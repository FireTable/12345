import { createEmbedClient, type EmbedProfile } from "@civic/embed";

export function embedProfileFromEnv(): EmbedProfile {
  return process.env.EMBEDDING_PROFILE === "online" ? "online" : "bulk";
}

export function embedEndpointsFromEnv(): string {
  return process.env.EMBEDDING_ENDPOINTS || process.env.EMBEDDING_BASE_URL || "https://api.edgefn.net/v1";
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
