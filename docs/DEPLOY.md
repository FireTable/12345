# 12345 工单平台 - VPS 部署文档

完整部署路径在 `~/.openclaw/workspace/skills/12345-maintain/SKILL.md`。

## 架构速览

```
本地开发机                            VPS (生产)
===========                           =========
12345 项目源码                       /opt/12345-stack/
  ↓ rsync                             ├── Dockerfile         (pnpm@9 + standalone output)
  + db/dumps/*                        ├── docker-compose.yml  (postgres + app, no caddy)
  + .env.vps                          ├── .env.vps           (POSTGRES_PASSWORD + API keys)
                                      └── db/dumps/*         (初始数据)
                                            ↓ docker compose --env-file .env.vps up -d
                                      + 12345-postgres       (postgres:16-alpine, named vol)
                                      + 12345-app            (minsheng-zhili:v0.1.0, 监听 :3100 容器内)
                                            ↓ 网络 langgraph-app_default (caddy 也在)
                                      langgraph-app-caddy-1  (复用现有 caddy, 反代 :3100 → 12345.firetable.tech)

                                      Cloudflare Origin Cert (复用 *.firetable.tech wildcard)
```

## 首次部署

详见 SKILL.md 的 "完整首次部署流程"。

## .env.vps 必填字段

```
POSTGRES_PASSWORD=*** (openssl rand -hex 16)
DATABASE_URL=postgresql://postgres:<上面那个密码>@postgres:5432/ticket_radar
OPENAI_API_KEY=*** (DeepSeek)
OPENAI_BASE_URL=https://api.deepseek.com
OPENAI_MODEL=deepseek-v4-flash
EMBEDDING_API_KEY=*** (Baishanyun/edgefn)
EMBEDDING_BASE_URL=https://api.edgefn.net/v1
EMBEDDING_MODEL=BAAI/bge-m3
RERANK_API_KEY=*** (Baishanyun/edgefn, 同 embed key)
RERANK_BASE_URL=https://api.edgefn.net/v1
RERANK_MODEL=bge-reranker-v2-m3
```

模板看 `.env.example` (cp 出来改个名就行)。

## 已知踩坑 (改任何东西前必读)

| # | 坑 | 原因 | 修法 |
|---|---|---|---|
| 1 | `ERR_PNPM_IGNORED_BUILDS` build 挂 | pnpm 10 把 `onlyBuiltDependencies` 从 package.json 移走 | Dockerfile pin `pnpm@9` |
| 2 | approval 永远不写 lockfile | `--frozen-lockfile` 禁止改 lockfile | 去掉 `--frozen-lockfile`, 用 `--reporter=silent` |
| 3 | compose `${VAR}` 插值失败 | compose 只读 shell / `.env`, 不读 `env_file:` | 用 `--env-file .env.vps` 启动 |
| 4 | postgres 容器不停 restart | `.env.vps` 没 `POSTGRES_PASSWORD` (env_file 不参与插值) | `.env.vps` 必须含 POSTGRES_PASSWORD |
| 5 | migrate image 报 module not found | Next.js standalone output 不含 tsx | **不走 migrate image**, 用本地 dump SQL 直灌 |
| 6 | 502 + caddy 解析失败 | compose service 名 `app` 跟 langgraph-app 的 `app` DNS 冲突 | 我们的 service 名 `ticket-radar-app` |
| 7 | caddy 占 :80/:443 | 跟现有 `langgraph-app-caddy-1` 抢端口 | 删 compose 里的 caddy service, 复用现有 caddy |
| 8 | restart 后 502 | caddy 容器 DNS cache 没刷 | 任何容器 restart 后必须 `docker restart langgraph-app-caddy-1` |

## 日常维护

| 操作 | 命令 |
|---|---|
| 看 app 日志 | `ssh root@VPS 'docker logs -f 12345-app'` |
| 重启 app | `ssh root@VPS 'cd /opt/12345-stack && docker compose --env-file .env.vps restart ticket-radar-app && docker restart langgraph-app-caddy-1'` |
| 改 .env.vps 后生效 | `ssh root@VPS 'cd /opt/12345-stack && docker compose --env-file .env.vps up -d'` |
| 改 Dockerfile 后生效 | rsync → 重新 `docker buildx build` → `docker compose up -d` |
| DB 行数 | `ssh root@VPS 'docker exec 12345-postgres psql -U postgres -d ticket_radar -c "SELECT count(*) FROM tickets;"'` |
| 4 端点验证 | `for p in / /tickets /themes /dict; do curl -kfsS -o /dev/null -w "%{http_code} $p\n" --max-time 15 "https://12345.firetable.tech$p"; done` |

## 更新代码后

```bash
# 从项目根目录执行
cd <项目根目录>

# 1. 本地 build 自测
pnpm build

# 2. rsync 到 VPS
rsync -avz --exclude={node_modules,.next,.git,*.tsbuildinfo,.env.local,db/dumps} \
  ./ root@<VPS_IP>:/opt/12345-stack/

# 3. VPS 重新 build + 重启
ssh root@VPS 'cd /opt/12345-stack && \
  docker buildx build --platform linux/amd64 -t minsheng-zhili:v1.0.1 --load . && \
  docker compose --env-file .env.vps up -d && \
  docker restart langgraph-app-caddy-1'
```

## 备份

- DB 自动备份: 未配置 (建议加 langgraph-app 风格的 backup cron)
- 手动 dump: `ssh root@VPS 'docker exec 12345-postgres pg_dump -U postgres -d ticket_radar' | gzip > backup-$(date +%F).sql.gz`
- offline dump (本地): `pnpm db:export` → `db/dumps/ticket_radar_data.json`
