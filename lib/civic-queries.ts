import { getRegionDb, type DB } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable } from "@/db/schema";
import { and, desc, eq, gte, isNotNull, lt, sql, type SQL } from "drizzle-orm";
import { explicitAdmin, isTownLabel } from "@/lib/admin-area";
import { regionLabel, toClusterDto, normalizeStatusCode } from "@/lib/civic-dto";
import { CIVIC_CATEGORIES, deriveClusterUrgency, spanDays, urgentCutFromUnprocessed } from "@/lib/civic-cluster";
import {
  buildInsights,
  buildOverviewFromBuckets,
  buildTrendsFromBuckets,
} from "@/lib/civic-stats";
import { clampTimeRef, formatYmd, timeWindow } from "@/lib/civic-time";

function asInt(v: unknown): number {
  return Number(v || 0);
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
  const { db: tenantDb } = await getRegionDb(regionId);
  const latest = await latestTicketTime(tenantDb);
  const scoped = colInWindow(ticketsTable.createTime, windowForDays(days, latest));
  const inWindow = scoped ?? sql`true`;

  const [totals, themeCountRes, regionRows, categoryRows, regionCategoryRows, monthlyRows, themeInsightRows] =
    await Promise.all([
      tenantDb
        .select({
          total: sql<number>`count(*)::int`,
          analyzed: sql<number>`count(*) filter (where ${ticketsTable.confidence} is not null)::int`,
          multifreq: sql<number>`count(*) filter (where ${ticketsTable.primaryThemeId} is not null)::int`,
          minTime: sql<Date | null>`min(${ticketsTable.createTime})`,
          maxTime: sql<Date | null>`max(${ticketsTable.createTime})`,
        })
        .from(ticketsTable)
        .where(scoped),
      tenantDb.select({ count: sql<number>`count(*)::int` }).from(themesTable),
      tenantDb
        .select({
          subdistrict: ticketsTable.subdistrict,
          n: sql<number>`count(*)::int`,
        })
        .from(ticketsTable)
        .where(inWindow)
        .groupBy(ticketsTable.subdistrict),
      tenantDb
        .select({
          category: ticketsTable.sourceCategory,
          n: sql<number>`count(*)::int`,
        })
        .from(ticketsTable)
        .where(inWindow)
        .groupBy(ticketsTable.sourceCategory),
      tenantDb
        .select({
          subdistrict: ticketsTable.subdistrict,
          category: ticketsTable.sourceCategory,
          n: sql<number>`count(*)::int`,
        })
        .from(ticketsTable)
        .where(inWindow)
        .groupBy(ticketsTable.subdistrict, ticketsTable.sourceCategory),
      tenantDb
        .select({
          month: sql<string>`to_char(date_trunc('month', ${ticketsTable.createTime} at time zone 'UTC'), 'YYYY-MM')`,
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
          recommendedAction: themesTable.recommendedAction,
          riskLevel: themesTable.riskLevel,
        })
        .from(themesTable)
        .orderBy(desc(themesTable.ticketCount))
        .limit(200),
    ]);

  const totalsRow = totals[0] || {
    total: 0,
    analyzed: 0,
    multifreq: 0,
    minTime: null,
    maxTime: null,
  };

  const overview = buildOverviewFromBuckets({
    total: asInt(totalsRow.total),
    analyzed: asInt(totalsRow.analyzed),
    multifreq: asInt(totalsRow.multifreq),
    minTime: totalsRow.minTime ? new Date(totalsRow.minTime) : null,
    maxTime: totalsRow.maxTime ? new Date(totalsRow.maxTime) : null,
    themeCount: asInt(themeCountRes[0]?.count),
    regionRows,
    categoryRows,
    regionCategoryRows,
    monthlyRows,
  });

  const insights = buildInsights(themeInsightRows);

  return {
    success: true as const,
    ...overview,
    insights,
  };
}

export async function loadTrends(days: number, regionId?: string) {
  const { db: tenantDb } = await getRegionDb(regionId);
  const latest = await latestTicketTime(tenantDb);
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
        day: sql<string>`to_char(${ticketsTable.createTime} at time zone 'UTC', 'YYYY-MM-DD')`,
        n: sql<number>`count(*)::int`,
      })
      .from(ticketsTable)
      .where(ticketWhere)
      .groupBy(sql`1`)
      .orderBy(sql`1`),
    tenantDb
      .select({
        day: sql<string>`to_char(${themesTable.createdAt} at time zone 'UTC', 'YYYY-MM-DD')`,
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
  const { db: tenantDb } = await getRegionDb(regionId);
  const [agg, regionRows, categoryRows] = await Promise.all([
    tenantDb
      .select({
        total: sql<number>`count(*)::int`,
        finished: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.status}, '')) in ('RESOLVED','FINISHED'))::int`,
        progress: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.status}, '')) in ('DISPATCHED','VERIFIED','IN_PROGRESS','PROCESSING'))::int`,
        urgent: sql<number>`count(*) filter (where upper(coalesce(${ticketsTable.urgency}, '')) = 'URGENT')::int`,
        multifreq: sql<number>`count(*) filter (where ${ticketsTable.primaryThemeId} is not null)::int`,
        latest: sql<Date | null>`max(${ticketsTable.createTime})`,
      })
      .from(ticketsTable),
    tenantDb
      .select({
        subdistrict: ticketsTable.subdistrict,
      })
      .from(ticketsTable)
      .groupBy(ticketsTable.subdistrict),
    tenantDb
      .select({
        category: ticketsTable.sourceCategory,
      })
      .from(ticketsTable)
      .where(isNotNull(ticketsTable.sourceCategory))
      .groupBy(ticketsTable.sourceCategory),
  ]);

  const row = agg[0] || {
    total: 0,
    finished: 0,
    progress: 0,
    urgent: 0,
    multifreq: 0,
    latest: null,
  };
  const total = asInt(row.total);
  const finished = asInt(row.finished);
  const progress = asInt(row.progress);

  const regionSet = new Set<string>();
  for (const r of regionRows) {
    const town = explicitAdmin(r.subdistrict);
    const label = town ? regionLabel(town) : "";
    if (isTownLabel(label)) regionSet.add(label);
  }

  const categorySet = new Set<string>();
  for (const c of categoryRows) {
    const cat = (c.category || "").trim();
    if (cat) categorySet.add(cat);
  }
  const known = CIVIC_CATEGORIES.filter((c) => categorySet.has(c));
  const extra = [...categorySet].filter((c) => !(CIVIC_CATEGORIES as readonly string[]).includes(c));

  return {
    stats: {
      total,
      pending: Math.max(0, total - finished - progress),
      progress,
      finished,
      urgent: asInt(row.urgent),
      multifreq: asInt(row.multifreq),
    },
    latest: row.latest ? new Date(row.latest) : null,
    facets: {
      regions: [...regionSet].sort((a, b) => a.localeCompare(b, "zh-CN")),
      categories: [...known, ...extra],
    },
  };
}

export async function loadClusterBundle(regionId?: string) {
  const { db: tenantDb } = await getRegionDb(regionId);
  const themeRows = await tenantDb.select().from(themesTable).orderBy(desc(themesTable.ticketCount));

  const [pendingRows, townRows, sampleRows] = await Promise.all([
    tenantDb
      .select({
        themeId: ticketThemesTable.themeId,
        pending: sql<number>`count(*) filter (where ${ticketsTable.status} = 'PENDING')::int`,
      })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .groupBy(ticketThemesTable.themeId),
    tenantDb
      .select({
        themeId: ticketThemesTable.themeId,
        subdistrict: ticketsTable.subdistrict,
      })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .groupBy(ticketThemesTable.themeId, ticketsTable.subdistrict),
    tenantDb.execute<{
      id: string;
      ticket_no: string | null;
      title: string | null;
      summarize_title: string | null;
      content: string | null;
      masked_content: string | null;
      subdistrict: string | null;
      district: string | null;
      status: string | null;
      theme_id: string;
    }>(sql`
      SELECT id, ticket_no, title, summarize_title, content, masked_content,
             subdistrict, district, status, theme_id
      FROM (
        SELECT t.id, t.ticket_no, t.title, t.summarize_title, t.content, t.masked_content,
               t.subdistrict, t.district, t.status, tt.theme_id,
               row_number() OVER (PARTITION BY tt.theme_id ORDER BY t.create_time DESC NULLS LAST) AS rn
        FROM ticket_themes tt
        INNER JOIN tickets t ON t.id = tt.ticket_id
      ) s
      WHERE rn <= 5
    `),
  ]);

  const pendingByTheme = new Map<string, number>();
  for (const r of pendingRows) pendingByTheme.set(r.themeId, asInt(r.pending));

  const townsByTheme = new Map<string, Set<string>>();
  for (const r of townRows) {
    const town = explicitAdmin(r.subdistrict);
    if (!town) continue;
    const set = townsByTheme.get(r.themeId) || new Set<string>();
    set.add(regionLabel(town));
    townsByTheme.set(r.themeId, set);
  }

  const samplesByTheme = new Map<
    string,
    Array<{
      id: string;
      ticketNo?: string;
      title?: string | null;
      summarizeTitle?: string | null;
      content?: string | null;
      maskedContent?: string | null;
      subdistrict?: string | null;
      district?: string | null;
      status?: string | null;
    }>
  >();
  const sampleList = Array.isArray(sampleRows)
    ? sampleRows
    : ((sampleRows as { rows?: typeof sampleRows }).rows as typeof sampleRows) || [];
  for (const r of sampleList as Array<{
    id: string;
    ticket_no: string | null;
    title: string | null;
    summarize_title: string | null;
    content: string | null;
    masked_content: string | null;
    subdistrict: string | null;
    district: string | null;
    status: string | null;
    theme_id: string;
  }>) {
    const list = samplesByTheme.get(r.theme_id) || [];
    list.push({
      id: r.id,
      ticketNo: r.ticket_no || undefined,
      title: r.title,
      summarizeTitle: r.summarize_title,
      content: r.content,
      maskedContent: r.masked_content,
      subdistrict: r.subdistrict,
      district: r.district,
      status: r.status,
    });
    samplesByTheme.set(r.theme_id, list);
  }

  const pendingValues = themeRows.map((t) => {
    const code = normalizeStatusCode(t.handlingStatus);
    if (code === "RESOLVED") return 0;
    return pendingByTheme.get(t.id) ?? Math.round((t.ticketCount || 0) * (code === "IN_PROGRESS" ? 0.4 : 0.7));
  });
  const cut = urgentCutFromUnprocessed(pendingValues);

  const dtos = themeRows.map((t, idx) => {
    const base = toClusterDto({
      ...t,
      firstAt: t.firstAt,
      lastAt: t.lastAt,
      tickets: samplesByTheme.get(t.id) || [],
    });
    const code = base.status.code || normalizeStatusCode(base.status.label);
    const unprocessed =
      code === "RESOLVED"
        ? 0
        : pendingByTheme.get(t.id) ?? Math.round(base.count * (code === "IN_PROGRESS" ? 0.4 : 0.7));
    return {
      ...base,
      unprocessed,
      urgency: deriveClusterUrgency(unprocessed, base.type, cut),
      days: spanDays(base.first_date, base.last_date),
      communities: townsByTheme.get(t.id)?.size || 0,
      code: `GC-${String(idx + 1).padStart(3, "0")}`,
    };
  });

  return { themeRows, dtos, samplesByTheme };
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

