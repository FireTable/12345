/**
 * 进程内 WS pub-sub：把 next-server 的进度状态变更主动推送给订阅者。
 *
 * 设计要点：
 * - 必须在同一个 next-server 进程里：progressStore / SystemTwoEngine.endpointRecentTickets
 *   都是 process-singleton，跨进程推不出去。
 * - 按 region 分桶：每个 region 一个 Set<WebSocket>，避免跨区泄漏。
 * - 单写多读：updateTaskProgress / finishClusterJob 等"写"侧只调一个 broadcast* 函数，
 *   不直接接触 WebSocket；"读"侧（自定义 server.ts 的 upgrade handler）只调 registerClient。
 * - 进程崩溃时所有连接自然断开，订阅者浏览器 EventSource/WS 会自动重连。
 * - 不做跨进程持久化：重启即丢，与 endpointRecentTickets 的语义一致。
 */

import type { WebSocket } from "ws";
import { getLatestTaskProgress } from "./task-progress";

type WsMessage =
  | { type: "task-progress"; regionId: string; data: unknown }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

const HEARTBEAT_INTERVAL_MS = 25_000;

declare global {
  // eslint-disable-next-line no-var
  var __ws_subscribers: Map<string, Set<WebSocket>> | undefined;
  // eslint-disable-next-line no-var
  var __ws_heartbeat: NodeJS.Timeout | undefined;
}

const subscribers: Map<string, Set<WebSocket>> =
  globalThis.__ws_subscribers ?? new Map<string, Set<WebSocket>>();
globalThis.__ws_subscribers = subscribers;

if (!globalThis.__ws_heartbeat) {
  // 服务端 ping 兜底：检测 zombie 连接（NAT 超时 / 浏览器挂起）。
  // 浏览器侧 next dev / next start 后的 ws 客户端通常会自带 pong，但客户端实现参差，
  // 服务端主动 ping 是更稳的探测手段。
  globalThis.__ws_heartbeat = setInterval(() => {
    for (const set of subscribers.values()) {
      for (const ws of set) {
        if (ws.readyState === 1 /* OPEN */) {
          try {
            // 浏览器 ws 实现一般不响应 application-level ping frame，
            // 但服务端保留它做 zombie 连接探测（pong 超时后会 emit close）。
            ws.ping();
          } catch {
            /* ignore */
          }
        }
      }
    }
  }, HEARTBEAT_INTERVAL_MS);
  // 不阻止进程退出（Next.js dev 模式会频繁重启）
  globalThis.__ws_heartbeat.unref?.();
}

function send(ws: WebSocket, msg: WsMessage): void {
  if (ws.readyState !== 1 /* OPEN */) return;
  try {
    ws.send(JSON.stringify(msg));
  } catch {
    /* 写入失败时由 close 事件统一清理 */
  }
}

/**
 * 注册一个订阅者。返回取消注册的函数（订阅者 close 事件里调一下也成）。
 *
 * 自动发一帧当前 task-progress 快照，避免新连接要先 HTTP 拉一次再接 WS。
 */
export function registerClient(regionId: string, ws: WebSocket): () => void {
  let set = subscribers.get(regionId);
  if (!set) {
    set = new Set();
    subscribers.set(regionId, set);
  }
  set.add(ws);

  // 初始快照：内存里有就直接发，没有就 DB 兜底（拉最新一条）
  try {
    // 直接同步读内存 store（getLatestTaskProgress 是 async），用 fire-and-forget
    void getLatestTaskProgress(regionId).then((tp) => {
      if (tp) send(ws, { type: "task-progress", regionId, data: tp });
    });
  } catch {
    /* ignore */
  }

  const cleanup = () => {
    const cur = subscribers.get(regionId);
    if (!cur) return;
    cur.delete(ws);
    if (cur.size === 0) subscribers.delete(regionId);
  };
  ws.on("close", cleanup);
  ws.on("error", cleanup);
  return cleanup;
}

/**
 * 推一帧 task-progress 给指定 region 的所有订阅者。
 * 由 updateTaskProgress / finishClusterJob / failClusterJob 等"状态写"侧调用。
 */
export function broadcastTaskProgress(regionId: string, data: unknown): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: WsMessage = { type: "task-progress", regionId, data };
  for (const ws of set) send(ws, msg);
}

/**
 * 推一个 "数据变化" 信号给订阅者，触发 cockpit 等页面 refetch 各自的懒数据
 * （overview / trends / clusters / tickets）。比定时轮询更省、更及时。
 */
export function broadcastDataRefresh(regionId: string): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: WsMessage = { type: "civic-data-refresh", regionId };
  for (const ws of set) send(ws, msg);
}

/**
 * 推一个 "pipeline-state 缓存失效" 信号，pipeline-drawer / pipeline-floating-pill
 * 收到后 refetch /api/workbench/pipeline-state（保留那个接口兜底，但默认不再轮询）。
 */
export function broadcastPipelineRefresh(regionId: string): void {
  const set = subscribers.get(regionId);
  if (!set || set.size === 0) return;
  const msg: WsMessage = { type: "pipeline-state-refresh", regionId };
  for (const ws of set) send(ws, msg);
}

/**
 * 测试 / 优雅停机用：清掉所有订阅。
 */
export function _resetWsBroadcasterForTesting(): void {
  for (const set of subscribers.values()) {
    for (const ws of set) {
      try {
        ws.close(1001, "server reset");
      } catch {
        /* ignore */
      }
    }
  }
  subscribers.clear();
}
