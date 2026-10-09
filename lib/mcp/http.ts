import { verifyMcpAccessToken } from "@/lib/mcp/clients";
import { requestOrigin, unauthorizedResponse, MCP_PROTOCOL_VERSION } from "@/lib/mcp/discovery";
import { callMcpTool, MCP_TOOLS } from "@/lib/mcp/tools";

type Rpc = {
  jsonrpc?: string;
  id?: string | number | null;
  method?: string;
  params?: Record<string, unknown>;
};

function rpcResult(id: string | number | null | undefined, result: unknown): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, result });
}

function rpcError(id: string | number | null | undefined, code: number, message: string): Response {
  return Response.json({ jsonrpc: "2.0", id: id ?? null, error: { code, message } });
}

function bearerToken(request: Request): string {
  const header = request.headers.get("authorization") || "";
  if (!header.toLowerCase().startsWith("bearer ")) return "";
  return header.slice(7).trim();
}

/** Streamable HTTP：一条 JSON-RPC，回复一条 JSON。未授权一律 401，并带资源元数据。 */
export async function handleMcpHttp(request: Request): Promise<Response> {
  const origin = requestOrigin(request);
  const token = bearerToken(request);
  if (!token) return unauthorizedResponse(origin);
  const client = await verifyMcpAccessToken(token);
  if (!client) return unauthorizedResponse(origin);

  if (request.method === "GET") {
    return new Response(JSON.stringify({ error: "method not allowed" }), {
      status: 405,
      headers: { Allow: "POST", "Content-Type": "application/json" },
    });
  }

  let body: Rpc;
  try {
    body = (await request.json()) as Rpc;
  } catch {
    return rpcError(null, -32700, "parse error");
  }

  const method = body.method || "";
  if (!body.id && method.startsWith("notifications/")) {
    return new Response(null, { status: 202 });
  }

  if (method === "initialize") {
    return rpcResult(body.id, {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: "12345", version: "1.0.0" },
      instructions: "先 list_regions，再按地区 push_ticket 或 region_overview。工单一次一条。",
    });
  }
  if (method === "ping") return rpcResult(body.id, {});
  if (method === "tools/list") return rpcResult(body.id, { tools: MCP_TOOLS });
  if (method === "tools/call") {
    const params = body.params || {};
    const name = String(params.name || "");
    const args = (params.arguments as Record<string, unknown> | undefined) || {};
    const result = await callMcpTool(name, args);
    return rpcResult(body.id, result);
  }
  return rpcError(body.id, -32601, `method not found: ${method}`);
}
