/**
 * 工单嵌入客户端。只负责把文本打到 OpenAI 兼容的 /v1/embeddings。
 * 不读工单、不写数据库、不依赖 Next。
 */

export const EMBEDDING_MODEL = "BAAI/bge-m3";
export const EMBEDDING_DIMENSIONS = 1024;
export const BULK_BATCH_SIZE = 32;
export const ONLINE_BATCH_SIZE = 4;
/** 云端 429 的退避。本地端点不走这段等待。 */
export const CLOUD_RATE_LIMIT_BACKOFF_MS = 70_000;
/** 节点被标为不健康后的默认冷却恢复时间 */
export const DEFAULT_UNHEALTHY_COOLDOWN_MS = 30_000;

export type EmbedProfile = "bulk" | "online";
export type EndpointKind = "local" | "cloud";

export interface ParsedEndpoint {
  baseUrl: string;
  kind: EndpointKind;
}

export interface EmbedRequestOptions {
  signal?: AbortSignal;
  timeoutMs?: number;
}

export interface EmbedClientOptions {
  /** 逗号分隔，或数组。`cloud:` / `local:` 前缀覆盖按主机名的判断。 */
  endpoints: string | string[];
  /** bulk 每批 32，同时只发一个批次。online 每批 4。 */
  profile?: EmbedProfile;
  apiKey?: string;
  endpointApiKeys?: Record<string, string>;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  unhealthyCooldownMs?: number;
  now?: () => number;
}

interface EndpointNode {
  baseUrl: string;
  kind: EndpointKind;
  apiKey?: string;
  inFlight: number;
  healthy: boolean;
  unhealthyAt?: number;
}

export interface EmbedNodeHealth {
  baseUrl: string;
  kind: EndpointKind;
  healthy: boolean;
  unhealthyAt?: number;
  inFlight: number;
}

export function batchSizeForProfile(profile: EmbedProfile): number {
  return profile === "online" ? ONLINE_BATCH_SIZE : BULK_BATCH_SIZE;
}

export function parseEndpointList(raw: string | string[]): ParsedEndpoint[] {
  const parts = (Array.isArray(raw) ? raw : raw.split(",")).flatMap((item) => item.split(","));
  const seen = new Set<string>();
  const endpoints: ParsedEndpoint[] = [];
  for (const part of parts) {
    let text = part.trim();
    if (!text) continue;
    let kind: EndpointKind | null = null;
    if (text.startsWith("cloud:")) {
      kind = "cloud";
      text = text.slice("cloud:".length).trim();
    } else if (text.startsWith("local:")) {
      kind = "local";
      text = text.slice("local:".length).trim();
    }
    text = text.replace(/\/+$/, "");
    if (!text) continue;
    if (!kind) kind = loopbackHost(text) ? "local" : "cloud";
    const key = `${kind}:${text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    endpoints.push({ baseUrl: text, kind });
  }
  return endpoints;
}

function loopbackHost(url: string): boolean {
  try {
    const host = new URL(url).hostname.replace(/^\[|\]$/g, "");
    return (
      host === "localhost" ||
      host === "127.0.0.1" ||
      host === "::1" ||
      host === "0.0.0.0" ||
      /^100\.\d+\.\d+\.\d+$/.test(host) ||
      /^192\.168\./.test(host) ||
      /^10\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    );
  } catch {
    return false;
  }
}

function embeddingsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/embeddings")) return base;
  return `${base}/embeddings`;
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    if (reason.name !== "AbortError") reason.name = "AbortError";
    return reason;
  }
  const message = typeof reason === "string" && reason.trim() ? reason : "The operation was aborted";
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export class CivicEmbedClient {
  private readonly nodes: EndpointNode[];
  private readonly profile: EmbedProfile;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number, signal?: AbortSignal) => Promise<void>;
  private readonly unhealthyCooldownMs: number;
  private readonly now: () => number;
  private cursor = 0;

  constructor(options: EmbedClientOptions) {
    const parsed = parseEndpointList(options.endpoints);
    if (parsed.length === 0) {
      throw new Error("No embedding endpoints configured");
    }
    this.nodes = parsed.map((endpoint) => ({
      baseUrl: endpoint.baseUrl,
      kind: endpoint.kind,
      apiKey: options.endpointApiKeys?.[endpoint.baseUrl],
      inFlight: 0,
      healthy: true,
    }));
    this.profile = options.profile ?? "bulk";
    this.apiKey = options.apiKey ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
    this.unhealthyCooldownMs = Math.max(0, options.unhealthyCooldownMs ?? DEFAULT_UNHEALTHY_COOLDOWN_MS);
    this.now = options.now ?? (() => Date.now());
  }

  get batchSize(): number {
    return batchSizeForProfile(this.profile);
  }

  getNodeHealth(): EmbedNodeHealth[] {
    return this.nodes.map((node) => ({
      baseUrl: node.baseUrl,
      kind: node.kind,
      healthy: node.healthy,
      unhealthyAt: node.unhealthyAt,
      inFlight: node.inFlight,
    }));
  }

  /** 配置里只要有一个云端端点，429 就按云端退避。全是本地则不等。 */
  cloudBackoffEnabled(): boolean {
    return this.nodes.some((node) => node.kind === "cloud");
  }

  /**
   * 按运行档分批。每一批发出去之后才发下一批，所以单个 embed() 同时只有一个批次在飞。
   * 批次之间不休眠。
   */
  async embed(texts: string[], options?: EmbedRequestOptions): Promise<number[][]> {
    if (options?.signal?.aborted) {
      throw createAbortError(options.signal);
    }
    if (texts.length === 0) return [];
    const size = this.batchSize;
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += size) {
      if (options?.signal?.aborted) {
        throw createAbortError(options.signal);
      }
      const slice = texts.slice(offset, offset + size);
      const batch = await this.embedBatch(slice, options);
      vectors.push(...batch);
    }
    return vectors;
  }

  private pickOrder(): EndpointNode[] {
    const now = this.now();
    for (const node of this.nodes) {
      if (!node.healthy && node.unhealthyAt !== undefined && now - node.unhealthyAt >= this.unhealthyCooldownMs) {
        node.healthy = true;
        node.unhealthyAt = undefined;
      }
    }
    const healthy = this.nodes.filter((node) => node.healthy);
    const pool = healthy.length > 0 ? healthy : this.nodes;
    const start = this.cursor % pool.length;
    this.cursor = (this.cursor + 1) % pool.length;
    const rotated = [...pool.slice(start), ...pool.slice(0, start)];
    return rotated
      .map((node, index) => ({ node, index }))
      .sort((left, right) => left.node.inFlight - right.node.inFlight || left.index - right.index)
      .map((row) => row.node);
  }

  private async embedBatch(texts: string[], options?: EmbedRequestOptions): Promise<number[][]> {
    const order = this.pickOrder();
    let lastError: Error | null = null;
    for (const node of order) {
      if (options?.signal?.aborted) {
        throw createAbortError(options.signal);
      }
      node.inFlight += 1;
      try {
        const result = await this.postWithRateLimit(node, texts, options);
        node.healthy = true;
        node.unhealthyAt = undefined;
        return result;
      } catch (error) {
        if (options?.signal?.aborted) {
          throw createAbortError(options.signal);
        }
        lastError = error instanceof Error ? error : new Error(String(error));
        node.healthy = false;
        node.unhealthyAt = this.now();
      } finally {
        node.inFlight = Math.max(0, node.inFlight - 1);
      }
    }
    throw lastError ?? new Error("All embedding endpoints failed");
  }

  private async postWithRateLimit(
    node: EndpointNode,
    texts: string[],
    options?: EmbedRequestOptions
  ): Promise<number[][]> {
    if (options?.signal?.aborted) {
      throw createAbortError(options.signal);
    }
    try {
      return await this.post(node, texts, options);
    } catch (error) {
      if (options?.signal?.aborted) {
        throw createAbortError(options.signal);
      }
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = /429|rate limit|qpm limit/i.test(message);
      if (!rateLimited) throw error;
      if (this.cloudBackoffEnabled()) {
        await this.sleep(CLOUD_RATE_LIMIT_BACKOFF_MS, options?.signal);
      }
      if (options?.signal?.aborted) {
        throw createAbortError(options.signal);
      }
      return await this.post(node, texts, options);
    }
  }

  private async post(
    node: EndpointNode,
    texts: string[],
    options?: EmbedRequestOptions
  ): Promise<number[][]> {
    const externalSignal = options?.signal;
    if (externalSignal?.aborted) {
      throw createAbortError(externalSignal);
    }

    const timeoutMs = options?.timeoutMs && options.timeoutMs > 0 ? options.timeoutMs : undefined;
    let combinedController: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onExternalAbort: (() => void) | undefined;

    if (externalSignal || timeoutMs) {
      combinedController = new AbortController();
      if (timeoutMs) {
        const timeoutErr = new Error(`Embedding request timed out after ${timeoutMs}ms`);
        timeoutErr.name = "AbortError";
        timer = setTimeout(() => combinedController?.abort(timeoutErr), timeoutMs);
      }
      if (externalSignal) {
        onExternalAbort = () => combinedController?.abort(createAbortError(externalSignal));
        externalSignal.addEventListener("abort", onExternalAbort, { once: true });
      }
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    const effectiveApiKey = (node.apiKey ?? this.apiKey).trim();
    if (effectiveApiKey) headers.Authorization = `Bearer ${effectiveApiKey}`;

    try {
      const response = await this.fetchImpl(embeddingsUrl(node.baseUrl), {
        method: "POST",
        headers,
        body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
        ...(combinedController ? { signal: combinedController.signal } : {}),
      });
      if (!response.ok) {
        const detail = await response.text().catch(() => "");
        throw new Error(`Embedding API error (${response.status}): ${detail || response.statusText}`);
      }
      const payload = (await response.json()) as {
        data?: Array<{ embedding?: unknown; index?: number }>;
      };
      return readVectors(payload, texts.length);
    } catch (error) {
      if (externalSignal?.aborted) {
        throw createAbortError(externalSignal);
      }
      throw error;
    } finally {
      if (timer) clearTimeout(timer);
      if (externalSignal && onExternalAbort) {
        externalSignal.removeEventListener("abort", onExternalAbort);
      }
    }
  }
}

function readVectors(
  payload: { data?: Array<{ embedding?: unknown; index?: number }> },
  expected: number
): number[][] {
  if (!payload.data || !Array.isArray(payload.data)) {
    throw new Error("Embedding response missing data array");
  }
  const rows = [...payload.data].sort((left, right) => (left.index ?? 0) - (right.index ?? 0));
  if (rows.length !== expected) {
    throw new Error(`Embedding count ${rows.length} != ${expected}`);
  }
  return rows.map((row) => {
    const embedding = row.embedding;
    if (!Array.isArray(embedding) || embedding.length !== EMBEDDING_DIMENSIONS) {
      throw new Error(`Embedding dimension ${Array.isArray(embedding) ? embedding.length : "invalid"} != ${EMBEDDING_DIMENSIONS}`);
    }
    const vector = embedding.map((value) => {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new Error("Embedding value is not a finite number");
      }
      return value;
    });
    return vector;
  });
}

export function createEmbedClient(options: EmbedClientOptions): CivicEmbedClient {
  return new CivicEmbedClient(options);
}
