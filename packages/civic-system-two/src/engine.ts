import { z } from 'zod';
import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  SystemTwoConfig,
} from './types.js';
import { ISystemTwoAdapter } from './adapters/types.js';
import { LocalMetalAdapter } from './adapters/local-metal-adapter.js';
import { CloudOpenAIAdapter } from './adapters/cloud-openai-adapter.js';
import { FallbackAdapter } from './adapters/fallback-adapter.js';
import { parseStructuredJson } from './parser.js';

export interface StructuredJsonResult<T> {
  data: T;
  reasoning_content?: string;
  raw_content: string;
  usage: CivicChatCompletion['usage'];
}

export class SystemTwoEngine {
  private localAdapter: LocalMetalAdapter;
  private cloudAdapter?: CloudOpenAIAdapter;
  private fallbackAdapter: FallbackAdapter;
  private activeAdapter: ISystemTwoAdapter;
  private config: SystemTwoConfig;

  private constructor(
    config: SystemTwoConfig,
    activeAdapter: ISystemTwoAdapter,
    localAdapter: LocalMetalAdapter,
    cloudAdapter?: CloudOpenAIAdapter,
    fallbackAdapter?: FallbackAdapter
  ) {
    this.config = config;
    this.activeAdapter = activeAdapter;
    this.localAdapter = localAdapter;
    this.cloudAdapter = cloudAdapter;
    this.fallbackAdapter = fallbackAdapter || new FallbackAdapter();
  }

  /**
   * 初始化并探测可用后端 (优先 Local Metal -> 其次 Cloud -> 最后 Fallback)
   */
  static async create(config: SystemTwoConfig = {}): Promise<SystemTwoEngine> {
    const localAdapter = new LocalMetalAdapter(config);
    const cloudAdapter = config.cloudFallback
      ? new CloudOpenAIAdapter(config.cloudFallback, config.timeoutMs)
      : undefined;
    const fallbackAdapter = new FallbackAdapter();

    let activeAdapter: ISystemTwoAdapter = fallbackAdapter;

    // 探测本地 Metal llama-server
    const isLocalAlive = await localAdapter.isAvailable();
    if (isLocalAlive) {
      activeAdapter = localAdapter;
    } else if (cloudAdapter) {
      const isCloudAlive = await cloudAdapter.isAvailable();
      if (isCloudAlive) {
        console.warn(
          '[SystemTwoEngine] 本地 Metal 后端不可用，已自动降级切换至云端灾备端点。'
        );
        activeAdapter = cloudAdapter;
      } else {
        console.warn(
          '[SystemTwoEngine] 本地与云端后端均不可用，已切换至安全离线兜底模式。'
        );
        activeAdapter = fallbackAdapter;
      }
    } else {
      console.warn(
        '[SystemTwoEngine] 本地 Metal 后端未启动且未配置云端灾备，已启用离线兜底模式。'
      );
      activeAdapter = fallbackAdapter;
    }

    return new SystemTwoEngine(
      config,
      activeAdapter,
      localAdapter,
      cloudAdapter,
      fallbackAdapter
    );
  }

  /**
   * 获取当前活跃的推理后端名称
   */
  getActiveBackend(): string {
    return this.activeAdapter.name;
  }

  /**
   * 刷新并重新探测健康状态
   */
  async refreshBackend(): Promise<string> {
    if (await this.localAdapter.isAvailable()) {
      this.activeAdapter = this.localAdapter;
    } else if (this.cloudAdapter && (await this.cloudAdapter.isAvailable())) {
      this.activeAdapter = this.cloudAdapter;
    } else {
      this.activeAdapter = this.fallbackAdapter;
    }
    return this.activeAdapter.name;
  }

  /**
   * 100% 兼容 OpenAI chat.completions.create 接口
   */
  readonly chat = {
    completions: {
      create: async <T = unknown>(
        params: CivicChatCompletionParams
      ): Promise<CivicChatCompletion<T>> => {
        try {
          return (await this.activeAdapter.chatCompletions(
            params
          )) as CivicChatCompletion<T>;
        } catch (error: any) {
          console.warn(
            `[SystemTwoEngine] 主后端 (${this.activeAdapter.name}) 调用失败: ${error.message}，正在尝试灾备链路...`
          );

          // 故障转移逻辑
          if (
            this.activeAdapter !== this.cloudAdapter &&
            this.cloudAdapter &&
            (await this.cloudAdapter.isAvailable())
          ) {
            this.activeAdapter = this.cloudAdapter;
            return (await this.cloudAdapter.chatCompletions(
              params
            )) as CivicChatCompletion<T>;
          }

          this.activeAdapter = this.fallbackAdapter;
          return (await this.fallbackAdapter.chatCompletions(
            params
          )) as CivicChatCompletion<T>;
        }
      },
    },
  };

  /**
   * 高阶快捷方法：结构化输出并带 Zod 校验
   * @param params 补全请求参数
   * @param schema 可选的 Zod Schema
   */
  async createJson<T>(
    params: Omit<CivicChatCompletionParams, 'response_format'> & {
      response_format?: CivicChatCompletionParams['response_format'];
    },
    schema?: z.ZodType<T>
  ): Promise<StructuredJsonResult<T>> {
    const format =
      params.response_format ||
      ({
        type: 'json_object',
      } as const);

    const completion = await this.chat.completions.create({
      ...params,
      response_format: format,
    });

    const rawContent = completion.choices[0]?.message.content || '';
    const reasoningContent = completion.choices[0]?.message.reasoning_content;

    const parsedData = parseStructuredJson<T>(rawContent, schema);

    return {
      data: parsedData,
      reasoning_content: reasoningContent,
      raw_content: rawContent,
      usage: completion.usage,
    };
  }
}
