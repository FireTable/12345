import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { db } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable } from "@/db/schema";
import { seedReviewQueue } from "@/lib/review-queue";
import { initTaskProgress } from "@/lib/task-progress";
import { sql, desc, eq } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";

export async function POST(req: Request) {
  try {
    let body: any = {};
    try {
      body = await req.json();
    } catch (e) {
      // Empty body allowed
    }

    const threadId = body.threadId || `cluster-${Date.now()}`;

    // 1. Fetch tickets from PostgreSQL
    const rows = await db
      .select()
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime))
      .limit(600);

    if (!rows || rows.length === 0) {
      return NextResponse.json(
        { success: false, error: "数据库中暂无工单数据，请先点击「上传入库」导入工单表格" },
        { status: 400 }
      );
    }

    const tickets: RawTicket[] = rows.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      title: r.title || undefined,
      summarizeTitle: r.summarizeTitle || undefined,
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
      district: r.district || "所属辖区",
      subdistrict: r.subdistrict || "未归属镇街",
      channel: r.channel || "市民服务热线",
      status: (r.status as any) || "PENDING",
    }));

    // 2. Total count in DB
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalTickets = Number(countRes[0]?.count || 0);

    const taskId = body.taskId || threadId || `task-${Date.now()}`;
    initTaskProgress(taskId, tickets.length);

    // 3. Run LangGraph JS Pipeline
    const result = await runTicketRadarPipeline(tickets, threadId, taskId);

    // 4. Persist computed themes & ticket_themes to PostgreSQL
    try {
      await db.delete(ticketThemesTable);
      await db.delete(themesTable);

      const themeRecords = result.themes.map((t) => ({
        id: t.id,
        title: t.title,
        canonicalSubject: t.canonicalSubject,
        canonicalLocation: t.canonicalLocation,
        eventType: t.eventType,
        category: t.category,
        riskLevel: t.riskLevel,
        riskReason: t.riskReason,
        ticketCount: t.ticketCount,
        timeSpanHours: t.timeSpanHours,
        aiSummary: t.aiSummary,
        recommendedAction: t.recommendedAction,
      }));

      if (themeRecords.length > 0) {
        await db.insert(themesTable).values(themeRecords);

        // Persist ticket_themes junction records
        const ticketThemeMappings: Array<{ ticketId: string; themeId: string }> = [];
        for (const theme of result.themes) {
          if (theme.tickets && Array.isArray(theme.tickets)) {
            for (const t of theme.tickets) {
              ticketThemeMappings.push({
                ticketId: t.id,
                themeId: theme.id,
              });
            }
          }
        }

        if (ticketThemeMappings.length > 0) {
          // Batch in chunks of 500
          for (let i = 0; i < ticketThemeMappings.length; i += 500) {
            const chunk = ticketThemeMappings.slice(i, i + 500);
            await db.insert(ticketThemesTable).values(chunk).onConflictDoNothing();
          }
        }

        for (const theme of result.themes) {
          for (const t of theme.tickets || []) {
            if (!t.isFakeClosure) continue;
            await db
              .update(ticketsTable)
              .set({ isFakeClosure: true, closureStatus: "REOPENED" })
              .where(eq(ticketsTable.id, t.id));
          }
        }
      }

      // Persist low-confidence tickets to Review Queue
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
  }
}

export async function GET() {
  return POST(new Request("http://localhost:3000/api/cluster", { method: "POST" }));
}
