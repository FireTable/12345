# 民声智理 · 系统部署与运维手册 (Deployment & Ops Guide)

> **项目名称**：民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 V2 生产架构)  
> **参赛团队**：赢了就回家吃鱼生  
> **部署形态**：支持 **本地开发环境**、**VPS 云服务器容器化部署** 及 **政务内网纯离线私有化部署**。

---

## 目录
1. [系统部署全景架构](#一系统部署全景架构)
2. [本地极速开发与启动](#二本地极速开发与启动)
3. [VPS 云端 Docker 容器化部署](#三vps-云端-docker-容器化部署)
4. [政务信创/内网纯离线部署 (Ollama / vLLM)](#四政务信创内网纯离线部署-ollama--vllm)
5. [已知避坑指南 (Troubleshooting)](#五已知避坑指南-troubleshooting)
6. [日常运维与健康巡检命令](#六日常运维与健康巡检命令)

---

## 一、系统部署全景架构

```
本地开发 / 演示机                          VPS / 政务云生产环境
===================                       ====================
12345 项目源码                             /opt/12345-stack/
  ↓ rsync                                   ├── Dockerfile         (pnpm@9 + Next.js Standalone)
  + .env.vps                                ├── docker-compose.yml (12345-postgres + 12345-app)
  + db/dumps/*                              ├── .env.vps           (生产环境变量)
                                            └── db/dumps/*         (初始化数据 dump)
                                                  ↓ docker compose --env-file .env.vps up -d
                                            + 12345-postgres       (postgres:16-alpine, named vol)
                                            + 12345-app            (minsheng-zhili:v0.1.0, 监听 :3100)
                                                  ↓ Docker 内部网络 (langgraph-app_default)
                                            langgraph-app-caddy-1  (Caddy 反向代理 :3100 → <your-domain>)
                                            
                                            Cloudflare / SSL Cert  (支持通配符 HTTPS 证书)
```

---

## 二、本地极速开发与启动

### 1. 基础环境要求
- **Node.js**：`>= 20.0.0`
- **包管理器**：`pnpm` (`>= 9.0.0`)
- **数据库**：PostgreSQL 16 (本地已启动)

### 2. 本地一键启动步骤
```bash
# 1. 安装依赖
pnpm install

# 2. 配置本地环境变量
cp .env.example .env.local
# 编辑 .env.local 填入本地 DATABASE_URL、API Key 与 BETTER_AUTH_SECRET

# 3. 一键初始化数据库结构、多租户站点与系统管理员
pnpm db:init        # 一键执行表迁移、顺德/天河双站点、高精行政边界、全套数据字典与管理员账号
# 若仅需单独重置管理员账号: pnpm db:init-admin

# 4. 启动 Next.js 极速热重载开发服务器
pnpm dev
# 浏览器访问: http://localhost:3000 (使用 admin / admin 登录)
```

> 📦 **`pnpm dev` 一键拉起两件套**（[scripts/dev.ts](../scripts/dev.ts) 编排）：
> 1. **System-2 慢思考推理**（[llama-server](https://github.com/ggerganov/llama.cpp) Metal 加速,端口 8132）— 仅当本地模型物料存在时
> 2. **Next.js dev server**（端口 3000）— Web + API + 内嵌 in-process 研判 worker
>
> 研判 worker **不再**有独立 tsx 进程（已删除 `scripts/cluster-worker.ts`），直接跑在 next-server 进程内，详见 [docs/WORKFLOW.md §3.1](../docs/WORKFLOW.md)。Ctrl+C 退出时 SIGTERM 广播给两个子进程，3 秒内兜底 SIGKILL，不会留孤儿。若只想启动前端/API（不跑大模型），用 `pnpm dev:web`（云端 API 灾备模式）。

---

## 三、VPS 云端 Docker 容器化部署

### 1. `.env.vps` 生产环境变量清单
```env
# ---------- 数据库配置 (必须包含 POSTGRES_PASSWORD 用于 docker-compose 变量插值) ----------
POSTGRES_PASSWORD=<生成高强度密码: openssl rand -hex 16>
DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@postgres:5432/ticket_radar

# ---------- Better Auth 生产级认证配置 ----------
BETTER_AUTH_SECRET=<生成32位随机密钥: openssl rand -hex 32>
BETTER_AUTH_URL=https://<your-domain>

# ---------- 默认系统管理员账号 (pnpm db:init-admin 读取) ----------
# 生产环境务必覆盖 ADMIN_PASSWORD 为高强度密码: openssl rand -hex 12
ADMIN_EMAIL=firetable@foxmail.com
ADMIN_USERNAME=admin
ADMIN_PASSWORD=<生成高强度密码: openssl rand -hex 12>

# ---------- 大模型接口配置 (支持 DeepSeek / 本地 vLLM) ----------
OPENAI_API_KEY=sk-***
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash

# ---------- 向量 Embedding (BGE-M3) ----------
EMBEDDING_API_KEY=sk-***
EMBEDDING_BASE_URL=https://api.edgefn.net/v1
EMBEDDING_MODEL=BAAI/bge-m3

# ---------- 重排 Rerank (bge-reranker-v2-m3) ----------
RERANK_API_KEY=sk-***
RERANK_BASE_URL=https://api.edgefn.net/v1
RERANK_MODEL=bge-reranker-v2-m3

# ---------- 运行环境 ----------
NODE_ENV=production
PORT=3100
HOSTNAME=0.0.0.0
```

### 2. 生产发布与更新流水线
```bash
# 1. 本地编译自测通过
pnpm build

# 2. 同步代码至 VPS 服务器
rsync -avz --exclude={node_modules,.next,.git,*.tsbuildinfo,.env.local} \
  ./ root@<VPS_IP>:/opt/12345-stack/

# 3. VPS 上容器构建与热启动
ssh root@<VPS_IP> 'cd /opt/12345-stack && \
  docker compose --env-file .env.vps up -d --build && \
  docker restart langgraph-app-caddy-1'
```

---

## 四、政务信创/内网纯离线部署 (Ollama / vLLM)

本系统原生支持**纯离线、零外部请求**的信创政务内网部署：

1. **大模型本地化 (Ollama / vLLM / llama-server)**：
   - 部署 MiniCPM / Qwen2.5 / Bonsai 2 等开源政务量化模型；
   - 系统内置 `isLocalLlm()` / `isOllamaLlm()` 自动识别并调优 KV Cache 与并发参数。
2. **Apple Silicon Metal 慢思考硬件加速 (System-2 黄金调优)**：
   - 模型物料：`Ternary-Bonsai-2-27B-PTQ1_0.gguf`（三值化 5.5GB 权重）；
   - 启动生产调优服务（端口 8132）：
     ```bash
     cd packages/civic-system-two
     npm run serve
     # 对应底层参数: -m <model.gguf> -np 1 -fa on -ctk q8_0 -ctv q8_0 --port 8132
     ```
   - 吞吐表现：在 M 系列芯片上实现 **20 ~ 24 tokens/s** 稳定高吞吐输出。
3. **数据不出域**：所有快思考决策（ONNX/MPS）、隐私脱敏及慢思考大模型推理全部在本地专网闭环完成，数据 100% 不出域。

---

## 五、已知避坑指南 (Troubleshooting)

| # | 现象 / 报错 | 根本原因 | 标准修复方案 |
|---|---|---|---|
| **1** | `ERR_PNPM_IGNORED_BUILDS` | pnpm 10 移除了部分构建兼容机制 | Dockerfile 中严格锁定 `pnpm@9` |
| **2** | Docker Compose `${VAR}` 插值失效 | Compose 默认只读取 shell，不自动读 `env_file:` 内部变量 | 启动命令必须显式带上 `--env-file .env.vps` |
| **3** | Postgres 容器不断自动重启 | `.env.vps` 中缺少 `POSTGRES_PASSWORD` 导致镜像健康检查失败 | 在 `.env.vps` 显式声明 `POSTGRES_PASSWORD` |
| **4** | 容器重启后 Caddy 报 502 Bad Gateway | Caddy 容器内部 DNS 缓存未刷新 | 容器更新后执行 `docker restart langgraph-app-caddy-1` |
| **5** | 数据库迁移 Module not found | Next.js Standalone 打包产物不包含开发态 `tsx` | 生产环境使用 `pnpm db:import` 或 SQL dump 直灌 |
| **6** | `Ctrl+C` 关 `pnpm dev` 后 `[extract] 1234/96019` 还在终端刷屏 | 老版 `scripts/dev.ts` 200ms 后 `process.exit`，worker 进程在跑 LLM 调用就被孤儿化逃出 dev 生命周期 | `pkill -f tsx` 立即止血；2026-10-08 之后已修：dev.ts 改为 3s 轮询 + SIGKILL 兜底，in-process worker 跟随 next-server 同生死，放弃的 job 由 task_progress 30s 心跳超时回收 |

---

## 六、日常运维与健康巡检命令

```bash
# 1. 查看生产 App 实时日志
ssh root@VPS 'docker logs -f 12345-app'

# 2. 检查 5 大核心业务路由 HTTP 状态
for p in / /tickets /themes /multifreq /dict; do
  curl -kfsS -o /dev/null -w "%{http_code} $p\n" --max-time 15 "https://<your-domain>$p"
done

# 3. 检查数据库实时工单及主题行数
ssh root@VPS 'docker exec 12345-postgres psql -U postgres -d ticket_radar -c "
  SELECT 
    (SELECT count(*) FROM tickets) as tickets_count,
    (SELECT count(*) FROM themes) as themes_count,
    (SELECT count(*) FROM aliases) as aliases_count;
"'

# 4. 手动备份全量数据库
ssh root@VPS 'docker exec 12345-postgres pg_dump -U postgres -d ticket_radar' | gzip > backup-$(date +%F).sql.gz
```
