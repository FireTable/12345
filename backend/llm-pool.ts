import PQueue from "p-queue";
import { systemTwoConcurrency } from "./model";

/**
 * 跨 region 共享的 System-2 LLM 调用池。
 *
 * 设计动机：
 * - extract-node 与 summary-node 原本各自 new PQueue(concurrency=systemTwoConcurrency())
 *   → 跑 N 个 region 时总并发 = N × endpoint 数，远超 llama-server / vLLM 的吞吐上限
 *   → 出现"两个 region 互相抢 LLM、被 endpoint 拒/排队"的资源争抢
 * - 现在统一用这一个进程级 PQueue，所有 region 的所有 LLM 调用都走这里排队
 *   → 总并发上限 = endpoint 数（systemTwoConcurrency 反映真实吞吐）
 *   → 一个 region 占满时其它 region 排队等，不会超载
 *
 * 进程级单例：每个 Node.js 进程一个池。in-process worker 与 standalone cluster-worker
 * 各自一个池（跨进程不共享），但每个池内部所有 region 共享。
 */
let _llmPool: PQueue | null = null;

export function getLlmPool(): PQueue {
  if (!_llmPool) {
    _llmPool = new PQueue({ concurrency: systemTwoConcurrency() });
  }
  return _llmPool;
}

/**
 * 仅用于测试 / 热重载场景下重置池子。
 * 正常代码不要调用 —— 旧池里正在排队的任务会卡死。
 */
export function _resetLlmPoolForTesting(): void {
  if (_llmPool) {
    _llmPool.clear();
    _llmPool = null;
  }
}
