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

export type EmbedProfile = "bulk" | "online";
export type EndpointKind = "local" | "cloud";

export interface ParsedEndpoint {
  baseUrl: string;
  kind: EndpointKind;
}

export interface EmbedClientOptions {
  /** 逗号分隔，或数组。`cloud:` / `local:` 前缀覆盖按主机名的判断。 */
  endpoints: string | string[];
  /** bulk 每批 32，同时只发一个批次。online 每批 4。 */
  profile?: EmbedProfile;
  apiKey?: string;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

interface EndpointNode {
  baseUrl: string;
  kind: EndpointKind;
  inFlight: number;
  healthy: boolean;
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
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "0.0.0.0";
  } catch {
    return false;
  }
}

function embeddingsUrl(baseUrl: string): string {
  const base = baseUrl.replace(/\/+$/, "");
  if (base.endsWith("/embeddings")) return base;
  return `${base}/embeddings`;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class CivicEmbedClient {
  private readonly nodes: EndpointNode[];
  private readonly profile: EmbedProfile;
  private readonly apiKey: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private cursor = 0;

  constructor(options: EmbedClientOptions) {
    const parsed = parseEndpointList(options.endpoints);
    if (parsed.length === 0) {
      throw new Error("No embedding endpoints configured");
    }
    this.nodes = parsed.map((endpoint) => ({
      baseUrl: endpoint.baseUrl,
      kind: endpoint.kind,
      inFlight: 0,
      healthy: true,
    }));
    this.profile = options.profile ?? "bulk";
    this.apiKey = options.apiKey ?? "";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  get batchSize(): number {
    return batchSizeForProfile(this.profile);
  }

  /** 配置里只要有一个云端端点，429 就按云端退避。全是本地则不等。 */
  cloudBackoffEnabled(): boolean {
    return this.nodes.some((node) => node.kind === "cloud");
  }

  /**
   * 按运行档分批。每一批发出去之后才发下一批，所以单个 embed() 同时只有一个批次在飞。
   * 批次之间不休眠。
   */
  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const size = this.batchSize;
    const vectors: number[][] = [];
    for (let offset = 0; offset < texts.length; offset += size) {
      const slice = texts.slice(offset, offset + size);
      const batch = await this.embedBatch(slice);
      vectors.push(...batch);
    }
    return vectors;
  }

  private pickOrder(): EndpointNode[] {
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

  private async embedBatch(texts: string[]): Promise<number[][]> {
    const order = this.pickOrder();
    let lastError: Error | null = null;
    for (const node of order) {
      node.inFlight += 1;
      try {
        return await this.postWithRateLimit(node, texts);
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        node.healthy = false;
      } finally {
        node.inFlight = Math.max(0, node.inFlight - 1);
      }
    }
    throw lastError ?? new Error("All embedding endpoints failed");
  }

  private async postWithRateLimit(node: EndpointNode, texts: string[]): Promise<number[][]> {
    try {
      return await this.post(node, texts);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const rateLimited = /429|rate limit|qpm limit/i.test(message);
      if (!rateLimited) throw error;
      if (this.cloudBackoffEnabled()) {
        await this.sleep(CLOUD_RATE_LIMIT_BACKOFF_MS);
      }
      return await this.post(node, texts);
    }
  }

  private async post(node: EndpointNode, texts: string[]): Promise<number[][]> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const response = await this.fetchImpl(embeddingsUrl(node.baseUrl), {
      method: "POST",
      headers,
      body: JSON.stringify({ model: EMBEDDING_MODEL, input: texts }),
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error(`Embedding API error (${response.status}): ${detail || response.statusText}`);
    }
    const payload = (await response.json()) as {
      data?: Array<{ embedding?: unknown; index?: number }>;
    };
    return readVectors(payload, texts.length);
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
