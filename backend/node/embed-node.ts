import { batchSizeForProfile } from "@civic/embed";
import type { EnrichedTicket, TicketRadarState } from "../state";
import {
  embedEligibleBatches,
  embeddingProgressLabel,
  isEmbedEligible,
  selectEmbedTicketIds,
  type EmbedTicketInput,
} from "../embed-policy";
import { embedProfileFromEnv, embedTextsWithRetry } from "../embed-products";
import { updateTaskProgress } from "@/lib/task-progress";
import { stagePercent } from "@/lib/pipeline-progress";
import {
  buildTicketEmbeddingHnsw,
  deleteIneligibleEmbeddings,
  ineligibleEmbeddingIds,
  loadEmbedSnapshot,
  upsertTicketEmbeddings,
} from "@/lib/ticket-embeddings";

function asInput(ticket: EnrichedTicket): EmbedTicketInput {
  return {
    id: ticket.id,
    canonicalSubject: ticket.canonicalSubject,
    extractionFailed: ticket.extractionFailed,
    summarizeTitle: ticket.summarizeTitle,
    eventType: ticket.eventType,
    canonicalLocation: ticket.canonicalLocation,
    subdistrict: ticket.subdistrict,
    sourceCategory: ticket.sourceCategory,
    confidence: ticket.confidence,
  };
}

/**
 * 对齐写完之后才嵌。只补哈希过期的行，每批推一次进度。
 * 聚类读这里挂上的库存向量，不再现算。
 */
export async function embedNode(state: TicketRadarState): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];
  const taskId = state.taskId;
  const regionId = state.regionId;
  const inputs = enrichedTickets.map(asInput);
  const snapshot = regionId ? await loadEmbedSnapshot(regionId) : null;
  const stored = snapshot?.stored ?? [];
  const batchSize = batchSizeForProfile(embedProfileFromEnv());
  const pendingIds = new Set(selectEmbedTicketIds({ tickets: inputs, stored }));

  const result = await embedEligibleBatches({
    tickets: inputs,
    stored,
    batchSize,
    embedBatch: (texts) => embedTextsWithRetry(texts),
    onProgress: (event) => {
      if (!taskId) return;
      updateTaskProgress(taskId, regionId, {
        stage: "EMBEDDING",
        stageText: embeddingProgressLabel(event.completed, event.eligible),
        processed: event.completed,
        total: event.eligible,
        percent: stagePercent("EMBED", event.completed, event.eligible),
      });
    },
  });

  if (regionId) {
    const written = result.rows.filter((row) => pendingIds.has(row.ticketId) && row.vector?.length === 1024);
    await upsertTicketEmbeddings(regionId, written);
    await deleteIneligibleEmbeddings(regionId, ineligibleEmbeddingIds(inputs));
    await buildTicketEmbeddingHnsw(regionId, result.failed);
  }

  const byId = new Map(result.rows.map((row) => [row.ticketId, row]));
  for (const ticket of enrichedTickets) {
    if (!isEmbedEligible(asInput(ticket))) {
      ticket.embedding = [];
      continue;
    }
    ticket.embedding = byId.get(ticket.id)?.vector ?? [];
  }

  if (result.failed) {
    throw new Error("Embedding failed: all endpoints down");
  }

  return { enrichedTickets, status: "clustering" };
}
