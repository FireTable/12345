import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  CloudFallbackConfig,
} from '../types';
import { extractReasoningAndContent, parseStructuredJson } from '../parser';
import { ISystemTwoAdapter } from './types';
import { recordNodeMetric } from '../metrics';

export class CloudOpenAIAdapter implements ISystemTwoAdapter {
  readonly name = 'CloudOpenAIAdapter (Remote OpenAI-compatible)';
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

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
      return !!(res && (res.ok || res.status === 401 || res.status === 403));
    } catch {
      return false;
    }
  }

  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    const url = `${this.endpoint}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: params.model || this.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 2048,
      stream: false,
      chat_template_kwargs: {
        enable_thinking: params.enable_thinking ?? false,
      },
    };

    if (params.top_p !== undefined) {
      payload.top_p = params.top_p;
    }

    if (params.response_format) {
      payload.response_format = params.response_format;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    const startMs = Date.now();

    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
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
    } finally {
      clearTimeout(timeout);
    }
  }
}
