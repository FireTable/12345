import { db } from "@/db/client";
import { reviewQueueTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";

/**
 * 辅助函数：批量将低置信度工单落库到人工复核队列
 */
export async function seedReviewQueue(
  tickets: Array<{ ticketId: string; confidence?: number; reason?: string }>
) {
  if (!tickets || tickets.length === 0) return { inserted: 0 };

  let insertedCount = 0;
  for (const item of tickets) {
    if (!item.ticketId) continue;
    try {
      // 避免同一工单重复产生 PENDING 复核项
      const existing = await db
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
      await db.insert(reviewQueueTable).values({
        id: reviewId,
        ticketId: item.ticketId,
        confidence: typeof item.confidence === "number" ? Math.round(item.confidence) : 0,
        reason: item.reason || "LOW_CONFIDENCE",
        status: "PENDING",
        createdAt: new Date(),
      });
      insertedCount++;
    } catch (e: any) {
      console.warn(`Failed to seed review item for ticket ${item.ticketId}:`, e.message);
    }
  }

  return { inserted: insertedCount };
}
