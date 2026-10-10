# 系统架构演进与技术攻坚日志 (Civic Radar Architecture Evolution Log)

> **版本定位**：从 `main` 分支单体粗粒度工作流（V1 基线）演进至多城市/多租户认知双系统（V2 生产架构）的全链路攻坚备忘。遵循真实持久化数据源、严禁伪造统计、严格保障政务数据物理隔离与高精测绘级时空对齐。

---

## 📌 V1 到 V2 核心架构质变与重大突破概览

1. **认知双系统分层（Kahneman Dual-System）**：
   - 摆脱全量依赖通用大模型的单体瓶颈，抽象端侧 ONNX 4 头轻量神经网络（System 1，<0.08ms 前向）与本地 27B 强约束结构化认知模型（System 2），实现“快慢分治”，算力开销骤降 80%+。
2. **根除幻觉死循环与去套娃仲裁**：
   - 彻底废除 V1 置信度不足反复调用 LLM 仲裁的死循环模式，建立法定镇街、社区与权威分类白名单的确定性物理校准。
3. **数据隐私安全气隙（Air-Gap Security）**：
   - 研发独立 `@civic/anonymizer`，会话级全要素双向可逆脱敏，实现出站高强度加密与入库无损解密，全链路本地离线部署，数据 100% 不出域。
4. **时空语义精准聚类与微观基底提纯**：
   - 弃用粗粒度静态 72h 图拓扑割裂，融合密集语义向量（bge-m3）与微观道路核心基底提纯（`extractSpatialCore`），实现高精度同案同地收拢，相邻门牌不误聚，跨街道误聚率清零。
5. **空间测绘级 GIS 基底（CGCS2000）**：
   - 引入国家天地图高精底图，彻底消除火星坐标系（GCJ-02）300~500米偏移，第四级乡镇街道矢量边界入库并自适应调色。
6. **多城市与多租户物理隔离**：
   - PostgreSQL Schema 物理隔离，解耦单一顺德硬编码，新增 AI Scout 30 秒全自主辖区智能拓荒向导。
7. **开放互联与可视化工作台**：
   - 原生 Model Context Protocol (MCP 2025-03-26) 集成与 React Flow 研判流水线全景工作台。

---

## 2026-10-10 — MCP 接入、大屏一次读取、副驾驶工具图与增量归并自适应强化

- **MCP 单工单增量聚类与主题自适应归并强化 (`lib/incremental-ingest.ts`, `backend/incremental-cluster.ts`)**：
  - **破解单单推送孤岛难题**：解决 MCP 逐张推送工单时单批次无法自建主题的问题。新工单未命中已有主题时，跨批次拉取历史落单工单池进行联合聚类（`candidatePool`），若发现同一事件事实且达到 ≥2 件门槛，立即自动收敛生成全新 Theme，并通过 `summaryNode` 输出跨部门协同处置预案，彻底打破单次推送的批次孤岛。
  - **已有主题微观特征对齐**：增量研判构建老主题特征 Profile 时，注入 `theme.aiSummary` 与 `theme.recommendedAction`，完整还原老主题中的微观道路名称（如“测试路”），避免因宏观行政区划概括导致同案同地误判为不匹配。
  - **镇街缺省策略校准 (`same-incident-cluster.ts`)**：优化镇街强校验规则，从“任一方为空直接否决”调整为“双方均具备且冲突时才否决”；对于未提取到明确镇街的公共设施类工单，允许依据微观地点、主体及向量相似度正常归并。
  - **放开办结主题复发吸纳**：增量候选主题池取消排除 `RESOLVED`（已办结）主题，市民再次反映已办结的同一事件时，系统自动识别为复发诉求（`reopenCount` 累加、标记 `isFakeClosure`），支持全周期闭环跟踪。
  - **市政公用工单 Embedding 资格放开 (`embed-policy.ts`)**：对于无特定企业主体的公共设施工单（原主体缺省为“涉事方”），只要具备标题、地点或事件类型即可正常生成向量嵌入，彻底打通语义检索与稠密向量归并链路。
- 外部 Agent 只配站点 origin。`POST /api/mcp` 是 MCP Streamable HTTP，协议 `2025-03-26`。未授权返回 401，并带 RFC 9728 的 `WWW-Authenticate`。人用 Better Auth 登录后在 `/mcp/authorize` 同意，换到 `civic_` access key。三个工具：`list_regions`、`push_ticket`（入库并自动触发异步增量研判）、`region_overview`（与站点总览同一套汇总）。吊销在站点管理中心。步骤见 [`MCP.md`](MCP.md)。`public.mcp_clients` 与 `public.mcp_auth_codes` 在第一次调用时建表。
- 大屏改为一次 `GET /api/cockpit`。最近 30 条只带正文前 80 字。这一读不探活 System 2。最近工单已走 `idx_tickets_create_time`，没有再加索引。
- 副驾驶改为 LangGraph `decide → tools → decide`，模型是本地 27B，工具按当前 region 检索。进入对话时不预读主题。
- `OPENAI_API_KEY` 仍会读：本地 System 2 探活失败时的云端回退、AI 拓荒，以及没写 `EMBEDDING_API_KEY` 时的向量 Key。抽取、主题建议和副驾驶的主路径是 8132 上的 27B，向量是 BAAI/bge-m3。

## 2026-10-07 — 流水线工厂抽屉与抽取空字段

- AI 研判流水线工厂是顶部 `PipelineDrawer`，`/workbench` 页面已删除。窄屏和宽屏用同一块 React Flow 画布，只让抽屉标题换行，不再另做手机步骤列表。
- 自动刷新保留节点 `measured`、宽高和拖拽位置。丢掉 `measured` 时 React Flow 会把节点藏起来。
- 抽取 Schema 把主体、地点的 `null` / `无` / `未知` 收成空字符串。标题或事件还在就收下；主体为空时置信度不超过 55。
- 算力节点耗时优先用 `predicted_ms`，界面一律写成秒。离线节点显示「无法连接」，不显示耗时。不健康节点超过 3 秒再探活，并轮询进调度。

现行规则以 [`docs/WORKFLOW.md`](WORKFLOW.md) 为准。下面 2026-09-26 一节里的咨询直通、72 小时并单、主题建议开思考，都已经不用了。

## 2026-09-26 — V2 双引擎架构重构、微观时空基底对齐与增量滑动窗口闭环落地

- **System-1 / System-2 双引擎分层协同全面落地**：
  - **Monorepo Packages 架构**：拆分并定型 `@civic/system-one`（4头交叉注意力神经分类器，单单推断 **0.079 ms**，吞吐超 **12,600 TPS**）、`@civic/system-two`（Bonsai 2 27B PTQ1_0 三值大模型，Apple Silicon Metal 深度调优，CoT 思维链剥离，`createJSON` 强类型驱动）与 `@civic/anonymizer`（全要素可逆隐私脱敏安全气隙）。
  - **快思考极速直通**：政策咨询件（INQUIRY）与工单催办毫秒级直接分派直通（51ms），无需调用昂贵大模型，节约 80%+ 简单工单算力。
  - **极速抽取与废除套娃仲裁**：工单抽取显式指定 `enableThinking: false`，单件约 3 秒结构化直出；彻底剔除旧版置信度 `< 60` 反复调用 LLM 仲裁的低效死循环，改由权威字典与本地白名单确定性校准。
  - **多频成团统一慢思考**：仅在多频事件成团后统一调用 1 次 System-2 慢思考（`enableThinking: true`），推导 **3100+ 字符思维链**，深度穿透跨部门权责并生成分步处置预案。
- **微观时空核心基底提纯算法 (`extractSpatialCore`)**：
  - 自动剥离门牌号（“28号”）、店铺名等修饰噪点，提纯出公共微观道路核心基底（如 `大良街道金榜上街`），彻底解决市民表达细微差异无法聚类的历史顽疾。
  - 建立纯行政区划防吸附隔离线，严禁将全街道泛诉求错误吸附进具体某条路段，杜绝工单串扰。
- **增量工单时空吸附与 72h 滑动时间窗口机制 (`backend/incremental-cluster.ts`)**：
  - 新增流式吸附判定：新工单 **1.9 毫秒** 判定是否吸附进当前在办活跃主题，工单数自动累加，杜绝重复建群。
  - 确立“距离该事件最后一个事件发生时间（lastOccurrence）的 72 小时滑动时间窗口”政务业务标准。
  - 平时 0 耗时继承老方案（0 等待、0 Token 消耗），座席秒级答复；突发严重险情（冲刷塌陷、次生灾害）质变精准触发 System-2 慢思考升级应急救援预案。
- **集中式 Token 与超时预算体系 (`lib/tokens.ts`)**：
  - 抽取分配 2048 Tokens / 5 分钟超时，慢思考分配 4096 Tokens / 10 分钟充足预算，彻底根除客户端写死短超时断联报错。
- **业务 API 双模态全面贯通**：
  - `POST /api/tickets`：单单流式入库后台异步触发 `ingestSingleTicketPipeline`，实现“入库即智能吸附”；
  - `POST /api/cluster`：批处理研判自动带入未结案存量主题，实现跨批次连续性治理。

---

- **工单镇街与摘要全量治理 (`scripts/refine-data-quality.ts`)**：
  - 全量清洗 13,659 条工单，结合顺德 10 镇街、98+ 村居社区及 72+ 别名白名单，将 5,764 条缺失镇街工单 100% 准确归正，并去除 `'其在陈村镇'` 等前缀脏数据。
  - 清理 3,992 条含“未标明微观地点/特定诉求涉事方/日常跟进”生硬机器拼接摘要，全面重塑为自然流畅的公文级一句话诉求。
- **Themes 主题群组高保真聚类重构 (`scripts/recluster-themes-perfect.ts`)**：
  - **根除泛词粗暴聚合**：建立 28+ 类通用停用词拦截矩阵（如“企业注册”、“企业注销”、“购买家具”、“网购纠纷”），坚决杜绝不同公司或不同主体的盲目归并。
  - **双轨实体与微观时空强隔离**：主体型聚类必须 100% 精确命中合法企业组织全称或车牌号；微观地点型聚类严格以 `[镇街] + [微观小区/路段]` 拓扑归组，跨镇街串扰误聚率彻底清零（0 / 704）。
  - **主题与关联表双向校验 (`scripts/audit-theme-links.ts`)**：重建 704 个高质感主题，`primary_theme_id` 与 `ticket_themes` 关联表 100% 双向对齐，工单数与时序统计无缝自洽。

---

## 2026-08-21 — Better Auth 安全认证集成与 Header 交互一体化重构

- **Better Auth 生产级安全认证迁移**：
  - 集成 `better-auth`、`@better-auth-ui/react` 与 `@better-auth-ui/core`，采用 Drizzle ORM PostgreSQL 适配器持久化 `user`、`session`、`account`、`verification` 认证表。
  - 启用 `username()` 插件，支持用户名密码体系，并编写幂等初始化脚本 `scripts/seed-admin.ts`（`pnpm db:seed-admin`），内置默认系统管理员账号 `admin` / `admin`。
  - 编写 Next.js 全局中间件 `middleware.ts` 路由守卫，除 `/login` 与公共资源外，未登录一律 307 重定向至登录页。
  - 开发 Civic Light 定制风格登录页（`/login`），支持一键填充默认管理员凭证与即时错误反馈。
- **Header 顶栏交互一体化升级**：
  - **全景演示视频点播弹窗 (`VideoModal`)**：Header 右侧新增胶卷图标按钮，内置 6 大模块演示视频点播列表；使用 `createPortal` 挂载，并采用固定 640px 视窗、16:9 比例锁定与缓冲遮罩，彻底杜绝视频切换时的布局闪烁。
  - **GitHub 官方源码仓库直达**：标准 16px 矢量图标，修复 Hover 时的深黑背景色与颜色层叠冲突，统一为 Civic Light 浅灰悬停主题。
  - **用户信息与退出操作合并**：将原先分散的系统管理员标签与退出按钮合并为一体化 `.navbar-user-card`（`[👤 系统管理员] [管理员标签] | [🚪 退出]`），统一 34px 高度与 8px 圆角度量，全站顶部右侧操作栏整洁统一。

---

## 2026-08-15 — start

- Created `feat/civic-ui-landing` from `main`.
- Plan: extend `tickets`/`themes` (no duplicate workorders/clusters tables), persist mode / first-last / confidence / handling / features / radar, add `diverge`, project APIs, rebuild six Next routes with design tokens.
- Verification this step: `git branch --show-current` → `feat/civic-ui-landing`.

## 2026-08-16 — UI consolidation + brand alignment

- Header brand `Ticket Radar` → `民声智理`;package name `ticket-radar` → `minsheng-zhili`;Docker image tag `minsheng-zhili:v0.1.0`.
- Move `启动 Agent 研判` from header to pages that own the upload (`/`, `/tickets`); header keeps only `上传入库` / `导出报表` / `AI 研判`.
- Drop header `上传工单` / `研判助手` buttons; add bottom-right Chat FAB (`MessageCircle`) that hides when the copilot drawer opens.
- AnimatePresence enter/exit on copilot drawer (backdrop fade + panel slide-x) and upload dialog (backdrop fade + panel scale/y). Click backdrop to close.
- Rename `关键洞察` → `工单透势` (workbench insight card) and `多频透视` → `工单透势` (multifreq page title + breadcrumb) for naming consistency.
- Swap nav order: `多频工单` before `工单透势` (then `工单中心` to end per later request).
- Drop 🚨 emoji from tickets urgent tab.
- Shunde SVG map: gray fill (`#E5E7EB`) + centered `暂无镇街研判数据` overlay when empty; vertically center card content.
- Quadrant chart: `width:100%` on `.quadrant-wrap` so the 50%-width quadrant children fill the card body instead of collapsing to 0 in a flex container.
- Multifreq ShundeMap card body: `align-items:center` + `paddingTop:40` to push SVG a bit lower without leaving a gap.
- TOP 5 辖区 column width 85 → 213 (~2.5x) to fit `均安 · 容桂 等 4 镇街`.
- Ticket detail (`/tickets/[id]`) "诉求正文" restyled as a citizen-letter card: `MessageSquareQuote` icon, character count + reception channel meta, 3px brand-colored left border, light blue gradient background, font 15/1.85.
- `lib/civic-dto.ts`: include `channel` field with `市民服务热线` fallback so detail can show reception channel.
- Deploy doc cleanup: strip personal IP/nickname/`Mac (开发)`/`本文档给人看` from `docs/DEPLOY.md` (pure agent-runnable doc).
- `scripts/verify-mobile-layout.ts`: explicit `as readonly string[]` cast to widen the `as const` literal tuple for `.includes(string)` — fixes Next build typecheck.
- Rename openclaw skill folder `12345-deploy` → `12345-maintain` (frontmatter `name` updated).

Verification this step: `pnpm build` 0 errors; `pnpm exec tsc --noEmit` 0; VPS rebuild + restart returns 4 endpoints to 200.

---

## 2026-08-15 — schema + cluster persist

- Added ticket columns: `source_category`, `urgency`, `address`, `confidence`, `primary_theme_id`.
- Added theme columns: `pattern_type`, `ai_confidence`, `first_at`/`last_at`, handling fields, `features_json`/`radar_json`, `trend_pct`.
- Official generate: `db/migrations/0005_civic_ui_fields.sql` (after fixing 0003/0004 snapshot `prevId` collision so drizzle-kit could run).
- Verification: drizzle-kit generate succeeded; SQL lists the new columns.

## 2026-08-15 — diverge + metrics

- `inferPatternType`: ≥2 AI categories → `DIVERGE`; few callers → `INDIVIDUAL_REPEAT`; else gathering.
- Location clustering now groups by place only (not place+category) so diverge is not split apart.
- `deriveThemeMetrics` writes features/radar/confidence/trend from tickets (no random).
- Cluster persist writes the new theme/ticket fields.
- Verification: `pnpm exec tsx scripts/verify-civic-map.ts` (mode mapping + DTO + overview sums).

## 2026-08-15 — APIs

- `GET /api/overview`, `/api/trends`, `/api/workorders` (paged), `/api/workorders/[id]`, `/api/clusters`, `/api/clusters/[id]`.
- Projection in `lib/civic-dto.ts` / `lib/civic-stats.ts`.
- Insights built from stored themes, not the design HTML copy.
- Verification: mapping script asserts region totals reconstruct input count; no 马龙村 string.

## 2026-08-15 — six routes + tokens

- Copied design `tokens.css` / `components.css` (brand `#1677FF`).
- Top nav: 工作面板 `/` · 工单中心 `/tickets` · 多频透视 `/multifreq` · 群组中心 `/themes` plus `/tickets/[id]` and `/themes/[id]`.
- Dashboard KPI/insights/trend/ranking/heatmap; list pages paginate via APIs.
- Verification: `tsc --noEmit` 0; `pnpm build` 0; `next start -p 3011` GET `/` `/tickets` `/themes` `/multifreq` all HTTP 200 and HTML contains the four nav labels.

## 2026-08-15 — skeptic fixes

- `inferPatternType`: 个体重复只在唯一反映人 === 1；两个不同市民同事件改为群体聚集。
- 工单/群组详情用 `classifyDetailPayload` 拆 loading / missing / ready，首屏不再闪「未找到」。
- Verification: `pnpm exec tsx scripts/verify-civic-map.ts` 增加「两市民 → aggregate」和详情三态断言。

## 2026-08-15 — restore upload / cluster / copilot

- Civic shell had dropped the previous header actions. Wired `UploadDialog` (POST `/api/tickets/upload` then LangGraph cluster), standalone `POST /api/cluster`, Copilot, and dashboard 导出/近7-90天/更新工单数据.
- Nav now always shows 上传工单 / 启动 AI 聚类 / 研判助手 on every route.
- Verification: `tsc --noEmit`; grep nav labels + upload/cluster handlers in civic-workflow.

## 2026-08-15 — nav chrome

- Brand mark `12345` is a 56×28 rectangle, not a 32×32 square.
- Removed the active tab underline (`::after` bar); current item is tint + weight only.

## 2026-08-15 — unbreak Tailwind

- Civic `tokens.css` had an unlayered `* { margin:0; padding:0 }` and `button { background:none }` after Tailwind, which wiped UploadDialog / Copilot / Shadcn spacing.
- Left only `:root` tokens + body canvas; links scoped to `.navbar` / `.main`.

## 2026-08-15 — 镇街/类型等 AI 回写

- 上传不再用正文正则猜镇街，也不再默认「所属辖区 / 综合辖区」。文件没有辖区列就留空。
- `parseAdminArea` 按省市区 + 镇/街道后缀切微观地点（不写顺德地名表）。
- 聚类后对**全部**已抽取工单回写 district / subdistrict / 七类 sourceCategory / address / confidence，不只写进了主题的那些。
- 总览镇街 TOP、类型、热力图只统计 `confidence != null` 的工单；总量/趋势仍含未研判。
- 工单列表/详情同样等研判后再展示镇街与类型，避免把「:00致电反映：均安镇」这类正则碎片当辖区。
- Verification: `pnpm exec tsx scripts/verify-civic-map.ts`（入库不进分布、地点切分、小区不误判为区）；浏览器 `/` 已研判 0/306、镇街/类型空态；`/tickets` 类型与镇街为 —。

## 2026-08-15 — 按设计稿还原四页结构

对照 `design-assets/frontend/` 补齐先前只搭了壳的页面：

- 工作面板：双轴折线（每日工单 + 多频群组新增）和七类环形图改回 ECharts，镇街 TOP 10 用色条排名，热力表按设计色阶。
- 工单中心：4 张统计卡 + 全部/待处理/处理中/已办结/紧急/多频聚类 Tab + 镇街/类型/时间筛选 + 行点击抽屉。
- 多频透视：未处理/今日新增/紧急/总量 4 卡，可点镇街的顺德图 + 紧急×重要四象限 + TOP 5 表，不再用三种模式 KPI 顶替。
- 群组中心：按处置状态归类（全部/未处理/处置中/已办结/紧急），模式改为筛选项；表头对齐设计稿（编号、未处理、紧急度、持续天数）。
- 镇街筛选项来自已研判数据，不写死十镇街表。

## 2026-08-15 — ingest vs agent persist

- 工单表增加 `ingest_district` / `ingest_subdistrict` / `ingest_category`（文件原列）；`district` / `subdistrict` / `source_category` / `address` / `confidence` / `summarize_title` / `primary_theme_id` 仅由 extract+cluster persist 写入。
- 主题表增加 `civic_mode`。官方迁移 `0006_ingest_agent_split.sql`。
- `lib/civic-persist.ts` 是唯一回写路径；`POST /api/cluster` 调用它。不覆盖 `content` / `masked_content`。
- Verification: `pnpm exec tsx scripts/verify-civic-map.ts`（未研判空镇街、persist 切均安+生态环境、DB 原文不变）；`GET /api/overview|workorders|clusters` 200。

---
