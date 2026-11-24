import { explicitAdmin, isTownLabel } from "./admin-area";
import { regionLabel, UNKNOWN_TOWN } from "./civic-dto";
import { shanghaiCalendarDate } from "./work-order-date";

export type TicketStatRow = {
  createTime?: Date | string | null;
  subdistrict?: string | null;
  district?: string | null;
  sourceCategory?: string | null;
  category?: string | null;
  primaryThemeId?: string | null;
  confidence?: number | null;
  address?: string | null;
};

export type ThemeStatRow = {
  createdAt?: Date | string | null;
  patternType?: string | null;
};

function asDate(v?: Date | string | null): Date | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v).replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

function ymd(d: Date): string {
  return shanghaiCalendarDate(d);
}

function ym(d: Date): string {
  return shanghaiCalendarDate(d).slice(0, 7);
}

function weekKey(d: Date): string {
  const [year, month, day] = shanghaiCalendarDate(d).split("-").map(Number);
  const civil = new Date(Date.UTC(year, month - 1, day));
  const dow = civil.getUTCDay() || 7;
  const start = new Date(civil);
  start.setUTCDate(start.getUTCDate() - (dow - 1));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + 6);
  return `${shanghaiCalendarDate(start)}/${shanghaiCalendarDate(end)}`;
}

export type OverviewBuckets = {
  total: number;
  analyzed: number;
  multifreq: number;
  minTime: Date | null;
  maxTime: Date | null;
  themeCount: number;
  regionRows: Array<{ subdistrict: string | null; n: number }>;
  categoryRows: Array<{ category: string | null; n: number }>;
  regionCategoryRows: Array<{ subdistrict: string | null; category: string | null; n: number }>;
  monthlyRows: Array<{ month: string; n: number }>;
};

export type TrendBuckets = {
  dailyRows: Array<{ day: string; n: number }>;
  clusterDayRows: Array<{ day: string; n: number }>;
};

function normalizeBucketRegion(subdistrict: string | null | undefined, isEcommerce: boolean): string {
  if (isEcommerce) {
    const clean = (subdistrict || "").trim();
    if (!clean || clean === "未知" || clean === "未指定" || clean === "未归属") {
      return UNKNOWN_TOWN;
    }
    return clean;
  }
  const region = regionLabel(subdistrict);
  return region && (isTownLabel(region) || region === UNKNOWN_TOWN) ? region : "";
}

export function buildOverviewFromBuckets(b: OverviewBuckets, opts?: { domainType?: string }) {
  const isEcommerce = opts?.domainType === "ECOMMERCE_CS";
  const min = b.minTime;
  const max = b.maxTime;
  const totalDays =
    min && max ? Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000) + 1) : 0;

  const regionDistribution: Record<string, number> = {};
  for (const row of b.regionRows) {
    const region = normalizeBucketRegion(row.subdistrict, isEcommerce);
    if (region) {
      regionDistribution[region] = (regionDistribution[region] || 0) + Number(row.n || 0);
    }
  }

  const categoryDistribution: Record<string, number> = {};
  for (const row of b.categoryRows) {
    const cat = (row.category || "").trim();
    if (cat) categoryDistribution[cat] = (categoryDistribution[cat] || 0) + Number(row.n || 0);
  }

  const regionCategory: Record<string, Record<string, number>> = {};
  for (const row of b.regionCategoryRows) {
    const region = normalizeBucketRegion(row.subdistrict, isEcommerce);
    const cat = (row.category || "").trim();
    if (region && cat) {
      if (!regionCategory[region]) regionCategory[region] = {};
      regionCategory[region][cat] = (regionCategory[region][cat] || 0) + Number(row.n || 0);
    }
  }

  const monthlyTrend: Record<string, number> = {};
  for (const row of b.monthlyRows) {
    if (row.month) monthlyTrend[row.month] = Number(row.n || 0);
  }

  const topRegion =
    Object.entries(regionDistribution)
      .filter(([name]) => name !== UNKNOWN_TOWN)
      .sort((a, c) => c[1] - a[1])[0]?.[0] || "";
  const topCategory =
    Object.entries(categoryDistribution).sort((a, c) => c[1] - a[1])[0]?.[0] || "";

  return {
    totalWorkorders: Number(b.total || 0),
    analyzedCount: Number(b.analyzed || 0),
    dateRange: min && max ? `${ymd(min)} ~ ${ymd(max)}` : "",
    totalDays,
    avgDaily: totalDays ? Math.round(Number(b.total || 0) / totalDays) : 0,
    topRegion,
    topCategory,
    multiFreqCount: Number(b.multifreq || 0),
    multiFreqClusters: Number(b.themeCount || 0),
    regionDistribution,
    categoryDistribution,
    regionCategory,
    monthlyTrend,
  };
}

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

function weekRangeForDay(dayStr: string): string | null {
  const m = YMD_RE.exec(dayStr);
  let weekStart: Date;
  if (m) {
    weekStart = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  } else {
    const d = asDate(dayStr);
    if (!d) return null;
    weekStart = new Date(d);
  }
  const dow = weekStart.getUTCDay() || 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - (dow - 1));
  const weekEnd = new Date(weekStart);
  weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
  return `${weekStart.toISOString().slice(0, 10)}/${weekEnd.toISOString().slice(0, 10)}`;
}

export function buildTrendsFromBuckets(b: TrendBuckets) {
  const daily: Record<string, number> = {};
  const weekly: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  const dailyNewClusters: Record<string, number> = {};

  for (const row of b.dailyRows) {
    if (!row.day) continue;
    const n = Number(row.n || 0);
    daily[row.day] = n;
    const monthKey = row.day.slice(0, 7);
    monthly[monthKey] = (monthly[monthKey] || 0) + n;
    const wk = weekRangeForDay(row.day);
    if (wk) weekly[wk] = (weekly[wk] || 0) + n;
  }

  for (const row of b.clusterDayRows) {
    if (row.day) dailyNewClusters[row.day] = Number(row.n || 0);
  }

  return { monthly, weekly, daily, dailyNewClusters };
}

export function buildOverview(tickets: TicketStatRow[], themeCount: number) {
  let minMs = Infinity;
  let maxMs = -Infinity;

  const regionDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, number> = {};
  const regionCategory: Record<string, Record<string, number>> = {};
  const monthlyTrend: Record<string, number> = {};
  let multiFreqCount = 0;
  let analyzedCount = 0;

  for (const t of tickets) {
    const d = asDate(t.createTime);
    if (d) {
      const ms = d.getTime();
      if (ms < minMs) minMs = ms;
      if (ms > maxMs) maxMs = ms;
      const key = ym(d);
      monthlyTrend[key] = (monthlyTrend[key] || 0) + 1;
    }
    if (t.primaryThemeId) multiFreqCount += 1;

    // 镇街 / 类型只统计 AI 已回写的工单，避免入库正则误切
    if (t.confidence == null) continue;
    analyzedCount += 1;

    const region = regionLabel(t.subdistrict);
    const cat = (t.sourceCategory || t.category || "").trim();

    if (region && (isTownLabel(region) || region === UNKNOWN_TOWN)) {
      regionDistribution[region] = (regionDistribution[region] || 0) + 1;
    }
    if (cat) {
      categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
    }
    if (region && (isTownLabel(region) || region === UNKNOWN_TOWN) && cat) {
      if (!regionCategory[region]) regionCategory[region] = {};
      regionCategory[region][cat] = (regionCategory[region][cat] || 0) + 1;
    }
  }

  const min = Number.isFinite(minMs) ? new Date(minMs) : null;
  const max = Number.isFinite(maxMs) ? new Date(maxMs) : null;
  const totalDays =
    min && max ? Math.max(1, Math.round((maxMs - minMs) / 86400000) + 1) : 0;

  const topRegion =
    Object.entries(regionDistribution)
      .filter(([name]) => name !== UNKNOWN_TOWN)
      .sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const topCategory =
    Object.entries(categoryDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  return {
    totalWorkorders: tickets.length,
    analyzedCount,
    dateRange: min && max ? `${ymd(min)} ~ ${ymd(max)}` : "",
    totalDays,
    avgDaily: totalDays ? Math.round(tickets.length / totalDays) : 0,
    topRegion,
    topCategory,
    multiFreqCount,
    multiFreqClusters: themeCount,
    regionDistribution,
    categoryDistribution,
    regionCategory,
    monthlyTrend,
  };
}

export function buildTrends(tickets: TicketStatRow[], themes: ThemeStatRow[] = []) {
  const daily: Record<string, number> = {};
  const weekly: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  const dailyNewClusters: Record<string, number> = {};

  for (const t of tickets) {
    const d = asDate(t.createTime);
    if (!d) continue;
    const day = ymd(d);
    daily[day] = (daily[day] || 0) + 1;
    monthly[ym(d)] = (monthly[ym(d)] || 0) + 1;
    const wk = weekKey(d);
    weekly[wk] = (weekly[wk] || 0) + 1;
  }

  for (const th of themes) {
    const d = asDate(th.createdAt);
    if (!d) continue;
    const day = ymd(d);
    dailyNewClusters[day] = (dailyNewClusters[day] || 0) + 1;
  }

  return { monthly, weekly, daily, dailyNewClusters };
}

export function buildInsights(
  themes: Array<{
    id: string;
    title?: string | null;
    category?: string | null;
    patternType?: string | null;
    ticketCount?: number | null;
    trendPct?: number | null;
    canonicalSubject?: string | null;
    canonicalLocation?: string | null;
    aiSummary?: string | null;
    recommendedAction?: string | null;
    riskLevel?: string | null;
  }>
) {
  if (!themes || themes.length === 0) return [];

  const cards: Array<{
    type: "GATHERING" | "DIVERGE" | "REPEAT" | "ANALYSIS";
    tag: string;
    tone: string;
    title: string;
    text: string;
    href?: string;
  }> = [];
  const usedThemeIds = new Set<string>();
  const tight = themes.filter((t) => {
    const title = t.title || "";
    const n = t.ticketCount || 0;
    return n >= 2 && n <= 240 && title.length > 0 && title.length <= 48 && !title.includes("身份证");
  });
  const pool = tight.length > 0 ? tight : themes.filter((t) => (t.ticketCount || 0) <= 240 && !(t.title || "").includes("身份证"));
  const titleOf = (theme: (typeof themes)[number]) => {
    const raw = (theme.title || "").replace(/\s+/g, " ").trim();
    if (raw && raw.length <= 42 && !raw.includes("身份证")) return raw;
    return `${theme.canonicalLocation || "辖区"} · ${theme.category || "民生"}诉求`;
  };
  const textOf = (theme: (typeof themes)[number]) => {
    const summary = (theme.aiSummary || "").replace(/\s+/g, " ").trim();
    if (summary && summary.length <= 72 && !summary.includes("【") && !summary.includes("身份证")) return summary;
    const fromTitle = (theme.title || "").split("·")[0]?.trim() || "";
    const place = fromTitle && fromTitle.length <= 12 ? fromTitle : "辖区";
    return `${place}汇聚 ${theme.ticketCount || 0} 件${theme.category || "民生"}诉求`;
  };

  const sortedPool = [...pool].sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0));

  // 1. 寻找最高频的“空间聚集”重点主题 (GROUP_GATHERING / SPATIAL_BURST)
  const gatherTheme = sortedPool.find(
    (t) =>
      (t.patternType === "GROUP_GATHERING" || t.patternType === "SPATIAL_BURST" || !t.patternType) &&
      !usedThemeIds.has(t.id)
  );

  if (gatherTheme) {
    usedThemeIds.add(gatherTheme.id);
    cards.push({
      type: "GATHERING",
      tag: "聚集",
      tone: "danger",
      title: titleOf(gatherTheme),
      text: textOf(gatherTheme),
      href: `/themes/${gatherTheme.id}`,
    });
  }

  // 2. 寻找最高频的“主体发散”重点主题 (DIVERGE)
  const divergeTheme = sortedPool.find((t) => t.patternType === "DIVERGE" && !usedThemeIds.has(t.id));

  if (divergeTheme) {
    usedThemeIds.add(divergeTheme.id);
    cards.push({
      type: "DIVERGE",
      tag: "发散",
      tone: "info",
      title: titleOf(divergeTheme),
      text: textOf(divergeTheme),
      href: `/themes/${divergeTheme.id}`,
    });
  }

  // 3. 寻找“高风险/重复反映”重点主题
  const repeatOrUrgentTheme =
    sortedPool.find(
      (t) => (t.riskLevel === "HIGH" || t.patternType === "INDIVIDUAL_REPEAT") && !usedThemeIds.has(t.id)
    ) || sortedPool.find((t) => !usedThemeIds.has(t.id));

  if (repeatOrUrgentTheme) {
    usedThemeIds.add(repeatOrUrgentTheme.id);
    cards.push({
      type: "REPEAT",
      tag: "重复",
      tone: "warning",
      title: titleOf(repeatOrUrgentTheme),
      text: textOf(repeatOrUrgentTheme),
      href: `/themes/${repeatOrUrgentTheme.id}`,
    });
  }

  // 4. 寻找“协同处置 / 综合治理”第 4 席主题 (补齐 4 列网格)
  const fourthTheme = sortedPool.find((t) => !usedThemeIds.has(t.id));

  if (fourthTheme) {
    usedThemeIds.add(fourthTheme.id);
    cards.push({
      type: fourthTheme.patternType === "DIVERGE" ? "DIVERGE" : "GATHERING",
      tag: fourthTheme.patternType === "DIVERGE" ? "发散" : "聚集",
      tone: fourthTheme.riskLevel === "HIGH" ? "danger" : fourthTheme.riskLevel === "LOW" ? "info" : "warning",
      title: titleOf(fourthTheme),
      text: textOf(fourthTheme),
      href: `/themes/${fourthTheme.id}`,
    });
  }

  return cards;
}
