/**
 * SSE 端点：GET /api/sse?regionId=<id>
 *
 * 返回 text/event-stream，把 region 维度的实时状态（task-progress / data-refresh / pipeline-refresh）
 * 推送给订阅者。浏览器侧用 EventSource（自动重连内置）。
 *
 * 鉴权：与 middleware.ts /api/* 401 策略一致 —— 看 better-auth.session_token cookie 是否存在。
 * SSE 没有普通 route handler 的简单 401 路径：直接关流即可，浏览器 EventSource 会看到
 * readyState != OPEN，自动重连（重连时还会带 cookie，登录态保持）。
 *
 * keep-alive：每 25s 推一行 ": heartbeat <ts>\n\n"（SSE 注释帧，浏览器忽略，
 * 反向代理 / 浏览器侧 EventSource 据此保持连接不被超时回收）。
 */

import type { NextRequest } from "next/server";
import { registerController } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ReadableStream + TextEncoder 都是 node 原生

const HEARTBEAT_INTERVAL_MS = 25_000;
const encoder = new TextEncoder();

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const regionId = searchParams.get("regionId");
  if (!regionId) {
    return new Response("Missing regionId", { status: 400 });
  }

  // Auth: 看 cookie 是否存在。真正的签名校验由业务层在订阅事件时按需做。
  const cookies = req.cookies;
  const sessionToken =
    cookies.get("better-auth.session_token")?.value ||
    cookies.get("__Secure-better-auth.session_token")?.value;
  if (!sessionToken) {
    return new Response("Unauthorized", {
      status: 401,
      headers: { "Content-Type": "text/plain" },
    });
  }

  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // 1. 注册订阅者
      cleanup = registerController(regionId, controller);

      // 2. 立即推一行注释让客户端 EventSource 立刻确认连接建立
      try {
        controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
      } catch {
        /* ignore */
      }

      // 3. 心跳 keep-alive
      heartbeat = setInterval(() => {
        try {
          controller.enqueue(
            encoder.encode(`: heartbeat ${Date.now()}\n\n`)
          );
        } catch {
          if (heartbeat) clearInterval(heartbeat);
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
    },
    cancel() {
      // 浏览器 / EventSource 关闭 / 反向代理断开时触发
      if (cleanup) cleanup();
      if (heartbeat) {
        clearInterval(heartbeat);
        heartbeat = null;
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // 关掉 Next.js 默认的 fetch 缓存
      "X-Accel-Buffering": "no",
    },
  });
}
