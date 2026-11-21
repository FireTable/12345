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
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { sql as drizzleSql } from "drizzle-orm";
import { getLatestTaskProgress } from "./task-progress";

export type SseRole = "admin" | "user";

type SseController = ReadableStreamDefaultController<Uint8Array>;

type SseRoleBucket = {
  admin: Set<SseController>;
  user: Set<SseController>;
};

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

type MetricsCacheEntry = { value: SseMetrics | null; fetchedAt: number };
type BroadcastThrottleEntry = {
  lastSentAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingTaskProgress: unknown;
};

const METRICS_THROTTLE_MS = 2500;
const BROADCAST_THROTTLE_MS = 250;

declare global {
  // eslint-disable-next-line no-var
  var __sse_subscribers_v2: Map<string, SseRoleBucket> | undefined;
  // eslint-disable-next-line no-var
  var __sse_metrics_cache: Map<string, MetricsCacheEntry> | undefined;
  // eslint-disable-next-line no-var
  var __sse_metrics_inflight: Map<string, Promise<SseMetrics | null>> | undefined;
  // eslint-disable-next-line no-var
  var __sse_metrics_seq: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __sse_broadcast_throttle: Map<string, BroadcastThrottleEntry> | undefined;
  // eslint-disable-next-line no-var
  var __sse_emit_seq: Map<string, number> | undefined;
  // eslint-disable-next-line no-var
  var __sse_emit_chain: Map<string, Promise<void>> | undefined;
}

const subscribers: Map<string, SseRoleBucket> =
  globalThis.__sse_subscribers_v2 ?? new Map<string, SseRoleBucket>();
globalThis.__sse_subscribers_v2 = subscribers;

const metricsCache: Map<string, MetricsCacheEntry> =
  globalThis.__sse_metrics_cache ?? new Map<string, MetricsCacheEntry>();
globalThis.__sse_metrics_cache = metricsCache;

const metricsInFlight: Map<string, Promise<SseMetrics | null>> =
  globalThis.__sse_metrics_inflight ?? new Map<string, Promise<SseMetrics | null>>();
globalThis.__sse_metrics_inflight = metricsInFlight;

const metricsSeqMap: Map<string, number> =
  globalThis.__sse_metrics_seq ?? new Map<string, number>();
globalThis.__sse_metrics_seq = metricsSeqMap;

const broadcastThrottle: Map<string, BroadcastThrottleEntry> =
  globalThis.__sse_broadcast_throttle ?? new Map<string, BroadcastThrottleEntry>();
globalThis.__sse_broadcast_throttle = broadcastThrottle;

const emitSeqMap: Map<string, number> =
  globalThis.__sse_emit_seq ?? new Map<string, number>();
globalThis.__sse_emit_seq = emitSeqMap;

const emitChainMap: Map<string, Promise<void>> =
  globalThis.__sse_emit_chain ?? new Map<string, Promise<void>>();
globalThis.__sse_emit_chain = emitChainMap;

const encoder = new TextEncoder();

async function computeMetrics(regionId: string): Promise<SseMetrics | null> {
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
    return {
      totalTickets: Number(ticketCounts?.total || 0),
      analyzedTickets: Number(ticketCounts?.analyzed || 0),
      unprocessedTickets: Number(ticketCounts?.unprocessed || 0),
      urgentTickets: Number(ticketCounts?.urgent || 0),
      stabilityRiskTickets: Number(ticketCounts?.stabilityRisk || 0),
      totalThemes: Number(themeCounts?.totalThemes || 0),
      highRiskThemes: Number(themeCounts?.highRiskThemes || 0),
    };
  } catch {
    return null;
  }
}

function invalidateMetricsCache(regionId: string): void {
  metricsCache.delete(regionId);
  metricsSeqMap.set(regionId, (metricsSeqMap.get(regionId) ?? 0) + 1);
}

async function getThrottledMetrics(
  regionId: string,
  forceRefresh = false
): Promise<SseMetrics | null> {
  if (!forceRefresh) {
    const cached = metricsCache.get(regionId);
    if (cached && Date.now() - cached.fetchedAt < METRICS_THROTTLE_MS) {
      return cached.value;
    }
    const existingFlight = metricsInFlight.get(regionId);
    if (existingFlight) {
      return existingFlight;
    }
  }

  const seq = (metricsSeqMap.get(regionId) ?? 0) + 1;
  metricsSeqMap.set(regionId, seq);

  let flight: Promise<SseMetrics | null> | undefined;
  flight = (async () => {
    try {
      const value = await computeMetrics(regionId);
      if (value !== null && (metricsSeqMap.get(regionId) ?? 0) === seq) {
        metricsCache.set(regionId, { value, fetchedAt: Date.now() });
      }
      return value;
    } finally {
      if (metricsInFlight.get(regionId) === flight) {
        metricsInFlight.delete(regionId);
      }
    }
  })();

  metricsInFlight.set(regionId, flight);
  return flight;
}

function clearBroadcastThrottle(regionId: string): void {
  const st = broadcastThrottle.get(regionId);
  if (st?.timer) {
    clearTimeout(st.timer);
    st.timer = null;
  }
  if (st) st.pendingTaskProgress = null;
  broadcastThrottle.delete(regionId);
}

/**
 * 从所有角色桶中移除指定订阅者，并在桶为空时清理 region 条目。
 */
export function unregisterController(
  regionId: string,
  controller: SseController
): void {
  const bucket = subscribers.get(regionId);
  if (!bucket) return;
  bucket.admin.delete(controller);
  bucket.user.delete(controller);
  if (bucket.admin.size === 0) {
    clearBroadcastThrottle(regionId);
  }
  if (bucket.admin.size === 0 && bucket.user.size === 0) {
    subscribers.delete(regionId);
  }
}

/**
 * 注册一个订阅者（按角色分桶，默认 fail-closed 为 "user"）。
 * 返回幂等取消注册的函数（路由 handler 在 cancel()/abort 时调一次）。
 *
 * 仅对 "admin" 订阅者推送初始 task-progress 快照（taskProgress + metrics），
 * 普通 "user" 订阅者绝不接收管理态势与工单敏感细节。
 */
export function registerController(
  regionId: string,
  controller: SseController,
  role: SseRole = "user"
): () => void {
  const safeRole: SseRole = role === "admin" ? "admin" : "user";
  let bucket = subscribers.get(regionId);
  if (!bucket) {
    bucket = { admin: new Set(), user: new Set() };
    subscribers.set(regionId, bucket);
  }
  bucket[safeRole].add(controller);

  let unregistered = false;
  const cleanup = () => {
    if (unregistered) return;
    unregistered = true;
    unregisterController(regionId, controller);
  };

  if (safeRole === "admin") {
    // 初始快照（fire-and-forget；DB 走 async 不会阻塞 stream start）
    void (async () => {
      try {
        if (unregistered || !subscribers.get(regionId)?.admin.has(controller)) return;
        const tp = await getLatestTaskProgress(regionId);
        if (!tp || unregistered || !subscribers.get(regionId)?.admin.has(controller)) return;
        const metrics = await getThrottledMetrics(regionId, false);
        if (unregistered || !subscribers.get(regionId)?.admin.has(controller)) return;
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
        cleanup();
      }
    })();
  }

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

function isTerminalBroadcast(taskProgress: unknown): boolean {
  if (!taskProgress || typeof taskProgress !== "object") return false;
  const tp = taskProgress as {
    status?: unknown;
    stage?: unknown;
    percent?: unknown;
    error?: unknown;
  };
  return (
    tp.status === "COMPLETED" ||
    tp.status === "FAILED" ||
    tp.status === "CANCELLED" ||
    tp.stage === "COMPLETED" ||
    (typeof tp.percent === "number" && tp.percent >= 100) ||
    Boolean(tp.error)
  );
}

async function emitTaskProgressFrame(
  regionId: string,
  taskProgress: unknown,
  forceMetricsRefresh: boolean
): Promise<void> {
  const seq = (emitSeqMap.get(regionId) ?? 0) + 1;
  emitSeqMap.set(regionId, seq);
  const isTerminal = isTerminalBroadcast(taskProgress);

  const prev = emitChainMap.get(regionId) ?? Promise.resolve();
  const task = prev
    .catch(() => {})
    .then(async () => {
      if (!isTerminal && seq < (emitSeqMap.get(regionId) ?? 0)) {
        return;
      }
      const bucket = subscribers.get(regionId);
      if (!bucket || bucket.admin.size === 0) return;
      const metrics = await getThrottledMetrics(regionId, forceMetricsRefresh);
      if (!isTerminal && seq < (emitSeqMap.get(regionId) ?? 0)) {
        return;
      }
      const currentBucket = subscribers.get(regionId);
      if (!currentBucket || currentBucket.admin.size === 0) return;
      const msg: SseMessage = {
        type: "task-progress",
        regionId,
        taskProgress,
        metrics,
      };
      for (const c of currentBucket.admin) send(c, msg);
    });

  const tail = task.finally(() => {
    if (emitChainMap.get(regionId) === tail) {
      emitChainMap.delete(regionId);
    }
  });
  emitChainMap.set(regionId, tail);
  await task;
}

/**
 * 推一帧 task-progress 给指定 region 的 admin 订阅者。
 * 若当前无 admin 订阅者，直接跳过 DB metrics 查询，也不推送给普通 user。
 * 首帧与终态立即推送（保留 M1 await 语义），高频中间帧按 regionId 合并节流。
 */
export async function broadcastTaskProgress(
  regionId: string,
  taskProgress: unknown
): Promise<void> {
  const bucket = subscribers.get(regionId);
  if (!bucket || bucket.admin.size === 0) return;

  const isTerminal = isTerminalBroadcast(taskProgress);
  const now = Date.now();
  let st = broadcastThrottle.get(regionId);
  if (!st) {
    st = { lastSentAt: 0, timer: null, pendingTaskProgress: null };
    broadcastThrottle.set(regionId, st);
  }

  const elapsed = now - st.lastSentAt;
  const isImmediate = isTerminal || st.lastSentAt === 0 || elapsed >= BROADCAST_THROTTLE_MS;

  if (isImmediate) {
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.pendingTaskProgress = null;
    st.lastSentAt = now;
    await emitTaskProgressFrame(regionId, taskProgress, isTerminal);
    return;
  }

  st.pendingTaskProgress = taskProgress;
  if (!st.timer) {
    const waitMs = Math.max(1, BROADCAST_THROTTLE_MS - elapsed);
    const entry = st;
    entry.timer = setTimeout(() => {
      entry.timer = null;
      const pending = entry.pendingTaskProgress;
      entry.pendingTaskProgress = null;
      if (pending == null) return;
      entry.lastSentAt = Date.now();
      void emitTaskProgressFrame(regionId, pending, isTerminalBroadcast(pending));
    }, waitMs);
    entry.timer.unref?.();
  }
}

/**
 * 推一个 "数据变化" 信号（仅含 type 与 regionId，无敏感载荷）给订阅者，
 * 触发前端按各自权限重新拉取数据，并同步失效聚合缓存与 SSE metrics 缓存。
 */
export function broadcastDataRefresh(regionId: string): void {
  invalidateCivicAggregates(regionId);
  invalidateMetricsCache(regionId);
  const bucket = subscribers.get(regionId);
  if (!bucket || (bucket.admin.size === 0 && bucket.user.size === 0)) return;
  const msg: SseMessage = { type: "civic-data-refresh", regionId };
  for (const c of bucket.admin) send(c, msg);
  for (const c of bucket.user) send(c, msg);
}

/**
 * 推一个 "pipeline-state 缓存失效" 信号给 admin 订阅者，
 * 触发工作台 refetch /api/workbench/pipeline-state，并同步失效聚合缓存与 SSE metrics 缓存。
 */
export function broadcastPipelineRefresh(regionId: string): void {
  invalidateCivicAggregates(regionId);
  invalidateMetricsCache(regionId);
  const bucket = subscribers.get(regionId);
  if (!bucket || bucket.admin.size === 0) return;
  const msg: SseMessage = { type: "pipeline-state-refresh", regionId };
  for (const c of bucket.admin) send(c, msg);
}

/**
 * 测试 / 优雅停机用：清掉所有订阅与节流状态。
 */
export function _resetSseBroadcasterForTesting(): void {
  for (const st of broadcastThrottle.values()) {
    if (st.timer) {
      clearTimeout(st.timer);
      st.timer = null;
    }
    st.pendingTaskProgress = null;
  }
  broadcastThrottle.clear();
  metricsCache.clear();
  metricsInFlight.clear();
  metricsSeqMap.clear();
  emitSeqMap.clear();
  emitChainMap.clear();
  for (const bucket of subscribers.values()) {
    for (const c of bucket.admin) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
    for (const c of bucket.user) {
      try {
        c.close();
      } catch {
        /* ignore */
      }
    }
  }
  subscribers.clear();
}
