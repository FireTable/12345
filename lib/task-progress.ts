/**
 * Real-time Task Progress Store for Backend LLM & Clustering Pipeline
 */

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

// In-memory global task progress map (singleton across module invocations)
const progressStore = new Map<string, TaskProgress>();

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
  return initial;
}

export function updateTaskProgress(
  taskId: string,
  patch: Partial<TaskProgress>
): TaskProgress | null {
  const current = progressStore.get(taskId);
  if (!current) {
    const fresh: TaskProgress = {
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
    progressStore.set(taskId, fresh);
    return fresh;
  }

  const updated: TaskProgress = {
    ...current,
    ...patch,
    updatedAt: Date.now(),
  };
  progressStore.set(taskId, updated);
  return updated;
}

export function getTaskProgress(taskId: string): TaskProgress | null {
  return progressStore.get(taskId) || null;
}

export function removeTaskProgress(taskId: string): void {
  progressStore.delete(taskId);
}
