import { NextRequest, NextResponse } from "next/server";
import { createComputeNode, listComputeNodesForAdmin } from "@/lib/compute-nodes";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/compute-nodes
 * 返回环境变量只读基础节点与动态挂载算力节点列表（严禁返回明文 apiKey）。
 */
export async function GET() {
  try {
    const data = await listComputeNodesForAdmin();
    return NextResponse.json({ success: true, data });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list compute nodes";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

/**
 * POST /api/admin/compute-nodes
 * 新增动态算力节点（可选立即探活）并热重载 System-2 集群池。
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      role?: string;
      provider?: string;
      endpoint?: string;
      apiKey?: string | null;
      model?: string | null;
      enabled?: boolean;
      probeNow?: boolean;
      probe?: boolean;
    } | null;

    if (!body || typeof body.endpoint !== "string" || !body.endpoint.trim()) {
      return NextResponse.json({ success: false, error: "endpoint is required" }, { status: 400 });
    }
    const name = typeof body.name === "string" && body.name.trim() ? body.name.trim() : "Colab GPU 节点";

    const result = await createComputeNode({
      name,
      role: body.role,
      provider: body.provider,
      endpoint: body.endpoint,
      apiKey: body.apiKey,
      model: body.model,
      enabled: body.enabled,
      probeNow: body.probeNow === true || body.probe === true,
    });

    return NextResponse.json({
      success: true,
      data: result.node,
      ...(result.probe ? { probe: result.probe } : {}),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to create compute node";
    const status = /无效的 Endpoint|仅支持 http|不能为空/.test(msg) ? 400 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}
