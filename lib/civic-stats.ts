import { explicitAdmin, isTownLabel } from "./admin-area";
import { regionLabel } from "./civic-dto";
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

export function buildOverviewFromBuckets(b: OverviewBuckets) {
  const min = b.minTime;
  const max = b.maxTime;
  const totalDays =
    min && max ? Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000) + 1) : 0;

  const regionDistribution: Record<string, number> = {};
  for (const row of b.regionRows) {
    const town = explicitAdmin(row.subdistrict);
    const region = town ? regionLabel(town) : "";
    if (region && isTownLabel(region)) {
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
    const town = explicitAdmin(row.subdistrict);
    const region = town ? regionLabel(town) : "";
    const cat = (row.category || "").trim();
    if (region && isTownLabel(region) && cat) {
      if (!regionCategory[region]) regionCategory[region] = {};
      regionCategory[region][cat] = (regionCategory[region][cat] || 0) + Number(row.n || 0);
    }
  }

  const monthlyTrend: Record<string, number> = {};
  for (const row of b.monthlyRows) {
    if (row.month) monthlyTrend[row.month] = Number(row.n || 0);
  }

  const topRegion =
    Object.entries(regionDistribution).sort((a, c) => c[1] - a[1])[0]?.[0] || "";
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

export function buildTrendsFromBuckets(b: TrendBuckets) {
  const daily: Record<string, number> = {};
  const weekly: Record<string, number> = {};
  const monthly: Record<string, number> = {};
  const dailyNewClusters: Record<string, number> = {};

  for (const row of b.dailyRows) {
    if (!row.day) continue;
    const n = Number(row.n || 0);
    daily[row.day] = n;
    monthly[row.day.slice(0, 7)] = (monthly[row.day.slice(0, 7)] || 0) + n;
    const d = asDate(row.day);
    if (!d) continue;
    const weekStart = new Date(d);
    const dow = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - (dow - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const wk = `${ymd(weekStart)}/${ymd(weekEnd)}`;
    weekly[wk] = (weekly[wk] || 0) + n;
  }

  for (const row of b.clusterDayRows) {
    if (row.day) dailyNewClusters[row.day] = Number(row.n || 0);
  }

  return { monthly, weekly, daily, dailyNewClusters };
}

export function buildOverview(tickets: TicketStatRow[], themeCount: number) {
  const dates = tickets.map((t) => asDate(t.createTime)).filter((d): d is Date => !!d);
  const min = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : null;
  const max = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))) : null;
  const totalDays =
    min && max ? Math.max(1, Math.round((max.getTime() - min.getTime()) / 86400000) + 1) : 0;

  const regionDistribution: Record<string, number> = {};
  const categoryDistribution: Record<string, number> = {};
  const regionCategory: Record<string, Record<string, number>> = {};
  const monthlyTrend: Record<string, number> = {};
  let multiFreqCount = 0;
  let analyzedCount = 0;

  for (const t of tickets) {
    const d = asDate(t.createTime);
    if (d) {
      const key = ym(d);
      monthlyTrend[key] = (monthlyTrend[key] || 0) + 1;
    }
    if (t.primaryThemeId) multiFreqCount += 1;

    // 镇街 / 类型只统计 AI 已回写的工单，避免入库正则误切
    if (t.confidence == null) continue;
    analyzedCount += 1;

    const town = explicitAdmin(t.subdistrict);
    const region = town ? regionLabel(town) : "";
    const cat = (t.sourceCategory || t.category || "").trim();

    if (region && isTownLabel(region)) {
      regionDistribution[region] = (regionDistribution[region] || 0) + 1;
    }
    if (cat) {
      categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
    }
    if (region && isTownLabel(region) && cat) {
      if (!regionCategory[region]) regionCategory[region] = {};
      regionCategory[region][cat] = (regionCategory[region][cat] || 0) + 1;
    }
  }

  const topRegion =
    Object.entries(regionDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
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

  // 1. 寻找最高频的“空间聚集”重点主题 (GROUP_GATHERING / SPATIAL_BURST)
  const gatherTheme = themes
    .filter((t) => (t.patternType === "GROUP_GATHERING" || t.patternType === "SPATIAL_BURST" || !t.patternType) && !usedThemeIds.has(t.id))
    .sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0))[0];

  if (gatherTheme) {
    usedThemeIds.add(gatherTheme.id);
    cards.push({
      type: "GATHERING",
      tag: "聚集",
      tone: "danger",
      title: gatherTheme.title || `${gatherTheme.canonicalLocation || "辖区"} · ${gatherTheme.category || "民生"}诉求聚集`,
      text: gatherTheme.aiSummary || gatherTheme.recommendedAction || `${gatherTheme.canonicalLocation || "辖区"}出现 ${gatherTheme.ticketCount || 0} 件${gatherTheme.category || ""}相关诉求`,
      href: `/themes/${gatherTheme.id}`,
    });
  }

  // 2. 寻找最高频的“主体发散”重点主题 (DIVERGE)
  const divergeTheme = themes
    .filter((t) => t.patternType === "DIVERGE" && !usedThemeIds.has(t.id))
    .sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0))[0];

  if (divergeTheme) {
    usedThemeIds.add(divergeTheme.id);
    cards.push({
      type: "DIVERGE",
      tag: "发散",
      tone: "info",
      title: divergeTheme.title || `${divergeTheme.canonicalSubject || "涉事主体"} 多类型问题发散`,
      text: divergeTheme.aiSummary || divergeTheme.recommendedAction || `涉及同一主体共 ${divergeTheme.ticketCount || 0} 件诉求`,
      href: `/themes/${divergeTheme.id}`,
    });
  }

  // 3. 寻找“高风险/重复反映”重点主题
  const repeatOrUrgentTheme = themes
    .filter((t) => (t.riskLevel === "HIGH" || t.patternType === "INDIVIDUAL_REPEAT") && !usedThemeIds.has(t.id))
    .sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0))[0] ||
    themes.filter((t) => !usedThemeIds.has(t.id)).sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0))[0];

  if (repeatOrUrgentTheme) {
    usedThemeIds.add(repeatOrUrgentTheme.id);
    cards.push({
      type: "REPEAT",
      tag: "重复",
      tone: "warning",
      title: repeatOrUrgentTheme.title || `${repeatOrUrgentTheme.canonicalSubject || "重点区域"} 多次重复诉求`,
      text: repeatOrUrgentTheme.aiSummary || repeatOrUrgentTheme.recommendedAction || `累计产生 ${repeatOrUrgentTheme.ticketCount || 0} 次高频反映`,
      href: `/themes/${repeatOrUrgentTheme.id}`,
    });
  }

  // 4. 寻找“协同处置 / 综合治理”第 4 席主题 (补齐 4 列网格)
  const fourthTheme = themes
    .filter((t) => !usedThemeIds.has(t.id))
    .sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0))[0];

  if (fourthTheme) {
    usedThemeIds.add(fourthTheme.id);
    cards.push({
      type: fourthTheme.patternType === "DIVERGE" ? "DIVERGE" : "GATHERING",
      tag: fourthTheme.patternType === "DIVERGE" ? "发散" : "聚集",
      tone: fourthTheme.riskLevel === "HIGH" ? "danger" : fourthTheme.riskLevel === "LOW" ? "info" : "warning",
      title: fourthTheme.title || `${fourthTheme.canonicalLocation || "属地片区"} · ${fourthTheme.category || "民生"}集中研判`,
      text: fourthTheme.aiSummary || fourthTheme.recommendedAction || `${fourthTheme.canonicalLocation || "辖区"}汇聚 ${fourthTheme.ticketCount || 0} 件工单`,
      href: `/themes/${fourthTheme.id}`,
    });
  }

  return cards;
}
