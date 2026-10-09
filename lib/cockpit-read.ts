import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { getSystemTwoEndpoints } from "@/backend/model";
import { loadOverview, loadTrends } from "@/lib/civic-queries";
import { getNodeMetric } from "@/lib/node-metrics";
import { peekLatestTaskProgress } from "@/lib/task-progress";
import { desc, sql } from "drizzle-orm";

/** 大屏最近工单窗口。旧入口先拉 500 条全文，页面只用前 30 条。 */
export const COCKPIT_RECENT_LIMIT = 30;

/**
 * 与 loadCockpitRecentTickets 执行的是同一条 SQL。
 * 正文只取前 80 字，不取电话。ORDER BY create_time DESC 对齐 idx_tickets_create_time。
 */
export const COCKPIT_RECENT_SQL = `SELECT id, ticket_no, title, summarize_title, left(content, 80) AS excerpt, create_time, district, subdistrict, channel, status, urgency, source_category FROM tickets ORDER BY create_time DESC LIMIT ${COCKPIT_RECENT_LIMIT}`;

const URGENT_TEXT = /积水|排涝|坍塌|燃气|泄露|停电|停水|火灾|暴雨|险情|抢修|急救/;
const CHINESE_NUMBERS = ["一", "二", "三", "四", "五", "六", "七", "八", "九", "十"];

export type CockpitRecentTicket = {
  id: string;
  ticketNo: string;
  title: string;
  summarizeTitle: string;
  createTime: string;
  district?: string;
  subdistrict?: string;
  channel: string;
  status: string;
  category?: string;
  /** 正文开头，最长 80 字，不是完整工单。 */
  content: string;
  isUrgent: boolean;
};

export type CockpitThemeSummary = {
  themeCount: number;
  highRiskCount: number;
  top: Array<{
    id: string;
    title: string;
    category: string;
    ticketCount: number;
    riskLevel: string;
    advice: string;
    location: string;
  }>;
};

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  const rows = (result as { rows?: unknown[] } | null)?.rows;
  return Array.isArray(rows) ? (rows as Array<Record<string, unknown>>) : [];
}

function asTime(value: unknown): string {
  if (value instanceof Date) return value.toISOString().slice(0, 19).replace("T", " ");
  if (!value) return "";
  const parsed = new Date(String(value));
  if (Number.isNaN(parsed.getTime())) return String(value);
  return parsed.toISOString().slice(0, 19).replace("T", " ");
}

function text(value: unknown): string {
  return value == null ? "" : String(value);
}

export function mapCockpitRecentRow(row: Record<string, unknown>): CockpitRecentTicket {
  const title = text(row.title);
  const summarizeTitle = text(row.summarize_title);
  const urgency = text(row.urgency);
  const excerpt = text(row.excerpt).slice(0, 80);
  const isUrgent =
    urgency === "URGENT" ||
    URGENT_TEXT.test(title) ||
    URGENT_TEXT.test(summarizeTitle) ||
    URGENT_TEXT.test(excerpt);
  return {
    id: text(row.id),
    ticketNo: text(row.ticket_no),
    title,
    summarizeTitle,
    createTime: asTime(row.create_time),
    district: text(row.district) || undefined,
    subdistrict: text(row.subdistrict) || undefined,
    channel: text(row.channel) || "12345热线",
    status: text(row.status) || "PENDING",
    category: text(row.source_category) || undefined,
    content: excerpt || (summarizeTitle || title).slice(0, 80),
    isUrgent,
  };
}

export async function loadCockpitRecentTickets(regionId?: string): Promise<CockpitRecentTicket[]> {
  const { db } = await getRegionDb(regionId);
  const result = await db.execute(sql.raw(COCKPIT_RECENT_SQL));
  return rowsOf(result).map(mapCockpitRecentRow);
}

export function cockpitSystemTwoNodes() {
  const endpoints = getSystemTwoEndpoints();
  const list = endpoints.length > 0 ? endpoints : ["http://127.0.0.1:8132/v1"];
  return list.map((endpoint, index) => {
    const hostMatch = endpoint.match(/https?:\/\/([^/:]+)(?::(\d+))?/);
    const metric = getNodeMetric(endpoint);
    return {
      id: `node-${index + 1}`,
      name: `研判节点${CHINESE_NUMBERS[index] || String(index + 1)}`,
      host: hostMatch ? `${hostMatch[1]}:${hostMatch[2] || "80"}` : endpoint,
      isLocal: /127\.0\.0\.1|localhost|0\.0\.0\.0/.test(endpoint),
      lastDurationMs: metric?.durationMs ?? null,
    };
  });
}

async function loadThemeSummary(regionId: string | undefined): Promise<Omit<CockpitThemeSummary, "themeCount">> {
  const { db } = await getRegionDb(regionId);
  const [riskRow, top] = await Promise.all([
    db
      .select({
        highRiskCount: sql<number>`count(*) filter (where ${themesTable.riskLevel} in ('HIGH', '高危'))::int`,
      })
      .from(themesTable),
    db
      .select({
        id: themesTable.id,
        title: themesTable.title,
        category: themesTable.category,
        ticketCount: themesTable.ticketCount,
        riskLevel: themesTable.riskLevel,
        advice: themesTable.recommendedAction,
        location: themesTable.canonicalLocation,
      })
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount))
      .limit(12),
  ]);

  return {
    highRiskCount: Number(riskRow[0]?.highRiskCount || 0),
    top: top.map((row) => ({
      id: row.id,
      title: row.title || "",
      category: row.category || "",
      ticketCount: Number(row.ticketCount || 0),
      riskLevel: row.riskLevel || "LOW",
      advice: row.advice || "",
      location: row.location || "",
    })),
  };
}

export function townshipStatsFromDistribution(distribution: Record<string, number>) {
  const entries = Object.entries(distribution).filter(([, count]) => count > 0);
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  return entries
    .sort((a, b) => b[1] - a[1])
    .map(([name, count], index) => ({
      name,
      count,
      sharePct: Math.round((count / total) * 1000) / 10,
      rank: index + 1,
    }));
}

export async function loadCockpitRead(regionId?: string) {
  const region = regionId || "fs_shunde";
  const [overview, trends, recentTickets, themeParts] = await Promise.all([
    loadOverview(0, region),
    loadTrends(30, region),
    loadCockpitRecentTickets(region),
    loadThemeSummary(region),
  ]);
  const themes: CockpitThemeSummary = {
    themeCount: overview.multiFreqClusters,
    ...themeParts,
  };
  const dates = Object.keys(trends.daily || {}).sort();
  const todayCount = dates.length ? Number(trends.daily[dates[dates.length - 1]] || 0) : recentTickets.length;
  const urgentFromThemes = themes.top.filter(
    (theme) => theme.riskLevel === "HIGH" || theme.riskLevel === "高危" || /急|水|险|爆|火|伤|停/.test(theme.title)
  ).length;
  const task = peekLatestTaskProgress(region);
  const townshipStats = townshipStatsFromDistribution(overview.regionDistribution || {});

  return {
    success: true as const,
    regionId: region,
    overview,
    trends: {
      daily: trends.daily,
      dailyNewClusters: trends.dailyNewClusters,
    },
    themes,
    recentTickets,
    townshipStats,
    kpi: {
      todayCount,
      todayGrowthPct: 0,
      totalTickets: overview.totalWorkorders,
      dailyAverage: overview.avgDaily,
      resolutionRatePct: overview.totalWorkorders > 0 ? 100 : 0,
      multifreqCount: overview.multiFreqCount,
      clusterCount: overview.multiFreqClusters,
      urgentAlertCount: urgentFromThemes + recentTickets.filter((ticket) => ticket.isUrgent).length,
    },
    systemTwoNodes: cockpitSystemTwoNodes(),
    endpointRecentTickets: task?.endpointRecentTickets || {},
  };
}

export type CockpitRead = Awaited<ReturnType<typeof loadCockpitRead>>;
