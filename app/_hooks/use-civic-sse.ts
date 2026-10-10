"use client";

/**
 * useCivicSse —— 浏览器侧 SSE 订阅 hook。
 *
 * 架构（共享单连接）：
 *   - 模块级单例 EventSource，跨所有 useCivicSse 调用共享。
 *   - 每个调用注册自己的 subscriber callback 到 Map<id, Set<Handler>>。
 *   - 第一调用：创建 EventSource，连接到 activeRegion 的 SSE 端点。
 *   - 后继调用：复用同一 EventSource。
 *   - regionId 切换：关闭旧连接，开新连接。
 *   - 最后一个 subscriber 卸载：关闭 EventSource（下次再开）。
 *
 * 替代之前"每个组件各自 new EventSource"的方案：原方案每个 useCivicSse
 * 都开一个独立的 SSE 连接（浏览器 EventStream 标签里能看到 3~4 个），
 * 浪费 HTTP/1.1 并发槽（虽然 6 个之内无影响）和服务端 controller 资源。
 *
 * 跟服务端协议保持不变：每帧 payload 还是 { taskProgress, metrics } / etc.
 */

import { useEffect, useRef } from "react";

export type CivicSseMetrics = {
  totalTickets: number;
  analyzedTickets: number;
  unprocessedTickets: number;
  urgentTickets: number;
  stabilityRiskTickets: number;
  totalThemes: number;
  highRiskThemes: number;
};

export type CivicSseMessage =
  | {
      type: "task-progress";
      regionId: string;
      taskProgress: unknown;
      metrics: CivicSseMetrics | null;
    }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

export type CivicSseStatus = "connecting" | "open" | "closed" | "error";

type Handler = (msg: CivicSseMessage) => void;

// ---------- 模块级单例状态 ----------
let sharedEs: EventSource | null = null;
let sharedRegionId: string | null = null;
let sharedRefCount = 0;
const subscribers = new Map<string, Set<Handler>>();
let subSeq = 0;

function broadcast(msg: CivicSseMessage): void {
  for (const set of subscribers.values()) {
    for (const cb of set) {
      try {
        cb(msg);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useCivicSse] subscriber threw:", err);
      }
    }
  }
}

function teardown(): void {
  if (sharedEs) {
    try {
      sharedEs.close();
    } catch {
      /* ignore */
    }
    sharedEs = null;
    sharedRegionId = null;
  }
}

function ensureSharedEs(regionId: string): void {
  // 已有连接到同一 region 且 readyState 不是 CLOSED，复用
  if (
    sharedEs &&
    sharedRegionId === regionId &&
    sharedEs.readyState !== EventSource.CLOSED
  ) {
    return;
  }
  // 切换 region 或旧连接死了，关旧的
  if (sharedEs) {
    try {
      sharedEs.close();
    } catch {
      /* ignore */
    }
    sharedEs = null;
    sharedRegionId = null;
  }

  const url = `/api/sse?regionId=${encodeURIComponent(regionId)}`;
  const es = new EventSource(url, { withCredentials: true });
  sharedEs = es;
  sharedRegionId = regionId;

  // 任何状态变化都广播一遍，便于 subscriber 判断状态。
  // 但 EventSource 没暴露 onopen/onerror 给别处订阅的简单 API，
  // 所以这里只处理 message；状态由各组件自己根据 taskProgress 是否更新推断。
  es.onmessage = (ev) => {
    try {
      const msg = JSON.parse(ev.data) as CivicSseMessage;
      broadcast(msg);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn("[useCivicSse] parse failed:", err);
    }
  };
  es.onerror = () => {
    // 浏览器 EventSource 自动重连，不需要手动重建
  };
}

// ---------- hook ----------
export function useCivicSse(regionId: string | undefined, onMessage: Handler): void {
  // 用 ref 包 callback 避免 onMessage 引用变化导致 subscriber Map 抖动
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  // 每次 hook 调用分配唯一 subId，effect cleanup 时精确反注册
  const subIdRef = useRef<string>("");
  if (!subIdRef.current) subIdRef.current = `sse-sub-${++subSeq}`;

  useEffect(() => {
    if (!regionId || typeof window === "undefined") return;

    sharedRefCount++;
    ensureSharedEs(regionId);

    const subId = subIdRef.current;
    if (!subscribers.has(subId)) subscribers.set(subId, new Set());
    subscribers.get(subId)!.add(onMessageRef.current);

    return () => {
      // 注销当前 callback
      const set = subscribers.get(subId);
      if (set) {
        set.delete(onMessageRef.current);
        if (set.size === 0) subscribers.delete(subId);
      }
      sharedRefCount = Math.max(0, sharedRefCount - 1);
      // 没有任何 subscriber 时关掉 ES，节省服务端 controller 资源
      if (sharedRefCount === 0) {
        teardown();
      }
    };
  }, [regionId]);
}

// ---------- 测试 / 调试 ----------
export function _resetSseSharedForTesting(): void {
  teardown();
  subscribers.clear();
  sharedRefCount = 0;
}

export function _getSseSharedState(): {
  connected: boolean;
  regionId: string | null;
  subscriberCount: number;
} {
  return {
    connected: sharedEs?.readyState === EventSource.OPEN,
    regionId: sharedRegionId,
    subscriberCount: Array.from(subscribers.values()).reduce((n, s) => n + s.size, 0),
  };
}
