import { desc, sql as drizzleSql } from "drizzle-orm";
import { runTicketRadarPipeline } from "@/backend/agent";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { persistClusterResult } from "@/lib/civic-persist";
import { ingestNewTickets } from "@/lib/incremental-ingest";
import { seedReviewQueue } from "@/lib/review-queue";
import { updateTaskProgress } from "@/lib/task-progress";
import { toRawTicket } from "@/lib/ticket-raw";
import type { ClusterJob } from "@/lib/cluster-queue";
import { yieldToEventLoop } from "@/lib/yield-loop";

/**
 * 已有聚类时只增量处理新工单。没有任何聚类时，把现有工单归并成第一批主题。
 * 两条路都不删除主题表。
 */
export async function executeClusterJob(job: ClusterJob): Promise<number> {
  const { db: tenantDb } = await getRegionDb(job.regionId);
  const [themeRow] = await tenantDb
    .select({ themes: drizzleSql<number>`count(*)::int` })
    .from(themesTable);
  const [ticketRow] = await tenantDb
    .select({
      unprocessed: drizzleSql<number>`count(*) filter (where ${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0)`,
      total: drizzleSql<number>`count(*)::int`,
    })
    .from(ticketsTable);
  const themeCount = Number(themeRow?.themes || 0);
  const unprocessedCount = Number(ticketRow?.unprocessed || 0);
  const totalTickets = Number(ticketRow?.total || 0);

  if (themeCount > 0) {
    if (unprocessedCount === 0) {
      console.log(
        `[cluster-job] ${job.taskId} (${job.regionId}) 跳过：已有 ${themeCount} 个聚类，没有新工单，不改主题表`
      );
      updateTaskProgress(job.taskId, job.regionId, {
        stage: "COMPLETED",
        stageText: `已有 ${themeCount} 个聚类，没有新工单`,
        percent: 100,
        themeCount,
      });
      return themeCount;
    }
    return ingestNewTickets(job);
  }

  if (totalTickets === 0) {
    console.log(`[cluster-job] ${job.taskId} (${job.regionId}) 跳过：没有工单`);
    updateTaskProgress(job.taskId, job.regionId, {
      stage: "COMPLETED",
      stageText: "没有工单",
      percent: 100,
    });
    return 0;
  }

  const rows = await tenantDb.select().from(ticketsTable).orderBy(desc(ticketsTable.createTime));
  const tickets = [];
  for (let index = 0; index < rows.length; index++) {
    tickets.push(toRawTicket(rows[index]));
    if ((index + 1) % 2000 === 0) await yieldToEventLoop();
  }

  const result = await runTicketRadarPipeline(tickets, job.taskId, job.taskId, job.regionId, []);
  const [beforeWrite] = await tenantDb
    .select({ themes: drizzleSql<number>`count(*)::int` })
    .from(themesTable);
  if (Number(beforeWrite?.themes || 0) > 0) {
    console.warn(`[cluster-job] ${job.taskId} 写入前已有聚类，取消首轮插入，避免改动现有主题`);
    return Number(beforeWrite?.themes || 0);
  }

  await persistClusterResult({
    tickets: result.enrichedTickets || [],
    themes: result.themes || [],
    regionId: job.regionId,
  });
  if (result.lowConfidenceTickets && result.lowConfidenceTickets.length > 0) {
    await seedReviewQueue(result.lowConfidenceTickets, job.regionId);
  }
  return result.themes?.length || 0;
}
