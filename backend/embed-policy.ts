/**
 * 工序 04 的嵌入资格、哈希、触发、宕机续跑和进度。纯函数，不连数据库。
 */
import { createHash } from "node:crypto";
import { extractionProductText } from "./embed-products";
import { workOrderInstantFromTicketNo } from "@/lib/work-order-date";

export const EMBEDDING_MODEL_LITERAL = "BAAI/bge-m3";
export const FAILED_EXTRACTION_SUBJECT = "涉事方";

export interface EmbedTicketInput {
  id: string;
  canonicalSubject?: string | null;
  extractionFailed?: boolean | null;
  summarizeTitle?: string | null;
  eventType?: string | null;
  canonicalLocation?: string | null;
  subdistrict?: string | null;
  sourceCategory?: string | null;
  confidence?: number | null;
}

export interface StoredEmbedding {
  ticketId: string;
  productHash: string;
  model: string;
  embeddedAt?: string;
  vector?: number[];
}

export type Stage04Reason =
  | "healthy-heartbeat"
  | "single-ticket"
  | "single-ticket-current"
  | "hashes-match"
  | "extract-finished"
  | "stale-hash";

export function isEmbedEligible(ticket: EmbedTicketInput): boolean {
  if (ticket.extractionFailed) return false;
  return (ticket.canonicalSubject || "").trim() !== FAILED_EXTRACTION_SUBJECT;
}

export function productTextForTicket(ticket: EmbedTicketInput): string {
  return extractionProductText(ticket);
}

export function productHashForTicket(ticket: EmbedTicketInput): string {
  return createHash("sha256").update(productTextForTicket(ticket)).digest("hex");
}

export function storedRowMatches(ticket: EmbedTicketInput, stored: StoredEmbedding | undefined): boolean {
  if (!stored) return false;
  return stored.model === EMBEDDING_MODEL_LITERAL && stored.productHash === productHashForTicket(ticket);
}

export function selectEmbedTicketIds(input: {
  tickets: EmbedTicketInput[];
  stored: StoredEmbedding[];
  onlyTicketId?: string | null;
}): string[] {
  const byId = new Map(input.stored.map((row) => [row.ticketId, row]));
  const pool = input.onlyTicketId
    ? input.tickets.filter((ticket) => ticket.id === input.onlyTicketId)
    : input.tickets;
  return pool
    .filter((ticket) => isEmbedEligible(ticket) && !storedRowMatches(ticket, byId.get(ticket.id)))
    .map((ticket) => ticket.id);
}

export function matchingEmbeddingCount(
  tickets: EmbedTicketInput[],
  stored: StoredEmbedding[]
): { matching: number; eligible: number } {
  const eligible = tickets.filter(isEmbedEligible);
  const byId = new Map(stored.map((row) => [row.ticketId, row]));
  const matching = eligible.filter((ticket) => storedRowMatches(ticket, byId.get(ticket.id))).length;
  return { matching, eligible: eligible.length };
}

/**
 * 进度是已对齐行 / 应嵌工单。再读一次相同的行，分数不会变小。
 */
export function embeddingProgressFraction(matchingRows: number, eligible: number, previous?: number): number {
  const next = eligible <= 0 ? 1 : matchingRows / eligible;
  if (previous == null || Number.isNaN(previous)) return next;
  return Math.max(previous, next);
}

export function embeddingProgressLabel(completed: number, eligible: number): string {
  return `嵌入中（${completed}/${eligible}）`;
}

export function isJobHeartbeatHealthy(input: {
  stage: string | null;
  lastBeatMs: number | null;
  nowMs: number;
  windowMs?: number;
}): boolean {
  if (input.stage !== "EMBEDDING" && input.stage !== "CLUSTERING") return false;
  if (input.lastBeatMs == null) return false;
  return input.nowMs - input.lastBeatMs < (input.windowMs ?? 30_000);
}

export function shouldStartStage04(input: {
  tickets: EmbedTicketInput[];
  stored: StoredEmbedding[];
  justFinishedExtractCanonical?: boolean;
  onlyTicketId?: string | null;
  healthyStage?: "EMBEDDING" | "CLUSTERING" | null;
  heartbeatHealthy?: boolean;
}): { start: boolean; reason: Stage04Reason; ticketIds: string[] } {
  if (
    input.heartbeatHealthy &&
    (input.healthyStage === "EMBEDDING" || input.healthyStage === "CLUSTERING")
  ) {
    return { start: false, reason: "healthy-heartbeat", ticketIds: [] };
  }
  const ticketIds = selectEmbedTicketIds(input);
  if (input.onlyTicketId) {
    return ticketIds.length > 0
      ? { start: true, reason: "single-ticket", ticketIds }
      : { start: false, reason: "single-ticket-current", ticketIds: [] };
  }
  if (ticketIds.length === 0) {
    return { start: false, reason: "hashes-match", ticketIds: [] };
  }
  return {
    start: true,
    reason: input.justFinishedExtractCanonical ? "extract-finished" : "stale-hash",
    ticketIds,
  };
}

export interface EmbedBatchProgress {
  completed: number;
  eligible: number;
  batches: number;
}

/**
 * 只嵌哈希过期的行。模型抛错时，已经写过的行和原先的行都留着。
 * 每批回调一次进度，不是每条工单一次。
 */
export async function embedEligibleBatches(input: {
  tickets: EmbedTicketInput[];
  stored: StoredEmbedding[];
  onlyTicketId?: string | null;
  batchSize: number;
  embedBatch: (texts: string[]) => Promise<number[][]>;
  onProgress?: (event: EmbedBatchProgress) => void;
}): Promise<{ rows: StoredEmbedding[]; modelCalls: number; progressEvents: number; failed: boolean }> {
  const ids = new Set(selectEmbedTicketIds(input));
  const targets = input.tickets.filter((ticket) => ids.has(ticket.id));
  const rows = input.stored.map((row) => ({ ...row }));
  const eligibleTickets = input.tickets.filter(
    (ticket) => isEmbedEligible(ticket) && (!input.onlyTicketId || ticket.id === input.onlyTicketId)
  );
  const size = Math.max(1, input.batchSize);
  let modelCalls = 0;
  let progressEvents = 0;
  const byId = () => new Map(rows.map((row) => [row.ticketId, row]));
  try {
    for (let offset = 0; offset < targets.length; offset += size) {
      const slice = targets.slice(offset, offset + size);
      const texts = slice.map((ticket) => productTextForTicket(ticket));
      const vectors = await input.embedBatch(texts);
      if (vectors.length !== slice.length) {
        throw new Error(`Embedding count ${vectors.length} != ${slice.length}`);
      }
      modelCalls += 1;
      const embeddedAt = new Date().toISOString();
      for (let index = 0; index < slice.length; index++) {
        const ticket = slice[index];
        const next: StoredEmbedding = {
          ticketId: ticket.id,
          productHash: productHashForTicket(ticket),
          model: EMBEDDING_MODEL_LITERAL,
          embeddedAt,
          vector: vectors[index],
        };
        const existing = rows.findIndex((row) => row.ticketId === ticket.id);
        if (existing >= 0) rows[existing] = next;
        else rows.push(next);
      }
      const matching = matchingEmbeddingCount(eligibleTickets, [...byId().values()]).matching;
      progressEvents += 1;
      input.onProgress?.({
        completed: matching,
        eligible: eligibleTickets.length,
        batches: progressEvents,
      });
    }
    return { rows, modelCalls, progressEvents, failed: false };
  } catch {
    return { rows, modelCalls, progressEvents, failed: true };
  }
}

/** 挂接后的件数。空的 tickets 数组不能把库里的件数刷成 1。 */
export function attachedMemberCount(previousCount: number, loadedTicketCount: number): number {
  return Math.max(previousCount || 0, loadedTicketCount || 0) + 1;
}

/** 主题的最后反映时间用工单时间。编号解析不了时用入库的 createTime。 */
export function memberLastAt(
  ticketNo: string | null | undefined,
  createTime: Date | string | null | undefined,
  now: Date = new Date()
): Date {
  const fromNo = workOrderInstantFromTicketNo(ticketNo);
  if (fromNo) return fromNo;
  if (createTime instanceof Date && !Number.isNaN(createTime.getTime())) return createTime;
  if (typeof createTime === "string" && createTime.trim()) {
    const normalized = createTime.includes("T") ? createTime : `${createTime.trim().replace(" ", "T")}+08:00`;
    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) return parsed;
  }
  return now;
}
