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
 * Per-region 队列：每个 region 独立的 task 行，独立的 worker。
 * 只要辖区有待处理工单 (unprocessed > 0)，且当前没有活跃任务，自动触发研判流水线。
 */
export async function triggerClusterJobAuto(regionId: string): Promise<boolean> {
  if (!regionId) return false;

  // 1. 进程内单例锁：先同步占坑。并发重入时第二个调用立刻看到 has=true 直接 false，
  //    不再走到后面的 await 与 runWorkerLoopForRegion 启动逻辑。
  //    锁的释放由 runWorkerLoopForRegion 的 finally 负责（worker 跑完自然释放）；
  //    本函数提前 return / throw 的分支都要 delete 释放，避免占着茅坑。
  if (activeRegionWorkers.has(regionId)) {
    return false;
  }
  activeRegionWorkers.add(regionId);

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
      activeRegionWorkers.delete(regionId); // 没有需要研判的工单，释放锁
      return false;
    }

    // 3. 入队（决策树见 enqueueClusterJob 注释：PENDING 复用 / RUNNING-fresh 跳过 / RUNNING-stale re-claim / 都无则新建）
    const taskId = `auto-${regionId}-${Date.now()}`;
    const enqueueResult = await enqueueClusterJob(regionId, taskId, total);

    // 'running' = 别人正在跑且心跳 fresh，不创建新行也不启新 worker，让当前的继续
    if (enqueueResult.source === "running") {
      console.log(
        `[cluster-runner] ${regionId} 已有 RUNNING worker 在跑，跳过本次 trigger`
      );
      activeRegionWorkers.delete(regionId);
      return false;
    }

    // 4. 启动当前 Node.js 异步非阻塞协程消费并执行任务
    //    锁已经在入口处加了，runWorkerLoopForRegion 内部不再二次加锁。
    runWorkerLoopForRegion(regionId).catch((err) => {
      console.error(`[cluster-runner] Background job error for region ${regionId}:`, err);
    });

    return true;
  } catch (err: any) {
    activeRegionWorkers.delete(regionId); // 入队或前置检查失败，释放锁
    console.error(`[cluster-runner] Failed to trigger auto cluster for ${regionId}:`, err?.message || err);
    return false;
  }
}

/**
 * 辖区专属后台 Worker 执行循环
 * 锁由 triggerClusterJobAuto 入口持有，本函数只消费；worker 自然结束时 finally 释放。
 */
async function runWorkerLoopForRegion(regionId: string): Promise<void> {
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
