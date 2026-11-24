import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  CivicChatStreamChunk,
  CloudFallbackConfig,
} from '../types';
import { extractReasoningAndContent, parseStructuredJson } from '../parser';
import { ISystemTwoAdapter } from './types';
import { recordNodeMetric } from '../metrics';
import { createAbortError, linkAbortSignals } from './abort-utils';
import { readOpenAISseStream } from './sse-stream';

const CLOUD_ID_CARD_RE =
  /(?<!\d)[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx](?!\d)/g;
const CLOUD_BANK_CARD_RE = /(?<!\d)(?:62\d{14,17}|[45]\d{15})(?!\d)/g;
const CLOUD_MOBILE_RE = /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d[\s-]?\d{4}[\s-]?\d{4}(?!\d)/g;
const CLOUD_LANDLINE_RE = /(?<!\d)0\d{2,3}-\d{7,8}(?!\d)/g;
const CLOUD_EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

export function scrubCloudPiiText(text: string): string {
  if (!text) return text;
  return text
    .replace(CLOUD_ID_CARD_RE, '{{ID_CARD_CLOUD}}')
    .replace(CLOUD_BANK_CARD_RE, '{{BANK_CARD_CLOUD}}')
    .replace(CLOUD_MOBILE_RE, '{{PHONE_NUMBER_CLOUD}}')
    .replace(CLOUD_LANDLINE_RE, '{{PHONE_NUMBER_CLOUD}}')
    .replace(CLOUD_EMAIL_RE, '{{EMAIL_CLOUD}}');
}

function isMiniMaxTarget(endpoint: string, model: string): boolean {
  return /minimax/i.test(endpoint) || /^minimax/i.test(model);
}

function sanitizeMessagesForCloud(
  messages: CivicChatCompletionParams['messages']
): CivicChatCompletionParams['messages'] {
  return messages.map((msg) => {
    if (msg.role === 'system' || !msg.content) return msg;
    const scrubbed = scrubCloudPiiText(msg.content);
    return scrubbed === msg.content ? msg : { ...msg, content: scrubbed };
  });
}

export class CloudOpenAIAdapter implements ISystemTwoAdapter {
  readonly name = 'CloudOpenAIAdapter (Remote OpenAI-compatible)';
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;
  private availabilityCache: { ok: boolean; expiresAt: number } | null = null;
  private availabilityProbePromise: Promise<boolean> | null = null;

  constructor(config: CloudFallbackConfig, timeoutMs = 600000) {
    this.endpoint = config.endpoint.replace(/\/+$/, '');
    this.apiKey = config.apiKey;
    this.model = config.model;
    this.timeoutMs = timeoutMs;
  }

  async isAvailable(): Promise<boolean> {
    if (!this.endpoint || !this.apiKey) {
      return false;
    }
    const now = Date.now();
    if (this.availabilityCache && now < this.availabilityCache.expiresAt) {
      return this.availabilityCache.ok;
    }
    if (this.availabilityProbePromise) {
      return this.availabilityProbePromise;
    }

    const probe = (async () => {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 3000);
        const res = await fetch(`${this.endpoint}/models`, {
          headers: {
            Authorization: `Bearer ${this.apiKey}`,
          },
          signal: controller.signal,
        }).catch(() => null);

        clearTimeout(timer);
        const ok = !!(res && (res.ok || res.status === 401 || res.status === 403));
        this.availabilityCache = {
          ok,
          expiresAt: Date.now() + (ok ? 30_000 : 5_000),
        };
        return ok;
      } catch {
        this.availabilityCache = { ok: false, expiresAt: Date.now() + 5_000 };
        return false;
      } finally {
        this.availabilityProbePromise = null;
      }
    })();

    this.availabilityProbePromise = probe;
    return probe;
  }

  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    const url = `${this.endpoint}/chat/completions`;
    const safeMessages = sanitizeMessagesForCloud(params.messages);
    const targetModel = params.model || this.model;
    const isMiniMax = isMiniMaxTarget(this.endpoint, targetModel);
    const requestedMaxTokens = params.max_tokens ?? 2048;
    const effectiveMaxTokens = isMiniMax ? Math.max(requestedMaxTokens, 1536) : requestedMaxTokens;

    const payload: Record<string, unknown> = {
      model: targetModel,
      messages: safeMessages,
      temperature: params.temperature ?? 0.2,
      max_tokens: effectiveMaxTokens,
      stream: false,
    };

    if (isMiniMax) {
      if (params.enable_thinking !== true) {
        payload.reasoning_effort = 'low';
      }
    } else {
      payload.chat_template_kwargs = {
        enable_thinking: params.enable_thinking ?? false,
      };
    }

    if (params.top_p !== undefined) {
      payload.top_p = params.top_p;
    }

    if (params.response_format) {
      payload.response_format = params.response_format;
    }

    const linked = linkAbortSignals(this.timeoutMs, params.signal);
    const startMs = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: linked.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(
          `[CloudOpenAIAdapter] Remote HTTP ${res.status}: ${res.statusText}. ${errorText}`
        );
      }

      const raw = (await res.json()) as any;
      const durationMs = Math.max(1, Date.now() - startMs);
      const completionTokens = raw.usage?.completion_tokens ?? 0;
      const promptTokens = raw.usage?.prompt_tokens ?? 0;
      const totalTokens = raw.usage?.total_tokens ?? (completionTokens + promptTokens);

      let tokensPerSecond = 0;
      if (raw.timings && typeof raw.timings.predicted_per_second === 'number' && raw.timings.predicted_per_second > 0) {
        tokensPerSecond = raw.timings.predicted_per_second;
      } else if (completionTokens > 0 && durationMs > 0) {
        tokensPerSecond = completionTokens / (durationMs / 1000);
      }

      if (tokensPerSecond > 0) {
        recordNodeMetric({
          endpoint: this.endpoint,
          tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
          completionTokens,
          promptTokens,
          totalTokens,
          durationMs,
          updatedAt: Date.now(),
        });
      }

      const choices = (raw.choices || []).map((choice: any, idx: number) => {
        const rawContent = choice.message?.content || '';
        const rawReasoning = choice.message?.reasoning_content;
        const split = extractReasoningAndContent(rawContent, rawReasoning);

        return {
          index: choice.index ?? idx,
          message: {
            role: 'assistant' as const,
            content: split.content,
            reasoning_content: split.reasoning_content,
          },
          finish_reason: choice.finish_reason || 'stop',
        };
      });

      const firstChoiceContent = choices[0]?.message.content || '';
      let parsed: unknown = undefined;

      if (params.response_format && params.response_format.type !== 'text') {
        try {
          parsed = parseStructuredJson(firstChoiceContent);
        } catch (err: any) {
          console.warn(`[CloudOpenAIAdapter] 自动 JSON 解析失败: ${err.message}`);
        }
      }

      return {
        id: raw.id || `chatcmpl-cloud-${Date.now()}`,
        object: 'chat.completion',
        created: raw.created || Math.floor(Date.now() / 1000),
        model: raw.model || this.model,
        choices,
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: totalTokens,
        },
        timings: raw.timings
          ? {
              predicted_per_second: raw.timings.predicted_per_second,
              predicted_n: raw.timings.predicted_n,
              predicted_ms: raw.timings.predicted_ms,
              prompt_per_second: raw.timings.prompt_per_second,
              prompt_n: raw.timings.prompt_n,
              prompt_ms: raw.timings.prompt_ms,
            }
          : undefined,
        parsed,
      };
    } catch (err) {
      if (params.signal?.aborted) {
        throw createAbortError(params.signal);
      }
      throw err;
    } finally {
      linked.cleanup();
    }
  }

  async *chatCompletionsStream(
    params: CivicChatCompletionParams
  ): AsyncGenerator<CivicChatStreamChunk> {
    const url = `${this.endpoint}/chat/completions`;
    const safeMessages = sanitizeMessagesForCloud(params.messages);
    const targetModel = params.model || this.model;
    const isMiniMax = isMiniMaxTarget(this.endpoint, targetModel);
    const requestedMaxTokens = params.max_tokens ?? 2048;
    const effectiveMaxTokens = isMiniMax ? Math.max(requestedMaxTokens, 1536) : requestedMaxTokens;

    const payload: Record<string, unknown> = {
      model: targetModel,
      messages: safeMessages,
      temperature: params.temperature ?? 0.2,
      max_tokens: effectiveMaxTokens,
      stream: true,
    };

    if (isMiniMax) {
      if (params.enable_thinking !== true) {
        payload.reasoning_effort = 'low';
      }
    } else {
      payload.chat_template_kwargs = {
        enable_thinking: params.enable_thinking ?? false,
      };
    }

    if (params.top_p !== undefined) {
      payload.top_p = params.top_p;
    }

    if (params.response_format) {
      payload.response_format = params.response_format;
    }

    const linked = linkAbortSignals(this.timeoutMs, params.signal);
    const startMs = Date.now();
    let res: Response;

    try {
      res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'text/event-stream',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: linked.signal,
      });

      if (!res.ok) {
        const errorText = await res.text().catch(() => '');
        throw new Error(
          `[CloudOpenAIAdapter] Remote HTTP ${res.status}: ${res.statusText}. ${errorText}`
        );
      }
    } catch (err) {
      linked.cleanup();
      if (params.signal?.aborted) {
        throw createAbortError(params.signal);
      }
      throw err;
    }

    yield* readOpenAISseStream({
      res,
      endpoint: this.endpoint,
      externalSignal: params.signal,
      abortCombined: linked.abortCombined,
      cleanup: linked.cleanup,
      onComplete: ({ usage, timings, approxCompletionChunks }) => {
        const durationMs = Math.max(1, Date.now() - startMs);
        const completionTokens = usage?.completion_tokens ?? approxCompletionChunks;
        const promptTokens = usage?.prompt_tokens ?? 0;
        const totalTokens = usage?.total_tokens ?? completionTokens + promptTokens;

        let tokensPerSecond = 0;
        if (timings && typeof timings.predicted_per_second === 'number' && timings.predicted_per_second > 0) {
          tokensPerSecond = timings.predicted_per_second;
        } else if (completionTokens > 0 && durationMs > 0) {
          tokensPerSecond = completionTokens / (durationMs / 1000);
        }

        if (tokensPerSecond > 0) {
          recordNodeMetric({
            endpoint: this.endpoint,
            tokensPerSecond: Math.round(tokensPerSecond * 10) / 10,
            completionTokens,
            promptTokens,
            totalTokens,
            durationMs,
            updatedAt: Date.now(),
          });
        }
      },
    });
  }
}
