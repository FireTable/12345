import { sql as rawSql } from "@/db/client";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import {
  enqueueClusterJob,
  claimNextClusterJob,
  finishClusterJob,
  failClusterJob,
  heartbeatClusterJob,
} from "./cluster-queue";
import { executeClusterJob } from "./cluster-job";

// 内存互斥锁：防止同一 Next.js 实例中对同一个辖区并发重入触发多个 worker
const activeRegionWorkers = new Set<string>();

/**
 * 自动检测并启动辖区研判任务 (Auto-Trigger In-Process Runner)
 * 只要辖区有待处理工单 (unprocessed > 0)，且当前没有活跃任务，自动触发研判流水线。
 */
export async function triggerClusterJobAuto(regionId: string): Promise<boolean> {
  if (!regionId) return false;

  // 1. 若本进程该辖区已经在跑 worker，直接返回
  if (activeRegionWorkers.has(regionId)) {
    return false;
  }

  try {
    const { db: tenantDb } = await getRegionDb(regionId);

    // 2. 统计当前辖区总工单数与待研判工单数
    const [counts] = await tenantDb
      .select({
        total: drizzleSql<number>`count(*)`,
        unprocessed: drizzleSql<number>`count(*) filter (where ${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0)`,
      })
      .from(ticketsTable);

    const total = Number(counts?.total || 0);
    const unprocessed = Number(counts?.unprocessed || 0);

    if (total === 0 || unprocessed === 0) {
      return false; // 没有需要研判的工单
    }

    // 3. 检查 task_progress 中是否已有正常运行中的任务
    const activeTasks = await rawSql<{ task_id: string; status: string }[]>`
      SELECT task_id, status
      FROM task_progress
      WHERE region_id = ${regionId}
        AND (
          status = 'RUNNING' AND COALESCE(heartbeat_at, updated_at) >= now() - interval '20 seconds'
        )
      LIMIT 1
    `;

    if (activeTasks.length > 0) {
      // 已有正常心跳的正在跑任务，无需重复入队
      return false;
    }

    // 4. 入队新研判任务
    const taskId = `auto-${regionId}-${Date.now()}`;
    await enqueueClusterJob(regionId, taskId, total);

    // 5. 启动当前 Node.js 异步非阻塞协程消费并执行任务
    runWorkerLoopForRegion(regionId).catch((err) => {
      console.error(`[cluster-runner] Background job error for region ${regionId}:`, err);
    });

    return true;
  } catch (err: any) {
    console.error(`[cluster-runner] Failed to trigger auto cluster for ${regionId}:`, err?.message || err);
    return false;
  }
}

/**
 * 辖区专属后台 Worker 执行循环
 */
async function runWorkerLoopForRegion(regionId: string): Promise<void> {
  if (activeRegionWorkers.has(regionId)) return;
  activeRegionWorkers.add(regionId);

  try {
    while (true) {
      // 认领当前辖区下一个待处理任务
      const job = await claimNextClusterJob(regionId);
      if (!job) break;

      console.log(`[cluster-runner] 🚀 自动研判任务启动: ${job.taskId} (辖区: ${job.regionId}, 工单: ${job.total})`);

      // 保持 4 秒一次心跳，防止被判定为超时死锁
      const timer = setInterval(() => {
        heartbeatClusterJob(job.taskId).catch((hbErr) => {
          console.warn(`[cluster-runner] 心跳异常: ${hbErr?.message || hbErr}`);
        });
      }, 4000);

      try {
        const themeCount = await executeClusterJob(job);
        await finishClusterJob(job.taskId, themeCount);
        console.log(`[cluster-runner] ✅ 自动研判完成: ${job.taskId}, 生成多频主题: ${themeCount}`);
      } catch (execErr: any) {
        const errMsg = execErr?.message || String(execErr);
        console.error(`[cluster-runner] ❌ 研判任务执行失败: ${job.taskId}: ${errMsg}`);
        await failClusterJob(job.taskId, errMsg);
      } finally {
        clearInterval(timer);
      }
    }
  } finally {
    activeRegionWorkers.delete(regionId);
  }
}
