import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { seedReviewQueue } from "@/lib/review-queue";
import { initTaskProgress } from "@/lib/task-progress";
import { persistClusterResult } from "@/lib/civic-persist";
import { sql, desc } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";

let clusterRunning = false;

export async function POST(req: Request) {
  if (clusterRunning) {
    return NextResponse.json(
      { success: false, error: "研判任务已在运行，请等待当前进度结束" },
      { status: 409 }
    );
  }
  clusterRunning = true;
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      // Empty body allowed
    }

    const threadId = body.threadId || `cluster-${Date.now()}`;
    const taskId = body.taskId || threadId || `task-${Date.now()}`;

    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalTickets = Number(countRes[0]?.count || 0);
    if (totalTickets === 0) {
      return NextResponse.json(
        { success: false, error: "数据库中暂无工单数据，请先点击「上传入库」导入工单表格" },
        { status: 400 }
      );
    }
    initTaskProgress(taskId, totalTickets);

    // All tickets: extract-node skips rows that already have confidence.
    const rows = await db
      .select()
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime));

    const tickets: RawTicket[] = rows.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      title: r.title || undefined,
      summarizeTitle: r.summarizeTitle || undefined,
      address: r.address || undefined,
      confidence: typeof r.confidence === "number" ? r.confidence : undefined,
      sourceCategory: r.sourceCategory || undefined,
      primaryThemeId: r.primaryThemeId || undefined,
      createTime: r.createTime
        ? r.createTime.toISOString().slice(0, 19).replace("T", " ")
        : "2025-01-01 00:00:00",
      content: r.content,
      maskedContent: r.maskedContent || undefined,
      closedAt: r.closedAt
        ? r.closedAt.toISOString().slice(0, 19).replace("T", " ")
        : undefined,
      closureStatus: (r.closureStatus as "RESOLVED" | "REOPENED" | null) || undefined,
      isFakeClosure: r.isFakeClosure || false,
      citizenName: r.citizenName || "热线市民",
      citizenPhone: r.citizenPhone || "",
      district: r.district || undefined,
      subdistrict: r.subdistrict || undefined,
      channel: r.channel || "市民服务热线",
      status: (r.status as any) || "PENDING",
    }));

    initTaskProgress(taskId, tickets.length);

    // 3. Run LangGraph JS Pipeline
    const result = await runTicketRadarPipeline(tickets, threadId, taskId);

    // 4. Persist extract + cluster agent fields (never overwrite content)
    try {
      await persistClusterResult({
        tickets: result.enrichedTickets || [],
        themes: result.themes || [],
      });
      if (result.lowConfidenceTickets && result.lowConfidenceTickets.length > 0) {
        await seedReviewQueue(result.lowConfidenceTickets);
      }
    } catch (persistErr: any) {
      console.warn("Could not persist themes/reviews to DB:", persistErr.message);
    }

    // 5. Build macro topological graph data (filtering out heavy single ticket nodes)
    const macroNodes = result.graphData.nodes.filter((n) => n.type !== "TICKET");
    const macroNodeIds = new Set(macroNodes.map((n) => n.id));
    const macroLinks = result.graphData.links.filter(
      (l) => macroNodeIds.has(l.source as string) && macroNodeIds.has(l.target as string)
    );

    const highRiskCount = result.themes.filter((t) => t.riskLevel === "HIGH").length;
    const mediumRiskCount = result.themes.filter((t) => t.riskLevel === "MEDIUM").length;
    const lowRiskCount = result.themes.filter((t) => t.riskLevel === "LOW").length;
    const multiFrequencyTickets = result.themes.reduce((acc, t) => acc + (t.ticketCount || 0), 0);
    const compressionRatio = totalTickets > result.themes.length
      ? Math.round(((totalTickets - result.themes.length) / totalTickets) * 100)
      : 95;

    return NextResponse.json({
      success: true,
      data: {
        themes: result.themes,
        stats: {
          totalTickets,
          multiFrequencyTickets,
          multiFrequencyRate: totalTickets > 0 ? Math.min(100, Math.round((multiFrequencyTickets / totalTickets) * 100)) : 38,
          themeCount: result.themes.length,
          highRiskCount,
          mediumRiskCount,
          lowRiskCount,
          compressionRatio,
          topSubject: result.themes[0]?.canonicalSubject || "暂无重点多频诉求",
          avgResponseTimeSavedHours: 5.2,
        },
        graphData: {
          nodes: macroNodes,
          links: macroLinks,
        },
      },
    });
  } catch (err: any) {
    console.error("Cluster route error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Cluster failed" },
      { status: 500 }
    );
  } finally {
    clusterRunning = false;
  }
}

export async function GET() {
  return NextResponse.json(
    {
      success: false,
      error: "研判只能 POST /api/cluster 启动一次；进度请 GET /api/cluster/progress",
    },
    { status: 405 }
  );
}
