export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
  reasoning_content?: string;
  name?: string;
}

export type ResponseFormat =
  | { type: 'text' }
  | { type: 'json_object' }
  | {
      type: 'json_schema';
      json_schema: {
        name: string;
        strict?: boolean;
        schema: Record<string, unknown>;
      };
    };

export interface CivicChatCompletionParams {
  messages: ChatMessage[];
  model?: string;
  temperature?: number;
  max_tokens?: number;
  top_p?: number;
  response_format?: ResponseFormat;
  /**
   * 是否启用慢思考（思维链）。
   * 默认为 true。
   * 启用时，模型的思考过程会解析到 choices[0].message.reasoning_content 中，
   * 纯正文输出放入 choices[0].message.content。
   * 设置为 false 时，直接输出纯正文。
   */
  enable_thinking?: boolean;
  stream?: boolean;
  signal?: AbortSignal;
  /**
   * 本地集群流式首包最大等待毫秒数；超时仅中止本次本地尝试的内部 signal（不触动调用方 signal，不误标节点不健康），并切换至 cloudFallback。
   */
  localWaitTimeoutMs?: number;
  /**
   * 当本地健康节点全部已有在途请求且配置了 cloudFallback 时，直接走云端流式避免交互被本地批处理长尾饿死。
   */
  preferCloudWhenLocalBusy?: boolean;
  /**
   * 为 true 且已配置 cloudFallback 时，直接走云端流式（跳过本地慢节点等待，若云端失败再回退本地）。
   */
  preferCloudDirect?: boolean;
}

export interface CivicChatStreamChunk {
  deltaContent?: string;
  deltaReasoning?: string;
  finishReason?: string | null;
  endpoint?: string | null;
  usage?: CivicUsage;
  timings?: CivicTimings;
}

export interface CivicChatChoice {
  index: number;
  message: {
    role: 'assistant';
    content: string;
    reasoning_content?: string;
  };
  finish_reason: string;
}

export interface CivicUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

export interface CivicTimings {
  prompt_n?: number;
  prompt_ms?: number;
  prompt_per_second?: number;
  predicted_n?: number;
  predicted_ms?: number;
  predicted_per_second?: number;
  total_ms?: number;
}

export interface CivicChatCompletion<T = unknown> {
  id: string;
  object: 'chat.completion';
  created: number;
  model: string;
  choices: CivicChatChoice[];
  usage: CivicUsage;
  timings?: CivicTimings;
  /**
   * 当使用 response_format 为 json_object 或 json_schema 时，
   * 如果解析成功，则包含解析后的强类型对象
   */
  parsed?: T;
}

export interface CloudFallbackConfig {
  endpoint: string;
  apiKey: string;
  model: string;
}

export interface ClusterNodeObjectSpec {
  endpoint: string;
  apiKey?: string;
  model?: string;
  provider?: string;
  name?: string;
}

export type ClusterNodeSpec = string | ClusterNodeObjectSpec;

export interface SystemTwoConfig {
  /**
   * llama-server 本地端点，默认为 http://127.0.0.1:8132/v1
   */
  endpoint?: string;
  /**
   * 多节点算力集群端点列表，支持传入多个局域网/本机端点实现负载均衡加速
   */
  endpoints?: string[];
  /**
   * 多节点算力集群详细节点规格（支持按节点绑定独立 apiKey / model / provider）
   */
  nodes?: ClusterNodeSpec[];
  /**
   * 模型别名，默认 bonsai-2-27b
   */
  model?: string;
  /**
   * 鉴权密钥（本地 llama-server 默认为空或任意字符）
   */
  apiKey?: string;
  /**
   * 节点来源标记 (LOCAL / COLAB / CLOUD)
   */
  provider?: string;
  /**
   * 超时时间（毫秒），默认为 180,000ms (3分钟)
   */
  timeoutMs?: number;
  /**
   * 默认思考开关，默认为 true
   */
  enableThinkingDefault?: boolean;
  /**
   * 云端灾备降级配置 (OpenAI/DeepSeek 等标准接口)
   */
  cloudFallback?: CloudFallbackConfig;
  /**
   * GGUF 模型文件所在本地路径（用于自动化健康探测和自动启动）
   */
  modelPath?: string;
  /**
   * llama-server 可执行文件路径
   */
  serverBinPath?: string;
}
