/**
 * Real-time & Persistent Task Progress Store for Backend LLM & Clustering Pipeline
 * Uses in-memory caching for zero-latency updates + PostgreSQL (task_progress) for restart durability.
 */

import { db } from "@/db/client";
import { taskProgressTable } from "@/db/schema";
import { eq, desc, lt, and, sql as drizzleSql } from "drizzle-orm";
import { getSystemTwoEngine } from "@/backend/model";

export interface ActiveCategoryStats {
  category: string;
  count: number;
}

export interface ActiveClusterSpotlight {
  id: string;
  name: string;
  category: string;
  ticketCount: number;
  subdistrict?: string;
  type: "EXISTING_ABSORBED" | "NEW_CLUSTER";
}

export interface TaskProgress {
  taskId: string;
  /** 任务归属辖区。所有按辖区的进度读取（workbench、cluster/progress）都按此字段过滤。 */
  regionId?: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: "PARSING" | "EXTRACTING" | "EMBEDDING" | "CLUSTERING" | "SYNTHESIZING" | "COMPLETED";
  stageText: string;
  percent: number;
  total: number;
  processed: number;
  extractedCount: number;
  themeCount: number;
  reviewCount: number;
  failedCount: number;
  // V2 流水线专有增强度量
  fastTrackCount?: number;
  classifiedCount?: number;
  absorbedCount?: number;
  activeCategories?: ActiveCategoryStats[];
  recentClusters?: ActiveClusterSpotlight[];
  currentReasoning?: string;
  currentSubject?: string;
  currentLocation?: string;
  currentEventType?: string;
  /**
   * Per-endpoint 最近处理过的工单预览（in-memory，来自 SystemTwoEngine.endpointRecentTickets）。
   * Key: endpoint URL；Value: 倒序的最近工单预览。
   * 不入库 —— 这是"工单处理事件"的实时流，next-server 重启即丢失，
   * 跟 currentLocation/currentSubject 一样是 in-memory UI 状态。
   * workbench 的"研判节点一/二"用它替代之前的 modulo 分配，
   * 保证每个节点卡片显示的是该 endpoint 实际处理过的工单。
   */
  endpointRecentTickets?: Record<
    string,
    Array<{
      id: string;
      ticketNo?: string;
      address?: string | null;
      canonicalSubject?: string | null;
      eventType?: string | null;
      durationMs?: number;
      processedAt: number;
    }>
  >;
  error?: string;
  updatedAt: number;
}

interface TaskPersistEntry {
  lastPersistedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
  pendingTask: TaskProgress | null;
  pendingImmediate: boolean;
  inFlight: Promise<void> | null;
}

const PERSIST_THROTTLE_MS = 1000;

declare global {
  var __ticket_radar_task_progress_store: Map<string, TaskProgress> | undefined;
  var __ticket_radar_task_persist_state: Map<string, TaskPersistEntry> | undefined;
}

// In-memory global task progress map (singleton across module invocations & Next.js route chunks)
const progressStore: Map<string, TaskProgress> =
  globalThis.__ticket_radar_task_progress_store ?? new Map<string, TaskProgress>();

const persistState: Map<string, TaskPersistEntry> =
  globalThis.__ticket_radar_task_persist_state ?? new Map<string, TaskPersistEntry>();
globalThis.__ticket_radar_task_persist_state = persistState;

function isTerminalTask(task: Pick<TaskProgress, "status" | "stage" | "percent" | "error">): boolean {
  return (
    task.status === "COMPLETED" ||
    task.status === "FAILED" ||
    task.stage === "COMPLETED" ||
    task.percent >= 100 ||
    Boolean(task.error)
  );
}

/**
 * 只读本进程里已经记下的最新任务。不查库，也不连接 System 2。
 * 大屏入口用它拿节点上最近的工单预览，避免为了这一屏去探测算力节点。
 */
export function peekLatestTaskProgress(regionId?: string): TaskProgress | null {
  let newest: TaskProgress | null = null;
  for (const task of progressStore.values()) {
    if (regionId && task.regionId !== regionId) continue;
    if (!newest || task.updatedAt > newest.updatedAt) newest = task;
  }
  return newest;
}

globalThis.__ticket_radar_task_progress_store = progressStore;

/**
 * 异步将任务数据落库至 PostgreSQL，静默捕获异常避免阻塞流水线
 */
async function persistTaskToDb(task: TaskProgress) {
  try {
    const isTerminalStatus = task.status === "COMPLETED" || task.status === "FAILED";
    await db
      .insert(taskProgressTable)
      .values({
        taskId: task.taskId,
        status: task.status,
        stage: task.stage,
        stageText: task.stageText,
        percent: task.percent,
        total: task.total,
        processed: task.processed,
        extractedCount: task.extractedCount,
        themeCount: task.themeCount,
        reviewCount: task.reviewCount,
        failedCount: task.failedCount,
        error: task.error || null,
        regionId: task.regionId || null,
        updatedAt: new Date(task.updatedAt),
      })
      .onConflictDoUpdate({
        target: taskProgressTable.taskId,
        ...(isTerminalStatus
          ? {}
          : { setWhere: drizzleSql`${taskProgressTable.status} NOT IN ('COMPLETED', 'FAILED')` }),
        set: {
          status: task.status,
          stage: task.stage,
          stageText: task.stageText,
          percent: task.percent,
          total: task.total,
          processed: task.processed,
          extractedCount: task.extractedCount,
          themeCount: task.themeCount,
          reviewCount: task.reviewCount,
          failedCount: task.failedCount,
          error: task.error || null,
          regionId: task.regionId || null,
          updatedAt: new Date(task.updatedAt),
        },
      });
  } catch (err: any) {
    console.warn(`[task-progress] Failed to persist task ${task.taskId} to DB:`, err.message);
  }
}

function getOrCreatePersistEntry(taskId: string): TaskPersistEntry {
  let entry = persistState.get(taskId);
  if (!entry) {
    entry = {
      lastPersistedAt: 0,
      timer: null,
      pendingTask: null,
      pendingImmediate: false,
      inFlight: null,
    };
    persistState.set(taskId, entry);
  }
  return entry;
}

function armPersistTimer(taskId: string, entry: TaskPersistEntry, delayMs: number): void {
  if (entry.timer) return;
  entry.timer = setTimeout(() => {
    entry.timer = null;
    const pending = entry.pendingTask;
    if (!pending || entry.inFlight) return;
    entry.pendingTask = null;
    entry.pendingImmediate = false;
    entry.lastPersistedAt = Date.now();
    startPersist(taskId, entry, pending);
  }, Math.max(1, delayMs));
  entry.timer.unref?.();
}

function startPersist(taskId: string, entry: TaskPersistEntry, task: TaskProgress): void {
  entry.pendingImmediate = false;
  const flight = persistTaskToDb(task).finally(() => {
    if (entry.inFlight === flight) {
      entry.inFlight = null;
    }
    if (!persistState.has(taskId)) return;
    const next = entry.pendingTask;
    if (!next) return;
    const wasPendingImmediate = entry.pendingImmediate;
    const elapsed = Date.now() - entry.lastPersistedAt;
    if (isTerminalTask(next) || wasPendingImmediate || elapsed >= PERSIST_THROTTLE_MS) {
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      entry.pendingTask = null;
      entry.pendingImmediate = false;
      entry.lastPersistedAt = Date.now();
      startPersist(taskId, entry, next);
    } else {
      armPersistTimer(taskId, entry, PERSIST_THROTTLE_MS - elapsed);
    }
  });
  entry.inFlight = flight;
}

function schedulePersistTask(task: TaskProgress, forceImmediate: boolean): void {
  const entry = getOrCreatePersistEntry(task.taskId);
  const now = Date.now();
  const shouldImmediate =
    forceImmediate || isTerminalTask(task) || now - entry.lastPersistedAt >= PERSIST_THROTTLE_MS;

  if (shouldImmediate && !entry.inFlight) {
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    entry.pendingTask = null;
    entry.pendingImmediate = false;
    entry.lastPersistedAt = now;
    startPersist(task.taskId, entry, task);
    return;
  }

  entry.pendingTask = task;
  entry.pendingImmediate = entry.pendingImmediate || forceImmediate;
  if (!entry.inFlight) {
    armPersistTimer(task.taskId, entry, PERSIST_THROTTLE_MS - (now - entry.lastPersistedAt));
  }
}

export async function flushTaskProgressPersist(taskId?: string): Promise<void> {
  const ids = taskId ? [taskId] : Array.from(persistState.keys());
  for (const id of ids) {
    const entry = persistState.get(id);
    if (!entry) continue;
    if (entry.timer) {
      clearTimeout(entry.timer);
      entry.timer = null;
    }
    while (entry.inFlight || entry.pendingTask) {
      if (entry.inFlight) {
        await entry.inFlight;
      }
      if (entry.timer) {
        clearTimeout(entry.timer);
        entry.timer = null;
      }
      const pending = entry.pendingTask;
      if (pending && !entry.inFlight) {
        entry.pendingTask = null;
        entry.pendingImmediate = false;
        entry.lastPersistedAt = Date.now();
        startPersist(id, entry, pending);
      }
    }
  }
}

export function initTaskProgress(taskId: string, regionId: string, total: number = 0): TaskProgress {
  const initial: TaskProgress = {
    taskId,
    regionId,
    status: "RUNNING",
    stage: "EXTRACTING",
    stageText: "正在初始化 Agent 研判流水线...",
    percent: 0,
    total,
    processed: 0,
    extractedCount: 0,
    themeCount: 0,
    reviewCount: 0,
    failedCount: 0,
    updatedAt: Date.now(),
  };

  progressStore.set(taskId, initial);
  // 首帧立即落库
  schedulePersistTask(initial, true);

  return initial;
}

/**
 * 写入一次进度。regionId 为任务归属辖区，必须由调用方传入，避免多辖区共享同一内存条目。
 * 既有内存条目会继承其 regionId；patch 里若显式给 regionId，以 patch 为准。
 */
export function updateTaskProgress(
  taskId: string,
  regionId: string | undefined,
  patch: Partial<TaskProgress>
): TaskProgress {
  const current = progressStore.get(taskId);
  if (
    current &&
    (current.status === "COMPLETED" || current.status === "FAILED") &&
    patch.status !== "COMPLETED" &&
    patch.status !== "FAILED"
  ) {
    return current;
  }

  let updated: TaskProgress;

  if (!current) {
    updated = {
      taskId,
      regionId: patch.regionId ?? regionId,
      status: "RUNNING",
      stage: "EXTRACTING",
      stageText: "处理中...",
      percent: 0,
      total: 0,
      processed: 0,
      extractedCount: 0,
      themeCount: 0,
      reviewCount: 0,
      failedCount: 0,
      updatedAt: Date.now(),
      ...patch,
    };
  } else {
    updated = {
      ...current,
      ...patch,
      regionId: patch.regionId ?? regionId ?? current.regionId,
      updatedAt: Date.now(),
    };
  }

  progressStore.set(taskId, updated);
  const stageOrStatusChanged =
    !current || current.stage !== updated.stage || current.status !== updated.status;
  // 按 taskId 节流异步落库；stage/status 切换或终态立即触发
  schedulePersistTask(updated, stageOrStatusChanged);

  // SSE 推送：每个 region 的活跃订阅者立刻收到新一帧。
  // regionId 来源优先级：patch > 函数参数 > 内存旧值（切区时保证旧 task 不会跨区泄漏）。
  const broadcastRegionId = updated.regionId;
  if (broadcastRegionId) {
    // 动态 import 避免循环依赖；broadcastTaskProgress 现在是 async（会查 metrics），
    // 调用方 fire-and-forget 不阻塞主流程
    import("./sse-broadcaster")
      .then((m) => m.broadcastTaskProgress(broadcastRegionId, updated))
      .catch(() => {
        /* sse-broadcaster 不可用时忽略（极少数 dev 模式边界场景） */
      });
  }

  return updated;
}

/**
 * 获取任务进度：优先从内存读取，若重启或跨实例未命中则回捞 PostgreSQL
 */
function rowToProgress(r: {
  taskId: string;
  regionId?: string | null;
  status: string | null;
  stage: string | null;
  stageText: string | null;
  percent: number | null;
  total: number | null;
  processed: number | null;
  extractedCount: number | null;
  themeCount: number | null;
  reviewCount: number | null;
  failedCount: number | null;
  error: string | null;
  updatedAt: Date | null;
}): TaskProgress {
  return {
    taskId: r.taskId,
    regionId: r.regionId || undefined,
    status: (r.status as TaskProgress["status"]) || "PENDING",
    stage: (r.stage as TaskProgress["stage"]) || "EXTRACTING",
    stageText: r.stageText || "处理中...",
    percent: r.percent || 0,
    total: r.total || 0,
    processed: r.processed || 0,
    extractedCount: r.extractedCount || 0,
    themeCount: r.themeCount || 0,
    reviewCount: r.reviewCount || 0,
    failedCount: r.failedCount || 0,
    error: r.error || undefined,
    updatedAt: r.updatedAt ? r.updatedAt.getTime() : Date.now(),
  };
}

/**
 * 进度由独立队列进程写入。Next 进程里的内存只是上一拍的副本，
 * 每次都跟数据库比时间，避免页面刷新后一直停在旧百分比。
 */
export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
  const mem = progressStore.get(taskId);

  try {
    const rows = await db
      .select()
      .from(taskProgressTable)
      .where(eq(taskProgressTable.taskId, taskId))
      .limit(1);

    if (rows && rows.length > 0) {
      const fromDb = rowToProgress(rows[0]);
      const fromDbIsTerminal = fromDb.status === "COMPLETED" || fromDb.status === "FAILED";
      if (
        mem &&
        mem.updatedAt > fromDb.updatedAt &&
        !(fromDbIsTerminal && mem.status !== "COMPLETED" && mem.status !== "FAILED")
      ) {
        return mem;
      }
      progressStore.set(taskId, fromDb);
      return fromDb;
    }
  } catch (err: any) {
    console.warn(`[task-progress] Failed to fetch task ${taskId} from DB:`, err.message);
  }

  return mem ?? null;
}

/**
 * 获取系统中最近一条执行的任务。
 * - 传 regionId 时，只返回该辖区的最新任务；多辖区并发时 UI 不会再跳。
 * - 不传 regionId 时，保持历史「全局最近」语义（仅作兜底）。
 */
export async function getLatestTaskProgress(regionId?: string): Promise<TaskProgress | null> {
  let newestMem: TaskProgress | null = null;
  for (const t of progressStore.values()) {
    if (regionId && t.regionId !== regionId) continue;
    if (!newestMem || t.updatedAt > newestMem.updatedAt) newestMem = t;
  }

  try {
    const baseQuery = db.select().from(taskProgressTable);
    const rows = regionId
      ? await baseQuery
          .where(eq(taskProgressTable.regionId, regionId))
          .orderBy(desc(taskProgressTable.updatedAt))
          .limit(1)
      : await baseQuery.orderBy(desc(taskProgressTable.updatedAt)).limit(1);

    if (rows && rows.length > 0) {
      const r = rows[0];
      const fromDb: TaskProgress = {
        taskId: r.taskId,
        regionId: r.regionId || undefined,
        status: (r.status as any) || "PENDING",
        stage: (r.stage as any) || "EXTRACTING",
        stageText: r.stageText || "处理中...",
        percent: r.percent || 0,
        total: r.total || 0,
        processed: r.processed || 0,
        extractedCount: r.extractedCount || 0,
        themeCount: r.themeCount || 0,
        reviewCount: r.reviewCount || 0,
        failedCount: r.failedCount || 0,
        error: r.error || undefined,
        updatedAt: r.updatedAt ? r.updatedAt.getTime() : Date.now(),
      };
      const fromDbIsTerminal = fromDb.status === "COMPLETED" || fromDb.status === "FAILED";
      if (
        newestMem &&
        newestMem.updatedAt >= fromDb.updatedAt &&
        !(
          fromDbIsTerminal &&
          newestMem.taskId === fromDb.taskId &&
          newestMem.status !== "COMPLETED" &&
          newestMem.status !== "FAILED"
        )
      ) {
        return newestMem;
      }
      const live = progressStore.get(fromDb.taskId);
      if (
        live &&
        live.updatedAt >= fromDb.updatedAt &&
        !(fromDbIsTerminal && live.status !== "COMPLETED" && live.status !== "FAILED")
      ) {
        return live;
      }
      // fromDb 路径：DB row 没存 in-memory 字段（endpointRecentTickets / currentLocation 等），
      // 从进程内 SystemTwoEngine 补上，确保 pipeline-state API 返回给前端的 taskProgress
      // 跟 SSE 推的 taskProgress 字段对齐，避免 fetchState 拿到缺字段的 taskProgress
      // 导致 PipelineCanvas 节点卡空白。
      if (live?.endpointRecentTickets && !fromDb.endpointRecentTickets) {
        fromDb.endpointRecentTickets = live.endpointRecentTickets;
      } else {
        try {
          const engine = await getSystemTwoEngine();
          (fromDb as any).endpointRecentTickets = engine.getEndpointRecentTickets();
        } catch {
          /* engine 不可用时保留 fromDb 原样 */
        }
      }
      if (fromDbIsTerminal) {
        progressStore.set(fromDb.taskId, fromDb);
      }
      return fromDb;
    } else {
      // 该辖区（或全局）已无任务记录：清掉已完成落库同步的僵尸内存条目；
      // 若当前进程尚有未完成/在途写入的任务，保留内存进度避免抢跑删除。
      let retainedNewest: TaskProgress | null = null;
      for (const [taskId, value] of Array.from(progressStore.entries())) {
        if (regionId && value.regionId !== regionId) continue;
        const p = persistState.get(taskId);
        if (p && (p.inFlight || p.pendingTask || p.timer)) {
          if (!retainedNewest || value.updatedAt > retainedNewest.updatedAt) {
            retainedNewest = value;
          }
        } else {
          removeTaskProgress(taskId);
        }
      }
      return retainedNewest;
    }
  } catch (err: any) {
    console.warn("[task-progress] Failed to fetch latest task from DB:", err.message);
  }

  return newestMem;
}

function clearPersistEntry(taskId: string): void {
  const entry = persistState.get(taskId);
  if (entry?.timer) {
    clearTimeout(entry.timer);
    entry.timer = null;
  }
  if (entry) {
    entry.pendingTask = null;
    entry.pendingImmediate = false;
  }
  persistState.delete(taskId);
}

export function clearTaskProgressStore(): void {
  for (const taskId of Array.from(persistState.keys())) {
    clearPersistEntry(taskId);
  }
  progressStore.clear();
}

export function removeTaskProgress(taskId: string): void {
  clearPersistEntry(taskId);
  progressStore.delete(taskId);
}

/**
 * Sweep stale RUNNING tasks: a task is considered dead if its updated_at is older than the
 * threshold (default 30 min). This catches cases where the container was killed / OOM /
 * SIGKILL'd mid-flight and the in-memory progress never reached a terminal state.
 *
 * Called lazily from initTaskProgress() so cleanup piggybacks on real cluster activity
 * — no cron, no timer, no second source of truth.
 */
const STALE_RUNNING_THRESHOLD_MS = 30 * 60 * 1000;

export async function sweepStaleTasks(): Promise<number> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_THRESHOLD_MS);
  try {
    const result = await db
      .update(taskProgressTable)
      .set({
        status: "FAILED",
        error: `任务卡死自动清扫(${STALE_RUNNING_THRESHOLD_MS / 60_000} 分钟无更新,容器可能异常退出)`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(taskProgressTable.status, "RUNNING"),
          lt(taskProgressTable.updatedAt, cutoff)
        )
      )
      .returning({ taskId: taskProgressTable.taskId });

    if (result.length > 0) {
      console.warn(`[task-progress] sweepStaleTasks: marked ${result.length} stale RUNNING tasks as FAILED`);
    }
    return result.length;
  } catch (err: any) {
    console.warn("[task-progress] sweepStaleTasks failed:", err?.message);
    return 0;
  }
}
