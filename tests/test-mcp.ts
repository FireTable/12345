/**
 * MCP 发现、授权、地区、工单写入和总览。
 * 调用已经发出去的处理函数。未授权不能看到工具。写入只插入一条工单。
 */
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { getAllRegions } from "../db/client";
import { auth } from "../lib/auth/config";
import { loadOverview } from "../lib/civic-queries";
import { authorizeMcpClientFromHeaders, listMcpClients, revokeMcpClient } from "../lib/mcp/clients";
import { handleMcpHttp } from "../lib/mcp/http";
import { readTicketByNo } from "../lib/mcp/tools";
import { GET as protectedResource } from "../app/api/mcp/oauth-protected-resource/route";
import { GET as authorizationServer } from "../app/api/mcp/oauth-authorization-server/route";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function writeEvidence(name: string, lines: string[]) {
  const dir = process.env.CIVIC_EVIDENCE_DIR;
  if (!dir) return;
  writeFileSync(path.join(dir, name), `${lines.join("\n")}\n`);
}

const origin = "http://civic.test";

async function mcpCall(token: string | null, method: string, params?: unknown, id: number = 1) {
  const headers = new Headers({ "content-type": "application/json" });
  if (token) headers.set("authorization", `Bearer ${token}`);
  return handleMcpHttp(
    new Request(`${origin}/api/mcp`, {
      method: "POST",
      headers,
      body: JSON.stringify({ jsonrpc: "2.0", id, method, params }),
    })
  );
}

async function toolPayload(token: string, name: string, args: Record<string, unknown>) {
  const response = await mcpCall(token, "tools/call", { name, arguments: args }, 3);
  const body = await response.json();
  const text = body?.result?.content?.[0]?.text;
  return { status: response.status, body, data: text ? JSON.parse(text) : null };
}

async function main() {
  const discovery: string[] = [];
  const unauth = await mcpCall(null, "initialize");
  const www = unauth.headers.get("www-authenticate") || "";
  discovery.push(`initialize_status ${unauth.status}`);
  discovery.push(`www_authenticate ${www}`);
  assert(unauth.status === 401, "没有凭证时 initialize 返回 401");
  const metaMatch = www.match(/resource_metadata="([^"]+)"/);
  assert(Boolean(metaMatch), "WWW-Authenticate 带上 resource_metadata");
  const metaUrl = metaMatch?.[1] || "";
  const metaResponse = await protectedResource(new Request(metaUrl));
  const meta = await metaResponse.json();
  discovery.push(`resource ${meta.resource}`);
  discovery.push(`authorization_servers ${JSON.stringify(meta.authorization_servers)}`);
  assert(meta.resource === `${origin}/api/mcp`, "受保护资源指向本站 MCP");
  assert(
    Array.isArray(meta.authorization_servers) && meta.authorization_servers.includes(origin),
    "受保护资源指出授权服务器"
  );

  const asUrl = `${origin}/.well-known/oauth-authorization-server`;
  const asResponse = await authorizationServer(new Request(asUrl));
  const asMeta = await asResponse.json();
  discovery.push(`authorization_endpoint ${asMeta.authorization_endpoint}`);
  discovery.push(`token_endpoint ${asMeta.token_endpoint}`);
  assert(asMeta.authorization_endpoint === `${origin}/mcp/authorize`, "授权端点在站点上");
  assert(asMeta.token_endpoint === `${origin}/api/mcp/token`, "令牌端点在站点上");
  const hidden = await unauth.text();
  assert(!hidden.includes("push_ticket") && !hidden.includes("ticketNo"), "未授权响应里没有工单工具和工单正文");
  writeEvidence("mcp-discovery.log", discovery);

  const authLog: string[] = [];
  const stamp = Date.now().toString(36);
  const email = `mcp-${stamp}@civic.local`;
  const username = `mcp${stamp}`.slice(0, 32);
  const password = randomBytes(18).toString("base64url");
  await auth.api.signUpEmail({
    body: { email, password, name: "MCP 测试", username },
  });
  const signIn = await auth.api.signInEmail({
    body: { email, password },
    asResponse: true,
  });
  assert(signIn.status === 200, "测试用户可以登录");
  const setCookies: string[] =
    typeof signIn.headers.getSetCookie === "function"
      ? signIn.headers.getSetCookie()
      : [signIn.headers.get("set-cookie") || ""];
  const cookie = setCookies
    .filter(Boolean)
    .map((item: string) => item.split(";")[0])
    .join("; ");
  const sessionHeaders = new Headers({ cookie });
  const session = await auth.api.getSession({ headers: sessionHeaders });
  assert(Boolean(session?.user?.id), "登录会话可以被读到");

  const issued = await authorizeMcpClientFromHeaders(sessionHeaders, `mcp-test-${stamp}`);
  assert(Boolean(issued?.accessToken.startsWith("civic_")), "已登录会话签发 access token");
  authLog.push("PASS authorize");
  const token = issued?.accessToken || "";

  const listed = await mcpCall(token, "tools/list", undefined, 2);
  const listedBody = await listed.json();
  const names = (listedBody?.result?.tools || []).map((tool: { name: string }) => tool.name);
  authLog.push(`tools ${names.join(",")}`);
  assert(listed.status === 200, "带 token 可以 tools/list");
  assert(names.includes("list_regions"), "工具包含地区查询");
  assert(names.includes("push_ticket"), "工具包含工单写入");
  assert(names.includes("region_overview"), "工具包含地区总览");

  const regions = await toolPayload(token, "list_regions", {});
  const dbRegions = (await getAllRegions()).map((region) => region.id).sort();
  const toolRegions = (regions.data || []).map((region: { id: string }) => region.id).sort();
  authLog.push(`regions ${toolRegions.join(",")}`);
  assert(toolRegions.length > 0 && toolRegions.join(",") === dbRegions.join(","), "地区查询返回数据库里的地区 id");

  const ticketNo = `MCP-${stamp}`;
  const pushed = await toolPayload(token, "push_ticket", {
    regionId: "fs_shunde",
    title: "测试路路灯不亮",
    content: "测试路路灯不亮，请安排检修。",
    ticketNo,
  });
  authLog.push(`push inserted ${pushed.data?.insertedCount} ticket ${pushed.data?.ticketNo}`);
  assert(pushed.data?.insertedCount === 1, "只写入一条工单");
  const stored = await readTicketByNo("fs_shunde", ticketNo);
  assert(stored?.ticketNo === ticketNo, "写入的工单能在该地区读到");

  const overview = await toolPayload(token, "region_overview", { regionId: "fs_shunde" });
  const direct = await loadOverview(0, "fs_shunde");
  authLog.push(`overview tickets ${overview.data?.ticketCount} themes ${overview.data?.themeCount}`);
  authLog.push(`direct tickets ${direct.totalWorkorders} themes ${direct.multiFreqClusters}`);
  assert(overview.data?.ticketCount === direct.totalWorkorders, "总览工单数与站点总览一致");
  assert(overview.data?.themeCount === direct.multiFreqClusters, "总览主题数与站点总览一致");

  const clientId = issued?.client.id || "";
  const revoked = await revokeMcpClient(clientId);
  const remaining = await listMcpClients();
  assert(revoked, "吊销成功");
  assert(!remaining.some((client) => client.id === clientId), "吊销后管理列表里不再有这个客户端");
  const rejected = await mcpCall(token, "tools/list", undefined, 4);
  assert(rejected.status === 401, "吊销后的 token 不能再列工具");
  authLog.push("PASS revoke");
  writeEvidence("mcp-auth.log", authLog);

  if (process.exitCode) process.exit(process.exitCode);
  process.exit(0);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exit(1);
});
