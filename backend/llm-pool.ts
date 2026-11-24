import { createAbortError } from "@civic/system-two";
import { systemTwoConcurrency } from "./model";

export type LlmLane = "interactive" | "batch";

export interface LlmPoolAddOptions {
  lane?: LlmLane;
  priority?: number;
  signal?: AbortSignal;
}

interface PoolEntry<T = any> {
  lane: LlmLane;
  fn: (signal?: AbortSignal) => Promise<T>;
  signal?: AbortSignal;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
  detachAbort?: () => void;
}

/**
 * 跨 region 共享的 System-2 双车道 LLM 调用池（interactive 优先 + 交互预留 + 即时 AbortSignal 退队）。
 *
 * 设计动机：
 * - 统一进程级池子，所有 region 和在线交互（Copilot/语音受理/回访）共用并发预算。
 * - `interactive` 车道优先级高于 `batch`；当 `concurrency >= 2` 时为交互预留 1 个槽位，
 *   当 `concurrency === 1` 时交互排队插队到所有待处理批处理任务之前，杜绝批处理饿死交互。
 * - 队列中的任务在 `signal` 中止时立即剔除并以标准 `AbortError` 拒绝，绝不占槽位也不再执行回调。
 */
export class LlmPool {
  private _concurrency: number;
  private interactiveQueue: PoolEntry[] = [];
  private batchQueue: PoolEntry[] = [];
  private activeInteractive = 0;
  private activeBatch = 0;

  constructor(options?: { concurrency?: number }) {
    const c = Number(options?.concurrency);
    this._concurrency = Number.isFinite(c) && c >= 1 ? Math.trunc(c) : 1;
  }

  get concurrency(): number {
    return this._concurrency;
  }

  set concurrency(value: number) {
    const next = Number.isFinite(value) && value >= 1 ? Math.trunc(value) : 1;
    const increased = next > this._concurrency;
    this._concurrency = next;
    if (increased) {
      this.drain();
    }
  }

  get size(): number {
    return this.interactiveQueue.length + this.batchQueue.length;
  }

  get pending(): number {
    return this.activeInteractive + this.activeBatch;
  }

  private getMaxBatchConcurrency(): number {
    const reserved = process.env.LLM_POOL_RESERVED_INTERACTIVE === "0" ? 0 : 1;
    if (this._concurrency >= 2 && reserved > 0) {
      return Math.max(1, this._concurrency - reserved);
    }
    return this._concurrency;
  }

  getStats() {
    return {
      concurrency: this._concurrency,
      maxBatchConcurrency: this.getMaxBatchConcurrency(),
      size: this.size,
      pending: this.pending,
      interactiveQueued: this.interactiveQueue.length,
      batchQueued: this.batchQueue.length,
      activeInteractive: this.activeInteractive,
      activeBatch: this.activeBatch,
    };
  }

  run<T>(fn: (signal?: AbortSignal) => Promise<T>, options?: LlmPoolAddOptions): Promise<T> {
    const signal = options?.signal;
    if (signal?.aborted) {
      return Promise.reject(createAbortError(signal));
    }

    const lane: LlmLane =
      options?.lane ?? ((options?.priority ?? 0) > 0 ? "interactive" : "batch");

    return new Promise<T>((resolve, reject) => {
      const entry: PoolEntry<T> = {
        lane,
        fn,
        signal,
        resolve,
        reject,
      };

      const targetQueue = lane === "interactive" ? this.interactiveQueue : this.batchQueue;

      if (signal) {
        const onAbort = () => {
          const idx = targetQueue.indexOf(entry);
          if (idx >= 0) {
            targetQueue.splice(idx, 1);
            entry.detachAbort?.();
            reject(createAbortError(signal));
          }
        };
        signal.addEventListener("abort", onAbort, { once: true });
        entry.detachAbort = () => {
          signal.removeEventListener("abort", onAbort);
          entry.detachAbort = undefined;
        };
      }

      targetQueue.push(entry);
      this.drain();
    });
  }

  add<T>(
    fn: ((ctx: { signal?: AbortSignal }) => Promise<T>) | (() => Promise<T>),
    options?: LlmPoolAddOptions
  ): Promise<T> {
    return this.run(
      (signal) => (fn as (ctx: { signal?: AbortSignal }) => Promise<T>)({ signal }),
      options
    );
  }

  addAll<T>(
    fns: Array<((ctx: { signal?: AbortSignal }) => Promise<T>) | (() => Promise<T>)>,
    options?: LlmPoolAddOptions
  ): Promise<T[]> {
    return Promise.all(fns.map((fn) => this.add(fn, options)));
  }

  clear(): void {
    const queued = [...this.interactiveQueue, ...this.batchQueue];
    this.interactiveQueue.length = 0;
    this.batchQueue.length = 0;
    for (const entry of queued) {
      entry.detachAbort?.();
      const err = new Error("LLM pool cleared");
      err.name = "AbortError";
      entry.reject(err);
    }
  }

  private startEntry(entry: PoolEntry, lane: LlmLane): void {
    entry.detachAbort?.();
    if (entry.signal?.aborted) {
      entry.reject(createAbortError(entry.signal));
      return;
    }

    if (lane === "interactive") {
      this.activeInteractive += 1;
    } else {
      this.activeBatch += 1;
    }

    const finish = () => {
      if (lane === "interactive") {
        this.activeInteractive = Math.max(0, this.activeInteractive - 1);
      } else {
        this.activeBatch = Math.max(0, this.activeBatch - 1);
      }
      this.drain();
    };

    Promise.resolve()
      .then(() => entry.fn(entry.signal))
      .then(
        (val) => {
          finish();
          entry.resolve(val);
        },
        (err) => {
          finish();
          entry.reject(err);
        }
      );
  }

  private drain(): void {
    while (this.activeInteractive + this.activeBatch < this._concurrency) {
      if (this.interactiveQueue.length > 0) {
        const entry = this.interactiveQueue.shift()!;
        this.startEntry(entry, "interactive");
        continue;
      }
      if (this.batchQueue.length > 0 && this.activeBatch < this.getMaxBatchConcurrency()) {
        const entry = this.batchQueue.shift()!;
        this.startEntry(entry, "batch");
        continue;
      }
      break;
    }
  }
}

let _llmPool: LlmPool | null = null;

export function getLlmPool(): LlmPool {
  if (!_llmPool) {
    _llmPool = new LlmPool({ concurrency: systemTwoConcurrency() });
  }
  return _llmPool;
}

export function syncLlmPoolConcurrency(activeHealthyNodeCount: number): number {
  const envOverride = Number(process.env.SYSTEM_TWO_CONCURRENCY);
  const next =
    Number.isFinite(envOverride) && envOverride >= 1
      ? Math.trunc(envOverride)
      : Math.max(1, Math.trunc(activeHealthyNodeCount || 1));
  if (_llmPool && _llmPool.concurrency !== next) {
    _llmPool.concurrency = next;
  }
  return next;
}

export function runInLlmPool<T>(
  lane: LlmLane,
  fn: (signal?: AbortSignal) => Promise<T>,
  signal?: AbortSignal
): Promise<T> {
  return getLlmPool().run(fn, { lane, signal });
}

/**
 * 仅用于测试 / 热重载场景下重置池子。
 * 正常代码不要调用 —— 旧池里正在排队的任务会以 AbortError 退队。
 */
export function _resetLlmPoolForTesting(): void {
  if (_llmPool) {
    _llmPool.clear();
    _llmPool = null;
  }
}
