# 民声智理 · 多频工单智能研判系统 — TODO & 交付状态面板

> 本文档作为项目交付状态与剩余待办总账使用。已交付项以 `[x]` 标注并附核验后的 commit hash 与实测效果；待办项以 `[ ]` 按优先级排序。
>
> **当前工作分支**：`feat/closed-loop`（最新核心提交 `9b93585`，同步自 2026-11-24）
>
> **生产现状快照**：
> - **双域名同镜像生产架构**（`ticket-radar:v0.1.5`，`CIVIC_SKIP_BOOTSTRAP="1"`）：
>   - 政务热线主站：`https://12345.firetable.tech` → `12345-app:3100`（`APP_DOMAIN=GOV_12345`，承载 `region_gz_tianhe` ~106.5k、`region_fs_shunde` ~138.7k）
>   - 电商售后独立站：`https://ecom.firetable.tech` → `12345-ecom-app:3100`（`APP_DOMAIN=ECOMMERCE_CS`，承载 `region_ecom_demo` 3,240）
> - **主导航路由**（`app/_components/civic/nav-items.ts`）：数据总览 `/` · 多频工单 `/themes` · 工单透势 `/multifreq` · 工单中心 `/tickets` · 智能治理 `/agent` · 标准字典 `/dict` · 实时演练 `/sandbox`；另含市民端 `/submit`、指挥大屏 `/screen`、站点管理 `/admin/regions`、MCP 授权 `/mcp/authorize`。

---

## 一、已完成的核心工程与闭环交付 ✅

### A. 架构升级与双域名独立部署
- [x] **双域名同镜像独立部署与 `APP_DOMAIN` 物理域隔离** — `ea76ae2`、`ee85bf8`、`3e031b2`
  - 触达：`docker-compose.yml`、`lib/app-domain.ts`、`lib/domain-profile.ts`、`lib/tenant/request-region.ts`、`app/api/regions/route.ts`、`lib/mcp/tools.ts`
  - 实测效果：同一生产镜像 `ticket-radar:v0.1.5` 独立承载 `12345.firetable.tech`（政务 `hasGeoMap: true`）与 `ecom.firetable.tech`（电商 `hasGeoMap: false` 切 `DomainChannelMatrix` 全渠道仓网矩阵），彻底阻断跨业务域 Cookie 与 MCP 越权访问；`CIVIC_SKIP_BOOTSTRAP="1"` 避免重启抢占算力。
- [x] **热插拔动态算力节点池（LOCAL / COLAB / CLOUD）** — `fed2c28`、`a459957`
  - 触达：`db/schema.ts`（`public.compute_nodes`）、`lib/compute-nodes.ts`、`app/api/admin/compute-nodes/**`、`app/_components/civic/compute-nodes-panel.tsx`
  - 实测效果：支持在 `/admin/regions` 在线增删与探活 System-2 / Embedding 节点，本地或 Colab 掉线时 2 秒内自动切换云端回退。

### B. 全链路闭环治理（市民端 + 工单中心 + 智能治理 + Copilot）
- [x] **市民端 `/submit` 3D 语音受理、进度追踪与假闭环重开** — `fc2a8bf`、`feba97c`、`ab16724`、`23809e1`、`dc31170`、`3e031b2`
  - 触达：`app/submit/page.tsx`、`app/_components/civic/voice-chat-composer.tsx`、`app/_components/agent/xiaochun-stage.tsx`、`app/_hooks/use-stream-asr.ts`、`app/api/intake/**`
  - 实测效果：统一 `VoiceChatComposer` 集成 `@firetable/stream-asr` 实时语音转写与 `@firetable/project-xiaochun` 小蠢（EMAGE 动作预加载、开麦自动打断 TTS 防回声）；支持市民查看本人进度并一键重开假闭环工单（自动置为 `REOPENED` + `is_fake_closure=true` 并在管理员待派单置顶）。
- [x] **4 态统一 + `缺资料` 筛选与「一键让 Agent 跟进」外呼补全闭环** — `3e031b2`、`9b93585`
  - 触达：`lib/civic-dto.ts`、`lib/civic-missing.ts`、`app/tickets/tickets-client.tsx`、`app/api/agent/tasks/route.ts`、`app/_components/agent/voice-outreach-dialog.tsx`、`app/api/agent/outreach/voice-turn/route.ts`
  - 实测效果：全站统一 `PENDING / DISPATCHED / IN_PROGRESS / RESOLVED`（含 `REOPENED` 置顶）；工单中心支持 `tab=missing_info` 筛选并在抽屉一键创建/复用 `MISSING_INFO` 任务发起外呼补全，补全回写后触发器自动清除缺资料标记。
- [x] **智能治理中心 `/agent`：L1/L2/L3 分级自治、48h 回访防假闭环与治理专报** — `d0a7057`、`fc2a8bf`、`3201339`
  - 触达：`lib/agent-governance.ts`、`app/agent/agent-client.tsx`、`app/api/agent/**`、`app/_components/civic/disposal-timeline.tsx`
  - 实测效果：自主巡检 `NOT EXISTS` 幂等去重，按 `L1_AUTO`（超期催办/电商缺资料）、`L2_APPROVAL`（政务缺资料/48h 满意度回访）、`L3_BLOCKED`（涉稳/食安红线熔断）分级处置；48h 回访未解决自动重开工单/主题并记入 `disposal_logs`；支持生成并持久化 Markdown 治理专报。
- [x] **AI 研判 Copilot 1 轮简报预取提速 + 3 层 PII 脱敏防火墙 + `civic-action` 提案执行** — `5d94729`、`3201339`、`3e031b2`
  - 触达：`backend/agent/copilot-agent.ts`、`backend/agent/copilot-tools.ts`、`lib/copilot-protocol.ts`、`app/_components/copilot/light-copilot.tsx`
  - 实测效果：简报类提问走 `isBriefingPrefetchPrompt()` 并行预取 3 项指标后 1 轮流式直出，大幅降低多轮工具往返时延；入口/工具/模型出站 3 层共享 `sessionKeymap` 脱敏保证零明文 PII 流出；`propose_theme_action` 生成 ```` ```civic-action ```` 确认卡片，管理员确认后调用 `PATCH /api/clusters/:id` 安全落库。

### C. 性能与生产基础设施调优（10 万+ 级大表实测落地）
- [x] **数据库 `0011` + `0012` 索引体系与 `is_missing_info` 触发器持久化列** — `3201339`、`9b93585`
  - 触达：`db/migrations/0011_trgm_and_review_indexes.sql`、`db/migrations/0012_perf_indexes.sql`、`lib/civic-missing.ts`、`lib/tenant/schema-manager.ts`、`app/api/workorders/route.ts`
  - 实测效果：14 列 `pg_trgm` GIN 加速模糊搜索；`is_missing_info` 触发器列 + 部分索引 `idx_tickets_missing_info_ct` 彻底消除全表 POSIX 正则扫描；`tab=pending` 三段索引归并消除 10 万+ 行 `CASE` 全表排序；覆盖索引 `idx_tickets_stats_cover` 与 `idx_tickets_id_subd_status` 配合 `VACUUM ANALYZE` 启用纯 Index-Only Scan。
- [x] **SWR 缓存 + Better Auth `cookieCache` + `/api/clusters` -99.8% 瘦身** — `9b93585`
  - 触达：`lib/civic-cache.ts`、`lib/auth/config.ts`、`app/api/clusters/route.ts`、`app/themes/themes-client.tsx`、`app/multifreq/multifreq-client.tsx`
  - 实测效果：`civic-cache` 升级 60s 软过期 / 10min 硬过期 SWR 后台单飞刷新；Better Auth 开启 5 分钟 HMAC `cookieCache` 减少并发 DB 鉴权查询；`/api/clusters` 新增 `view=summary` 与分页视图及预编码字节缓存，实测响应体积从 **4.14~6.86 MB** 压降至 **未压缩 ~5.4~7.6 KB / zstd 压缩后 1.3~1.9 KB（降幅 99.8%+）**。
- [x] **Postgres 16 生产内存调优与 Caddy `@streaming` / 压缩分流** — `9b93585`
  - 触达：`docker-compose.yml`、生产 Caddyfile（见 `docs/DEPLOY.md` 第四节）
  - 实测效果：Postgres 16 配置 `shm_size: 512m`、`shared_buffers=1GB`、`effective_cache_size=4GB`、`work_mem=32MB`、`maintenance_work_mem=256MB`、`random_page_cost=1.1`、`jit=off`；Caddy 对 `/api/sse* /api/copilot* /api/events* /api/agent/outreach* /api/mcp*` 启用 `flush_interval -1` 无压缩直通，其余路由开启 `encode zstd gzip`。

### D. 历史 P0/P1/P2/P3 需求结项归档
- [x] **原 P0 #1–#5 全套（7 大分类、置信度与复核队列、7 天假闭环、核查总表、红黄蓝三级规则）** — `daee967` ~ `e311b48`
- [x] **原 P1/P2 `review_queue` 复核页 UI、假闭环标记与大屏闭环漏斗** — `c2a942f`、`d0a7057`、`3201339`（已集成至 `/tickets`「待人工复核」「疑似假闭环」Tab 及 `/screen` 大屏）
- [x] **原 P0/P1 全量安全与无障碍审计修复** — `3201339`、`dc31170`（SSE 角色隔离、地图代理白名单/限界、CSV 防注入、System-1 红线重训、原生 `<dialog>`、390px 移动端适配；验证 GOV E2E 51/51、ECOM E2E 10/10）
- [x] **原 P3/P4 探索项落地（Copilot 智能问数、3D 数字人小蠢、四象限分析、跨行业电商域迁移、pgvector 向量记忆）** — 已在 `feat/closed-loop` 全部交付上线。

---

## 二、当前剩余待办 (Active Backlog)

### P1 — 发布收尾与运维确认（需授权后执行）
- [ ] **生产数据库补跑 `VACUUM ANALYZE` 核验**：每次大批量数据导入或首次上线 `0012_perf_indexes.sql` 后，确认已对 `region_gz_tianhe`、`region_fs_shunde`、`region_ecom_demo` 执行 `VACUUM ANALYZE`，并在 `EXPLAIN (ANALYZE, BUFFERS)` 中确认 `Heap Fetches` 趋近于 0。
- [ ] **分支合并收口**：完成本轮文档同步与最终回归核验后，经人工确认将 `feat/closed-loop` 合并至 `main`。

### P2 — 下一阶段演进（需明确排期后启动）
- [ ] **真实电信外呼 / 短信网关对接**：在现有 `VOICE_SIM`、Webhook 与 SMTP 通道基础上，按甲方合规要求接入运营商 SIP 语音外呼与政务短信回执。
- [ ] **PII 按需审计还原 (`revealPII` / `pii_audit`)**：针对经审批的高权限核查岗位，建立带留痕审计的按需脱敏查看机制（不破坏现有出站 3 层 PII 防火墙）。
- [ ] **工序权重数据化校准**：待采集生产大批量研判的真实 P95/P99 分阶段耗时后，用实测权重替换 `lib/pipeline-progress.ts` 中 `{ S1: 2, S2: 88, CLUSTER: 5, SUMMARY: 5 }` 占位比例。

---

## 三、工程协作红线（改动前必读）

1. **禁止触碰核心红线文件（未经明确授权）**：
   - `langgraph.json`、`backend/agent/ticket-agent.ts`
   - 已发布的旧迁移文件 `db/migrations/0000`–`0012`（新变更必须新增幂等迁移编号）
2. **密钥与隐私底线**：
   - 严禁将任何真实密码、API Key、Token 写入代码、日志或文档；密钥仅通过 `.env.local` / `.env.vps` 注入。
3. **提交前基础自检**：
   ```bash
   pnpm exec tsc --noEmit
   pnpm build
   ```
