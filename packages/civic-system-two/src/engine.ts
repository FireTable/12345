import { z } from 'zod';
import {
  CivicChatCompletion,
  CivicChatCompletionParams,
  SystemTwoConfig,
} from './types';
import { ISystemTwoAdapter } from './adapters/types';
import { LocalMetalAdapter } from './adapters/local-metal-adapter';
import { PooledMetalAdapter } from './adapters/pooled-metal-adapter';
import { CloudOpenAIAdapter } from './adapters/cloud-openai-adapter';
import { FallbackAdapter } from './adapters/fallback-adapter';
import { parseStructuredJson } from './parser';

export interface CreateJSONOptions {
  messages: CivicChatCompletionParams['messages'];
  enableThinking?: boolean;
  temperature?: number;
  maxTokens?: number;
  model?: string;
  response_format?: CivicChatCompletionParams['response_format'];
}

export interface StructuredJSONResult<T> {
  data: T;
  reasoning?: string;
  raw: string;
  usage: CivicChatCompletion['usage'];
  timings?: CivicChatCompletion['timings'];
  /**
   * 本次请求实际命中的 endpoint URL（仅当 activeAdapter 是 PooledMetalAdapter 时有值）。
   * 用于在调用方按节点分别统计最近处理过的工单。
   */
  endpoint?: string | null;
}

export interface EndpointTicketPreview {
  id: string;
  ticketNo?: string;
  address?: string | null;
  canonicalSubject?: string | null;
  eventType?: string | null;
  durationMs?: number;
  processedAt: number;
}

export type StructuredJsonResult<T> = StructuredJSONResult<T>;

export class SystemTwoEngine {
  private clusterAdapter: PooledMetalAdapter;
  private cloudAdapter?: CloudOpenAIAdapter;
  private fallbackAdapter: FallbackAdapter;
  private activeAdapter: ISystemTwoAdapter;
  private config: SystemTwoConfig;

  // Per-endpoint 最近处理过的工单预览（in-memory，进程级单例；不落库）
  // 用于 workbench 按节点展示"该 endpoint 最新处理了哪些工单"。
  // 容量上限 8/endpoint，FIFO 滚动。
  private endpointRecentTickets: Map<string, EndpointTicketPreview[]> = new Map();
  private static readonly ENDPOINT_TICKETS_MAX = 8;

  private constructor(
    config: SystemTwoConfig,
    activeAdapter: ISystemTwoAdapter,
    clusterAdapter: PooledMetalAdapter,
    cloudAdapter?: CloudOpenAIAdapter,
    fallbackAdapter?: FallbackAdapter
  ) {
    this.config = config;
    this.activeAdapter = activeAdapter;
    this.clusterAdapter = clusterAdapter;
    this.cloudAdapter = cloudAdapter;
    this.fallbackAdapter = fallbackAdapter || new FallbackAdapter();
  }

  /**
   * 初始化并探测可用后端 (优先 Local Metal 集群池 -> 其次 Cloud -> 最后 Fallback)
   */
  static async create(config: SystemTwoConfig = {}): Promise<SystemTwoEngine> {
    const rawEndpoints =
      config.endpoints && config.endpoints.length > 0
        ? config.endpoints
        : (config.endpoint || 'http://127.0.0.1:8132/v1')
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean);

    const clusterAdapter = new PooledMetalAdapter(rawEndpoints, config);
    const cloudAdapter = config.cloudFallback
      ? new CloudOpenAIAdapter(config.cloudFallback, config.timeoutMs)
      : undefined;
    const fallbackAdapter = new FallbackAdapter();

    let activeAdapter: ISystemTwoAdapter = fallbackAdapter;

    // 探测本地/局域网算力集群
    const isClusterAlive = await clusterAdapter.isAvailable();
    if (isClusterAlive) {
      activeAdapter = clusterAdapter;
    } else if (cloudAdapter) {
      const isCloudAlive = await cloudAdapter.isAvailable();
      if (isCloudAlive) {
        console.warn(
          '[SystemTwoEngine] 本地算力集群节点不可用，已自动降级切换至云端灾备端点。'
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
        '[SystemTwoEngine] 本地算力集群未就绪且未配置云端灾备，已启用离线兜底模式。'
      );
      activeAdapter = fallbackAdapter;
    }

    return new SystemTwoEngine(
      config,
      activeAdapter,
      clusterAdapter,
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
   * 获取当前在线健康的节点列表
   */
  getHealthyEndpoints(): string[] {
    return this.clusterAdapter.getHealthyEndpoints();
  }

  /**
   * 获取当前在线的节点数量
   */
  getActiveNodeCount(): number {
    return this.clusterAdapter.getActiveNodeCount();
  }

  /**
   * 刷新并重新探测健康状态
   */
  async refreshBackend(): Promise<string> {
    if (await this.clusterAdapter.isAvailable()) {
      this.activeAdapter = this.clusterAdapter;
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
   * 直观命令式结构化 JSON 抽取：显式传入 Zod Schema 和思考开关，无隐式黑盒封装
   * @param schema 必传的 Zod Schema，严格守卫返回类型
   * @param options 结构化调用选项 (显式 enableThinking 等)
   */
  async createJSON<T>(
    schema: z.ZodType<T>,
    options: CreateJSONOptions
  ): Promise<StructuredJSONResult<T>> {
    const enableThinking = options.enableThinking ?? false;
    const format = options.response_format || ({ type: 'json_object' } as const);

    const completion = await this.chat.completions.create({
      messages: options.messages,
      enable_thinking: enableThinking,
      model: options.model,
      temperature: options.temperature,
      max_tokens: options.maxTokens ?? (enableThinking ? 4096 : 2048),
      response_format: format,
    });

    const raw = completion.choices[0]?.message.content || '';
    const reasoning = completion.choices[0]?.message.reasoning_content;
    const data = parseStructuredJson<T>(raw, schema);

    return {
      data,
      reasoning,
      raw,
      usage: completion.usage,
      timings: completion.timings,
      // 仅 cluster adapter 能告诉你"这次命中了哪个 endpoint"；
      // cloud/fallback 是单一端点没必要记。
      endpoint:
        this.activeAdapter === this.clusterAdapter
          ? this.clusterAdapter.getLastUsedEndpoint()
          : null,
    };
  }

  /**
   * 把刚处理完的工单按 endpoint 记录到进程内的最近列表头部。
   * 同 endpoint 超过 ENDPOINT_TICKETS_MAX 条时丢最旧的。
   */
  recordProcessedTicket(endpoint: string, ticket: Omit<EndpointTicketPreview, "processedAt">): void {
    if (!endpoint) return;
    const list = this.endpointRecentTickets.get(endpoint) || [];
    list.unshift({ ...ticket, processedAt: Date.now() });
    if (list.length > SystemTwoEngine.ENDPOINT_TICKETS_MAX) {
      list.length = SystemTwoEngine.ENDPOINT_TICKETS_MAX;
    }
    this.endpointRecentTickets.set(endpoint, list);
  }

  /**
   * 拿到当前 in-memory 的全部 endpoint → 最近工单列表映射。
   * 返回 plain object 方便 JSON 序列化透传到前端。
   */
  getEndpointRecentTickets(): Record<string, EndpointTicketPreview[]> {
    const out: Record<string, EndpointTicketPreview[]> = {};
    for (const [ep, list] of this.endpointRecentTickets.entries()) {
      out[ep] = [...list];
    }
    return out;
  }

  /**
   * 兼容旧版调用的 createJson 别名
   */
  async createJson<T>(
    params: Omit<CivicChatCompletionParams, 'response_format'> & {
      response_format?: CivicChatCompletionParams['response_format'];
    },
    schema?: z.ZodType<T>
  ): Promise<StructuredJSONResult<T>> {
    return this.createJSON(schema || (z.any() as any), {
      messages: params.messages,
      enableThinking: params.enable_thinking,
      temperature: params.temperature,
      maxTokens: params.max_tokens,
      model: params.model,
      response_format: params.response_format,
    });
  }
}
