import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getLatestTaskProgress } from "@/lib/task-progress";
import { sql, desc, eq, isNull } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb, region } = await getRegionDb(regionId);

    // 1. 获取最新任务进度
    const taskProgress = await getLatestTaskProgress();

    // 2. 统计当前辖区工单与主题指标
    const [ticketCounts] = await tenantDb
      .select({
        total: sql<number>`count(*)`,
        analyzed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is not null and ${ticketsTable.confidence} > 0)`,
        unprocessed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0)`,
        urgent: sql<number>`count(*) filter (where ${ticketsTable.urgency} = 'URGENT')`,
        stabilityRisk: sql<number>`count(*) filter (where ${ticketsTable.stabilityRisk} = true)`,
      })
      .from(ticketsTable);

    const [themeCounts] = await tenantDb
      .select({
        totalThemes: sql<number>`count(*)`,
        highRiskThemes: sql<number>`count(*) filter (where ${themesTable.riskLevel} = 'HIGH')`,
      })
      .from(themesTable);

    // 3. 最新 5 条工单样本 (用于接入台和实体研判展示)
    const recentTickets = await tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        content: ticketsTable.content,
        canonicalSubject: ticketsTable.canonicalSubject,
        address: ticketsTable.address,
        district: ticketsTable.district,
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        urgency: ticketsTable.urgency,
        stabilityRisk: ticketsTable.stabilityRisk,
        confidence: ticketsTable.confidence,
        createTime: ticketsTable.createTime,
      })
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime))
      .limit(6);

    // 4. 最新 5 个多频主题 (用于聚类与案卷展示)
    const recentThemes = await tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        canonicalSubject: themesTable.canonicalSubject,
        canonicalLocation: themesTable.canonicalLocation,
        category: themesTable.category,
        riskLevel: themesTable.riskLevel,
        ticketCount: themesTable.ticketCount,
        recommendedAction: themesTable.recommendedAction,
        handlingStatus: themesTable.handlingStatus,
        createdAt: themesTable.createdAt,
      })
      .from(themesTable)
      .orderBy(desc(themesTable.createdAt))
      .limit(5);

    // 5. 分类统计分布
    const categoryStats = await tenantDb
      .select({
        category: sql<string>`coalesce(${ticketsTable.sourceCategory}, '其他诉求')`,
        count: sql<number>`count(*)`,
      })
      .from(ticketsTable)
      .groupBy(sql`coalesce(${ticketsTable.sourceCategory}, '其他诉求')`)
      .orderBy(sql`count(*) desc`)
      .limit(7);

    return apiSuccess({
      regionId,
      regionName: region?.name ?? regionId,
      cityName: region?.city ?? "",
      taskProgress: taskProgress || null,
      metrics: {
        totalTickets: Number(ticketCounts?.total || 0),
        analyzedTickets: Number(ticketCounts?.analyzed || 0),
        unprocessedTickets: Number(ticketCounts?.unprocessed || 0),
        urgentTickets: Number(ticketCounts?.urgent || 0),
        stabilityRiskTickets: Number(ticketCounts?.stabilityRisk || 0),
        totalThemes: Number(themeCounts?.totalThemes || 0),
        highRiskThemes: Number(themeCounts?.highRiskThemes || 0),
      },
      categoryStats: categoryStats.map((c) => ({
        category: c.category,
        count: Number(c.count || 0),
      })),
      recentTickets: recentTickets.map((t) => ({
        ...t,
        createTime: t.createTime ? t.createTime.toISOString() : null,
      })),
      recentThemes: recentThemes.map((th) => ({
        ...th,
        createdAt: th.createdAt ? th.createdAt.toISOString() : null,
      })),
    });
  } catch (err: any) {
    console.error("[workbench/pipeline-state] Error:", err);
    return apiError(ApiCode.INTERNAL_ERROR, err.message, 500);
  }
}
