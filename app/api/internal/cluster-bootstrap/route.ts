/**
 * 内部端点：next-server 启动后被 instrumentation.ts 通过 HTTP 调一次，
 * 扫描所有 region，对有未处理工单的 region 入队 + 启 in-process worker。
 *
 * Server-only API route（默认 Node.js runtime），不参与 Edge bundle。
 * 这里才能 import 包含 fs/path 的 cluster-bootstrap 链。
 */
import { NextRequest } from "next/server";
import { bootstrapClusterWorkers } from "@/lib/cluster-bootstrap";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

export async function POST(_req: NextRequest) {
  try {
    const result = await bootstrapClusterWorkers();
    return apiSuccess(result);
  } catch (err: any) {
    console.warn("[api/_internal/cluster-bootstrap] failed:", err?.message || err);
    return apiError(
      ApiCode.TASK_EXECUTION_FAILED,
      err?.message || String(err),
      500
    );
  }
}
