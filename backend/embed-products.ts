import { getEmbeddingModel } from "./model";

const EMBED_BATCH = 20;

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

/** 嵌入抽取产物。429 会退避重试，仍失败就抛出，不改用更低的阈值凑数。 */
export async function embedTextsWithRetry(texts: string[]): Promise<number[][]> {
  if (texts.length === 0) return [];
  const model = getEmbeddingModel();
  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += EMBED_BATCH) {
    const slice = texts.slice(offset, offset + EMBED_BATCH).map((text) => text.trim() || "空工单");
    let accepted: number[][] | null = null;
    let lastError: unknown;
    for (let attempt = 0; attempt < 8; attempt++) {
      try {
        const batch = await model.embedDocuments(slice);
        if (batch.length !== slice.length) {
          throw new Error(`Embedding count ${batch.length} != ${slice.length}`);
        }
        accepted = batch;
        break;
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        const retryable = /429|502|503|504|rate limit|qpm limit|Embedding API error \(5/i.test(message);
        if (!retryable || attempt === 7) break;
        const waitMs = /429|qpm limit|rate limit/i.test(message) ? 70_000 : 3_000 * (attempt + 1);
        console.log(`[embed] retry ${attempt + 1} in ${Math.round(waitMs / 1000)}s`);
        await delay(waitMs);
      }
    }
    if (!accepted) {
      const message = lastError instanceof Error ? lastError.message : String(lastError);
      throw new Error(`Embedding failed: ${message}`);
    }
    vectors.push(...accepted);
    console.log(`[embed] ${vectors.length}/${texts.length}`);
    if (offset + EMBED_BATCH < texts.length) await delay(8_000);
  }
  return vectors;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
