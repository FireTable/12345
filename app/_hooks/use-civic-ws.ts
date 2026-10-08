"use client";

/**
 * useCivicWs —— 浏览器侧 WS 订阅 hook。
 *
 * 行为：
 * - 连接到 ws[s]://<host>/api/ws?regionId=<regionId>
 * - 自动随 regionId 切换重连（useEffect 依赖 regionId）
 * - 自动处理断线重连（指数退避 1s -> 30s）
 * - 注册 message 回调，按 type 分发
 * - 返回 send 方法以便上层发送心跳或客户端事件
 *
 * 服务端 cookie 在浏览器同源下自动随 upgrade 请求带上，
 * 因此无需手动加 credentials。
 */

import { useEffect, useRef, useState } from "react";

export type CivicWsMessage =
  | { type: "task-progress"; regionId: string; data: unknown }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

export type CivicWsStatus = "connecting" | "open" | "closed" | "error";

type Handler = (msg: CivicWsMessage) => void;

function wsUrl(regionId: string): string {
  if (typeof window === "undefined") return "";
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  return `${proto}//${window.location.host}/api/ws?regionId=${encodeURIComponent(regionId)}`;
}

export function useCivicWs(regionId: string | undefined, onMessage: Handler) {
  const [status, setStatus] = useState<CivicWsStatus>("closed");
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUserRef = useRef(false);
  // 用 ref 包 callback 避免 onMessage 引用变化导致 effect 重连
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!regionId) {
      setStatus("closed");
      return;
    }
    closedByUserRef.current = false;
    let attempt = 0;

    const connect = () => {
      if (closedByUserRef.current) return;
      setStatus("connecting");
      let ws: WebSocket;
      try {
        ws = new WebSocket(wsUrl(regionId));
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useCivicWs] WebSocket construct failed:", err);
        scheduleReconnect();
        return;
      }
      wsRef.current = ws;
      ws.onopen = () => {
        attempt = 0;
        setStatus("open");
      };
      ws.onmessage = (ev) => {
        try {
          const data = JSON.parse(ev.data) as CivicWsMessage;
          onMessageRef.current(data);
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn("[useCivicWs] parse message failed:", err);
        }
      };
      ws.onerror = () => {
        setStatus("error");
      };
      ws.onclose = () => {
        setStatus("closed");
        wsRef.current = null;
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUserRef.current) return;
      attempt += 1;
      const delay = Math.min(30_000, 500 * 2 ** Math.min(attempt, 6));
      reconnectTimerRef.current = setTimeout(connect, delay);
    };

    connect();

    return () => {
      closedByUserRef.current = true;
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {
          /* ignore */
        }
        wsRef.current = null;
      }
    };
  }, [regionId]);

  const send = (data: string | object) => {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    try {
      ws.send(typeof data === "string" ? data : JSON.stringify(data));
      return true;
    } catch {
      return false;
    }
  };

  return { status, send };
}
