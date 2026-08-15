import { regionLabel } from "./civic-dto";

export type TicketStatRow = {
  createTime?: Date | string | null;
  subdistrict?: string | null;
  district?: string | null;
  sourceCategory?: string | null;
  category?: string | null;
  primaryThemeId?: string | null;
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
  return d.toISOString().slice(0, 10);
}

function ym(d: Date): string {
  return d.toISOString().slice(0, 7);
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

  for (const t of tickets) {
    const region = regionLabel(t.subdistrict, t.district);
    regionDistribution[region] = (regionDistribution[region] || 0) + 1;
    const cat = t.sourceCategory || t.category || "未分类";
    categoryDistribution[cat] = (categoryDistribution[cat] || 0) + 1;
    if (!regionCategory[region]) regionCategory[region] = {};
    regionCategory[region][cat] = (regionCategory[region][cat] || 0) + 1;
    const d = asDate(t.createTime);
    if (d) {
      const key = ym(d);
      monthlyTrend[key] = (monthlyTrend[key] || 0) + 1;
    }
    if (t.primaryThemeId) multiFreqCount += 1;
  }

  const topRegion =
    Object.entries(regionDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  const topCategory =
    Object.entries(categoryDistribution).sort((a, b) => b[1] - a[1])[0]?.[0] || "";

  return {
    totalWorkorders: tickets.length,
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
    const weekStart = new Date(d);
    const dow = weekStart.getUTCDay() || 7;
    weekStart.setUTCDate(weekStart.getUTCDate() - (dow - 1));
    const weekEnd = new Date(weekStart);
    weekEnd.setUTCDate(weekEnd.getUTCDate() + 6);
    const wk = `${ymd(weekStart)}/${ymd(weekEnd)}`;
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
    recommendedAction?: string | null;
    riskLevel?: string | null;
  }>
) {
  const byMode = (m: string) =>
    themes
      .filter((t) => t.patternType === m || (m === "GROUP_GATHERING" && !t.patternType))
      .sort((a, b) => (b.ticketCount || 0) - (a.ticketCount || 0));

  const gather = byMode("GROUP_GATHERING")[0] || byMode("DIVERGE")[0];
  const repeat = byMode("INDIVIDUAL_REPEAT")[0];
  const diverge = byMode("DIVERGE")[0];
  const drop = [...themes]
    .filter((t) => typeof t.trendPct === "number" && (t.trendPct as number) < 0)
    .sort((a, b) => (a.trendPct || 0) - (b.trendPct || 0))[0];

  const cards: Array<{ tag: string; tone: string; title: string; text: string; href?: string }> = [];
  if (gather) {
    cards.push({
      tag: "聚集",
      tone: "danger",
      title: gather.title || `${gather.canonicalLocation || ""} · ${gather.category || ""}`,
      text: `${gather.ticketCount || 0} 件${gather.category || ""}，${gather.recommendedAction || "建议尽快派单处置。"}`,
      href: `/themes/${gather.id}`,
    });
  }
  if (repeat) {
    cards.push({
      tag: "重复",
      tone: "warning",
      title: repeat.canonicalSubject || repeat.title || "个体重复诉求",
      text: `${repeat.ticketCount || 0} 次重复反映，建议上升优先级并闭环跟踪。`,
      href: `/themes/${repeat.id}`,
    });
  }
  if (diverge) {
    cards.push({
      tag: "发散",
      tone: "info",
      title: diverge.canonicalSubject || diverge.title || "同主体多类型问题",
      text: `${diverge.canonicalLocation || ""} 出现多类问题共 ${diverge.ticketCount || 0} 件，建议现场核查与源头治理。`,
      href: `/themes/${diverge.id}`,
    });
  }
  if (drop) {
    cards.push({
      tag: "下降",
      tone: "success",
      title: `${drop.category || drop.title || "该类"}投诉下降 ${Math.abs(drop.trendPct || 0)}%`,
      text: `近 7 日相对前 7 日下降 ${Math.abs(drop.trendPct || 0)}%，建议持续观察。`,
      href: `/themes/${drop.id}`,
    });
  }
  return cards;
}
