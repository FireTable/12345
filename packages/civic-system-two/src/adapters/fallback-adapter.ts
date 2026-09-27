import { CivicChatCompletion, CivicChatCompletionParams } from '../types';
import { ISystemTwoAdapter } from './types';

export class FallbackAdapter implements ISystemTwoAdapter {
  readonly name = 'FallbackAdapter (Safe Offline Emergency Failsafe)';

  async isAvailable(): Promise<boolean> {
    return true; // 始终可用作为兜底
  }

  async chatCompletions(params: CivicChatCompletionParams): Promise<CivicChatCompletion> {
    const isJson = params.response_format && params.response_format.type !== 'text';

    const fallbackPayload = {
      fallback: true,
      status: 'offline_emergency',
      message: 'System-Two 所有推理后端（本地 Metal 及云端灾备）当前不可用，已进入兜底状态。',
      timestamp: new Date().toISOString(),
    };

    const content = isJson
      ? JSON.stringify(fallbackPayload, null, 2)
      : '【系统提示】慢思考引擎 (System Two) 当前处于离线安全降级模式。';

    return {
      id: `chatcmpl-fallback-${Date.now()}`,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model: 'system-two-fallback-safe',
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content,
            reasoning_content: '检测到所有模型服务离线，触发紧急降级兜底逻辑。',
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      },
      parsed: isJson ? fallbackPayload : undefined,
    };
  }
}
