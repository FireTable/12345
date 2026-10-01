import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

let stopped = false;

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  // 静态 import 会在 loadEnvConfig 之前执行，数据库客户端会连到错误的账号。
  const {
    claimNextClusterJob,
    failClusterJob,
    finishClusterJob,
    heartbeatClusterJob,
  } = await import("../lib/cluster-queue");
  const { executeClusterJob } = await import("../lib/cluster-job");

  console.log("[cluster-worker] 研判队列已启动");
  const onStop = () => {
    stopped = true;
    console.log("[cluster-worker] 收到停止信号，当前任务保持运行中，下次启动会接着做");
  };
  process.on("SIGTERM", onStop);
  process.on("SIGINT", onStop);

  while (!stopped) {
    const job = await claimNextClusterJob();
    if (!job) {
      await sleep(2000);
      continue;
    }

    console.log(`[cluster-worker] 开始 ${job.taskId}（${job.regionId}，已处理 ${job.processed}）`);
    const timer = setInterval(() => {
      heartbeatClusterJob(job.taskId).catch((err) => {
        console.warn(`[cluster-worker] 心跳失败: ${err?.message || err}`);
      });
    }, 5000);

    try {
      const themeCount = await executeClusterJob(job);
      await finishClusterJob(job.taskId, themeCount);
      console.log(`[cluster-worker] 完成 ${job.taskId}，主题 ${themeCount} 个`);
    } catch (err: any) {
      const message = err?.message || String(err);
      console.error(`[cluster-worker] ${job.taskId} 失败: ${message}`);
      if (stopped) {
        console.log(`[cluster-worker] ${job.taskId} 被打断，保持运行中，下次启动接着做`);
      } else {
        await failClusterJob(job.taskId, message);
      }
    } finally {
      clearInterval(timer);
    }
    if (stopped) break;
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("[cluster-worker] 退出:", err);
  process.exit(1);
});
