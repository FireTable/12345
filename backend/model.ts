import { ChatOpenAI } from "@langchain/openai";
import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import { z } from "zod";
import nextEnvPkg from "@next/env";

try {
  const loadEnvConfig = (nextEnvPkg as any)?.loadEnvConfig || (nextEnvPkg as any)?.default?.loadEnvConfig;
  if (typeof loadEnvConfig === "function") {
    loadEnvConfig(process.cwd());
  }
} catch (e) { }

const DEFAULT_HEADERS = {
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
};

/**
 * 封装自定义 ChatOpenAI 类，消除 js-tiktoken 对自定义模型名称（如 gpt-5.6-terra）的 Unknown model 警告
 */
export class PatchedChatOpenAI extends ChatOpenAI {
  async getNumTokens(content: string): Promise<number> {
    return Math.ceil((content?.length || 0) / 2);
  }

  async getNumTokensFromMessages(messages: any[]): Promise<{ totalCount: number; countPerMessage: number[] }> {
    const countPerMessage = messages.map((m: any) => {
      const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
      return Math.ceil((text?.length || 0) / 2);
    });
    const totalCount = countPerMessage.reduce((a: number, b: number) => a + b, 0);
    return { totalCount, countPerMessage };
  }
}

/**
 * 78Code / OpenAI-compatible Chat LLM (gpt-5.6-terra)
 */
export function isLocalLlm(): boolean {
  const base = (process.env.OPENAI_BASE_URL || "http://127.0.0.1:8080/v1").toLowerCase();
  return /localhost|127\.0\.0\.1|0\.0\.0\.0|::1/.test(base);
}

export function isOllamaLlm(): boolean {
  return /:11434\b/.test(process.env.OPENAI_BASE_URL || "");
}

/** Cloud APIs can take 10; local MLX/Ollama is sequential — keep it at 1 unless overridden. */
export function llmConcurrency(): number {
  const raw = Number(process.env.LLM_CONCURRENCY);
  if (Number.isFinite(raw) && raw >= 1) return Math.trunc(raw);
  return isLocalLlm() ? 5 : 10;
}

const ToolProbeSchema = z.object({ ping: z.string() });

let toolCallingSupported: boolean | null = null;
let toolCallingProbe: Promise<boolean> | null = null;

/** 进程内缓存：一次探测，整场研判复用。 */
export function modelSupportsToolCallingCached(): boolean | null {
  return toolCallingSupported;
}

export function markToolCallingUnsupported(reason?: string): void {
  if (toolCallingSupported !== false) {
    console.warn(
      `[llm] tool calling disabled, fallback to JSON${reason ? `: ${reason}` : ""}`
    );
  }
  toolCallingSupported = false;
}

/**
 * 优先探测当前端点是否支持 tool / function calling。
 * 支持则后续走 withStructuredOutput；失败只记一次，整场回退 JSON。
 */
export async function modelSupportsToolCalling(): Promise<boolean> {
  if (toolCallingSupported !== null) return toolCallingSupported;
  if (toolCallingProbe) return toolCallingProbe;

  toolCallingProbe = (async () => {
    try {
      const chat = getChatModel(0);
      const structured = chat.withStructuredOutput(ToolProbeSchema);
      const raced = await Promise.race([
        structured.invoke('只通过函数/工具调用返回 {"ping":"ok"}，不要输出其它文字。'),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("tool-calling probe timeout")), 12000)
        ),
      ]);
      const ping = (raced as { ping?: unknown })?.ping;
      toolCallingSupported = typeof ping === "string" && ping.length > 0;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      toolCallingSupported = false;
      console.warn(`[llm] tool calling probe failed, fallback to JSON: ${message}`);
    }
    if (toolCallingSupported) {
      console.info("[llm] tool calling available, using structured output");
    }
    return toolCallingSupported;
  })();

  return toolCallingProbe;
}

export function getChatModel(temperature: number = 0.2): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY || "mlx";
  const baseURL = process.env.OPENAI_BASE_URL || "http://127.0.0.1:8080/v1";
  const model = process.env.OPENAI_MODEL || "MiniCPM4.1-8B-MLX";
  const local = isLocalLlm();
  const ollama = isOllamaLlm();
  const ctx = Number(process.env.OLLAMA_NUM_CTX);
  const numCtx = Number.isFinite(ctx) && ctx >= 512 ? Math.trunc(ctx) : 4096;

  return new PatchedChatOpenAI({
    model,
    apiKey,
    temperature,
    streaming: !local,
    maxTokens: local ? 384 : undefined,
    configuration: {
      baseURL,
      defaultHeaders: DEFAULT_HEADERS,
    },
    maxRetries: local ? 0 : 2,
    timeout: 120000,
    // Ollama OpenAI-compat only: cap KV cache + disable thinking
    ...(ollama
      ? {
        modelKwargs: {
          think: false,
          options: { num_ctx: numCtx, num_predict: 256 },
        },
      }
      : {}),
  });
}

/**
 * Baishanyun Dense Vector Embeddings (BAAI/bge-m3)
 */
export class BaishanEmbeddings extends Embeddings {
  private apiKey: string;
  private baseUrl: string;
  private model: string;

  constructor(
    apiKey: string,
    baseUrl: string = "https://api.edgefn.net/v1",
    model: string = "BAAI/bge-m3",
    params?: EmbeddingsParams
  ) {
    super(params ?? {});
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.model = model;
  }

  async embedDocuments(documents: string[]): Promise<number[][]> {
    if (documents.length === 0) return [];
    const url = this.baseUrl.replace(/\/$/, "") + "/embeddings";

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
        ...DEFAULT_HEADERS,
      },
      body: JSON.stringify({
        model: this.model,
        input: documents,
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Embedding API error (${res.status}): ${errText || res.statusText}`);
    }

    const data = await res.json();
    if (!data.data || !Array.isArray(data.data)) {
      throw new Error("Invalid response format from Embedding API: missing 'data' array");
    }

    return data.data.map((d: any) => d.embedding);
  }

  async embedQuery(document: string): Promise<number[]> {
    const vectors = await this.embedDocuments([document]);
    return vectors[0];
  }
}

export function getEmbeddingModel(): Embeddings {
  const apiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";
  const baseURL = process.env.EMBEDDING_BASE_URL || "https://api.edgefn.net/v1";
  const model = process.env.EMBEDDING_MODEL || "BAAI/bge-m3";

  return new BaishanEmbeddings(apiKey, baseURL, model);
}

/**
 * Baishanyun Rerank Client (bge-reranker-v2-m3)
 */
export class RerankModel {
  constructor(
    public readonly config: {
      baseUrl: string;
      modelName: string;
      apiKey: string;
    }
  ) { }

  async rerank(
    query: string,
    documents: string[],
    topN?: number
  ): Promise<Array<{ index: number; score: number }>> {
    let url = this.config.baseUrl.replace(/\/$/, "");
    if (!url.endsWith("/rerank")) {
      url = `${url}/rerank`;
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
        ...DEFAULT_HEADERS,
      },
      body: JSON.stringify({
        model: this.config.modelName,
        query,
        documents,
        top_n: topN,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Rerank API error (${response.status}): ${errText || response.statusText}`);
    }

    const data = (await response.json()) as {
      results: Array<{ index: number; relevance_score: number }>;
    };

    if (!data.results || !Array.isArray(data.results)) {
      throw new Error("Invalid response format from Rerank API: missing 'results' array");
    }

    return data.results.map((r) => ({
      index: r.index,
      score: r.relevance_score,
    }));
  }
}

export function getRerankModel(): RerankModel | null {
  const apiKey = process.env.RERANK_API_KEY || process.env.EMBEDDING_API_KEY;
  const baseUrl = process.env.RERANK_BASE_URL || "https://api.edgefn.net/v1";
  const modelName = process.env.RERANK_MODEL || "bge-reranker-v2-m3";

  if (!apiKey) return null;

  return new RerankModel({
    baseUrl,
    modelName,
    apiKey,
  });
}
