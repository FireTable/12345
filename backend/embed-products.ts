import { createHash } from "node:crypto";
import {
  CivicEmbedClient,
  createEmbedClient,
  parseEndpointList,
  type EmbedProfile,
  type EmbedRequestOptions,
  type ParsedEndpoint,
} from "@civic/embed";
import { isColabEndpoint, isLocalEndpoint, listEnabledComputeNodes, normalizeProvider, type ComputeNodeProvider } from "@/lib/compute-nodes";

declare global {
  var __civic_embed_clients: Map<string, CivicEmbedClient> | undefined;
}

export interface ActiveEmbedEndpointSpec {
  endpoint: string;
  apiKey?: string;
  model?: string;
  provider: ComputeNodeProvider;
  name?: string;
  source: "ENV" | "DB";
}

export function embedProfileFromEnv(): EmbedProfile {
  return process.env.EMBEDDING_PROFILE === "online" ? "online" : "bulk";
}

export function embedEndpointsFromEnv(): string {
  return process.env.EMBEDDING_ENDPOINTS || process.env.EMBEDDING_BASE_URL || "https://api.edgefn.net/v1";
}

/**
 * 合并环境变量 Embedding 端点与 public.compute_nodes 中启用的 EMBEDDING 节点。
 */
export async function resolveActiveEmbedEndpoints(): Promise<ActiveEmbedEndpointSpec[]> {
  const merged = new Map<string, ActiveEmbedEndpointSpec>();
  const envKey = (process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "").trim() || undefined;
  const colabKey = (process.env.CIVIC_COLAB_API_KEY || "").trim() || undefined;
  const envModel = (process.env.EMBEDDING_MODEL || "BAAI/bge-m3").trim();

  for (const part of embedEndpointsFromEnv().split(",")) {
    const ep = part.trim().replace(/^(?:cloud|local):/i, "").trim().replace(/\/+$/, "");
    if (!ep) continue;
    const isColab = isColabEndpoint(ep);
    const isLocal = !isColab && isLocalEndpoint(ep);
    merged.set(ep, {
      endpoint: ep,
      apiKey: isColab ? colabKey : isLocal ? undefined : envKey,
      model: envModel,
      provider: isColab ? "COLAB" : isLocal ? "LOCAL" : "CLOUD",
      source: "ENV",
    });
  }

  try {
    const dbNodes = await listEnabledComputeNodes("EMBEDDING");
    for (const node of dbNodes) {
      const ep = (node.endpoint || "").trim().replace(/\/+$/, "");
      if (!ep) continue;
      merged.set(ep, {
        endpoint: ep,
        apiKey: node.apiKey?.trim() || undefined,
        model: node.model?.trim() || envModel,
        provider: normalizeProvider(node.provider, ep),
        name: node.name,
        source: "DB",
      });
    }
  } catch {
    // 数据库未就绪时平滑回退环境变量端点
  }

  return Array.from(merged.values());
}

export function extractionProductText(ticket: {
  summarizeTitle?: string | null;
  canonicalSubject?: string | null;
  eventType?: string | null;
  canonicalLocation?: string | null;
  subdistrict?: string | null;
  sourceCategory?: string | null;
}): string {
  return [
    ticket.summarizeTitle,
    ticket.canonicalSubject,
    ticket.eventType,
    ticket.canonicalLocation,
    ticket.subdistrict,
    ticket.sourceCategory,
  ]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join("\n");
}

export function themeProductText(theme: {
  aiSummary?: string | null;
  canonicalSubject?: string | null;
  eventType?: string | null;
  canonicalLocation?: string | null;
  category?: string | null;
}): string {
  return [
    theme.aiSummary,
    theme.canonicalSubject,
    theme.eventType,
    theme.canonicalLocation,
    theme.category,
  ]
    .map((value) => (value || "").trim())
    .filter(Boolean)
    .join("\n");
}

export interface SharedEmbedClientOptions {
  endpoints?: string | string[];
  profile?: EmbedProfile;
  apiKey?: string;
  endpointApiKeys?: Record<string, string>;
  unhealthyCooldownMs?: number;
}

export function buildColabEndpointApiKeys(parsedEndpoints: ParsedEndpoint[]): Record<string, string> {
  const colabKey = process.env.CIVIC_COLAB_API_KEY?.trim();
  if (!colabKey) return {};
  const out: Record<string, string> = {};
  for (const ep of parsedEndpoints) {
    if (isColabEndpoint(ep.baseUrl)) {
      out[ep.baseUrl] = colabKey;
    }
  }
  return out;
}

export function getSharedEmbedClient(options?: SharedEmbedClientOptions): CivicEmbedClient {
  const endpoints = options?.endpoints ?? embedEndpointsFromEnv();
  const profile = options?.profile ?? embedProfileFromEnv();
  const apiKey = options?.apiKey ?? (process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "");
  const cooldown = options?.unhealthyCooldownMs ?? 30_000;

  const parsed = parseEndpointList(endpoints);
  const endpointApiKeys = options?.endpointApiKeys ?? buildColabEndpointApiKeys(parsed);
  const endpointKey = parsed.map((e) => `${e.kind}:${e.baseUrl}`).join(",");
  const keyHash = createHash("sha256").update(apiKey).digest("hex").slice(0, 16);
  const endpointKeysSerialized = Object.keys(endpointApiKeys)
    .sort()
    .map((ep) => `${ep}=${endpointApiKeys[ep]}`)
    .join("\n");
  const endpointKeysHash = createHash("sha256").update(endpointKeysSerialized).digest("hex").slice(0, 16);
  const cacheKey = `${profile}|${cooldown}|${endpointKey}|${keyHash}|${endpointKeysHash}`;

  const cache = (globalThis.__civic_embed_clients ??= new Map<string, CivicEmbedClient>());
  let client = cache.get(cacheKey);
  if (!client) {
    client = createEmbedClient({
      endpoints,
      profile,
      apiKey,
      ...(Object.keys(endpointApiKeys).length > 0 ? { endpointApiKeys } : {}),
      unhealthyCooldownMs: cooldown,
    });
    cache.set(cacheKey, client);
  }
  return client;
}

/** 嵌入抽取产物。分批、故障转移和 429 退避都在 @civic/embed 里。 */
export async function embedTextsWithRetry(
  texts: string[],
  client?: { embed: (texts: string[], options?: EmbedRequestOptions) => Promise<number[][]> },
  options?: EmbedRequestOptions
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder = client ?? getSharedEmbedClient();
  const normalized = texts.map((text) => text.trim() || "空工单");
  return options !== undefined ? embedder.embed(normalized, options) : embedder.embed(normalized);
}
