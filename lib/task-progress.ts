/**
 * Real-time & Persistent Task Progress Store for Backend LLM & Clustering Pipeline
 * Uses in-memory caching for zero-latency updates + PostgreSQL (task_progress) for restart durability.
 */

import { db } from "@/db/client";
import { taskProgressTable } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

export interface TaskProgress {
  taskId: string;
  status: "PENDING" | "RUNNING" | "COMPLETED" | "FAILED";
  stage: "PARSING" | "EXTRACTING" | "CLUSTERING" | "SYNTHESIZING" | "COMPLETED";
  stageText: string;
  percent: number;
  total: number;
  processed: number;
  extractedCount: number;
  themeCount: number;
  reviewCount: number;
  failedCount: number;
  error?: string;
  updatedAt: number;
}

declare global {
  var __ticket_radar_task_progress_store: Map<string, TaskProgress> | undefined;
}

// In-memory global task progress map (singleton across module invocations & Next.js route chunks)
const progressStore: Map<string, TaskProgress> =
  globalThis.__ticket_radar_task_progress_store ?? new Map<string, TaskProgress>();

globalThis.__ticket_radar_task_progress_store = progressStore;

/**
 * 异步将任务数据落库至 PostgreSQL，静默捕获异常避免阻塞流水线
 */
async function persistTaskToDb(task: TaskProgress) {
  try {
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
        updatedAt: new Date(task.updatedAt),
      })
      .onConflictDoUpdate({
        target: taskProgressTable.taskId,
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
          updatedAt: new Date(task.updatedAt),
        },
      });
  } catch (err: any) {
    console.warn(`[task-progress] Failed to persist task ${task.taskId} to DB:`, err.message);
  }
}

export function initTaskProgress(taskId: string, total: number = 0): TaskProgress {
  const initial: TaskProgress = {
    taskId,
    status: "RUNNING",
    stage: "EXTRACTING",
    stageText: "正在初始化 LangGraph 研判流水线...",
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
  // 异步写入 DB
  persistTaskToDb(initial);

  return initial;
}

export function updateTaskProgress(
  taskId: string,
  patch: Partial<TaskProgress>
): TaskProgress {
  const current = progressStore.get(taskId);
  let updated: TaskProgress;

  if (!current) {
    updated = {
      taskId,
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
      updatedAt: Date.now(),
    };
  }

  progressStore.set(taskId, updated);
  // 异步实时同步 DB
  persistTaskToDb(updated);

  return updated;
}

/**
 * 获取任务进度：优先从内存读取，若重启或跨实例未命中则回捞 PostgreSQL
 */
export async function getTaskProgress(taskId: string): Promise<TaskProgress | null> {
  const mem = progressStore.get(taskId);
  if (mem) return mem;

  try {
    const rows = await db
      .select()
      .from(taskProgressTable)
      .where(eq(taskProgressTable.taskId, taskId))
      .limit(1);

    if (rows && rows.length > 0) {
      const r = rows[0];
      const restored: TaskProgress = {
        taskId: r.taskId,
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
      progressStore.set(taskId, restored);
      return restored;
    }
  } catch (err: any) {
    console.warn(`[task-progress] Failed to fetch task ${taskId} from DB:`, err.message);
  }

  return null;
}

/**
 * 获取系统中最近一条执行的任务（用于页面初始化或断线重连）
 */
export async function getLatestTaskProgress(): Promise<TaskProgress | null> {
  try {
    const rows = await db
      .select()
      .from(taskProgressTable)
      .orderBy(desc(taskProgressTable.updatedAt))
      .limit(1);

    if (rows && rows.length > 0) {
      const r = rows[0];
      const latest: TaskProgress = {
        taskId: r.taskId,
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
      progressStore.set(r.taskId, latest);
      return latest;
    }
  } catch (err: any) {
    console.warn("[task-progress] Failed to fetch latest task from DB:", err.message);
  }

  return null;
}

export function removeTaskProgress(taskId: string): void {
  progressStore.delete(taskId);
}
