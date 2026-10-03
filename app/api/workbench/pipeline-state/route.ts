import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getLatestTaskProgress } from "@/lib/task-progress";
import { sql, desc, eq, isNull } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { regionLabel, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";

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

    // 自动自驱动研判：只要辖区存在未研判工单，且当前没有正在执行的任务，系统自动开启研判流水线
    const unprocessedTickets = Number(ticketCounts?.unprocessed || 0);
    if (unprocessedTickets > 0 && (!taskProgress || taskProgress.status !== "RUNNING")) {
      triggerClusterJobAuto(regionId).catch((err) => {
        console.warn("[workbench/pipeline-state] Auto cluster trigger warning:", err?.message || err);
      });
    }

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
        eventType: ticketsTable.eventType,
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

    // 5. 属地镇街流向分布统计 (统一按系统单一事实来源 regionLabel 解析，缺失/非镇街统一收敛为 UNKNOWN_TOWN "未知")
    const subdistrictRows = await tenantDb
      .select({
        subdistrict: ticketsTable.subdistrict,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.subdistrict);

    const townshipMap = new Map<string, number>();
    for (const r of subdistrictRows) {
      const label = regionLabel(r.subdistrict);
      townshipMap.set(label, (townshipMap.get(label) || 0) + Number(r.count || 0));
    }

    const townshipStats = [...townshipMap.entries()]
      .sort((a, b) => {
        if (a[0] === UNKNOWN_TOWN) return 1;
        if (b[0] === UNKNOWN_TOWN) return -1;
        return b[1] - a[1];
      })
      .map(([township, count]) => ({ township, count }));

    // 6. 全量民生业务分类分布 (统一与系统分类字典对齐，空值收敛为 UNKNOWN_TOWN "未知")
    const categoryRows = await tenantDb
      .select({
        category: ticketsTable.sourceCategory,
        count: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.sourceCategory);

    const categoryMap = new Map<string, number>();
    for (const r of categoryRows) {
      const raw = (r.category || "").trim();
      const cat = raw || UNKNOWN_TOWN;
      categoryMap.set(cat, (categoryMap.get(cat) || 0) + Number(r.count || 0));
    }

    const categoryStats = [...categoryMap.entries()]
      .sort((a, b) => {
        if (a[0] === UNKNOWN_TOWN) return 1;
        if (b[0] === UNKNOWN_TOWN) return -1;
        return b[1] - a[1];
      })
      .map(([category, count]) => ({ category, count }));

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
      townshipStats: townshipStats.map((ts) => ({
        township: ts.township,
        count: Number(ts.count || 0),
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
