import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  CloudFallbackConfig,
} from '../types.js';
import { extractReasoningAndContent, parseStructuredJson } from '../parser.js';
import { ISystemTwoAdapter } from './types.js';

export class CloudOpenAIAdapter implements ISystemTwoAdapter {
  readonly name = 'CloudOpenAIAdapter (Remote OpenAI-compatible)';
  private endpoint: string;
  private apiKey: string;
  private model: string;
  private timeoutMs: number;

  constructor(config: CloudFallbackConfig, timeoutMs = 120000) {
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
    };

    if (params.top_p !== undefined) {
      payload.top_p = params.top_p;
    }

    if (params.response_format) {
      payload.response_format = params.response_format;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);

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
          prompt_tokens: raw.usage?.prompt_tokens ?? 0,
          completion_tokens: raw.usage?.completion_tokens ?? 0,
          total_tokens: raw.usage?.total_tokens ?? 0,
        },
        parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
