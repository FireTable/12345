/**
 * 大屏一次读取：短列表、索引扫描，并且比原来的五路请求快。
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { desc, sql } from "drizzle-orm";
import { getRegionDb } from "../db/client";
import { ticketsTable } from "../db/schema";
import { loadClusterBundle, loadOverview, loadTrends } from "../lib/civic-queries";
import {
  COCKPIT_RECENT_LIMIT,
  COCKPIT_RECENT_SQL,
  loadCockpitRead,
} from "../lib/cockpit-read";
import { getLatestTaskProgress } from "../lib/task-progress";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const regionId = "fs_shunde";

function explainText(result: unknown): string {
  const rows = Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows || [];
  return rows
    .map((row) => {
      const record = row as Record<string, unknown>;
      return String(record["QUERY PLAN"] || record["query plan"] || Object.values(record)[0] || "");
    })
    .join("\n");
}

async function main() {
  const { db } = await getRegionDb(regionId);
  const fanoutStart = performance.now();
  await Promise.all([
    loadOverview(0, regionId),
    loadTrends(30, regionId),
    loadClusterBundle(regionId),
    db.select().from(ticketsTable).orderBy(desc(ticketsTable.createTime)).limit(500),
    getLatestTaskProgress(regionId),
  ]);
  const fanoutMs = Math.round(performance.now() - fanoutStart);

  const dbFanoutStart = performance.now();
  await Promise.all([
    loadOverview(0, regionId),
    loadTrends(30, regionId),
    loadClusterBundle(regionId),
    db.select().from(ticketsTable).orderBy(desc(ticketsTable.createTime)).limit(500),
  ]);
  const dbFanoutMs = Math.round(performance.now() - dbFanoutStart);

  const readStart = performance.now();
  const payload = await loadCockpitRead(regionId);
  const readMs = Math.round(performance.now() - readStart);

  const explained = await db.execute(sql.raw(`EXPLAIN ${COCKPIT_RECENT_SQL}`));
  const plan = explainText(explained);
  const overview = await loadOverview(0, regionId);

  assert(payload.kpi.totalTickets === overview.totalWorkorders, "KPI 工单总量与总览一致");
  assert(payload.kpi.clusterCount === overview.multiFreqClusters, "KPI 主题数与总览一致");
  assert(payload.themes.themeCount === overview.multiFreqClusters, "主题汇总数量与总览一致");
  assert(typeof payload.themes.highRiskCount === "number", "带有高风险主题数");
  assert(payload.themes.top.length > 0 && payload.themes.top.length <= 12, "主题风险摘要只取前 12 条");
  assert(payload.townshipStats.length > 0, "镇街数量来自总览分布");
  const townshipNames = payload.townshipStats.map((item) => item.name).sort();
  const overviewNames = Object.keys(overview.regionDistribution).filter((name) => overview.regionDistribution[name] > 0).sort();
  assert(townshipNames.join(",") === overviewNames.join(","), "镇街名单与总览分布一致");
  assert(payload.recentTickets.length === COCKPIT_RECENT_LIMIT, "最近工单是短窗口，不是 500 条");
  assert(
    payload.recentTickets.every(
      (ticket) =>
        ticket.content.length <= 80 &&
        !("citizenPhone" in ticket) &&
        !("maskedContent" in ticket) &&
        typeof ticket.isUrgent === "boolean"
    ),
    "最近工单不是完整正文"
  );
  assert(COCKPIT_RECENT_SQL.includes("left(content, 80)"), "最近工单只取正文开头");
  assert(!COCKPIT_RECENT_SQL.includes("citizen_phone"), "最近工单不取电话");
  assert(/Index Scan/i.test(plan) && plan.includes("idx_tickets_create_time"), "最近工单走创建时间索引");
  assert(!/Seq Scan/i.test(plan), "最近工单没有顺序扫描");
  assert(readMs < dbFanoutMs, `一次读取 ${readMs}ms 快于原来的数据库扇出 ${dbFanoutMs}ms`);
  assert(readMs < fanoutMs, `一次读取 ${readMs}ms 快于五路 ${fanoutMs}ms`);

  const lines = [
    "EXPLAIN recent tickets:",
    plan,
    `fanout_ms ${fanoutMs}`,
    `db_fanout_ms ${dbFanoutMs}`,
    `consolidated_ms ${readMs}`,
    `recent ${payload.recentTickets.length}`,
    `tickets ${payload.kpi.totalTickets}`,
    `themes ${payload.themes.themeCount}`,
    `townships ${payload.townshipStats.length}`,
    "PASS consolidated faster",
  ];
  console.log(lines.join("\n"));
  const dir = process.env.CIVIC_EVIDENCE_DIR;
  if (dir) writeFileSync(path.join(dir, "cockpit-read.log"), `${lines.join("\n")}\n`);

  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
