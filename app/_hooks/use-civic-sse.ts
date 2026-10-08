"use client";

/**
 * useCivicSse —— 浏览器侧 SSE 订阅 hook。
 *
 * 用浏览器原生 EventSource（自动重连内置），按 regionId 切换订阅。
 *
 * 跟之前 useCivicWs 的 API 兼容：useCivicSse(regionId, onMessage)，
 * 上层组件只换 import 即可，message 协议（type 字段）不变。
 */

import { useEffect, useRef, useState } from "react";

export type CivicSseMessage =
  | { type: "task-progress"; regionId: string; data: unknown }
  | { type: "pipeline-state-refresh"; regionId: string }
  | { type: "civic-data-refresh"; regionId: string };

export type CivicSseStatus = "connecting" | "open" | "closed" | "error";

type Handler = (msg: CivicSseMessage) => void;

function sseUrl(regionId: string): string {
  return `/api/sse?regionId=${encodeURIComponent(regionId)}`;
}

export function useCivicSse(regionId: string | undefined, onMessage: Handler) {
  const [status, setStatus] = useState<CivicSseStatus>("closed");
  const onMessageRef = useRef(onMessage);
  onMessageRef.current = onMessage;

  useEffect(() => {
    if (!regionId || typeof window === "undefined") {
      setStatus("closed");
      return;
    }

    setStatus("connecting");
    const es = new EventSource(sseUrl(regionId), {
      withCredentials: true,
    });

    es.onopen = () => setStatus("open");
    es.onerror = () => {
      // EventSource 默认会自动重连，这里只更新状态指示
      setStatus("error");
    };
    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as CivicSseMessage;
        onMessageRef.current(data);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.warn("[useCivicSse] parse failed:", err);
      }
    };

    return () => {
      es.close();
      setStatus("closed");
    };
  }, [regionId]);

  return { status };
}
