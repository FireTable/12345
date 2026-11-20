import { getRegionDb } from "@/db/client";
import { reviewQueueTable, ticketsTable } from "@/db/schema";
import { and, desc, eq } from "drizzle-orm";

/**
 * 辅助函数：批量将低置信度工单落库到对应租户的人工复核队列
 */
export async function seedReviewQueue(
  tickets: Array<{ ticketId: string; confidence?: number; reason?: string }>,
  regionId?: string
) {
  if (!tickets || tickets.length === 0) return { inserted: 0 };
  const { db: tenantDb } = await getRegionDb(regionId);

  let insertedCount = 0;
  for (const item of tickets) {
    if (!item.ticketId) continue;
    try {
      // 避免同一工单重复产生 PENDING 复核项
      const existing = await tenantDb
        .select({ id: reviewQueueTable.id })
        .from(reviewQueueTable)
        .where(
          and(
            eq(reviewQueueTable.ticketId, item.ticketId),
            eq(reviewQueueTable.status, "PENDING")
          )
        )
        .limit(1);

      if (existing.length > 0) continue;

      const reviewId = `rev-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      await tenantDb.insert(reviewQueueTable).values({
        id: reviewId,
        ticketId: item.ticketId,
        confidence: typeof item.confidence === "number" ? Math.round(item.confidence) : 0,
        reason: item.reason || "LOW_CONFIDENCE",
        status: "PENDING",
        createdAt: new Date(),
      });
      insertedCount++;
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      console.warn(`Failed to seed review item for ticket ${item.ticketId}:`, msg);
    }
  }

  return { inserted: insertedCount };
}

/**
 * 查询指定租户下的人工复核队列（关联工单基础摘要字段）
 */
export async function listReviewQueue(regionId?: string, statusParam = "PENDING") {
  const { db: tenantDb } = await getRegionDb(regionId);

  const columns = {
    id: reviewQueueTable.id,
    ticketId: reviewQueueTable.ticketId,
    confidence: reviewQueueTable.confidence,
    reason: reviewQueueTable.reason,
    status: reviewQueueTable.status,
    operator: reviewQueueTable.operator,
    note: reviewQueueTable.note,
    createdAt: reviewQueueTable.createdAt,
    reviewedAt: reviewQueueTable.reviewedAt,
    ticketNo: ticketsTable.ticketNo,
    title: ticketsTable.title,
    summarizeTitle: ticketsTable.summarizeTitle,
    district: ticketsTable.district,
    subdistrict: ticketsTable.subdistrict,
    sourceCategory: ticketsTable.sourceCategory,
    canonicalSubject: ticketsTable.canonicalSubject,
    address: ticketsTable.address,
  };

  const normalized = (statusParam || "PENDING").trim().toUpperCase();
  if (normalized && normalized !== "ALL") {
    return tenantDb
      .select(columns)
      .from(reviewQueueTable)
      .leftJoin(ticketsTable, eq(reviewQueueTable.ticketId, ticketsTable.id))
      .where(eq(reviewQueueTable.status, normalized))
      .orderBy(desc(reviewQueueTable.createdAt));
  }

  return tenantDb
    .select(columns)
    .from(reviewQueueTable)
    .leftJoin(ticketsTable, eq(reviewQueueTable.ticketId, ticketsTable.id))
    .orderBy(desc(reviewQueueTable.createdAt));
}
