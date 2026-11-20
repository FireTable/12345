import { ApiCode, apiError, apiSuccess } from "@/lib/api-codes";
import { listMcpClients, revokeMcpClient } from "@/lib/mcp/clients";
import { requireAdmin } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const clients = await listMcpClients();
  return apiSuccess({ clients });
}

export async function DELETE(request: Request) {
  const auth = await requireAdmin(request);
  if ("response" in auth) return auth.response;

  const body = (await request.json().catch(() => ({}))) as { id?: string };
  const id = String(body.id || "").trim();
  if (!id) return apiError(ApiCode.INVALID_PARAMS, "缺少客户端 id", 400);
  const revoked = await revokeMcpClient(id);
  return apiSuccess({ revoked, id });
}
