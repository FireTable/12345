# 民声智理 · 系统部署与运维手册 (Deployment & Ops Guide)

> **项目名称**：民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 / 双业务域 V2 生产架构)  
> **研发团队**：赢了就回家吃鱼生  
> **部署形态**：支持 **本地开发环境**、**VPS 云服务器双域名同镜像 Docker 部署** 及 **政务内网纯离线私有化部署**。

---

## 目录
1. [系统部署全景架构（双域名同镜像）](#一系统部署全景架构双域名同镜像)
2. [本地极速开发与启动](#二本地极速开发与启动)
3. [VPS 云端双域名 Docker 容器化部署](#三vps-云端双域名-docker-容器化部署)
4. [Caddyfile 流式路由与压缩分流配置](#四caddyfile-流式路由与压缩分流配置)
5. [迁移 `0012_perf_indexes.sql` 与 `VACUUM ANALYZE` 上线步骤](#五迁移-0012_perf_indexessql-与-vacuum-analyze-上线步骤)
6. [政务信创/内网纯离线部署 (Ollama / vLLM / llama-server)](#六政务信创内网纯离线部署-ollama--vllm--llama-server)
7. [已知避坑指南 (Troubleshooting)](#七已知避坑指南-troubleshooting)
8. [日常运维与健康巡检命令](#八日常运维与健康巡检命令)

---

## 一、系统部署全景架构（双域名同镜像）

系统通过运行期环境变量 `APP_DOMAIN` 实现**同镜像双实例双域名物理域隔离**：一份 `ticket-radar:v0.1.7` 生产镜像同时承载政务主站与电商售后独立站，共用后端 PostgreSQL 16 + `pgvector` 实例（按独立 Schema 隔离），前端由共享 Caddy 容器按子域与路径特性分流。

```text
本地开发 / 演示机                          VPS 生产环境 (/opt/12345-stack/)
===================                       =========================================
12345 项目源码                             ├── Dockerfile         (Node 22 + pnpm@9 + Next.js Standalone)
  ↓ rsync                                  ├── docker-compose.yml (12345-postgres + 12345-app + 12345-ecom-app)
  + .env.vps (不入库)                       ├── .env.vps           (生产密钥与外部模型配置)
                                           └── db/migrations/*    (含 0011–0013 性能与审计迁移)
                                                 ↓ docker compose --env-file .env.vps up -d
                                           + 12345-postgres       (pgvector/pgvector:pg16, shm_size: 512m, 内网 :5432)
                                           + 12345-app            (ticket-radar:v0.1.7, APP_DOMAIN=GOV_12345, :3100)
                                           + 12345-ecom-app       (ticket-radar:v0.1.7, APP_DOMAIN=ECOMMERCE_CS, :3100)
                                                 ↓ Docker 外部共享网络 (langgraph-app_default)
                                           langgraph-app-caddy-1  (共享 Caddy 反向代理 + 自动 HTTPS)
                                             ├── https://12345.firetable.tech → 12345-app:3100
                                             │     ├── @streaming (SSE/Copilot/Outreach/MCP) → flush_interval -1 (无压缩)
                                             │     └── 普通路由                              → encode zstd gzip
                                             └── https://ecom.firetable.tech  → 12345-ecom-app:3100
                                                   ├── @streaming (SSE/Copilot/Outreach/MCP) → flush_interval -1 (无压缩)
                                                   └── 普通路由                              → encode zstd gzip
```

### 双实例核心参数对照（与 `docker-compose.yml` 一致）

| 服务名 | 容器名 | 生产镜像 | 绑定域名 | `APP_DOMAIN` | `CIVIC_SKIP_BOOTSTRAP` |
| :--- | :--- | :--- | :--- | :--- | :---: |
| `app` | `12345-app` | `ticket-radar:v0.1.7` | `https://12345.firetable.tech` | `GOV_12345` | `"1"` |
| `ecom-app` | `12345-ecom-app` | `ticket-radar:v0.1.7` | `https://ecom.firetable.tech` | `ECOMMERCE_CS` | `"1"` |

> **为什么生产设置 `CIVIC_SKIP_BOOTSTRAP="1"`**：`instrumentation.ts` 在 Node.js 运行时启动后默认延迟 2 秒自动触发 `/api/internal/cluster-bootstrap` 扫描全库未研判工单。双实例生产环境下将其关闭可避免容器滚动重启时瞬时抢占 LLM/Embedding 算力与数据库连接，按需由新工单入库、MCP 推送或管理员手动触发增量研判。

---

## 二、本地极速开发与启动

### 1. 基础环境要求
- **Node.js**：`>= 20.0.0`（Docker 生产镜像使用 Node 22 Alpine）
- **包管理器**：`pnpm` (`9.x`，与 `Dockerfile` 中 `pnpm@9` 一致)
- **数据库**：PostgreSQL 16 + `pgvector` + `pg_trgm`

### 2. 本地一键启动步骤
```bash
# 1. 安装依赖
pnpm install

# 2. 配置本地环境变量（切勿提交含真实密钥的 .env.local）
cp .env.example .env.local
# 编辑 .env.local：配置 DATABASE_URL、BETTER_AUTH_SECRET、TIANDITU_SERVER_KEY 及模型端点。
# 本地调试多业务域可设 APP_DOMAIN=ALL；单域调试可设 GOV_12345 或 ECOMMERCE_CS。

# 3. 一键初始化数据库结构、多租户站点与系统管理员
pnpm db:init        # 执行表迁移、站点注册、行政边界、标准字典与管理员/市民账号
# 若仅需增量跑迁移: pnpm db:migrate
# 若仅需重置管理员账号: pnpm db:init-admin

# 4. 启动本地开发服务器
pnpm dev
# 浏览器访问: http://localhost:3000
```

> 📦 **`pnpm dev` 一键编排**（[scripts/dev.ts](../scripts/dev.ts)）：
> 1. **System-2 慢思考推理**（`llama-server` Metal 加速，端口 8132）— 仅当本地模型物料存在时自动拉起；
> 2. **Next.js dev server**（端口 3000）— Web + API + 内嵌 in-process 研判 worker。
>
> 研判 worker 运行在 `next-server` 进程内（无独立 tsx 进程），Ctrl+C 退出时 SIGTERM 广播并 3 秒内 SIGKILL 兜底。若只启动前端/API（走云端或远端算力节点），使用 `pnpm dev:web`。

MCP 与页面同源：未带凭证的 `POST /api/mcp` 返回 `401` 并在 `WWW-Authenticate` 中指向 `/.well-known/oauth-protected-resource`，详见 [docs/MCP.md](MCP.md)。

---

## 三、VPS 云端双域名 Docker 容器化部署

> **生产节点参考规格**：
> - **配置**：8 GB 内存 / 100 GB NVMe 固态硬盘 / 25 TB 每月流量配额
> - **Postgres 16 内存与内核调优**：`docker-compose.yml` 已内置 `shm_size: 512m`、`shared_buffers=1GB`、`effective_cache_size=4GB`、`work_mem=32MB`、`maintenance_work_mem=256MB`、`random_page_cost=1.1`、`jit=off`、`max_parallel_workers_per_gather=2`、`checkpoint_completion_target=0.9`（详见 [`docs/DBS.md`](DBS.md) 第五节）。

### 1. `.env.vps` 生产环境变量清单（脱敏模板）
> ⚠️ 严禁将真实 `.env.vps` 提交至 Git 仓库，所有密钥均使用占位符并在 VPS 本机安全注入。

```env
# ---------- 数据库配置 (必须包含 POSTGRES_PASSWORD 用于 docker-compose 变量插值) ----------
POSTGRES_PASSWORD=<使用 openssl rand -hex 16 生成>
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/ticket_radar

# ---------- Better Auth 生产级认证配置 ----------
# 注: docker-compose.yml 已按实例分别覆写 BETTER_AUTH_URL 与 BETTER_AUTH_TRUSTED_ORIGINS
BETTER_AUTH_SECRET=<使用 openssl rand -hex 32 生成>

# ---------- 默认账号初始化 (pnpm db:init-admin 读取，生产务必设高强度密码) ----------
ADMIN_EMAIL=admin@civic.local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<使用 openssl rand -hex 12 生成>
CITIZEN_USERNAME=citizen
CITIZEN_PASSWORD=<使用 openssl rand -hex 12 生成>

# ---------- Agent 安全守卫与限流 ----------
ALLOWED_AGENT_HOSTS=12345.firetable.tech,ecom.firetable.tech
AGENT_RATE_LIMIT_PER_MIN=20

# ---------- System 2 与 Embedding 端点 (可选混合云 Tailscale / Colab，或由 /admin/regions 动态管理) ----------
# SYSTEM_TWO_ENDPOINTS=http://<tailscale-ip>:8132/v1
# EMBEDDING_ENDPOINTS=http://<tailscale-ip>:8133/v1

# ---------- 云端回退与 AI 拓荒 (OpenAI 兼容接口) ----------
OPENAI_API_KEY=<your-openai-compatible-api-key>
OPENAI_BASE_URL=https://api.edgefn.net/v1
OPENAI_MODEL=DeepSeek-V4-Flash-0731

# ---------- 向量 Embedding (BAAI/bge-m3) 与 Rerank ----------
EMBEDDING_API_KEY=<your-embedding-api-key>
EMBEDDING_BASE_URL=https://api.edgefn.net/v1
EMBEDDING_MODEL=BAAI/bge-m3
RERANK_API_KEY=<your-rerank-api-key>
RERANK_BASE_URL=https://api.edgefn.net/v1
RERANK_MODEL=bge-reranker-v2-m3

# ---------- 地图服务 (天地图 CGCS2000，仅服务端读取) ----------
TIANDITU_SERVER_KEY=<your-tianditu-server-key>

# ---------- 前端语音识别 (Stream-ASR) 与 3D 数字人 (Project XiaoChun) ----------
NEXT_PUBLIC_STREAM_ASR_MODEL_URL=https://asr.firetable.tech/model_chunks/model.json
NEXT_PUBLIC_STREAM_ASR_WASM_URL=https://asr.firetable.tech/wasm
NEXT_PUBLIC_XIAOCHUN_EMBED_URL=https://xiaochun.firetable.tech/embed

# ---------- 可选通知通道 (Agent 闭环 Webhook / SMTP) ----------
# AGENT_WEBHOOK_URL=https://hooks.example.com/services/<token>
# SMTP_HOST=smtp.example.com
# SMTP_PORT=465
# SMTP_USER=noreply@example.com
# SMTP_PASS=<your-smtp-password>
# SMTP_FROM="民声智理平台 <noreply@example.com>"
```

### 2. 生产发布与双实例热更新流水线
```bash
# 1. 本地类型检查与构建自测
pnpm exec tsc --noEmit && pnpm build

# 2. 同步代码至 VPS（排除本地依赖、构建产物与密钥文件）
rsync -avz --exclude={node_modules,.next,.git,*.tsbuildinfo,.env.local,.env.vps} \
  ./ root@<VPS_HOST>:/opt/12345-stack/

# 3. VPS 构建新镜像 ticket-radar:v0.1.7 并启动双实例（app 构建镜像，ecom-app 复用同镜像）
ssh root@<VPS_HOST> 'cd /opt/12345-stack && \
  docker compose --env-file .env.vps build app && \
  docker compose --env-file .env.vps up -d postgres app ecom-app && \
  docker exec langgraph-app-caddy-1 caddy reload --config /etc/caddy/Caddyfile'
```

### 3. VPS + 本地 Mac / Colab 混合算力接入模式
除通过 `.env.vps` 挂载静态端点外，系统支持在 `/admin/regions` 的「动态算力节点池」在线纳管与探活 `LOCAL`（Tailscale 内网 Mac `0.0.0.0:8132` / `8133`）、`COLAB`（GPU 隧道节点）与 `CLOUD` 端点：
- 本机便捷控制台：`pnpm civic`（`./scripts/civic-ctl.sh`）或前台拉起双模型 `pnpm dev:models`；
- 本地/Colab 节点在线时优先使用零 Token 成本算力；探活超时或繁忙时在毫秒~2 秒级自动平滑降级至云端 API。

---

## 四、Caddyfile 流式路由与压缩分流配置

系统同时存在 **实时流式端点**（SSE 推送、Copilot Token 流、外呼语音流、MCP Streamable HTTP）与 **高吞吐 JSON/页面路由**。若对流式接口全局启用 gzip/zstd 缓冲压缩，会导致浏览器无法实时收到首字流式输出或 SSE 心跳积压；反之不对普通 API/页面启用压缩又会浪费传输带宽。

因此在共享 Caddy 容器（`langgraph-app-caddy-1`）的 `/etc/caddy/Caddyfile` 中，双域名均采用 **`@streaming` 无压缩直通（`flush_interval -1`）+ 普通路由 `encode zstd gzip` 分流** 策略：

```caddyfile
12345.firetable.tech {
    @streaming {
        path /api/sse* /api/copilot* /api/events* /api/agent/outreach* /api/mcp*
    }
    handle @streaming {
        reverse_proxy 12345-app:3100 {
            flush_interval -1
        }
    }
    handle {
        encode zstd gzip
        reverse_proxy 12345-app:3100
    }
}

ecom.firetable.tech {
    @streaming {
        path /api/sse* /api/copilot* /api/events* /api/agent/outreach* /api/mcp*
    }
    handle @streaming {
        reverse_proxy 12345-ecom-app:3100 {
            flush_interval -1
        }
    }
    handle {
        encode zstd gzip
        reverse_proxy 12345-ecom-app:3100
    }
}
```

配置更新后平滑重载（无需中断在飞连接）：
```bash
ssh root@<VPS_HOST> 'docker exec langgraph-app-caddy-1 caddy validate --config /etc/caddy/Caddyfile && \
  docker exec langgraph-app-caddy-1 caddy reload --config /etc/caddy/Caddyfile'
```

---

## 五、迁移 `0012_perf_indexes.sql` 与 `VACUUM ANALYZE` 上线步骤

`0011_trgm_and_review_indexes.sql` 与 `0012_perf_indexes.sql` 均为幂等 SQL 脚本，可直接在运行中的 `12345-postgres` 上安全执行，无需停机删除数据卷：

```bash
# 1. 确保 0011 与 0012 迁移已幂等落库（支持重复执行，已存在索引与未变化行自动跳过）
ssh root@<VPS_HOST> '
  docker exec -i 12345-postgres psql -U postgres -d ticket_radar -v ON_ERROR_STOP=1 \
    < /opt/12345-stack/db/migrations/0011_trgm_and_review_indexes.sql
  docker exec -i 12345-postgres psql -U postgres -d ticket_radar -v ON_ERROR_STOP=1 \
    < /opt/12345-stack/db/migrations/0012_perf_indexes.sql
'

# 2. 对全部核心存量租户表执行 VACUUM ANALYZE，立即刷亮 Visibility Map 获得纯 Index-Only Scan
ssh root@<VPS_HOST> 'docker exec 12345-postgres psql -U postgres -d ticket_radar -v ON_ERROR_STOP=1 -c "
  VACUUM ANALYZE region_gz_tianhe.tickets;
  VACUUM ANALYZE region_gz_tianhe.themes;
  VACUUM ANALYZE region_fs_shunde.tickets;
  VACUUM ANALYZE region_fs_shunde.themes;
  VACUUM ANALYZE region_ecom_demo.tickets;
  VACUUM ANALYZE region_ecom_demo.themes;
"'

# 3. 验证触发器与关键覆盖/部分索引已生效
ssh root@<VPS_HOST> 'docker exec 12345-postgres psql -U postgres -d ticket_radar -c "
  SELECT schemaname, tablename, indexname
  FROM pg_indexes
  WHERE schemaname IN (\x27region_gz_tianhe\x27, \x27region_fs_shunde\x27, \x27region_ecom_demo\x27)
    AND indexname IN (
      \x27idx_tickets_missing_info_ct\x27,
      \x27idx_tickets_stats_cover\x27,
      \x27idx_tickets_id_subd_status\x27,
      \x27idx_tickets_reopened_updated_at\x27,
      \x27idx_tickets_fake_closure_pending\x27,
      \x27idx_tickets_status_create_time_id_desc\x27
    )
  ORDER BY schemaname, indexname;
"'
```

> 若使用独立迁移镜像阶段，也可按 `Dockerfile` 中的 `migrate` stage 运行 `pnpm db:migrate`。

---

## 六、政务信创/内网纯离线部署 (Ollama / vLLM / llama-server)

本系统原生支持**纯离线、零外部请求**的信创政务内网部署：

1. **大模型本地化 (Ollama / vLLM / llama-server)**：
   - 部署 Qwen / MiniCPM / Bonsai 2 等开源量化模型，均走标准 OpenAI 兼容协议；
   - `packages/civic-system-two` 内置本地节点健康探测、并发控制与思维链剥离。
2. **Apple Silicon Metal 慢思考硬件加速 (System-2)**：
   - 推荐权重：`Ternary-Bonsai-2-27B-PTQ1_0.gguf`（三值化 ~5.5 GB）；
   - 启动服务（端口 `8132`）：`pnpm dev:llm`（底层参数 `-np 1 -fa on -ctk q8_0 -ctv q8_0 --port 8132`），M 系列芯片稳定输出 **20 ~ 24 tokens/s**。
3. **数据不出域**：快思考 ONNX 分类（`@civic/system-one`）、3 层 PII 可逆脱敏防火墙（`@civic/anonymizer`）、向量检索（`pgvector`）与慢思考推理全部可在内网闭环运行。

---

## 七、已知避坑指南 (Troubleshooting)

| # | 现象 / 报错 | 根本原因 | 标准修复方案 |
|---|---|---|---|
| **1** | `ERR_PNPM_IGNORED_BUILDS` | pnpm 10 移除了 `package.json` 中的 `onlyBuiltDependencies` 机制 | `Dockerfile` 严格锁定 `pnpm@9` |
| **2** | Docker Compose `${VAR}` 插值失效 | Compose 默认不读取 `env_file:` 内变量做 YAML 插值 | 启动命令必须显式携带 `--env-file .env.vps` |
| **3** | Postgres 容器循环重启 | `.env.vps` 缺少 `POSTGRES_PASSWORD` 或 `pgdata` 权限异常 | 在 `.env.vps` 显式声明 `POSTGRES_PASSWORD` |
| **4** | 容器重建后 Caddy 报 `502 Bad Gateway` | Caddy 缓存了旧容器 IP | 更新容器后执行 `caddy reload` 或重启 `langgraph-app-caddy-1` |
| **5** | Copilot / SSE 输出整段卡顿后一次性吐出 | Caddy 对流式路由误启用了 `encode zstd gzip` 缓冲 | 确认 `/api/sse* /api/copilot* /api/events* /api/agent/outreach* /api/mcp*` 命中 `@streaming` 且设 `flush_interval -1` |
| **6** | `0012` 后首次聚合仍见较多 `Heap Fetches` | 存量大表刚回填完 `is_missing_info`，Visibility Map 尚未标亮 | 按第五节对各租户 `tickets` 执行 `VACUUM ANALYZE` |
| **7** | 容器启动后立即抢占算力跑历史未研判工单 | `instrumentation.ts` 自动 bootstrap 默认开启 | 生产 `docker-compose.yml` 保持 `CIVIC_SKIP_BOOTSTRAP: "1"` |

---

## 八、日常运维与健康巡检命令

```bash
# 1. 查看政务主站与电商独立站实时日志
ssh root@<VPS_HOST> 'docker logs -f --tail 100 12345-app'
ssh root@<VPS_HOST> 'docker logs -f --tail 100 12345-ecom-app'

# 2. 巡检双域名公开入口与登录页 HTTP 状态
for host in https://12345.firetable.tech https://ecom.firetable.tech; do
  for p in /login /api/public/overview /api/regions /.well-known/oauth-protected-resource; do
    curl -fsS -o /dev/null -w "%{http_code} ${host}${p}\n" --max-time 15 "${host}${p}"
  done
  # 未带 Bearer Token 的 MCP 请求应返回 401
  curl -sS -o /dev/null -w "%{http_code} POST ${host}/api/mcp (expect 401)\n" -X POST "${host}/api/mcp"
done

# 3. 检查三大核心租户实时行数与缺资料计数
ssh root@<VPS_HOST> 'docker exec 12345-postgres psql -U postgres -d ticket_radar -c "
  SELECT \x27region_gz_tianhe\x27 AS tenant, count(*) AS tickets, count(*) FILTER (WHERE is_missing_info) AS missing_info FROM region_gz_tianhe.tickets
  UNION ALL
  SELECT \x27region_fs_shunde\x27, count(*), count(*) FILTER (WHERE is_missing_info) FROM region_fs_shunde.tickets
  UNION ALL
  SELECT \x27region_ecom_demo\x27, count(*), count(*) FILTER (WHERE is_missing_info) FROM region_ecom_demo.tickets;
"'

# 4. 检查 Postgres 关键运行时参数是否生效
ssh root@<VPS_HOST> 'docker exec 12345-postgres psql -U postgres -d ticket_radar -c "
  SHOW shared_buffers; SHOW effective_cache_size; SHOW work_mem; SHOW random_page_cost; SHOW jit;
"'

# 5. 全量逻辑备份
ssh root@<VPS_HOST> 'docker exec 12345-postgres pg_dump -U postgres -d ticket_radar' | gzip > backup-$(date +%F).sql.gz
```
