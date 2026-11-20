import { NextRequest, NextResponse } from "next/server";
import { deleteComputeNode, updateComputeNode } from "@/lib/compute-nodes";

export const dynamic = "force-dynamic";

/**
 * PATCH /api/admin/compute-nodes/[id]
 * 更新算力节点配置或启停状态并热重载 System-2 集群池。
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      role?: string;
      provider?: string;
      endpoint?: string;
      apiKey?: string | null;
      clearApiKey?: boolean;
      model?: string | null;
      enabled?: boolean;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json({ success: false, error: "Invalid request body" }, { status: 400 });
    }

    const updated = await updateComputeNode(id, body);
    if (!updated) {
      return NextResponse.json({ success: false, error: "Compute node not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true, data: updated });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update compute node";
    const status = /无效的 Endpoint|仅支持 http|不能为空/.test(msg) ? 400 : 500;
    return NextResponse.json({ success: false, error: msg }, { status });
  }
}

/**
 * DELETE /api/admin/compute-nodes/[id]
 * 移除动态算力节点并热重载 System-2 集群池。
 */
export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const deleted = await deleteComputeNode(id);
    if (!deleted) {
      return NextResponse.json({ success: false, error: "Compute node not found" }, { status: 404 });
    }
    return NextResponse.json({ success: true, deletedId: id });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to delete compute node";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
