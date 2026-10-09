/**
 * 工单嵌入旁路表。应用负责落库，@civic/embed 不碰数据库。
 * 回填写行时不建 HNSW；写完再建。
 */
import { sql as drizzleSql } from "drizzle-orm";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import {
  EMBEDDING_MODEL_LITERAL,
  isEmbedEligible,
  type EmbedTicketInput,
  type StoredEmbedding,
} from "@/backend/embed-policy";
import { HNSW_EF_SEARCH, NEIGHBOR_K, hnswCreateIndexSql } from "@/backend/embed-neighbors";
import { yieldToEventLoop } from "@/lib/yield-loop";

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key] ?? row[key.toLowerCase()] ?? "";
  return value == null ? "" : String(value);
}

function parseHalfvec(value: string): number[] {
  return value
    .replace(/^\[/, "")
    .replace(/\]$/, "")
    .split(",")
    .filter((part) => part.length > 0)
    .map(Number);
}

function halfvecLiteral(vector: number[]): string {
  if (vector.length !== 1024 || vector.some((value) => typeof value !== "number" || !Number.isFinite(value))) {
    throw new Error("refusing to store a vector that is not 1024 finite values");
  }
  return `[${vector.join(",")}]`;
}

export async function ensureTicketEmbeddingsTable(regionId: string): Promise<boolean> {
  try {
    const { db } = await getRegionDb(regionId);
    await db.execute(drizzleSql`CREATE EXTENSION IF NOT EXISTS vector`);
    await db.execute(drizzleSql`
      CREATE TABLE IF NOT EXISTS ticket_embeddings (
        ticket_id VARCHAR(64) PRIMARY KEY REFERENCES tickets(id) ON DELETE CASCADE,
        embedding halfvec(1024) NOT NULL,
        product_hash VARCHAR(64) NOT NULL,
        model VARCHAR(64) NOT NULL DEFAULT 'BAAI/bge-m3',
        embedded_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      )
    `);
    return true;
  } catch (error) {
    console.warn("[embed] ticket_embeddings unavailable:", error instanceof Error ? error.message : error);
    return false;
  }
}

export async function loadEmbedSnapshot(
  regionId: string
): Promise<{ tickets: EmbedTicketInput[]; stored: StoredEmbedding[] } | null> {
  const ready = await ensureTicketEmbeddingsTable(regionId);
  if (!ready) return null;
  try {
    const { db } = await getRegionDb(regionId);
    const tickets = await db
      .select({
        id: ticketsTable.id,
        canonicalSubject: ticketsTable.canonicalSubject,
        summarizeTitle: ticketsTable.summarizeTitle,
        eventType: ticketsTable.eventType,
        address: ticketsTable.address,
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        confidence: ticketsTable.confidence,
      })
      .from(ticketsTable);
    const storedResult = await db.execute(drizzleSql`
      SELECT ticket_id, product_hash, model, embedding::text AS embedding
      FROM ticket_embeddings
    `);
    const rawStored = rowsOf(storedResult);
    const stored: StoredEmbedding[] = [];
    for (let index = 0; index < rawStored.length; index++) {
      const row = rawStored[index];
      const vector = parseHalfvec(cell(row, "embedding"));
      stored.push({
        ticketId: cell(row, "ticket_id"),
        productHash: cell(row, "product_hash"),
        model: cell(row, "model"),
        vector: vector.length === 1024 ? vector : undefined,
      });
      if ((index + 1) % 40 === 0) await yieldToEventLoop();
    }
    return {
      tickets: tickets.map((row) => ({
        id: row.id,
        canonicalSubject: row.canonicalSubject,
        summarizeTitle: row.summarizeTitle,
        eventType: row.eventType,
        canonicalLocation: row.address,
        subdistrict: row.subdistrict,
        sourceCategory: row.sourceCategory,
        confidence: row.confidence,
      })),
      stored,
    };
  } catch (error) {
    console.warn("[embed] snapshot failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

export async function upsertTicketEmbeddings(regionId: string, rows: StoredEmbedding[]): Promise<void> {
  const ready = rows.filter((row) => row.vector && row.vector.length === 1024);
  if (ready.length === 0) return;
  const tableReady = await ensureTicketEmbeddingsTable(regionId);
  if (!tableReady) return;
  const { db } = await getRegionDb(regionId);
  for (const row of ready) {
    const literal = halfvecLiteral(row.vector || []);
    await db.execute(drizzleSql`
      INSERT INTO ticket_embeddings (ticket_id, embedding, product_hash, model, embedded_at)
      VALUES (
        ${row.ticketId},
        ${literal}::halfvec(1024),
        ${row.productHash},
        ${EMBEDDING_MODEL_LITERAL},
        now()
      )
      ON CONFLICT (ticket_id) DO UPDATE SET
        embedding = EXCLUDED.embedding,
        product_hash = EXCLUDED.product_hash,
        model = EXCLUDED.model,
        embedded_at = now()
    `);
  }
}

export async function deleteIneligibleEmbeddings(regionId: string, ticketIds: string[]): Promise<void> {
  if (ticketIds.length === 0) return;
  const tableReady = await ensureTicketEmbeddingsTable(regionId);
  if (!tableReady) return;
  const { db } = await getRegionDb(regionId);
  const ids = drizzleSql.join(ticketIds.map((id) => drizzleSql`${id}`), drizzleSql`, `);
  await db.execute(drizzleSql`DELETE FROM ticket_embeddings WHERE ticket_id IN (${ids})`);
}

/** 写完之后才建索引。backfillInProgress 为真时直接返回。 */
export async function buildTicketEmbeddingHnsw(regionId: string, backfillInProgress: boolean): Promise<void> {
  const statement = hnswCreateIndexSql(backfillInProgress);
  if (!statement) return;
  const tableReady = await ensureTicketEmbeddingsTable(regionId);
  if (!tableReady) return;
  const { db } = await getRegionDb(regionId);
  await db.execute(drizzleSql.raw(statement));
}

/** 从库存向量取近邻工单对。失败时返回 null，调用方改用内存里的已存向量。 */
export async function loadStoredNeighborPairs(regionId: string): Promise<Array<[string, string]> | null> {
  const tableReady = await ensureTicketEmbeddingsTable(regionId);
  if (!tableReady) return null;
  try {
    const { db } = await getRegionDb(regionId);
    const result = await db.transaction(async (tx) => {
      await tx.execute(drizzleSql.raw(`SET LOCAL hnsw.ef_search = ${HNSW_EF_SEARCH}`));
      return tx.execute(drizzleSql.raw(`
        SELECT t.id AS ticket_id, n.neighbor_id
        FROM tickets t
        JOIN ticket_embeddings e ON e.ticket_id = t.id
        JOIN LATERAL (
          SELECT e2.ticket_id AS neighbor_id
          FROM ticket_embeddings e2
          JOIN tickets t2 ON t2.id = e2.ticket_id
          WHERE t2.source_category IS NOT DISTINCT FROM t.source_category
            AND t2.subdistrict IS NOT DISTINCT FROM t.subdistrict
            AND e2.ticket_id <> t.id
          ORDER BY e2.embedding <=> e.embedding
          LIMIT ${NEIGHBOR_K}
        ) n ON true
      `));
    });
    const pairs: Array<[string, string]> = [];
    const seen = new Set<string>();
    const neighborRows = rowsOf(result);
    for (let index = 0; index < neighborRows.length; index++) {
      const row = neighborRows[index];
      const left = cell(row, "ticket_id");
      const right = cell(row, "neighbor_id");
      if (!left || !right) continue;
      const key = [left, right].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      pairs.push([left, right]);
      if ((index + 1) % 5000 === 0) await yieldToEventLoop();
    }
    return pairs;
  } catch (error) {
    console.warn("[embed] neighbor lookup failed:", error instanceof Error ? error.message : error);
    return null;
  }
}

/** 主题不单独存向量。增量挂接用成员工单里已经写下的一条。 */
export async function loadThemeMemberVectors(regionId: string, themeIds: string[]): Promise<Map<string, number[]>> {
  const vectors = new Map<string, number[]>();
  if (themeIds.length === 0) return vectors;
  const tableReady = await ensureTicketEmbeddingsTable(regionId);
  if (!tableReady) return vectors;
  try {
    const { db } = await getRegionDb(regionId);
    const ids = drizzleSql.join(themeIds.map((id) => drizzleSql`${id}`), drizzleSql`, `);
    const result = await db.execute(drizzleSql`
      SELECT DISTINCT ON (tt.theme_id) tt.theme_id, e.embedding::text AS embedding
      FROM ticket_themes tt
      JOIN ticket_embeddings e ON e.ticket_id = tt.ticket_id
      WHERE tt.theme_id IN (${ids})
    `);
    for (const row of rowsOf(result)) {
      const themeId = cell(row, "theme_id");
      const vector = parseHalfvec(cell(row, "embedding"));
      if (themeId && vector.length === 1024) vectors.set(themeId, vector);
    }
  } catch (error) {
    console.warn("[embed] theme member vectors failed:", error instanceof Error ? error.message : error);
  }
  return vectors;
}

export function ineligibleEmbeddingIds(tickets: EmbedTicketInput[]): string[] {
  return tickets.filter((ticket) => !isEmbedEligible(ticket)).map((ticket) => ticket.id);
}
