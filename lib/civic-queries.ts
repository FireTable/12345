import { getAllRegions, getRegionDb, type DB } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable, reviewQueueTable } from "@/db/schema";
import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { isTownLabel, parseAdminArea } from "@/lib/admin-area";
import { regionLabel, toClusterDto, normalizeStatusCode, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { buildUnresolvedMissingInfoSql } from "@/lib/civic-missing";
import { CIVIC_CATEGORIES, deriveClusterUrgency, spanDays, urgentCutFromUnprocessed } from "@/lib/civic-cluster";
import {
  buildInsights,
  buildOverviewFromBuckets,
  buildTrendsFromBuckets,
} from "@/lib/civic-stats";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";
import { parseDomainProfile } from "@/lib/domain-profile";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

function asInt(v: unknown): number {
  return Number(v || 0);
}

function normalizeTenantRegionLabel(subdistrict: string | null | undefined, isEcommerce: boolean): string {
  if (isEcommerce) {
    const clean = (subdistrict || "").trim();
    if (!clean || clean === "未知" || clean === "未指定" || clean === "未归属") {
      return UNKNOWN_TOWN;
    }
    return clean;
  }
  return regionLabel(subdistrict);
}

/**
 * 区分站点选择参数与镇街/渠道过滤参数：当 ?region= 为镇街/渠道名且非已知租户 ID 时，优先采用 regionId 或 x-region-id。
 */
export async function resolveSiteRegionId(req: Request): Promise<string> {
  try {
    const { searchParams } = new URL(req.url);
    const explicitRegionId = searchParams.get("regionId")?.trim();
    if (explicitRegionId) {
      return resolveRequestRegionId(req, explicitRegionId);
    }
    const queryRegion = searchParams.get("region")?.trim();
    const headerRegion = req.headers.get("x-region-id")?.trim();
    if (queryRegion && headerRegion && queryRegion !== headerRegion) {
      const allRegions = await getAllRegions();
      const matchesTenant =
        queryRegion === "shunde" ||
        queryRegion === "haizhu" ||
        allRegions.some((r) => r.id === queryRegion || r.id.endsWith(`_${queryRegion}`));
      if (!matchesTenant) {
        return resolveRequestRegionId(req, headerRegion);
      }
    }
  } catch {
    // ignore URL parse error
  }
  return resolveRequestRegionId(req);
}

async function latestTicketTime(tenantDb: DB): Promise<Date | null> {
  const rows = await tenantDb
    .select({ max: sql<Date | null>`max(${ticketsTable.createTime})` })
    .from(ticketsTable);
  const v = rows[0]?.max;
  return v ? new Date(v) : null;
}

function windowForDays(days: number, latest: Date | null): { from?: Date; to?: Date } {
  if (days <= 0) return {};
  return timeWindow(`近${days}天`, clampTimeRef(latest));
}

function colInWindow(col: typeof ticketsTable.createTime | typeof themesTable.createdAt, win: { from?: Date; to?: Date }): SQL | undefined {
  const parts: SQL[] = [];
  if (win.from) parts.push(gte(col, win.from));
  if (win.to) parts.push(lt(col, win.to));
  if (!parts.length) return undefined;
  return parts.length === 1 ? parts[0] : and(...parts);
}

export async function loadOverview(days: number, regionId?: string) {
  const { db: tenantDb, region: tenantRegion } = await getRegionDb(regionId);
  const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
  const latest = await latestTicketTime(tenantDb);
  const scoped = colInWindow(ticketsTable.createTime, windowForDays(days, latest));
  const todayWin = timeWindow("今天", clampTimeRef(latest));
  const todayCondition =
    todayWin.from && todayWin.to
      ? and(gte(ticketsTable.createTime, todayWin.from), lt(ticketsTable.createTime, todayWin.to))
      : undefined;

  const [bucketRows, themeCountRes, monthlyRows, themeInsightRows] = await Promise.all([
    tenantDb
      .select({
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        n: sql<number>`count(*)::int`,
        today: todayCondition
          ? sql<number>`count(*) filter (where ${todayCondition})::int`
          : sql<number>`0::int`,
        analyzed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is not null)::int`,
        multifreq: sql<number>`count(*) filter (where ${ticketsTable.primaryThemeId} is not null)::int`,
        resolved: sql<number>`count(*) filter (where ${ticketsTable.status} in ('RESOLVED', 'FINISHED', 'CLOSED', '已办结') or ${ticketsTable.closedAt} is not null)::int`,
        fakeClosure: sql<number>`count(*) filter (where ${ticketsTable.isFakeClosure} is true)::int`,
        minTime: sql<Date | null>`min(${ticketsTable.createTime})`,
        maxTime: sql<Date | null>`max(${ticketsTable.createTime})`,
      })
      .from(ticketsTable)
      .where(scoped)
      .groupBy(ticketsTable.subdistrict, ticketsTable.sourceCategory),
    tenantDb.select({ count: sql<number>`count(*)::int` }).from(themesTable),
    tenantDb
      .select({
        month: sql<string>`date_trunc('month', ${ticketsTable.createTime} at time zone 'Asia/Shanghai')`,
        n: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .where(scoped ? and(isNotNull(ticketsTable.createTime), scoped) : isNotNull(ticketsTable.createTime))
      .groupBy(sql`1`),
    tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        category: themesTable.category,
        patternType: themesTable.patternType,
        ticketCount: themesTable.ticketCount,
        trendPct: themesTable.trendPct,
        canonicalSubject: themesTable.canonicalSubject,
        canonicalLocation: themesTable.canonicalLocation,
        aiSummary: themesTable.aiSummary,
        recommendedAction: themesTable.recommendedAction,
        riskLevel: themesTable.riskLevel,
      })
      .from(themesTable)
      .orderBy(
        sql`case when ${themesTable.ticketCount} between 2 and 240 and char_length(coalesce(${themesTable.title}, '')) <= 48 and coalesce(${themesTable.title}, '') not like '%身份证%' then 0 else 1 end`,
        desc(themesTable.lastAt),
        desc(themesTable.ticketCount)
      )
      .limit(80),
  ]);

  let total = 0;
  let today = 0;
  let analyzed = 0;
  let multifreq = 0;
  let resolved = 0;
  let fakeClosure = 0;
  let minMs = Infinity;
  let maxMs = -Infinity;

  const regionCounts = new Map<string | null, number>();
  const categoryCounts = new Map<string | null, number>();
  const regionCategoryRows: Array<{ subdistrict: string | null; category: string | null; n: number }> = [];

  for (const row of bucketRows) {
    const n = asInt(row.n);
    total += n;
    today += asInt(row.today);
    analyzed += asInt(row.analyzed);
    multifreq += asInt(row.multifreq);
    resolved += asInt(row.resolved);
    fakeClosure += asInt(row.fakeClosure);

    if (row.minTime) {
      const ms = new Date(row.minTime).getTime();
      if (!Number.isNaN(ms) && ms < minMs) minMs = ms;
    }
    if (row.maxTime) {
      const ms = new Date(row.maxTime).getTime();
      if (!Number.isNaN(ms) && ms > maxMs) maxMs = ms;
    }

    regionCounts.set(row.subdistrict, (regionCounts.get(row.subdistrict) || 0) + n);
    categoryCounts.set(row.sourceCategory, (categoryCounts.get(row.sourceCategory) || 0) + n);
    regionCategoryRows.push({
      subdistrict: row.subdistrict,
      category: row.sourceCategory,
      n,
    });
  }

  const regionRows = Array.from(regionCounts.entries(), ([subdistrict, n]) => ({ subdistrict, n }));
  const categoryRows = Array.from(categoryCounts.entries(), ([category, n]) => ({ category, n }));
  const formattedMonthlyRows = monthlyRows.map((r) => ({
    month: r.month ? String(r.month).slice(0, 7) : "",
    n: asInt(r.n),
  }));

  const overview = buildOverviewFromBuckets(
    {
      total,
      analyzed,
      multifreq,
      minTime: Number.isFinite(minMs) ? new Date(minMs) : null,
      maxTime: Number.isFinite(maxMs) ? new Date(maxMs) : null,
      themeCount: asInt(themeCountRes[0]?.count),
      regionRows,
      categoryRows,
      regionCategoryRows,
      monthlyRows: formattedMonthlyRows,
    },
    { domainType: domainProfile.domainType }
  );

  const insights = buildInsights(themeInsightRows);

  return {
    success: true as const,
    todayCount: today,
    resolvedCount: resolved,
    fakeClosureCount: fakeClosure,
    ...overview,
    insights,
  };
}

export async function loadTrends(days: number, regionId?: string) {
  const { db: tenantDb } = await getRegionDb(regionId);
  const latest = days > 0 ? await latestTicketTime(tenantDb) : null;
  const win = windowForDays(days, latest);
  const ticketScoped = colInWindow(ticketsTable.createTime, win);
  const themeScoped = colInWindow(themesTable.createdAt, win);
  const ticketWhere = ticketScoped
    ? and(isNotNull(ticketsTable.createTime), ticketScoped)
    : isNotNull(ticketsTable.createTime);
  const themeWhere = themeScoped
    ? and(isNotNull(themesTable.createdAt), themeScoped)
    : isNotNull(themesTable.createdAt);

  const [dailyRows, clusterDayRows] = await Promise.all([
    tenantDb
      .select({
        day: sql<string>`(${ticketsTable.createTime} at time zone 'Asia/Shanghai')::date::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .where(ticketWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    tenantDb
      .select({
        day: sql<string>`(${themesTable.createdAt} at time zone 'UTC')::date::text`,
        n: sql<number>`count(*)::int`,
      })
      .from(themesTable)
      .where(themeWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
  ]);

  return {
    success: true as const,
    ...buildTrendsFromBuckets({ dailyRows, clusterDayRows }),
  };
}

export async function loadWorkorderStats(regionId?: string) {
  const { db: tenantDb, region: tenantRegion } = await getRegionDb(regionId);
  const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
  const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";
  const latest = await latestTicketTime(tenantDb);
  const todayWin = timeWindow("今天", clampTimeRef(latest));
  const todayCondition =
    todayWin.from && todayWin.to
      ? and(gte(ticketsTable.createTime, todayWin.from), lt(ticketsTable.createTime, todayWin.to))
      : undefined;

  const [bucketRows, reviewPendingRows] = await Promise.all([
    tenantDb
      .select({
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        total: sql<number>`count(*)::int`,
        today: todayCondition
          ? sql<number>`count(*) filter (where ${todayCondition})::int`
          : sql<number>`0::int`,
        finished: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.status}, '')) in ('RESOLVED','FINISHED'))::int`,
        progress: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.status}, '')) in ('DISPATCHED','VERIFIED','IN_PROGRESS','PROCESSING'))::int`,
        urgent: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.urgency}, '')) = 'URGENT')::int`,
        multifreq: sql<number>`count(*) filter (where ${ticketsTable.primaryThemeId} is not null)::int`,
        fakeClosure: sql<number>`count(*) filter (where ${ticketsTable.isFakeClosure} is true)::int`,
        missingInfo: sql<number>`count(*) filter (where ${sql.raw(buildUnresolvedMissingInfoSql("", isEcommerce))})::int`,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.subdistrict, ticketsTable.sourceCategory),
    tenantDb
      .select({ count: sql<number>`count(*)::int` })
      .from(reviewQueueTable)
      .where(eq(reviewQueueTable.status, "PENDING"))
      .catch(() => [{ count: 0 }]),
  ]);

  let total = 0;
  let today = 0;
  let finished = 0;
  let progress = 0;
  let urgent = 0;
  let multifreq = 0;
  let fakeClosure = 0;
  let missingInfo = 0;
  const regionSet = new Set<string>();
  const categorySet = new Set<string>();

  for (const row of bucketRows) {
    total += asInt(row.total);
    today += asInt(row.today);
    finished += asInt(row.finished);
    progress += asInt(row.progress);
    urgent += asInt(row.urgent);
    multifreq += asInt(row.multifreq);
    fakeClosure += asInt(row.fakeClosure);
    missingInfo += asInt(row.missingInfo);

    const label = normalizeTenantRegionLabel(row.subdistrict, isEcommerce);
    if (label && (isEcommerce || isTownLabel(label) || label === UNKNOWN_TOWN)) {
      regionSet.add(label);
    }

    const cat = (row.sourceCategory || "").trim();
    if (cat) categorySet.add(cat);
  }

  const pendingReview = asInt(reviewPendingRows[0]?.count);
  const baseCategories: readonly string[] = isEcommerce ? domainProfile.categories : CIVIC_CATEGORIES;
  const known = baseCategories.filter((c) => categorySet.has(c));
  const extra = [...categorySet].filter((c) => !baseCategories.includes(c));

  const sortedRegions = [...regionSet]
    .filter((r) => r !== UNKNOWN_TOWN)
    .sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (regionSet.has(UNKNOWN_TOWN)) {
    sortedRegions.push(UNKNOWN_TOWN);
  }

  return {
    stats: {
      total,
      today,
      pending: Math.max(0, total - finished - progress),
      progress,
      finished,
      urgent,
      multifreq,
      single: Math.max(0, total - multifreq),
      fakeClosure,
      missingInfo,
      pendingReview,
    },
    latest,
    facets: {
      regions: sortedRegions,
      categories: [...known, ...extra],
    },
  };
}

export function clusterRegionLabel(
  towns: Set<string> | undefined,
  canonicalLocation: string | null | undefined,
  isEcommerce = false
): string {
  const names = [...(towns || [])].filter((town) => town && town !== UNKNOWN_TOWN && town !== "未归属");
  names.sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (names.length === 1) return names[0];
  if (names.length === 2) return names.join(" · ");
  if (names.length > 2) return `${names.slice(0, 2).join(" · ")} 等 ${names.length} 镇街`;
  if (isEcommerce) {
    return normalizeTenantRegionLabel(canonicalLocation, true);
  }
  const parsed = parseAdminArea(canonicalLocation);
  if (parsed.subdistrict) return regionLabel(parsed.subdistrict);
  return regionLabel(canonicalLocation);
}

function facetTownsFrom(townsByTheme: Map<string, Set<string>>, isEcommerce = false): string[] {
  const set = new Set<string>();
  for (const towns of townsByTheme.values()) {
    for (const town of towns) {
      if (isEcommerce ? Boolean(town) : isTownLabel(town) || town === UNKNOWN_TOWN) {
        set.add(town);
      }
    }
  }
  const list = [...set].filter((town) => town !== UNKNOWN_TOWN).sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (set.has(UNKNOWN_TOWN)) list.push(UNKNOWN_TOWN);
  return list;
}

export async function loadClusterBundle(regionId?: string) {
  const { db: tenantDb, region: tenantRegion } = await getRegionDb(regionId);
  const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
  const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";

  const [themeRows, memberStatsRows] = await Promise.all([
    tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        canonicalSubject: themesTable.canonicalSubject,
        canonicalLocation: themesTable.canonicalLocation,
        eventType: themesTable.eventType,
        category: themesTable.category,
        riskLevel: themesTable.riskLevel,
        ticketCount: themesTable.ticketCount,
        patternType: themesTable.patternType,
        civicMode: themesTable.civicMode,
        aiConfidence: themesTable.aiConfidence,
        firstAt: themesTable.firstAt,
        lastAt: themesTable.lastAt,
        handlingStatus: themesTable.handlingStatus,
        handlingProgress: themesTable.handlingProgress,
        handlingOwner: themesTable.handlingOwner,
        handlingEta: themesTable.handlingEta,
        trendPct: themesTable.trendPct,
      })
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount)),
    tenantDb
      .select({
        themeId: ticketThemesTable.themeId,
        subdistrict: ticketsTable.subdistrict,
        pending: sql<number>`count(*) filter (where ${ticketsTable.status} = 'PENDING')::int`,
      })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .groupBy(ticketThemesTable.themeId, ticketsTable.subdistrict),
  ]);

  const pendingByTheme = new Map<string, number>();
  const townsByTheme = new Map<string, Set<string>>();
  for (const r of memberStatsRows) {
    pendingByTheme.set(r.themeId, (pendingByTheme.get(r.themeId) || 0) + asInt(r.pending));
    const town = normalizeTenantRegionLabel(r.subdistrict, isEcommerce);
    if (!town) continue;
    let set = townsByTheme.get(r.themeId);
    if (!set) {
      set = new Set<string>();
      townsByTheme.set(r.themeId, set);
    }
    set.add(town);
  }

  const pendingValues = themeRows.map((t) => {
    const code = normalizeStatusCode(t.handlingStatus);
    if (code === "RESOLVED") return 0;
    return pendingByTheme.get(t.id) ?? Math.round((t.ticketCount || 0) * (code === "IN_PROGRESS" ? 0.4 : 0.7));
  });
  const cut = urgentCutFromUnprocessed(pendingValues);

  const dtos = themeRows.map((t, idx) => {
    const base = toClusterDto(
      {
        ...t,
        firstAt: t.firstAt,
        lastAt: t.lastAt,
        tickets: [],
      },
      { brief: true }
    );
    const code = base.status.code || normalizeStatusCode(base.status.label);
    const unprocessed =
      code === "RESOLVED"
        ? 0
        : pendingByTheme.get(t.id) ?? Math.round(base.count * (code === "IN_PROGRESS" ? 0.4 : 0.7));
    return {
      ...base,
      region: clusterRegionLabel(townsByTheme.get(t.id), t.canonicalLocation, isEcommerce),
      unprocessed,
      urgency: deriveClusterUrgency(unprocessed, base.type, cut),
      days: spanDays(base.first_date, base.last_date),
      communities: townsByTheme.get(t.id)?.size || 0,
      code: `GC-${String(idx + 1).padStart(3, "0")}`,
    };
  });

  return { dtos, facetTowns: facetTownsFrom(townsByTheme, isEcommerce) };
}

export function filterClusterDtos(
  dtos: Awaited<ReturnType<typeof loadClusterBundle>>["dtos"],
  q: {
    mode?: string;
    region?: string;
    keyword?: string;
    status?: string;
    urgency?: string;
    tab?: string;
  }
) {
  let next = dtos;
  if (q.mode) next = next.filter((c) => c.mode === q.mode);
  if (q.region) next = next.filter((c) => c.region.includes(q.region!));
  if (q.status) next = next.filter((c) => c.status.code === normalizeStatusCode(q.status) || c.status.label === q.status);
  if (q.urgency) next = next.filter((c) => c.urgency === q.urgency);
  if (q.tab === "pending") next = next.filter((c) => c.status.code === "PENDING");
  else if (q.tab === "progress") next = next.filter((c) => c.status.code === "IN_PROGRESS");
  else if (q.tab === "done") next = next.filter((c) => c.status.code === "RESOLVED");
  else if (q.tab === "urgent") next = next.filter((c) => c.urgency === "urgent");
  if (q.keyword) {
    const kw = q.keyword.toLowerCase();
    next = next.filter(
      (c) =>
        c.type.toLowerCase().includes(kw) ||
        c.region.toLowerCase().includes(kw) ||
        c.title.toLowerCase().includes(kw) ||
        c.code.toLowerCase().includes(kw)
    );
  }
  return next;
}

