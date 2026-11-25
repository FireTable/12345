/**
 * 内部端点：next-server 启动后被 instrumentation.ts 通过 HTTP 调一次，
 * 扫描所有 region，对有未处理工单的 region 入队 + 启 in-process worker。
 *
 * Server-only API route（默认 Node.js runtime），不参与 Edge bundle。
 * 这里才能 import 包含 fs/path 的 cluster-bootstrap 链。
 */
import { NextRequest } from "next/server";
import { getAllRegions } from "@/db/client";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadClusterBundle, loadOverview, loadTrends, loadWorkorderStats } from "@/lib/civic-queries";
import { bootstrapClusterWorkers } from "@/lib/cluster-bootstrap";
import { startDailyReportScheduler } from "@/lib/daily-report-scheduler";
import { filterRegionsByAppDomain, getAppDomainMode } from "@/lib/domain-profile";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

declare global {
  // eslint-disable-next-line no-var
  var __civic_cache_warmup_started: boolean | undefined;
}

/**
 * 后台顺序预热当前 APP_DOMAIN 下各站点的核心只读聚合缓存（共享于 globalThis.__civicCacheStore），
 * 消除容器重启或冷启动后首访的冷查询延迟。失败静默吞掉，绝不阻塞 bootstrap 响应。
 */
function scheduleAggregateCacheWarmup(): void {
  if (globalThis.__civic_cache_warmup_started) return;
  globalThis.__civic_cache_warmup_started = true;

  void (async () => {
    try {
      const appDomain = getAppDomainMode();
      const regions = filterRegionsByAppDomain(await getAllRegions(), appDomain);
      for (const r of regions) {
        await Promise.allSettled([
          cacheGetOrLoad(`overview:${r.id}:0`, () => loadOverview(0, r.id)),
          cacheGetOrLoad(`trends:${r.id}:0`, () => loadTrends(0, r.id)),
          cacheGetOrLoad(`workorders:stats:${r.id}`, () => loadWorkorderStats(r.id)),
          cacheGetOrLoad(`clusters:bundle:v2:${r.id}`, () => loadClusterBundle(r.id)),
        ]);
      }
    } catch (err: any) {
      console.warn("[api/_internal/cluster-bootstrap] cache warmup failed:", err?.message || err);
    }
  })();
}

export async function POST(_req: NextRequest) {
  try {
    const result = await bootstrapClusterWorkers();
    scheduleAggregateCacheWarmup();
    startDailyReportScheduler();
    return apiSuccess(result);
  } catch (err: any) {
    console.warn("[api/_internal/cluster-bootstrap] failed:", err?.message || err);
    return apiError(
      ApiCode.TASK_EXECUTION_FAILED,
      err?.message || String(err),
      500
    );
  }
}
