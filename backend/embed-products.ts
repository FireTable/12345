import { createEmbedClient, type EmbedProfile } from "@civic/embed";
import { isLocalEndpoint, listEnabledComputeNodes, normalizeProvider, type ComputeNodeProvider } from "@/lib/compute-nodes";

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
  const envModel = (process.env.EMBEDDING_MODEL || "BAAI/bge-m3").trim();

  for (const part of embedEndpointsFromEnv().split(",")) {
    let ep = part.trim().replace(/^(?:cloud|local):/i, "").trim().replace(/\/+$/, "");
    if (!ep) continue;
    merged.set(ep, {
      endpoint: ep,
      apiKey: isLocalEndpoint(ep) ? undefined : envKey,
      model: envModel,
      provider: isLocalEndpoint(ep) ? "LOCAL" : "CLOUD",
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

/** 嵌入抽取产物。分批、故障转移和 429 退避都在 @civic/embed 里。 */
export async function embedTextsWithRetry(
  texts: string[],
  client?: { embed: (texts: string[]) => Promise<number[][]> }
): Promise<number[][]> {
  if (texts.length === 0) return [];
  const embedder =
    client ??
    createEmbedClient({
      endpoints: embedEndpointsFromEnv(),
      profile: embedProfileFromEnv(),
      apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",
    });
  return embedder.embed(texts.map((text) => text.trim() || "空工单"));
}
