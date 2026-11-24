import { randomUUID } from "node:crypto";
import { getRegionDb } from "@/db/client";
import { reviewQueueTable, ticketsTable } from "@/db/schema";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { and, desc, eq, inArray, sql } from "drizzle-orm";

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

/**
 * 辅助函数：批量将低置信度工单落库到对应租户的人工复核队列
 */
export async function seedReviewQueue(
  tickets: Array<{ ticketId: string; confidence?: number; reason?: string }>,
  regionId?: string
) {
  if (!tickets || tickets.length === 0) return { inserted: 0 };

  // 按 ticketId 去重（保留首次出现，与原顺序语义一致）
  const seenTicketIds = new Set<string>();
  const deduped: Array<{ ticketId: string; confidence?: number; reason?: string }> = [];
  for (const item of tickets) {
    if (!item?.ticketId || seenTicketIds.has(item.ticketId)) continue;
    seenTicketIds.add(item.ticketId);
    deduped.push(item);
  }
  if (deduped.length === 0) return { inserted: 0 };

  const { db: tenantDb } = await getRegionDb(regionId);

  // 分块查询已存在 PENDING 复核项的 ticket_id
  const existingPendingSet = new Set<string>();
  const SELECT_CHUNK = 1000;
  const allTicketIds = deduped.map((d) => d.ticketId);
  for (let i = 0; i < allTicketIds.length; i += SELECT_CHUNK) {
    const idChunk = allTicketIds.slice(i, i + SELECT_CHUNK);
    const existingRows = await tenantDb
      .select({ ticketId: reviewQueueTable.ticketId })
      .from(reviewQueueTable)
      .where(
        and(
          eq(reviewQueueTable.status, "PENDING"),
          inArray(reviewQueueTable.ticketId, idChunk)
        )
      );
    for (const r of existingRows) {
      if (r.ticketId) existingPendingSet.add(r.ticketId);
    }
  }

  const toInsert = deduped.filter((item) => !existingPendingSet.has(item.ticketId));
  if (toInsert.length === 0) return { inserted: 0 };

  let insertedCount = 0;
  const INSERT_CHUNK = 400;
  for (let i = 0; i < toInsert.length; i += INSERT_CHUNK) {
    const chunk = toInsert.slice(i, i + INSERT_CHUNK);
    const nowIso = new Date().toISOString();
    const prepared = chunk.map((item) => ({
      id: `rev-${Date.now()}-${randomUUID().slice(0, 12)}`,
      ticketId: item.ticketId,
      confidence:
        typeof item.confidence === "number" && Number.isFinite(item.confidence)
          ? Math.round(item.confidence)
          : 0,
      reason: String(item.reason || "LOW_CONFIDENCE").slice(0, 128),
      createdAtIso: nowIso,
    }));

    try {
      const valuesSql = sql.join(
        prepared.map(
          (p) =>
            sql`(${p.id}::varchar, ${p.ticketId}::varchar, ${p.confidence}::integer, ${p.reason}::varchar, ${p.createdAtIso}::timestamptz)`
        ),
        sql`, `
      );
      const res = await tenantDb.execute(sql`
        INSERT INTO review_queue (id, ticket_id, confidence, reason, status, created_at)
        SELECT v.id, v.ticket_id, v.confidence, v.reason, 'PENDING', v.created_at
        FROM (VALUES ${valuesSql}) AS v(id, ticket_id, confidence, reason, created_at)
        WHERE NOT EXISTS (
          SELECT 1 FROM review_queue rq
          WHERE rq.ticket_id = v.ticket_id AND rq.status = 'PENDING'
        )
        ON CONFLICT (id) DO NOTHING
        RETURNING id
      `);
      insertedCount += rowsOf(res).length;
    } catch {
      // 块内含非法外键等异常时降级逐条插入，确保同批合法工单不受影响
      for (const p of prepared) {
        try {
          const singleRes = await tenantDb.execute(sql`
            INSERT INTO review_queue (id, ticket_id, confidence, reason, status, created_at)
            SELECT ${p.id}::varchar, ${p.ticketId}::varchar, ${p.confidence}::integer, ${p.reason}::varchar, 'PENDING', ${p.createdAtIso}::timestamptz
            WHERE NOT EXISTS (
              SELECT 1 FROM review_queue rq
              WHERE rq.ticket_id = ${p.ticketId}::varchar AND rq.status = 'PENDING'
            )
            ON CONFLICT (id) DO NOTHING
            RETURNING id
          `);
          insertedCount += rowsOf(singleRes).length;
        } catch (e: unknown) {
          const msg = e instanceof Error ? e.message : String(e);
          console.warn(`Failed to seed review item for ticket ${p.ticketId}:`, msg);
        }
      }
    }
  }

  return { inserted: insertedCount };
}

export interface ListReviewQueueOptions {
  page?: unknown;
  size?: unknown;
}

export interface ListReviewQueueResult {
  page: number;
  size: number;
  total: number;
  data: Array<{
    id: string;
    ticketId: string;
    confidence: number | null;
    reason: string;
    status: string;
    operator: string | null;
    note: string | null;
    createdAt: Date;
    reviewedAt: Date | null;
    ticketNo: string | null;
    title: string | null;
    summarizeTitle: string | null;
    district: string | null;
    subdistrict: string | null;
    sourceCategory: string | null;
    canonicalSubject: string | null;
    address: string | null;
  }>;
}

/**
 * 分页查询指定租户下的人工复核队列（关联工单基础摘要字段）
 */
export async function listReviewQueue(
  regionId?: string,
  statusParam = "PENDING",
  options?: ListReviewQueueOptions
): Promise<ListReviewQueueResult> {
  const { db: tenantDb } = await getRegionDb(regionId);

  const page = clampPage(options?.page);
  const size = clampSize(options?.size);
  const offset = Math.min((page - 1) * size, 2_000_000_000);

  const normalized = (statusParam ?? "").trim().toUpperCase() || "PENDING";
  const where = normalized !== "ALL" ? eq(reviewQueueTable.status, normalized) : undefined;

  const countQ = tenantDb.select({ count: sql<number>`count(*)::int` }).from(reviewQueueTable);
  const pageSelect = tenantDb
    .select({
      id: reviewQueueTable.id,
      ticketId: reviewQueueTable.ticketId,
      confidence: reviewQueueTable.confidence,
      reason: reviewQueueTable.reason,
      status: reviewQueueTable.status,
      operator: reviewQueueTable.operator,
      note: reviewQueueTable.note,
      createdAt: reviewQueueTable.createdAt,
      reviewedAt: reviewQueueTable.reviewedAt,
    })
    .from(reviewQueueTable);

  const pageRq = tenantDb.$with("page_rq").as(
    (where ? pageSelect.where(where) : pageSelect)
      .orderBy(desc(reviewQueueTable.createdAt), desc(reviewQueueTable.id))
      .limit(size)
      .offset(offset)
  );

  const listQ = tenantDb
    .with(pageRq)
    .select({
      id: pageRq.id,
      ticketId: pageRq.ticketId,
      confidence: pageRq.confidence,
      reason: pageRq.reason,
      status: pageRq.status,
      operator: pageRq.operator,
      note: pageRq.note,
      createdAt: pageRq.createdAt,
      reviewedAt: pageRq.reviewedAt,
      ticketNo: ticketsTable.ticketNo,
      title: ticketsTable.title,
      summarizeTitle: ticketsTable.summarizeTitle,
      district: ticketsTable.district,
      subdistrict: ticketsTable.subdistrict,
      sourceCategory: ticketsTable.sourceCategory,
      canonicalSubject: ticketsTable.canonicalSubject,
      address: ticketsTable.address,
    })
    .from(pageRq)
    .leftJoin(ticketsTable, eq(pageRq.ticketId, ticketsTable.id))
    .orderBy(desc(pageRq.createdAt), desc(pageRq.id));

  const [countRows, data] = await Promise.all([
    where ? countQ.where(where) : countQ,
    listQ,
  ]);

  return {
    page,
    size,
    total: Number(countRows[0]?.count ?? 0),
    data,
  };
}
