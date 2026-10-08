/**
 * 自定义 Next.js server：在同一进程内同时跑
 *   1. Next.js HTTP handler（dev / start 都走这里）
 *   2. WebSocket server（路径 /api/ws，处理实时进度推送）
 *
 * 为什么需要自定义 server：
 *   - WS 必须和 updateTaskProgress / SystemTwoEngine.endpointRecentTickets 共享进程内存，
 *     跨进程推不出去。
 *   - Next.js App Router route handler 不直接支持 WebSocket upgrade，
 *     标准做法就是在 HTTP server 层面挂 ws.WebSocketServer({ noServer: true })，
 *     自己处理 'upgrade' 事件并 select path。
 *
 * 启动：
 *   - dev:   tsx server.ts   （next({ dev: true })）
 *   - prod:  next build && tsx server.ts   （next({ dev: false })）
 *
 * 替换：
 *   - package.json: "dev:web": "tsx server.ts", "start": "tsx server.ts"
 */

import { createServer, type IncomingMessage } from "node:http";
import { parse as parseUrl } from "node:url";
import next from "next";
import { WebSocketServer } from "ws";

const dev = process.env.NODE_ENV !== "production";
const port = Number.parseInt(process.env.PORT || "3000", 10);
const hostname = process.env.HOSTNAME || "0.0.0.0";

const app = next({ dev, hostname, port });
const handle = app.getRequestHandler();

const WS_PATH = "/api/ws";

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx < 0) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = decodeURIComponent(v);
  }
  return out;
}

/**
 * 与 middleware.ts 第 53-55 行的策略保持一致：只看 session_token cookie 是否存在。
 * 真正的签名校验留给后续业务层（如果有客户端→服务端消息才需要）。
 * WS 当前只接收 client→server 的 subscribe/keepalive，不需要做精细校验。
 */
function hasSessionCookie(req: IncomingMessage): boolean {
  const cookies = parseCookies(req.headers.cookie);
  return Boolean(
    cookies["better-auth.session_token"] ||
      cookies["__Secure-better-auth.session_token"]
  );
}

app.prepare().then(() => {
  const server = createServer(async (req, res) => {
    try {
      const parsedUrl = parseUrl(req.url || "/", true);
      await handle(req, res, parsedUrl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error("[server] request handler error:", err);
      res.statusCode = 500;
      res.end("internal server error");
    }
  });

  const wss = new WebSocketServer({ noServer: true });

  server.on("upgrade", (req, socket, head) => {
    const url = req.url || "";
    const { pathname, query } = parseUrl(url, true);

    if (pathname !== WS_PATH) {
      // 不是我们的 WS 路径：交给 Next.js 处理 HMR socket 等。
      // next({ dev: true }) 注册的 upgrade 监听器会处理 _next/webpack-hmr。
      return; // 不调用 socket.destroy()，让其他监听器接管
    }

    if (!hasSessionCookie(req)) {
      // 与 middleware.ts /api/* 401 一致：缺 session 直接拒
      socket.write(
        "HTTP/1.1 401 Unauthorized\r\nContent-Type: application/json\r\n\r\n" +
          JSON.stringify({ error: "Unauthorized", code: "UNAUTHORIZED" })
      );
      socket.destroy();
      return;
    }

    const regionId = typeof query.regionId === "string" ? query.regionId : "";
    if (!regionId) {
      socket.write(
        "HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\n\r\n" +
          JSON.stringify({ error: "Missing regionId" })
      );
      socket.destroy();
      return;
    }

    wss.handleUpgrade(req, socket, head, (ws) => {
      // 动态 import 避免 server.ts 在 ws 不可用时被 next dev 拉起时的边界情况
      import("./lib/ws-broadcaster").then((m) => {
        m.registerClient(regionId, ws);
        // eslint-disable-next-line no-console
        console.log(
          `[ws] connected region=${regionId} (total: ${wss.clients.size})`
        );
        ws.on("close", () => {
          // eslint-disable-next-line no-console
          console.log(
            `[ws] disconnected region=${regionId} (total: ${wss.clients.size})`
          );
        });
        ws.on("error", (err) => {
          // eslint-disable-next-line no-console
          console.warn(`[ws] error region=${regionId}:`, err?.message || err);
        });
      });
    });
  });

  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(
      `> Ready on http://${hostname}:${port} (WS at ${WS_PATH}?regionId=X)`
    );
  });
});
