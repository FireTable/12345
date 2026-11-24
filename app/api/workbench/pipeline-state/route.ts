import { NextRequest } from "next/server";
import { getRegionDb, type DB } from "@/db/client";
import { ticketsTable, themesTable, reviewQueueTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getLatestTaskProgress } from "@/lib/task-progress";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { sql, desc, eq } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { regionLabel, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { getSystemTwoEndpoints } from "@/backend/model";
import { getNodeMetric } from "@/lib/node-metrics";
import {
  buildModelsUrl,
  isLocalEndpoint,
  listEnabledComputeNodes,
  normalizeProvider,
  type ComputeNodeProvider,
} from "@/lib/compute-nodes";
import { requireAdmin } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

const PIPELINE_DB_CACHE_TTL_MS = 10_000;

const nodeHealthCache = new Map<string, { isOnline: boolean; lastChecked: number }>();
const LOCAL_PROBE_TIMEOUT_MS = 500;
const REMOTE_PROBE_TIMEOUT_MS = 2500;
const ONLINE_TTL_MS = 3000;
const OFFLINE_TTL_MS = 30_000;

async function probeEndpointOnline(
  endpoint: string,
  apiKey?: string | null,
  provider?: ComputeNodeProvider
): Promise<boolean> {
  const cacheKey = `${endpoint}|${apiKey || ""}`;
  const cached = nodeHealthCache.get(cacheKey);
  if (cached) {
    const ttl = cached.isOnline ? ONLINE_TTL_MS : OFFLINE_TTL_MS;
    if (Date.now() - cached.lastChecked < ttl) return cached.isOnline;
  }
  const isLocal = isLocalEndpoint(endpoint) && provider !== "COLAB";
  const timeoutMs = isLocal ? LOCAL_PROBE_TIMEOUT_MS : REMOTE_PROBE_TIMEOUT_MS;
  let online = false;
  try {
    const url = buildModelsUrl(endpoint);
    const headers: Record<string, string> = {};
    if (apiKey?.trim()) {
      headers.Authorization = `Bearer ${apiKey.trim()}`;
    }
    const res = await fetch(url, {
      method: "GET",
      headers,
      signal: AbortSignal.timeout(timeoutMs),
    });
    online = res.ok;
  } catch {
    online = false;
  }
  nodeHealthCache.set(cacheKey, { isOnline: online, lastChecked: Date.now() });
  return online;
}

async function loadRecentExtractedTickets(tenantDb: DB) {
  try {
    return await tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        content: sql<string | null>`left(${ticketsTable.content}, 80)`,
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
      return await tenantDb
        .select({
          id: ticketsTable.id,
          ticketNo: ticketsTable.ticketNo,
          title: ticketsTable.title,
          content: sql<string | null>`left(${ticketsTable.content}, 80)`,
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
    } catch {
      return [];
    }
  }
}

async function loadPipelineDbSnapshot(tenantDb: DB) {
  const [
    ticketBuckets,
    themeCountRows,
    pendingReviewRows,
    recentTickets,
    recentExtractedTicketsRaw,
    recentThemes,
  ] = await Promise.all([
    // 合并原 3 次全表 tickets 扫描（metrics + subdistrict + sourceCategory）为单次 GROUP BY
    tenantDb
      .select({
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        total: sql<number>`count(*)::int`,
        analyzed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is not null and ${ticketsTable.confidence} > 0)::int`,
        unprocessed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0)::int`,
        urgent: sql<number>`count(*) filter (where ${ticketsTable.urgency} = 'URGENT')::int`,
        stabilityRisk: sql<number>`count(*) filter (where ${ticketsTable.stabilityRisk} = true)::int`,
        fakeClosureTickets: sql<number>`count(*) filter (where ${ticketsTable.isFakeClosure} is true)::int`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.subdistrict, ticketsTable.sourceCategory),
    tenantDb
      .select({
        totalThemes: sql<number>`count(*)`,
        highRiskThemes: sql<number>`count(*) filter (where ${themesTable.riskLevel} = 'HIGH')`,
        pendingThemes: sql<number>`count(*) filter (where ${themesTable.handlingStatus} is null or upper(${themesTable.handlingStatus}) = 'PENDING')::int`,
        inProgressThemes: sql<number>`count(*) filter (where upper(coalesce(${themesTable.handlingStatus}, '')) in ('IN_PROGRESS', 'DISPATCHED', 'PROCESSING'))::int`,
        resolvedThemes: sql<number>`count(*) filter (where upper(coalesce(${themesTable.handlingStatus}, '')) in ('RESOLVED', 'FINISHED'))::int`,
      })
      .from(themesTable),
    tenantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewQueueTable)
      .where(eq(reviewQueueTable.status, "PENDING"))
      .catch(() => [{ count: 0 }]),
    tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        content: sql<string | null>`left(${ticketsTable.content}, 80)`,
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
      .limit(6),
    loadRecentExtractedTickets(tenantDb),
    tenantDb
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
      .limit(5),
  ]);

  let totalTickets = 0;
  let analyzedTickets = 0;
  let unprocessedTickets = 0;
  let urgentTickets = 0;
  let stabilityRiskTickets = 0;
  let fakeClosureTickets = 0;
  const townshipMap = new Map<string, number>();
  const categoryMap = new Map<string, number>();

  for (const r of ticketBuckets) {
    const rowTotal = Number(r.total || 0);
    totalTickets += rowTotal;
    analyzedTickets += Number(r.analyzed || 0);
    unprocessedTickets += Number(r.unprocessed || 0);
    urgentTickets += Number(r.urgent || 0);
    stabilityRiskTickets += Number(r.stabilityRisk || 0);
    fakeClosureTickets += Number(r.fakeClosureTickets || 0);

    const label = regionLabel(r.subdistrict);
    townshipMap.set(label, (townshipMap.get(label) || 0) + rowTotal);

    const rawCat = (r.sourceCategory || "").trim();
    const cat = rawCat || UNKNOWN_TOWN;
    categoryMap.set(cat, (categoryMap.get(cat) || 0) + rowTotal);
  }

  const townshipStats = [...townshipMap.entries()]
    .sort((a, b) => {
      if (a[0] === UNKNOWN_TOWN) return 1;
      if (b[0] === UNKNOWN_TOWN) return -1;
      return b[1] - a[1];
    })
    .map(([township, count]) => ({ township, count: Number(count || 0) }));

  const categoryStats = [...categoryMap.entries()]
    .sort((a, b) => {
      if (a[0] === UNKNOWN_TOWN) return 1;
      if (b[0] === UNKNOWN_TOWN) return -1;
      return b[1] - a[1];
    })
    .map(([category, count]) => ({ category, count: Number(count || 0) }));

  const themeCounts = themeCountRows[0];

  // 计算最近连续两张工单的实际完成时间差（真实物理客观耗时，用于客观校验与兜底）
  let dbTicketDurationMs: number | null = null;
  if (recentExtractedTicketsRaw.length >= 2) {
    const first = recentExtractedTicketsRaw[0] as { updatedAt?: Date | null };
    const second = recentExtractedTicketsRaw[1] as { updatedAt?: Date | null };
    const u0 = first?.updatedAt ? new Date(first.updatedAt).getTime() : 0;
    const u1 = second?.updatedAt ? new Date(second.updatedAt).getTime() : 0;
    if (u0 > 0 && u1 > 0) {
      const delta = Math.abs(u0 - u1);
      if (delta >= 800 && delta <= 60000) {
        dbTicketDurationMs = delta;
      }
    }
  }

  return {
    metrics: {
      totalTickets,
      analyzedTickets,
      unprocessedTickets,
      urgentTickets,
      stabilityRiskTickets,
      totalThemes: Number(themeCounts?.totalThemes || 0),
      highRiskThemes: Number(themeCounts?.highRiskThemes || 0),
    },
    disposalMetrics: {
      pendingThemes: Number(themeCounts?.pendingThemes || 0),
      inProgressThemes: Number(themeCounts?.inProgressThemes || 0),
      resolvedThemes: Number(themeCounts?.resolvedThemes || 0),
      fakeClosureTickets,
      pendingReviewCount: Number(pendingReviewRows[0]?.count || 0),
    },
    categoryStats,
    townshipStats,
    dbTicketDurationMs,
    recentExtractedTickets: recentExtractedTicketsRaw.map((t: any) => ({
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
  };
}

export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb, region } = await getRegionDb(regionId);

    const [taskProgress, dbSnapResult, dbNodes] = await Promise.all([
      getLatestTaskProgress(regionId),
      cacheGetOrLoad(
        `stats:${regionId}:pipeline-state:db`,
        () => loadPipelineDbSnapshot(tenantDb),
        PIPELINE_DB_CACHE_TTL_MS
      ),
      listEnabledComputeNodes("SYSTEM_TWO").catch(() => []),
    ]);

    const dbSnap = dbSnapResult.value;

    // 解析 SYSTEM_TWO_ENDPOINTS 环境变量节点 + 数据库动态启用节点，并发探测健康状态
    const rawEndpoints = getSystemTwoEndpoints();
    const envList = rawEndpoints.length > 0 ? rawEndpoints : ["http://127.0.0.1:8132/v1"];
    const chineseNumbers = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

    const nodeEntries = new Map<
      string,
      {
        id?: string;
        name?: string;
        endpoint: string;
        apiKey?: string | null;
        provider: ComputeNodeProvider;
      }
    >();
    for (const rawEp of envList) {
      const ep = rawEp.trim().replace(/\/+$/, "");
      if (!ep) continue;
      nodeEntries.set(ep, {
        endpoint: ep,
        provider: isLocalEndpoint(ep) ? "LOCAL" : "CLOUD",
      });
    }
    for (const dbNode of dbNodes) {
      const ep = (dbNode.endpoint || "").trim().replace(/\/+$/, "");
      if (!ep) continue;
      nodeEntries.set(ep, {
        id: dbNode.id,
        name: dbNode.name,
        endpoint: ep,
        apiKey: dbNode.apiKey,
        provider: normalizeProvider(dbNode.provider, ep),
      });
    }

    const mergedNodes = Array.from(nodeEntries.values());
    const onlineStatuses = await Promise.all(
      mergedNodes.map((n) => probeEndpointOnline(n.endpoint, n.apiKey, n.provider))
    );

    const systemTwoNodes = mergedNodes.map((item, idx) => {
      const ep = item.endpoint;
      const isLocal = isLocalEndpoint(ep) && item.provider !== "COLAB";
      const hostMatch = ep.match(/https?:\/\/([^/:]+)(?::(\d+))?/);
      const hostStr = hostMatch ? `${hostMatch[1]}:${hostMatch[2] || (ep.startsWith("https") ? "443" : "80")}` : ep;
      const chineseNum = chineseNumbers[idx] || String(idx + 1);
      const metric = getNodeMetric(ep);
      const isOnline = onlineStatuses[idx] ?? false;

      // 完整工单耗时：在线时取原生或数据库耗时；离线时不显示耗时
      const effectiveDuration = isOnline
        ? (metric?.durationMs && metric.durationMs >= 200)
          ? metric.durationMs
          : (dbSnap.dbTicketDurationMs ?? (metric?.durationMs && metric.durationMs > 0 ? metric.durationMs : null))
        : null;

      return {
        id: item.id || `node-${idx + 1}`,
        name: item.name || `研判节点${chineseNum}`,
        host: hostStr,
        isLocal,
        isOnline,
        lastDurationMs: effectiveDuration,
        provider: item.provider,
        tokensPerSecond: isOnline ? (metric?.tokensPerSecond ?? null) : null,
      };
    });

    return apiSuccess({
      regionId,
      regionName: region?.name ?? regionId,
      cityName: region?.city ?? "",
      taskProgress: taskProgress || null,
      metrics: dbSnap.metrics,
      disposalMetrics: dbSnap.disposalMetrics,
      categoryStats: dbSnap.categoryStats,
      townshipStats: dbSnap.townshipStats,
      systemTwoNodes,
      recentExtractedTickets: dbSnap.recentExtractedTickets,
      recentTickets: dbSnap.recentTickets,
      recentThemes: dbSnap.recentThemes,
    });
  } catch (err: any) {
    console.error("[workbench/pipeline-state] Error:", err);
    return apiError(ApiCode.INTERNAL_ERROR, err.message, 500);
  }
}
