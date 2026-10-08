/**
 * 进程内 SSE pub-sub：把 next-server 的进度状态变更主动推送给订阅者。
 *
 * 跟之前 ws-broadcaster 的关系：
 *   - SSE 一路推（服务端→客户端），不需要客户端→服务端消息，
 *     正好覆盖 updateTaskProgress / 簇终态 / upload 三类事件。
 *   - 客户端用浏览器原生 EventSource（自动重连内置，无需 hook 维护重连逻辑）。
 *   - 服务端用 ReadableStream + TextEncoder，按 SSE 协议写 data: ...\n\n 帧。
 *
 * 设计要点：
 *   - 必须在同一个 next-server 进程里：progressStore / SystemTwoEngine.endpointRecentTickets
 *     都是 process-singleton，跨进程推不出去。
 *   - 按 region 分桶：每个 region 一个 Set<ReadableStreamDefaultController>。
 *   - 单写多读：updateTaskProgress / finishClusterJob 等"写"侧只调一个 broadcast* 函数，
 *     不直接接触 controller；"读"侧（app/api/sse/route.ts）只调 registerController。
 *   - 客户端断开 → ReadableStream 触发 cancel() → 我们 cleanup 注销 controller + 清心跳。
 *   - 进程崩溃 → 路由 handler 一起死 → 浏览器 EventSource 自动重连。
 *
 * task-progress 帧 payload：
 *   - taskProgress: lib/task-progress.ts 里的 TaskProgress（status/percent/processed 等）
 *   - metrics: PipelineStateResponse 的 metrics 块（analyzedTickets/totalThemes 等）
 *     —— 由服务端在推帧前异步查一次 DB 塞进来，让 PipelineCanvas 不必额外 fetchState
 *     就能实时更新进度条和主题数。如果 metrics 查询失败，payload 里 metrics 字段
 *     缺省，前端用 prev 值兜底。
 */

import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import { getLatestTaskProgress } from "./task-progress";

type SseController = ReadableStreamDefaultController<Uint8Array>;

type SseMetrics = {
  totalTickets: number;
  analyzedTickets: number;
  unprocessedTickets: number;
  urgentTickets: number;
  stabilityRiskTickets: number;
  totalThemes: number;
  highRiskThemes: number;
};

type SseMessage =
  | {
      type: "task-progress";
      regionId: string;
      taskProgress: unknown;
      metrics: SseMetrics | null;
    }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

declare global {
  // eslint-disable-next-line no-var
  var __sse_subscribers: Map<string, Set<SseController>> | undefined;
  // eslint-disable-next-line no-var
  var __sse_metrics_cache: Map<string, { at: number; data: SseMetrics }> | undefined;
}

const subscribers: Map<string, Set<SseController>> =
  globalThis.__sse_subscribers ?? new Map<string, Set<SseController>>();
globalThis.__sse_subscribers = subscribers;

// metrics 缓存：同一 region 的高频 chunk 推送（每 0.4~5s 一次）会复用同一份 metrics，
// 避免每个 chunk 都查 DB。5s 过期足以保证实时性（DB count 变化也是秒级）。
const METRICS_TTL_MS = 5_000;
const metricsCache: Map<string, { at: number; data: SseMetrics }> =
  globalThis.__sse_metrics_cache ?? new Map<string, { at: number; data: SseMetrics }>();
globalThis.__sse_metrics_cache = metricsCache;

const encoder = new TextEncoder();

async function computeMetrics(regionId: string): Promise<SseMetrics | null> {
  const cached = metricsCache.get(regionId);
  if (cached && Date.now() - cached.at < METRICS_TTL_MS) {
    return cached.data;
  }
  try {
    const { db: tenantDb } = await getRegionDb(regionId);
    const [ticketCounts] = await tenantDb
      .select({
        total: drizzleSql<number>`count(*)`,
        analyzed: drizzleSql<number>`count(*) filter (where ${ticketsTable.confidence} is not null and ${ticketsTable.confidence} > 0)`,
        unprocessed: drizzleSql<number>`count(*) filter (where ${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0)`,
        urgent: drizzleSql<number>`count(*) filter (where ${ticketsTable.urgency} = 'URGENT')`,
        stabilityRisk: drizzleSql<number>`count(*) filter (where ${ticketsTable.stabilityRisk} = true)`,
      })
      .from(ticketsTable);
    const [themeCounts] = await tenantDb
      .select({
        totalThemes: drizzleSql<number>`count(*)`,
        highRiskThemes: drizzleSql<number>`count(*) filter (where ${themesTable.riskLevel} = 'HIGH')`,
      })
      .from(themesTable);
    const metrics: SseMetrics = {
      totalTickets: Number(ticketCounts?.total || 0),
      analyzedTickets: Number(ticketCounts?.analyzed || 0),
      unprocessedTickets: Number(ticketCounts?.unprocessed || 0),
      urgentTickets: Number(ticketCounts?.urgent || 0),
      stabilityRiskTickets: Number(ticketCounts?.stabilityRisk || 0),
      totalThemes: Number(themeCounts?.totalThemes || 0),
      highRiskThemes: Number(themeCounts?.highRiskThemes || 0),
    };
    metricsCache.set(regionId, { at: Date.now(), data: metrics });
    return metrics;
  } catch {
    return null;
  }
}

/**
 * 注册一个订阅者。返回取消注册的函数（路由 handler 在 cancel() 里调一次）。
 *
 * 注册后自动推一帧 task-progress 快照（taskProgress + metrics），
 * 避免新连接要先 HTTP 拉一次再接 SSE。
 */
export function registerController(
  regionId: string,
  controller: SseController
): () => void {
  let set = subscribers.get(regionId);
  if (!set) {
    set = new Set();
    subscribers.set(regionId, set);
  }
  set.add(controller);

  const cleanup = () => {
    const cur = subscribers.get(regionId);
    if (!cur) return;
    cur.delete(controller);
    if (cur.size === 0) subscribers.delete(regionId);
  };

  // 初始快照（fire-and-forget；DB 走 async 不会阻塞 stream start）
  void (async () => {
    try {
      const tp = await getLatestTaskProgress(regionId);
      if (!tp) return;
      const metrics = await computeMetrics(regionId);
      controller.enqueue(
        encoder.encode(
          `data: ${JSON.stringify({
            type: "task-progress",
            regionId,
            taskProgress: tp,
            metrics,
          })}\n\n`
        )
      );
    } catch {
      /* ignore */
    }
  })();

  return cleanup;
}

function send(controller: SseController, msg: SseMessage): void {
  try {
    controller.enqueue(
      encoder.encode(`data: ${JSON.stringify(msg)}\n\n`)
    );
  } catch {
    /* 写入失败时由 cancel() 统一清理 */
  }
}

/**
 * 推一帧 task-progress 给指定 region 的所有订阅者。
 *
 * 帧里同时塞 taskProgress + metrics：
 *   - taskProgress: chunk 完成的实时状态（status/percent/processed）
 *   - metrics: 当前 DB count（analyzedTickets 等）
 * 这样 PipelineCanvas 不用 fetchState 也能实时更新进度条和主题数。
 *
 * 调用方可以 fire-and-forget（async + .catch），不影响主流程：
 *   broadcastTaskProgress(regionId, tp).catch(() => {});
 */
export async function broadcastTaskProgress(
  regionId: string,
  taskProgress: unknown
): Promise<void> {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const metrics = await computeMetrics(regionId);
  const msg: SseMessage = {
    type: "task-progress",
    regionId,
    taskProgress,
    metrics,
  };
  for (const c of set) send(c, msg);
}

/**
 * 推一个 "数据变化" 信号给订阅者，触发 cockpit / themes / multifreq 等
 * 派生聚合页面 refetch 各自的懒数据。比定时轮询更省、更及时。
 */
export function broadcastDataRefresh(regionId: string): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: SseMessage = { type: "civic-data-refresh", regionId };
  for (const c of set) send(c, msg);
  // metrics 缓存作废：data-refresh 通常意味着新数据写入，缓存里 analyzeCount 过期
  metricsCache.delete(regionId);
}

/**
 * 推一个 "pipeline-state 缓存失效" 信号，pipeline-drawer 收到后
 * refetch /api/workbench/pipeline-state（含 systemTwoNodes 探活这种
 * SSE 不便携带的重量级数据）。
 */
export function broadcastPipelineRefresh(regionId: string): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: SseMessage = { type: "pipeline-state-refresh", regionId };
  for (const c of set) send(c, msg);
  metricsCache.delete(regionId);
}

/**
 * 测试 / 优雅停机用：清掉所有订阅。
 */
export function _resetSseBroadcasterForTesting(): void {
  for (const set of subscribers.values()) {
    for (const c of set) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
  }
  subscribers.clear();
  metricsCache.clear();
}
