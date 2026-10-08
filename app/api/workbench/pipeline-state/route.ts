import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getLatestTaskProgress } from "@/lib/task-progress";
import { sql, desc, eq, isNull } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { regionLabel, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";
import { getSystemTwoEndpoints } from "@/backend/model";
import { getNodeMetric } from "@/lib/node-metrics";

export const dynamic = "force-dynamic";

const nodeHealthCache = new Map<string, { isOnline: boolean; lastChecked: number }>();

async function probeEndpointOnline(endpoint: string): Promise<boolean> {
  const cached = nodeHealthCache.get(endpoint);
  if (cached && Date.now() - cached.lastChecked < 3000) {
    return cached.isOnline;
  }
  let online = false;
  try {
    const base = endpoint.replace(/\/+$/, "");
    const url = base.endsWith("/v1") ? `${base}/models` : `${base}/v1/models`;
    const res = await fetch(url, {
      method: "GET",
      signal: AbortSignal.timeout(1500),
    });
    online = res.status < 500;
  } catch {
    online = false;
  }
  nodeHealthCache.set(endpoint, { isOnline: online, lastChecked: Date.now() });
  return online;
}

export async function GET(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb, region } = await getRegionDb(regionId);

    // 1. 获取当前辖区最新任务进度（多辖区并发时不再跨区泄漏）
    const taskProgress = await getLatestTaskProgress(regionId);

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

    // 3.1 接入台样本 (按原始提报时间)
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

    // 3.2 实体研判台最新处理好的工单样本 (按更新研判时间 updatedAt，真实反映最新提取出的要素)
    let recentExtractedTickets: any[] = [];
    try {
      recentExtractedTickets = await tenantDb
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
          updatedAt: ticketsTable.updatedAt,
        })
        .from(ticketsTable)
        .where(sql`${ticketsTable.canonicalSubject} IS NOT NULL AND ${ticketsTable.canonicalSubject} != ''`)
        .orderBy(desc(ticketsTable.updatedAt), desc(ticketsTable.createdAt))
        .limit(8);
    } catch {
      try {
        recentExtractedTickets = await tenantDb
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
          .where(sql`${ticketsTable.canonicalSubject} IS NOT NULL AND ${ticketsTable.canonicalSubject} != ''`)
          .orderBy(desc(ticketsTable.createTime))
          .limit(8);
      } catch {}
    }

    // 3.3 计算最近连续两张工单的实际完成时间差（真实物理客观耗时，用于客观校验与兜底）
    let dbTicketDurationMs: number | null = null;
    if (recentExtractedTickets.length >= 2) {
      const u0 = recentExtractedTickets[0]?.updatedAt ? new Date(recentExtractedTickets[0].updatedAt).getTime() : 0;
      const u1 = recentExtractedTickets[1]?.updatedAt ? new Date(recentExtractedTickets[1].updatedAt).getTime() : 0;
      if (u0 > 0 && u1 > 0) {
        const delta = Math.abs(u0 - u1);
        // 单条工单合理耗时范围 800ms ~ 60s
        if (delta >= 800 && delta <= 60000) {
          dbTicketDurationMs = delta;
        }
      }
    }

    // 3.4 解析 SYSTEM_TWO_ENDPOINTS 集群算力节点配置并并发探测健康状态
    const rawEndpoints = getSystemTwoEndpoints();
    const endpointsList = rawEndpoints.length > 0 ? rawEndpoints : ["http://127.0.0.1:8132/v1"];
    const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

    const onlineStatuses = await Promise.all(
      endpointsList.map((ep) => probeEndpointOnline(ep))
    );

    const systemTwoNodes = endpointsList.map((ep, idx) => {
      const isLocal = /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(ep);
      const hostMatch = ep.match(/https?:\/\/([^/:]+)(?::(\d+))?/);
      const hostStr = hostMatch ? `${hostMatch[1]}:${hostMatch[2] || "80"}` : ep;
      const chineseNum = chineseNumbers[idx] || String(idx + 1);
      const metric = getNodeMetric(ep);
      const isOnline = onlineStatuses[idx] ?? false;

      // 完整工单耗时：在线时取原生或数据库耗时；离线时不显示耗时
      const effectiveDuration = isOnline
        ? (metric?.durationMs && metric.durationMs >= 200)
          ? metric.durationMs
          : (dbTicketDurationMs ?? (metric?.durationMs && metric.durationMs > 0 ? metric.durationMs : null))
        : null;

      return {
        id: `node-${idx + 1}`,
        name: `研判节点${chineseNum}`,
        host: hostStr,
        isLocal,
        isOnline,
        lastDurationMs: effectiveDuration,
      };
    });

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
      systemTwoNodes,
      recentExtractedTickets: recentExtractedTickets.map((t) => ({
        ...t,
        createTime: t.createTime ? t.createTime.toISOString() : null,
        updatedAt: t.updatedAt ? t.updatedAt.toISOString() : null,
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
