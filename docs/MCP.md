# 12345 MCP 对接

Agent 只需要站点来源（origin）。本地是 `http://localhost:3000`，生产是对外的 `https://` 域名，不要带路径，也不要写死 IP 以外的第二套地址。发现文档里的端点都由这次请求的 origin 拼出来。

协议是 MCP Streamable HTTP，JSON-RPC 2.0，协议版本 `2025-03-26`。实现在 `lib/mcp/`。人的登录仍是 Better Auth 的用户名和密码。Better Auth 不签发 OAuth 令牌。站点在人登录并同意之后，自己发 access key。

没有令牌就读不到工单正文。

## 1. 发现

对 `{origin}/api/mcp` 发任意 POST。没有 `Authorization: Bearer` 时返回 HTTP 401，正文是 `{"error":"unauthorized"}`，并带：

```http
WWW-Authenticate: Bearer realm="12345", resource_metadata="{origin}/.well-known/oauth-protected-resource"
```

按这个头去拉两份公开元数据。路径里有 `.`，不走登录 cookie。

| 文档 | 地址 | 规范 |
| :--- | :--- | :--- |
| 受保护资源 | `GET {origin}/.well-known/oauth-protected-resource` | RFC 9728 |
| 授权服务器 | `GET {origin}/.well-known/oauth-authorization-server` | RFC 8414 |

资源文档里 `resource` 是 `{origin}/api/mcp`，`authorization_servers` 是 `[origin]`，`bearer_methods_supported` 是 `["header"]`，`scopes_supported` 是 `["mcp"]`。

授权服务器文档：

| 字段 | 值 |
| :--- | :--- |
| `issuer` | `{origin}` |
| `authorization_endpoint` | `{origin}/mcp/authorize` |
| `token_endpoint` | `{origin}/api/mcp/token` |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `["authorization_code"]` |
| `code_challenge_methods_supported` | `["S256"]` |
| `token_endpoint_auth_methods_supported` | `["none"]` |

`next.config.ts` 把这两条 `/.well-known/` 重写到 `app/api/mcp/oauth-protected-resource` 和 `oauth-authorization-server`。中间件对 `/api/mcp`、`/api/mcp/token` 和这两条元数据路由放行，让 401 带上 `WWW-Authenticate`。登录 cookie 的 401 没有这个头，Agent 不要把普通接口的 401 当成发现入口。

## 2. 让人批准，换 access key

授权码加 PKCE S256。令牌端点是公开的，用 `none`，不另发 client secret。

1. 生成 `code_verifier`，再用 S256 得到 `code_challenge`（SHA-256 后做 base64url，无填充）。
2. 让已登录的人打开：

```text
{origin}/mcp/authorize?response_type=code&client_name={客户端名}&redirect_uri={回调}&state={state}&code_challenge={challenge}&code_challenge_method=S256
```

`client_name` 也可以写成 `name`。`redirect_uri` 必须是 `http://` 或 `https://`，换令牌时要逐字相同。`state` 会原样回到回调上。

3. 人点同意。页面 `POST /api/mcp/grant`（要 Better Auth session）。`response_type=code` 时返回一次性 `code`，浏览器再转到 `{redirect_uri}?code=...&state=...`。
4. Agent 向令牌端点换 key。JSON 或表单都可以：

```http
POST {origin}/api/mcp/token
Content-Type: application/json

{
  "grant_type": "authorization_code",
  "code": "civic_code_...",
  "redirect_uri": "https://client.example/callback",
  "code_verifier": "..."
}
```

成功正文：

```json
{ "access_token": "civic_...", "token_type": "Bearer" }
```

授权码 10 分钟内有效，用一次作废。存过 `code_challenge` 时，`code_verifier` 必须对上 S256。对不上、回调不一致、过期或已使用，都是 `400 {"error":"invalid_grant"}`。

令牌前缀是 `civic_`，后面 32 字节随机数的 base64url。库里只存 SHA-256。没有 `expires_in`，一直有效，直到站点管理中心吊销。

未登录时打开 `/mcp/authorize`，中间件会转到 `/login?from=/mcp/authorize`。`from` 只保留路径，查询参数不会跟着走。人先登录，再打开带齐参数的授权链接。

已登录、且没有 `response_type=code` 时，同一页会直接签发 access token，明文只显示一次。这是给人在浏览器里抄 key 用的。远程 Agent 走上面的授权码。

`/api/mcp/grant` 仍要登录。没有 session 时是站点自己的 401，不是发现用的 `WWW-Authenticate`。

## 3. 调用工具

```http
POST {origin}/api/mcp
Authorization: Bearer civic_...
Content-Type: application/json
Accept: application/json, text/event-stream
```

一条 JSON-RPC，一条 JSON 回复。先 `initialize`，再 `tools/list` 或 `tools/call`。

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "example", "version": "0.1.0" }
  }
}
```

`initialize` 的结果里 `serverInfo.name` 是 `12345`，`protocolVersion` 是 `2025-03-26`，`capabilities.tools.listChanged` 是 `false`。`instructions` 写明：先 `list_regions`，再按地区 `push_ticket` 或 `region_overview`，工单一次一条。

| 方法 | 结果 |
| :--- | :--- |
| `initialize` | 协议版本、服务名、工具能力 |
| `ping` | `{}` |
| `tools/list` | 下面三个工具 |
| `tools/call` | `params.name` + `params.arguments` |
| `notifications/*` 且没有 `id` | HTTP 202，空正文 |
| 其他方法 | JSON-RPC `-32601` |

带了令牌再 `GET /api/mcp` 会 405，只允许 POST。令牌无效或已吊销，仍是带 `WWW-Authenticate` 的 401。

工具结果在 `result.content[0].text`，是一段 JSON 字符串。失败时 `result.isError` 为 `true`，HTTP 仍是 200。

### list_regions

无参数。返回已纳管地区的 `id`、`name`、`city`、`province`。后面的 `regionId` 用这里的 `id`，例如 `fs_shunde`。

### push_ticket

向一个地区写入一条工单。走 `buildRecordsFromRows` 和 `insertRecordsBatch`，地区名、城市、省份用作入库画像。

| 参数 | 说明 |
| :--- | :--- |
| `regionId` | 必填，必须是 `list_regions` 里的 id |
| `content` | 正文。和 `title` 至少有一个 |
| `title` | 可选 |
| `ticketNo` | 可选。不传则生成 `MCP-{时间戳}-000001` 这种编号 |
| `subdistrict` | 镇街，可空 |

`tickets` 或 `rows` 数组会被拒绝。一次一条。同一 `ticketNo` 再推一次计入 `duplicateCount`，不覆盖原单。

这次调用只入库。不走 `POST /api/tickets` 的单条抽取，不入队全市重新聚类。新工单要等该地区自己的研判任务才会过 System 1 和 System 2。

成功 JSON：`regionId`、`ticketNo`、`insertedCount`、`duplicateCount`。

### region_overview

| 参数 | 说明 |
| :--- | :--- |
| `regionId` | 必填 |

数字和站点数据总览同一套 `loadOverview`：`ticketCount`、`themeCount`（多频主题数）、`analyzedCount`、`multiFreqCount`、`avgDaily`、`topRegion`、`topCategory`。另加 `highRiskCount`（主题 `risk_level` 为 `HIGH` 或 `高危`）。

大屏页面用的是 `GET /api/cockpit`，那是给人看的一次聚合，不是 MCP 工具。Agent 读总览用 `region_overview`。

## 4. 吊销

站点管理中心是 `/admin/regions`，导航名「站点管理中心」。区块「已接入的 Agent」列出未吊销的客户端：名称、用户姓名、邮箱、用户名。吊销调用 `DELETE /api/admin/mcp-clients`，正文 `{"id":"mcp_..."}`，要登录 session。吊销后原 `civic_` 令牌再调用就是 401。

客户端 id 前缀是 `mcp_`。令牌明文不会再次显示。

## 5. 库表

`public.mcp_clients` 和 `public.mcp_auth_codes` 在第一次签发或校验时 `CREATE TABLE IF NOT EXISTS`，不在 Drizzle migration 里。字段见 [`DBS.md`](DBS.md) 第九节。第二次创建会打 Postgres `42P07` NOTICE，表已在，可以忽略。

## 6. 核对

```bash
npx tsx tests/test-mcp.ts
```

这支会向顺德写入一条工单，编号前缀 `MCP-`，跑完不删除。不要拿它当只读探针。

发现可以先这样看（应是 401，并有 `WWW-Authenticate`）：

```bash
curl -i -X POST http://localhost:3000/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'
```
