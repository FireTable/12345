import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  SystemTwoConfig,
} from '../types.js';
import { extractReasoningAndContent, parseStructuredJson } from '../parser.js';
import { ISystemTwoAdapter } from './types.js';

export class LocalMetalAdapter implements ISystemTwoAdapter {
  readonly name = 'LocalMetalAdapter (llama-server / Metal)';
  private endpoint: string;
  private model: string;
  private apiKey?: string;
  private timeoutMs: number;
  private defaultEnableThinking: boolean;

  constructor(config: SystemTwoConfig = {}) {
    this.endpoint = (config.endpoint || 'http://127.0.0.1:8132/v1').replace(/\/+$/, '');
    this.model = config.model || 'bonsai-2-27b';
    this.apiKey = config.apiKey || 'local-token';
    this.timeoutMs = config.timeoutMs ?? 600000; // 默认 10 分钟充足慢思考预算
    this.defaultEnableThinking = config.enableThinkingDefault ?? true;
  }

  async isAvailable(): Promise<boolean> {
    try {
      const baseUrl = this.endpoint.replace(/\/v1$/, '');
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 2000);

      // llama-server 提供了 /health 和 /v1/models
      const res = await fetch(`${baseUrl}/health`, {
        signal: controller.signal,
      }).catch(() => null);

      clearTimeout(timer);
      if (res && res.ok) {
        return true;
      }

      // 如果没有 /health，尝试请求 /v1/models
      const controller2 = new AbortController();
      const timer2 = setTimeout(() => controller2.abort(), 2000);
      const res2 = await fetch(`${this.endpoint}/models`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller2.signal,
      }).catch(() => null);

      clearTimeout(timer2);
      return !!(res2 && res2.ok);
    } catch {
      return false;
    }
  }

  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    const enableThinking = params.enable_thinking ?? this.defaultEnableThinking;
    const url = `${this.endpoint}/chat/completions`;

    const payload: Record<string, unknown> = {
      model: params.model || this.model,
      messages: params.messages,
      temperature: params.temperature ?? 0.2,
      max_tokens: params.max_tokens ?? 2048,
      stream: false,
      chat_template_kwargs: {
        enable_thinking: enableThinking,
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
          `[LocalMetalAdapter] llama-server HTTP ${res.status}: ${res.statusText}. ${errorText}`
        );
      }

      const raw = (await res.json()) as any;

      // 提取与分离 choices 中的 reasoning 与 content
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

      // 如果请求要求了 JSON 输出，执行安全的解析并挂载在 completion.parsed 上
      if (params.response_format && params.response_format.type !== 'text') {
        try {
          parsed = parseStructuredJson(firstChoiceContent);
        } catch (err: any) {
          // 如果解析失败但模型给出了正文，记录警告但不直接崩溃
          console.warn(`[LocalMetalAdapter] 自动 JSON 解析失败: ${err.message}`);
        }
      }

      return {
        id: raw.id || `chatcmpl-${Date.now()}`,
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
