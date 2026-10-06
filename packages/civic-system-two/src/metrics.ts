import fs from 'fs';
import path from 'path';

export interface NodeMetric {
  endpoint: string;
  durationMs: number; // 最近一次工单处理耗时 (毫秒)
  updatedAt: number;
  tokensPerSecond?: number;
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

declare global {
  var __civic_node_metrics_store: Map<string, NodeMetric> | undefined;
}

export function normalizeEndpointKey(endpoint: string): string {
  if (!endpoint) return '';
  return endpoint
    .trim()
    .toLowerCase()
    .replace(/\/+$/, '')
    .replace(/\/v1$/, '');
}

const METRICS_FILE_NAME = '.civic-node-metrics.json';

function getMetricsFilePath(): string {
  try {
    return path.join(process.cwd(), METRICS_FILE_NAME);
  } catch {
    return path.join('/tmp', METRICS_FILE_NAME);
  }
}

// In-memory store (零延迟内存读取)
const memoryStore: Map<string, NodeMetric> =
  globalThis.__civic_node_metrics_store ?? new Map<string, NodeMetric>();
globalThis.__civic_node_metrics_store = memoryStore;

// 加载持久化耗时记录
function loadPersistedMetrics() {
  try {
    const filePath = getMetricsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (typeof data === 'object' && data !== null) {
        for (const [key, val] of Object.entries(data)) {
          if (val && typeof (val as any).durationMs === 'number') {
            memoryStore.set(key, val as NodeMetric);
          }
        }
      }
    }
  } catch {
    // 忽略文件读取异常
  }
}

loadPersistedMetrics();

/**
 * 记录节点最新一笔工单的处理耗时 (内存 + 本地轻量持久化)
 */
export function recordNodeMetric(metric: Partial<NodeMetric> & { endpoint: string; durationMs: number }): void {
  const key = normalizeEndpointKey(metric.endpoint);
  if (!key) return;

  const data: NodeMetric = {
    endpoint: metric.endpoint,
    durationMs: Math.max(1, Math.round(metric.durationMs)),
    updatedAt: metric.updatedAt || Date.now(),
    tokensPerSecond: metric.tokensPerSecond ? Math.round(metric.tokensPerSecond * 10) / 10 : undefined,
    completionTokens: metric.completionTokens,
    promptTokens: metric.promptTokens,
    totalTokens: metric.totalTokens,
  };

  memoryStore.set(key, data);

  // 原子写入本地指标文件，保证跨进程安全同步且避免并发截断文件
  try {
    const filePath = getMetricsFilePath();
    const obj: Record<string, NodeMetric> = {};
    for (const [k, v] of memoryStore.entries()) {
      obj[k] = v;
    }
    const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, JSON.stringify(obj, null, 2), 'utf-8');
    fs.renameSync(tmpPath, filePath);
  } catch {
    // 忽略异常
  }
}


/**
 * 获取指定算力节点最新一笔工单的处理指标
 */
export function getNodeMetric(endpoint: string): NodeMetric | null {
  const key = normalizeEndpointKey(endpoint);
  let metric = memoryStore.get(key);
  if (metric) return metric;

  // 若内存未命中，重载文件（处理跨独立进程写入）
  try {
    const filePath = getMetricsFilePath();
    if (fs.existsSync(filePath)) {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data = JSON.parse(raw);
      if (data && data[key]) {
        memoryStore.set(key, data[key]);
        return data[key];
      }
      // 容错端口/Host模糊匹配
      const entries = Object.entries(data);
      for (const [storedKey, storedVal] of entries) {
        const val = storedVal as NodeMetric;
        if (!val || typeof val.durationMs !== 'number') continue;
        const portKeyMatch = key.match(/:(\d+)/);
        const portStoredMatch = storedKey.match(/:(\d+)/);
        if (portKeyMatch && portStoredMatch && portKeyMatch[1] === portStoredMatch[1]) {
          return val;
        }
      }
    }
  } catch {
    // 忽略异常
  }

  return null;
}

/**
 * 获取所有节点的指标字典
 */
export function getAllNodeMetrics(): Record<string, NodeMetric> {
  loadPersistedMetrics();
  const obj: Record<string, NodeMetric> = {};
  for (const [k, v] of memoryStore.entries()) {
    obj[k] = v;
  }
  return obj;
}

/**
 * 格式化耗时展示，一律写成秒（例如 1850ms -> 1.9s，420ms -> 0.4s）。
 */
export function formatDuration(durationMs?: number | null): string {
  if (durationMs == null || durationMs <= 0) return '';
  return `${(durationMs / 1000).toFixed(1)}s`;
}
