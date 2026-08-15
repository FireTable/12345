import { ChatOpenAI } from "@langchain/openai";
import { Embeddings, type EmbeddingsParams } from "@langchain/core/embeddings";
import nextEnvPkg from "@next/env";

try {
  const loadEnvConfig = (nextEnvPkg as any)?.loadEnvConfig || (nextEnvPkg as any)?.default?.loadEnvConfig;
  if (typeof loadEnvConfig === "function") {
    loadEnvConfig(process.cwd());
  }
} catch (e) {}

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
export function getChatModel(temperature: number = 0.2): ChatOpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  const baseURL = process.env.OPENAI_BASE_URL || "https://www.78code.cc/v1";
  const model = process.env.OPENAI_MODEL || "gpt-5.6-terra";

  return new PatchedChatOpenAI({
    model,
    apiKey,
    temperature,
    streaming: true,
    configuration: {
      baseURL,
      defaultHeaders: DEFAULT_HEADERS,
    },
    maxRetries: 1,
    timeout: 15000,
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
  ) {}

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
