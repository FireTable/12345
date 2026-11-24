/**
 * SSE 端点：GET /api/sse?regionId=<id>
 *
 * 返回 text/event-stream，把 region 维度的实时状态（task-progress / data-refresh / pipeline-refresh）
 * 推送给订阅者。浏览器侧用 EventSource（自动重连内置）。
 *
 * 鉴权：通过 getRequestSession(req) 验证真实 Better Auth 会话，并按 session.user.role
 * 分流订阅（admin 可接收 task-progress 与 pipeline-state-refresh，普通 user 仅接收非敏感刷新信号）。
 *
 * keep-alive：每 25s 推一行 ": heartbeat <ts>\n\n"（SSE 注释帧，浏览器忽略，
 * 反向代理 / 浏览器侧 EventSource 据此保持连接不被超时回收）。
 */

import type { NextRequest } from "next/server";
import { getRequestSession } from "@/lib/auth/rbac";
import { getAllRegions } from "@/db/client";
import { isRegionAllowedInAppDomain } from "@/lib/domain-profile";
import { registerController } from "@/lib/sse-broadcaster";

export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // ReadableStream + TextEncoder 都是 node 原生

const HEARTBEAT_INTERVAL_MS = 25_000;
const REGION_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;
const encoder = new TextEncoder();

export async function GET(req: NextRequest) {
  const session = await getRequestSession(req);
  if (!session) {
    return new Response(
      JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" }),
      {
        status: 401,
        headers: { "Content-Type": "application/json" },
      }
    );
  }

  const { searchParams } = new URL(req.url);
  const rawRegionId = searchParams.get("regionId")?.trim() || "";
  if (!rawRegionId) {
    return new Response("Missing regionId", { status: 400 });
  }
  if (!REGION_ID_RE.test(rawRegionId)) {
    return new Response("Invalid regionId", { status: 400 });
  }

  const normalized =
    rawRegionId === "shunde"
      ? "fs_shunde"
      : rawRegionId === "haizhu"
        ? "gz_haizhu"
        : rawRegionId;

  const allRegions = await getAllRegions();
  const matched =
    allRegions.find((r) => r.id === normalized) ||
    allRegions.find((r) => r.id.endsWith(`_${normalized}`));
  if (!matched || !isRegionAllowedInAppDomain(matched)) {
    return new Response("Region not found", { status: 404 });
  }
  const resolvedRegionId = matched.id;

  let closed = false;
  let cleanup: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;

  const teardown = () => {
    if (closed) return;
    closed = true;
    req.signal.removeEventListener("abort", teardown);
    if (heartbeat) {
      clearInterval(heartbeat);
      heartbeat = null;
    }
    if (cleanup) {
      cleanup();
      cleanup = null;
    }
    if (streamController) {
      try {
        streamController.close();
      } catch {
        /* ignore */
      }
      streamController = null;
    }
  };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
      if (req.signal.aborted) {
        teardown();
        return;
      }

      req.signal.addEventListener("abort", teardown, { once: true });

      // 1. 按已认证用户角色及 userId 注册订阅者
      cleanup = registerController(resolvedRegionId, controller, session.user.role, session.user.id);

      // 2. 立即推一行注释让客户端 EventSource 立刻确认连接建立
      try {
        controller.enqueue(encoder.encode(`: connected ${Date.now()}\n\n`));
      } catch {
        teardown();
        return;
      }

      // 3. 心跳 keep-alive
      heartbeat = setInterval(() => {
        if (closed) return;
        try {
          controller.enqueue(
            encoder.encode(`: heartbeat ${Date.now()}\n\n`)
          );
        } catch {
          teardown();
        }
      }, HEARTBEAT_INTERVAL_MS);
      heartbeat.unref?.();
    },
    cancel() {
      // 浏览器 / EventSource 关闭 / 反向代理断开时触发
      teardown();
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
