import { NextRequest, NextResponse } from "next/server";
import { probeAndSaveComputeNode, probeComputeEndpoint } from "@/lib/compute-nodes";
import { requireAdmin } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

/**
 * POST /api/admin/compute-nodes/probe
 * 支持传入 { id } 对已注册节点探活并回写状态，或传入临时 { endpoint, apiKey?, role?, provider? } 做添加前连通性测试。
 */
export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const body = (await req.json().catch(() => null)) as {
      id?: string;
      endpoint?: string;
      apiKey?: string;
      role?: string;
      provider?: string;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }

    if (typeof body.id === "string" && body.id.trim()) {
      const result = await probeAndSaveComputeNode(body.id.trim());
      if (!result) {
        return NextResponse.json({ success: false, error: "Compute node not found" }, { status: 404 });
      }
      return NextResponse.json({
        success: true,
        data: {
          ...result.probe,
          node: result.node,
        },
      });
    }

    if (typeof body.endpoint === "string" && body.endpoint.trim()) {
      const probe = await probeComputeEndpoint({
        endpoint: body.endpoint,
        apiKey: body.apiKey,
        role: body.role,
        provider: body.provider,
      });
      return NextResponse.json({
        success: true,
        data: probe,
      });
    }

    return NextResponse.json(
      { success: false, error: "id or endpoint is required" },
      { status: 400 }
    );
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to probe compute node";
    const status = /无效的 Endpoint|仅支持 http/.test(msg) ? 400 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
