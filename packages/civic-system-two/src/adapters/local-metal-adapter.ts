import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  SystemTwoConfig,
} from '../types';
import { extractReasoningAndContent, parseStructuredJson } from '../parser';
import { ISystemTwoAdapter } from './types';
import { recordNodeMetric } from '../metrics';

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
          `[LocalMetalAdapter] llama-server HTTP ${res.status}: ${res.statusText}. ${errorText}`
        );
      }

      const raw = (await res.json()) as any;
      const durationMs = Math.max(1, Date.now() - startMs);

      // 提取 timings 和动态生成速率 tok/s
      let tokensPerSecond = 0;
      if (raw.timings && typeof raw.timings.predicted_per_second === 'number' && raw.timings.predicted_per_second > 0) {
        tokensPerSecond = raw.timings.predicted_per_second;
      } else if (raw.timings && typeof raw.timings.predicted_ms === 'number' && raw.timings.predicted_ms > 0 && raw.timings.predicted_n) {
        tokensPerSecond = raw.timings.predicted_n / (raw.timings.predicted_ms / 1000);
      } else if (raw.usage?.completion_tokens && durationMs > 0) {
        tokensPerSecond = raw.usage.completion_tokens / (durationMs / 1000);
      }

      const completionTokens = raw.usage?.completion_tokens ?? raw.timings?.predicted_n ?? 0;
      const promptTokens = raw.usage?.prompt_tokens ?? raw.timings?.prompt_n ?? 0;
      const totalTokens = raw.usage?.total_tokens ?? (completionTokens + promptTokens);

      // System-2 原生完整处理耗时: prompt_ms (首字/上下文预填充) + predicted_ms (生成完整工单结构体耗时)
      const modelPromptMs = Number(raw.timings?.prompt_ms || 0);
      const modelPredictedMs = Number(raw.timings?.predicted_ms || 0);
      const modelTotalMs = modelPromptMs + modelPredictedMs;
      // 优先采用 System-2 原生模型报告的完整处理时间，若无则使用精确往返耗时
      const finalDurationMs = modelTotalMs > 0 ? Math.round(modelTotalMs) : durationMs;

      recordNodeMetric({
        endpoint: this.endpoint,
        tokensPerSecond: tokensPerSecond > 0 ? Math.round(tokensPerSecond * 10) / 10 : undefined,
        completionTokens,
        promptTokens,
        totalTokens,
        durationMs: finalDurationMs,
        updatedAt: Date.now(),
      });

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
              total_ms: modelTotalMs > 0 ? Math.round(modelTotalMs) : undefined,
            }
          : undefined,
        parsed,
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
