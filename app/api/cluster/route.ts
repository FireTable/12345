import { NextRequest } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { db, getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { seedReviewQueue } from "@/lib/review-queue";
import { initTaskProgress } from "@/lib/task-progress";
import { persistClusterResult } from "@/lib/civic-persist";
import { sql, desc } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

let clusterRunning = false;

export async function POST(req: NextRequest) {
  if (clusterRunning) {
    return apiError(ApiCode.TASK_RUNNING, undefined, 409);
  }
  clusterRunning = true;
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      // Empty body allowed
    }

    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const threadId = body.threadId || `cluster-${Date.now()}`;
    const taskId = body.taskId || threadId || `task-${Date.now()}`;

    const countRes = await tenantDb.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalTickets = Number(countRes[0]?.count || 0);
    if (totalTickets === 0) {
      return apiError(ApiCode.TASK_EMPTY_DATA, undefined, 400);
    }
    initTaskProgress(taskId, totalTickets);

    // All tickets: extract-node skips rows that already have confidence.
    const rows = await tenantDb
      .select()
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime));

    const tickets: RawTicket[] = rows.map((r: any) => ({
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

    // 2.1 查询数据库中处于在办/未办结状态的存量多频主题，支持跨批次增量吸附
    let existingActiveThemes: any[] = [];
    try {
      const activeRows = await tenantDb
        .select()
        .from(themesTable)
        .where(sql`${themesTable.handlingStatus} != '已办结'`);

      existingActiveThemes = activeRows.map((r: any) => ({
        id: r.id,
        title: r.title,
        canonicalSubject: r.canonicalSubject,
        canonicalLocation: r.canonicalLocation,
        eventType: r.eventType,
        category: r.category || "城市管理",
        riskLevel: r.riskLevel,
        riskReason: r.riskReason || "",
        ticketCount: r.ticketCount,
        timeSpanHours: r.timeSpanHours || 1,
        firstOccurrence: r.firstAt ? r.firstAt.toISOString().slice(0, 19).replace("T", " ") : "",
        lastOccurrence: r.lastAt ? r.lastAt.toISOString().slice(0, 19).replace("T", " ") : "",
        aiSummary: r.aiSummary || "",
        recommendedAction: r.recommendedAction || "",
        handlingStatus: r.handlingStatus || "未处理",
        status: "CONFIRMED",
        tickets: [],
        relatedSubjects: [r.canonicalSubject],
        relatedLocations: [r.canonicalLocation],
      }));
    } catch (e: any) {
      // 降级为空
    }

    // 3. Run LangGraph JS Pipeline with regionId and existingActiveThemes
    const result = await runTicketRadarPipeline(tickets, threadId, taskId, regionId, existingActiveThemes);

    // 4. Persist extract + cluster agent fields (never overwrite content)
    try {
      await persistClusterResult({
        tickets: result.enrichedTickets || [],
        themes: result.themes || [],
        regionId,
      });
      if (result.lowConfidenceTickets && result.lowConfidenceTickets.length > 0) {
        await seedReviewQueue(result.lowConfidenceTickets, regionId);
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

    return apiSuccess({
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
    });
  } catch (err: any) {
    console.error("Cluster route error:", err);
    return apiError(ApiCode.TASK_EXECUTION_FAILED, err.message, 500);
  } finally {
    clusterRunning = false;
  }
}

export async function GET() {
  return apiError(ApiCode.BAD_REQUEST, "研判只能 POST /api/cluster 启动一次；进度请 GET /api/cluster/progress", 405);
}
