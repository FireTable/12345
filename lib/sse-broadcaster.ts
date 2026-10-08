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
 */

import { getLatestTaskProgress } from "./task-progress";

type SseController = ReadableStreamDefaultController<Uint8Array>;

type SseMessage =
  | { type: "task-progress"; regionId: string; data: unknown }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

declare global {
  // eslint-disable-next-line no-var
  var __sse_subscribers: Map<string, Set<SseController>> | undefined;
}

const subscribers: Map<string, Set<SseController>> =
  globalThis.__sse_subscribers ?? new Map<string, Set<SseController>>();
globalThis.__sse_subscribers = subscribers;

const encoder = new TextEncoder();

/**
 * 注册一个订阅者。返回取消注册的函数（路由 handler 在 cancel() 里调一次）。
 *
 * 注册后自动推一帧 task-progress 快照，避免新连接要先 HTTP 拉一次再接 SSE。
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
  try {
    void getLatestTaskProgress(regionId).then((tp) => {
      if (tp) {
        try {
          controller.enqueue(
            encoder.encode(
              `data: ${JSON.stringify({
                type: "task-progress",
                regionId,
                data: tp,
              })}\n\n`
            )
          );
        } catch {
          /* 控制器已关闭 */
        }
      }
    });
  } catch {
    /* ignore */
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

/**
 * 推一帧 task-progress 给指定 region 的所有订阅者。
 * 由 updateTaskProgress / finishClusterJob / failClusterJob 等"状态写"侧调用。
 */
export function broadcastTaskProgress(regionId: string, data: unknown): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: SseMessage = { type: "task-progress", regionId, data };
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
}

/**
 * 推一个 "pipeline-state 缓存失效" 信号，pipeline-drawer / pipeline-floating-pill
 * 收到后 refetch /api/workbench/pipeline-state（保留那个接口兜底，但默认不再轮询）。
 */
export function broadcastPipelineRefresh(regionId: string): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: SseMessage = { type: "pipeline-state-refresh", regionId };
  for (const c of set) send(c, msg);
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
}
