import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { reviewQueueTable, ticketsTable } from "@/db/schema";
import { listReviewQueue, seedReviewQueue } from "@/lib/review-queue";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { recordDisposalLog, resolveOperatorName } from "@/lib/disposal";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";
import { eq } from "drizzle-orm";
import { requireAdmin } from "@/lib/auth/rbac";

type ReviewCorrection = {
  subdistrict?: string;
  sourceCategory?: string;
  canonicalSubject?: string;
  address?: string;
  eventType?: string;
  urgency?: string;
};

function buildTicketCorrectionPatch(correction: ReviewCorrection | undefined) {
  if (!correction || typeof correction !== "object") return null;
  const patch: Record<string, unknown> = {};
  if (typeof correction.subdistrict === "string") {
    patch.subdistrict = correction.subdistrict.trim() || null;
  }
  if (typeof correction.sourceCategory === "string") {
    patch.sourceCategory = correction.sourceCategory.trim() || null;
  }
  if (typeof correction.canonicalSubject === "string") {
    patch.canonicalSubject = correction.canonicalSubject.trim().slice(0, 255) || null;
  }
  if (typeof correction.address === "string") {
    patch.address = correction.address.trim().slice(0, 255) || null;
  }
  if (typeof correction.eventType === "string") {
    patch.eventType = correction.eventType.trim().slice(0, 128) || null;
  }
  if (typeof correction.urgency === "string" && correction.urgency.trim()) {
    const u = correction.urgency.trim().toUpperCase();
    if (u === "NORMAL" || u === "MEDIUM" || u === "URGENT") {
      patch.urgency = u;
    }
  }
  if (Object.keys(patch).length === 0) return null;
  patch.updatedAt = new Date();
  return patch;
}

/**
 * GET /api/review?status=PENDING&page=1&size=10
 * 按当前请求租户隔离分页查询人工复核队列。
 */
export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") ?? "PENDING";
    const page = clampPage(searchParams.get("page"));
    const size = clampSize(searchParams.get("size"));
    const result = await listReviewQueue(regionId, statusParam, { page, size });

    return NextResponse.json({
      success: true,
      regionId,
      page: result.page,
      size: result.size,
      total: result.total,
      data: result.data,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to fetch review queue";
    console.error("GET /api/review failed:", error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/review
 * 提交人工复核结果（支持可选附带纠偏字段与 disposal_logs 留痕）或批量注入复核项。
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const { pathname } = new URL(req.url);
    const body = (await req.json().catch(() => ({}))) as {
      tickets?: Array<{ ticketId: string; confidence?: number; reason?: string }>;
      reviewId?: string;
      action?: string;
      note?: string;
      operator?: string;
      correction?: ReviewCorrection;
    };

    // 路由分支 1: 批量注入复核种子数据 (/api/review/seed 或 body.tickets)
    if (pathname.endsWith("/seed") || Array.isArray(body.tickets)) {
      const tickets = Array.isArray(body.tickets) ? body.tickets : [];
      const result = await seedReviewQueue(tickets, regionId);
      invalidateCivicAggregates(regionId);
      broadcastDataRefresh(regionId);
      return NextResponse.json({
        success: true,
        regionId,
        message: `Successfully queued ${result.inserted} items for review`,
        inserted: result.inserted,
      });
    }

    // 路由分支 2: 单条处理复核
    const { reviewId, action, note, operator, correction } = body;
    if (!reviewId || !action) {
      return NextResponse.json(
        { success: false, error: "reviewId and action ('REVIEWED' | 'DISMISSED' | 'PENDING') are required" },
        { status: 400 }
      );
    }

    const nextStatus = action.trim().toUpperCase();
    const validActions = ["REVIEWED", "DISMISSED", "PENDING"];
    if (!validActions.includes(nextStatus)) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const existingRows = await tenantDb
      .select()
      .from(reviewQueueTable)
      .where(eq(reviewQueueTable.id, reviewId))
      .limit(1);
    const existing = existingRows[0];
    if (!existing) {
      return NextResponse.json(
        { success: false, error: "Review queue item not found" },
        { status: 404 }
      );
    }

    const resolvedOperator =
      typeof operator === "string" && operator.trim()
        ? operator.trim().slice(0, 64)
        : await resolveOperatorName(req);

    const [updated] = await tenantDb
      .update(reviewQueueTable)
      .set({
        status: nextStatus,
        operator: resolvedOperator,
        note: note ? String(note).trim() : null,
        reviewedAt: nextStatus === "PENDING" ? null : new Date(),
      })
      .where(eq(reviewQueueTable.id, reviewId))
      .returning();

    const ticketPatch = buildTicketCorrectionPatch(correction);
    if (ticketPatch && existing.ticketId) {
      await tenantDb
        .update(ticketsTable)
        .set(ticketPatch)
        .where(eq(ticketsTable.id, existing.ticketId));
    }

    if (existing.ticketId) {
      const logAction =
        nextStatus === "DISMISSED"
          ? "REVIEW_DISMISS"
          : nextStatus === "REVIEWED"
            ? "REVIEW_APPROVE"
            : "UPDATE_STATUS";
      await recordDisposalLog({
        regionId,
        targetType: "TICKET",
        targetId: existing.ticketId,
        action: logAction,
        fromStatus: existing.status,
        toStatus: nextStatus,
        operator: resolvedOperator,
        note:
          note ||
          (nextStatus === "REVIEWED"
            ? "人工复核确认无误"
            : nextStatus === "DISMISSED"
              ? "人工复核驳回/忽略"
              : "退回待人工复核"),
        meta: {
          reviewId,
          correction: ticketPatch ? correction : null,
        },
      });
    }

    invalidateCivicAggregates(regionId);
    broadcastDataRefresh(regionId);

    return NextResponse.json({
      success: true,
      regionId,
      message: `Review item ${reviewId} marked as ${nextStatus}`,
      data: updated,
    });
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : "Failed to process review action";
    console.error("POST /api/review failed:", error);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
