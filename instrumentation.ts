/**
 * Next.js instrumentation hook.
 * 文档：https://nextjs.org/docs/app/api-reference/file-conventions/instrumentation
 *
 * register() 在 next-server 每次启动时调用一次（dev 模式包括 hot reload）。
 * 我们用它做 cluster worker bootstrap：扫描所有 region，对有未处理工单的
 * region 入队 + 启动 in-process worker。Fire-and-forget，不阻塞 server 启动。
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  // 延迟 import：instrumentation 在 Next.js 启动最早阶段被调用，
  // 此时 @/db/client 等可能还没完全 init。
  const { bootstrapClusterWorkers } = await import("./lib/cluster-bootstrap");
  bootstrapClusterWorkers().catch((err) => {
    console.warn("[instrumentation] cluster bootstrap failed:", err?.message || err);
  });
}
