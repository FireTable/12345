# 12345 MCP 对接指南

Agent 只需要目标站点的来源（`origin`）：
- **本地开发**：`http://localhost:3000`
- **政务热线生产站（`APP_DOMAIN=GOV_12345`）**：`https://12345.firetable.tech`
- **电商售后生产站（`APP_DOMAIN=ECOMMERCE_CS`）**：`https://ecom.firetable.tech`

不要在 `origin` 后拼接路径，也不要硬编码第二套后端地址。发现文档里的所有端点均由当次请求的 `origin`（优先读取 `x-forwarded-proto` / `x-forwarded-host`，本地兜底 `BETTER_AUTH_URL`）动态拼出。

协议为 **MCP Streamable HTTP**，JSON-RPC 2.0，协议版本 **`2025-03-26`**，核心实现位于 `lib/mcp/` 与 `app/api/mcp/`。人的登录认证由 Better Auth 负责；Better Auth 本身不签发 OAuth 令牌，站点在已登录用户批准后自主签发 `civic_` access token。没有令牌无法读取或写入任何工单数据。

---

## 1. 业务域隔离（双域名同镜像）

同一套代码通过 `APP_DOMAIN` 环境变量以双实例独立运行（见 `docker-compose.yml`）。`lib/mcp/tools.ts` 中 `list_regions`、`push_ticket`、`region_overview` 全部调用 `filterRegionsByAppDomain()` 强制隔离租户边界：

| 对接域名 (`origin`) | 实例容器 | `APP_DOMAIN` | MCP 可见租户范围 |
| :--- | :--- | :--- | :--- |
| **`https://12345.firetable.tech`** | `12345-app` | `GOV_12345` | 仅政务热线租户（如 `gz_tianhe`、`fs_shunde`） |
| **`https://ecom.firetable.tech`** | `12345-ecom-app` | `ECOMMERCE_CS` | 仅电商售后租户（如 `ecom_demo`） |

> 反向代理层（Caddyfile）已将 `/api/mcp*` 纳入 `@streaming` 路由（`flush_interval -1`，无压缩缓冲），确保 MCP 客户端低延迟稳定通信。

---

## 2. 发现 (RFC 9728 / RFC 8414)

对 `{origin}/api/mcp` 发送任意 `POST`。未携带有效 `Authorization: Bearer` 时返回 HTTP `401`，正文为 `{"error":"unauthorized"}`，并附带发现头：

```http
WWW-Authenticate: Bearer realm="12345", resource_metadata="{origin}/.well-known/oauth-protected-resource"
```

Agent 按此响应头拉取两份公开元数据（均免登录 Cookie）：

| 文档 | 对外路径 | `next.config.ts` Rewrite 目标 | 规范 |
| :--- | :--- | :--- | :--- |
| 受保护资源元数据 | `GET {origin}/.well-known/oauth-protected-resource`（及 `/:path*` 子路径变体） | `/api/mcp/oauth-protected-resource` | RFC 9728 |
| 授权服务器元数据 | `GET {origin}/.well-known/oauth-authorization-server` | `/api/mcp/oauth-authorization-server` | RFC 8414 |

> `next.config.ts` 同时重写了 `/.well-known/oauth-protected-resource` 与 `/.well-known/oauth-protected-resource/:path*`（兼容携带资源路径后缀的 RFC 9728 客户端，如 `/.well-known/oauth-protected-resource/api/mcp`）。`middleware.ts` 对 `/.well-known/*`、`/api/mcp`、`/api/mcp/token`、`/api/mcp/oauth-protected-resource`、`/api/mcp/oauth-authorization-server` 放行，以确保未授权请求返回带 `WWW-Authenticate` 的规范 401。

**受保护资源元数据**返回字段：
- `resource`: `{origin}/api/mcp`
- `authorization_servers`: `[origin]`
- `bearer_methods_supported`: `["header"]`
- `scopes_supported`: `["mcp"]`
- `resource_name`: `"12345"`

**授权服务器元数据**返回字段：

| 字段 | 值 |
| :--- | :--- |
| `issuer` | `{origin}` |
| `authorization_endpoint` | `{origin}/mcp/authorize` |
| `token_endpoint` | `{origin}/api/mcp/token` |
| `response_types_supported` | `["code"]` |
| `grant_types_supported` | `["authorization_code"]` |
| `code_challenge_methods_supported` | `["S256"]` |
| `token_endpoint_auth_methods_supported` | `["none"]` |

---

## 3. 人工批准与换取 Access Key (OAuth 2.0 + PKCE S256)

令牌端点为公开客户端模式（`token_endpoint_auth_methods_supported: ["none"]`），无需 `client_secret`，采用授权码 + PKCE S256：

1. 生成 `code_verifier`，计算 `code_challenge = base64url(SHA-256(code_verifier))`（无 `=` 填充）。
2. 引导已登录用户在浏览器打开：

```text
{origin}/mcp/authorize?response_type=code&client_name={客户端名}&redirect_uri={回调地址}&state={state}&code_challenge={challenge}&code_challenge_method=S256
```

`client_name` 也兼容参数名 `name`。`redirect_uri` 必须为 `http://` 或 `https://` 且换票时逐字一致；`state` 原样回传。

3. 用户点击同意后，前端调用 `POST /api/mcp/grant`（校验 Better Auth session），签发一次性授权码 `civic_code_...` 并跳转至 `{redirect_uri}?code=...&state=...`。
4. Agent 向令牌端点换取 access token（支持 `application/json` 或表单提交）：

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

成功响应：

```json
{ "access_token": "civic_...", "token_type": "Bearer" }
```

- 授权码有效期 **10 分钟**，一次性消费；校验失败、回调不一致、过期或重放均返回 `400 {"error":"invalid_grant"}`。
- Access token 前缀 `civic_`，后接 32 字节随机数 base64url；数据库 `public.mcp_clients` 仅存 SHA-256 哈希，永不落盘明文；不设自动过期时间，持续有效直至在管理后台吊销。
- 未登录打开 `/mcp/authorize` 会由 `middleware.ts` 重定向至 `/login?from=/mcp/authorize`（`from` 仅保留路径不含查询串），请先登录后再访问完整授权链接。
- 已登录且未传 `response_type=code` 时，`/mcp/authorize` 可直接签发并一次性展示 `civic_` 明文令牌，便于人工复制调试。

---

## 4. 调用 MCP 工具

```http
POST {origin}/api/mcp
Authorization: Bearer civic_...
Content-Type: application/json
Accept: application/json, text/event-stream
```

每次 `POST` 携带一条 JSON-RPC 2.0 请求，返回一条 JSON 响应。建议先 `initialize`，再调用 `tools/list` 或 `tools/call`：

```json
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "initialize",
  "params": {
    "protocolVersion": "2025-03-26",
    "capabilities": {},
    "clientInfo": { "name": "example-agent", "version": "0.1.0" }
  }
}
```

| JSON-RPC Method | 返回行为 |
| :--- | :--- |
| `initialize` | 返回 `protocolVersion: "2025-03-26"`、`serverInfo: { name: "12345", version: "1.0.0" }`、`capabilities: { tools: { listChanged: false } }` 及调用说明 |
| `ping` | `{}` |
| `tools/list` | 返回 3 个工具定义 |
| `tools/call` | 按 `params.name` 与 `params.arguments` 执行工具 |
| `notifications/*`（无 `id`） | HTTP `202` 空正文 |
| 其他方法 | JSON-RPC 错误码 `-32601` |

带有效令牌访问 `GET /api/mcp` 返回 HTTP `405`（`Allow: POST`）；令牌无效或已吊销返回带 `WWW-Authenticate` 的 `401`。工具结果封装在 `result.content[0].text`（JSON 字符串），业务失败时 `result.isError = true` 且 HTTP 状态码为 `200`。

### 工具 1：`list_regions`
无参数。返回当前 `APP_DOMAIN` 允许访问的站点列表，每项包含 `id`、`name`、`city`、`province`。

### 工具 2：`push_ticket`
向指定站点写入**单条**工单（拒绝 `tickets` / `rows` 数组批量传入）。走 `buildRecordsFromRows` 与 `insertRecordsBatch`，以站点名称/城市/省份补全入库画像，来源通道记为 `"MCP"`。

| 参数 | 必填 | 说明 |
| :--- | :---: | :--- |
| `regionId` | 是 | 必须是当前域名 `list_regions` 返回的 `id` |
| `content` | 是（与 `title` 至少其一） | 工单正文 |
| `title` | 否 | 工单短标题 |
| `ticketNo` | 否 | 业务单号；不传自动生成 `MCP-{时间戳}-000001`；重复单号计入 `duplicateCount` 不覆盖原单 |
| `subdistrict` | 否 | 镇街名（政务域）或渠道/仓网名（电商域） |

入库成功（`insertedCount > 0`）后自动触发该站点的异步增量研判（`triggerClusterJobAuto`）：
- 经 System 1 快分类与 System 2 脱敏抽取后，与已有主题（含已办结复发主题）进行增量归并；
- 命中已有主题时毫秒级并入并更新件数、时间跨度与复发/假闭环标识；
- 未命中已有主题时，与近期历史落单工单跨批次联合计算（`incidentsMatch` 或 `BAAI/bge-m3` 余弦 ≥ 默认 `0.85` + 空间/主体约束），满 2 件自适应生成全新 Theme 与处置预案；
- 绝不删除已有历史主题。

返回 JSON：`{ "regionId", "ticketNo", "insertedCount", "duplicateCount" }`。

### 工具 3：`region_overview`
| 参数 | 必填 | 说明 |
| :--- | :---: | :--- |
| `regionId` | 是 | 必须在当前 `APP_DOMAIN` 允许范围内 |

复用与站点数据总览相同的 `loadOverview(0, regionId)`，返回 `regionId`、`ticketCount`、`themeCount`、`analyzedCount`、`multiFreqCount`、`avgDaily`、`topRegion`、`topCategory`，并附带 `highRiskCount`（`risk_level` 为 `HIGH` 或 `高危` 的主题数）。

---

## 5. 客户端管理与吊销

在「站点管理中心」（`/admin/regions`）的「已接入的 Agent」区块可查看当前有效客户端（名称、授权人、邮箱、最近使用时间）。吊销调用 `DELETE /api/admin/mcp-clients`（正文 `{"id":"mcp_..."}`，需管理员登录 session），吊销后原 `civic_` 令牌立即失效并返回 `401`。

---

## 6. 数据库表与核对脚本

- 表结构：`public.mcp_clients` 与 `public.mcp_auth_codes` 在首次签发或校验时由 `lib/mcp/clients.ts` 幂等建表，字段字典见 [`DBS.md`](DBS.md) 第 12 节。
- 端到端测试脚本：

```bash
# 注意：会向顺德写入一条 MCP- 前缀工单且跑完不删除，勿作为只读探针
npx tsx tests/test-mcp.ts

# 只读发现验证（应返回 HTTP 401 并携带 WWW-Authenticate 头）
curl -i -X POST https://12345.firetable.tech/api/mcp \
  -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'

# 检查 RFC 9728 路径变体 rewrite（应返回 HTTP 200 JSON）
curl -fsS https://12345.firetable.tech/.well-known/oauth-protected-resource/api/mcp
```
