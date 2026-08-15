import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { reviewQueueTable, ticketsTable } from "@/db/schema";
import { seedReviewQueue } from "@/lib/review-queue";
import { eq, desc } from "drizzle-orm";

/**
 * GET /api/review?status=PENDING
 * 查询待复核工单队列（连表查询工单详情）
 */
export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const statusParam = searchParams.get("status") || "PENDING";

    let query = db
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
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        content: ticketsTable.content,
        maskedContent: ticketsTable.maskedContent,
        district: ticketsTable.district,
        subdistrict: ticketsTable.subdistrict,
      })
      .from(reviewQueueTable)
      .leftJoin(ticketsTable, eq(reviewQueueTable.ticketId, ticketsTable.id))
      .orderBy(desc(reviewQueueTable.createdAt));

    let rows;
    if (statusParam && statusParam.toUpperCase() !== "ALL") {
      rows = await db
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
          ticketNo: ticketsTable.ticketNo,
          title: ticketsTable.title,
          summarizeTitle: ticketsTable.summarizeTitle,
          content: ticketsTable.content,
          maskedContent: ticketsTable.maskedContent,
          district: ticketsTable.district,
          subdistrict: ticketsTable.subdistrict,
        })
        .from(reviewQueueTable)
        .leftJoin(ticketsTable, eq(reviewQueueTable.ticketId, ticketsTable.id))
        .where(eq(reviewQueueTable.status, statusParam.toUpperCase()))
        .orderBy(desc(reviewQueueTable.createdAt));
    } else {
      rows = await query;
    }

    return NextResponse.json({
      success: true,
      data: rows,
      total: rows.length,
    });
  } catch (error: any) {
    console.error("GET /api/review failed:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to fetch review queue" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/review
 * 提交人工复核结果 或 批量初始化复核项 (/api/review/seed)
 */
export async function POST(req: Request) {
  try {
    const { pathname } = new URL(req.url);
    const body = await req.json();

    // 路由分支 1: 批量注入复核种子数据 (/api/review/seed 或 body.tickets)
    if (pathname.endsWith("/seed") || Array.isArray(body.tickets)) {
      const tickets = Array.isArray(body.tickets) ? body.tickets : [];
      const result = await seedReviewQueue(tickets);
      return NextResponse.json({
        success: true,
        message: `Successfully queued ${result.inserted} items for review`,
        inserted: result.inserted,
      });
    }

    // 路由分支 2: 单条处理复核
    const { reviewId, action, note, operator } = body;
    if (!reviewId || !action) {
      return NextResponse.json(
        { success: false, error: "reviewId and action ('REVIEWED' | 'DISMISSED') are required" },
        { status: 400 }
      );
    }

    const validActions = ["REVIEWED", "DISMISSED", "PENDING"];
    if (!validActions.includes(action.toUpperCase())) {
      return NextResponse.json(
        { success: false, error: `Invalid action. Must be one of: ${validActions.join(", ")}` },
        { status: 400 }
      );
    }

    const updated = await db
      .update(reviewQueueTable)
      .set({
        status: action.toUpperCase(),
        operator: operator || "system_operator",
        note: note || null,
        reviewedAt: new Date(),
      })
      .where(eq(reviewQueueTable.id, reviewId))
      .returning();

    if (!updated || updated.length === 0) {
      return NextResponse.json(
        { success: false, error: "Review queue item not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: `Review item ${reviewId} marked as ${action.toUpperCase()}`,
      data: updated[0],
    });
  } catch (error: any) {
    console.error("POST /api/review failed:", error);
    return NextResponse.json(
      { success: false, error: error.message || "Failed to process review action" },
      { status: 500 }
    );
  }
}
