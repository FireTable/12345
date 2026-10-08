/**
 * Next.js instrumentation hook.
 * 文档：https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * 关键约束：此文件会被 Next.js 同时给 Node.js 和 Edge 两个 runtime bundle。
 * lib/cluster-bootstrap 链上 lib/vocabulary.ts 用了 Node.js 内置 fs/path，
 * 不能在 Edge runtime 跑。所以本文件只能用 globals（fetch / setTimeout /
 * process.env），绝对不能 import 任何含 fs/path 的模块。
 *
 * 启动时通过 HTTP 调 internal API（Node.js runtime）触发 bootstrap，
 * API route 内部才 import cluster-bootstrap 链。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 延迟 2s 等 next-server 完全监听，再 fire-and-forget 触发 bootstrap。
  // 失败也不阻塞 server 启动 —— user 可手动重试或下次 trigger 自然覆盖。
  setTimeout(() => {
    const port = process.env.PORT || "3000";
    fetch(`http://127.0.0.1:${port}/api/_internal/cluster-bootstrap`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ source: "instrumentation" }),
    }).catch((err: any) => {
      console.warn(
        `[instrumentation] cluster bootstrap trigger failed: ${err?.message || err}`
      );
    });
  }, 2000);
}
