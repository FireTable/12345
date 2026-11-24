# 项目依赖清单与组件架构披露 (Dependencies & Components)

> **项目名称**：民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 / 双业务域 V2 生产架构)  
> **研发团队**：赢了就回家吃鱼生  
> **依赖核对基准**：根目录 [`package.json`](../package.json) 与 `packages/*/package.json`  
> **合规结论**：全栈开源依赖均采用宽松商业友好许可证（**MIT / ISC / Apache-2.0 / Unlicense**），无 GPL/AGPL 传染性协议。

---

## 目录
1. [生产核心依赖清单与开源协议](#一生产核心依赖清单与开源协议)
2. [外部服务与基础扩展清单](#二外部服务与基础扩展清单)
3. [前端与业务组件架构映射表](#三前端与业务组件架构映射表)
4. [合规性与数据安全声明](#四合规性与数据安全声明)

---

## 一、生产核心依赖清单与开源协议

### 0. 核心私有 Monorepo 独立引擎包 (`packages/*`)

| 模块名称 | 路径 | 内部核心依赖 | 核心能力说明 | 架构特性 |
| :--- | :--- | :--- | :--- | :--- |
| **`@civic/system-one`** (`1.0.0`) | `packages/civic-system-one` | `onnxruntime-node ^1.30.0` | **端侧 4 头神经分类器**：意图、7 大分类、紧急程度、涉稳风险，叠加 `redline.ts` 符号红线互锁 | 纯离线 ONNX 分类器，每条工单毫秒级前置执行；模型不绑定具体城市镇街 |
| **`@civic/system-two`** (`1.0.0`) | `packages/civic-system-two` | `zod ^3.24.2` | **慢思考通用认知大模型引擎**：OpenAI 协议适配、思维链与正文剥离、`createJSON` 强类型输出、Apple Silicon Metal 调优 | 多端点池探活、本地优先与云端自适应降级、流式 Abort 透传、耗时记 `predicted_ms` |
| **`@civic/embed`** (`1.0.0`) | `packages/civic-embed` | 无额外运行时依赖 | **多端点语义嵌入客户端**：OpenAI 兼容 `/v1/embeddings`（`BAAI/bge-m3`），最少连接调度与故障转移 | 本地/云端双轨容灾、429 退避、支持 `bulk`/`online` 批处理配置 |
| **`@civic/anonymizer`** (`1.0.0`) | `packages/civic-anonymizer` | 无额外运行时依赖 | **全要素可逆隐私脱敏引擎**：出站掩码（人名/单字姓称谓/手机号/身份证/车牌等）与会话级 Keymap 确定性还原 | 国标身份证校验、零外部网络依赖、支撑研判流水线与 Copilot 3 层 PII 防火墙 |

### 1. 核心 AI 图状态机、推理与并发调度

| 依赖库名称 | 版本号 (`package.json`) | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`@langchain/langgraph`** | `^0.2.54` | 确定性图状态机（工单研判流 `ticket-agent` + 副驾驶 `copilot-agent`） | **MIT** | [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) |
| **`@langchain/core`** | `^0.3.40` | 大模型消息抽象、Tool 定义与流式调度基础接口 | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`@langchain/openai`** | `^0.4.4` | OpenAI 兼容协议客户端（DeepSeek / vLLM / Ollama / llama-server） | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`onnxruntime-node`** | `^1.30.0` | Node.js 端侧 ONNX Runtime（驱动 `@civic/system-one` 毫秒级推理） | **MIT** | [microsoft/onnxruntime](https://github.com/microsoft/onnxruntime) |
| **`zod`** | `^3.24.2` | 强类型参数与 LLM 结构化输出 Schema 校验 | **MIT** | [colinhacks/zod](https://github.com/colinhacks/zod) |
| **`p-queue`** | `^8.1.0` | `backend/llm-pool.ts` 并发队列调度（区分 `interactive` / `batch` 通道） | **MIT** | [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) |
| **`date-fns`** | `^4.1.0` | 工单爆发时序跨度、时间窗口与假闭环周期计算 | **MIT** | [date-fns/date-fns](https://github.com/date-fns/date-fns) |

### 2. 语音交互与 3D 数字人 SDK

| 依赖库名称 | 版本号 (`package.json`) | 用途说明 | 配置方式 |
| :--- | :--- | :--- | :--- |
| **`@firetable/project-xiaochun`** | `^0.2.16` | 3D 交互数字人「小蠢」SDK：承载 `/submit` 市民受理与外呼舞台、EMAGE 动作预加载与语音播报（支持开麦自动打断防回声） | `next.config.ts` 已配置 `transpilePackages`；支持 `NEXT_PUBLIC_XIAOCHUN_EMBED_URL` |
| **`@firetable/stream-asr`** | `^0.1.2` | 浏览器端侧实时流式语音识别 SDK（WASM + AudioWorklet `public/civic/asr-worklet.js`），驱动 `VoiceChatComposer` 边说边转写 | `next.config.ts` 已配置 `transpilePackages`；支持 `NEXT_PUBLIC_STREAM_ASR_MODEL_URL` / `WASM_URL` |

### 3. 现代前端全栈、GIS 地图与 Civic Light 设计体系

| 依赖库名称 | 版本号 (`package.json`) | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`next`** | `^15.2.1` | React 服务端渲染、App Router 与 Standalone 最小化镜像构建 | **MIT** | [vercel/next.js](https://github.com/vercel/next.js) |
| **`react` / `react-dom`** | `^19.0.0` | 前端响应式渲染核心 | **MIT** | [facebook/react](https://github.com/facebook/react) |
| **`tailwindcss`** | `^4.0.9` | 原子化样式引擎与 Civic Light 设计系统（搭配 `@tailwindcss/postcss ^4.0.9`） | **MIT** | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| **`@radix-ui/react-*`** | `^1.1.x` ~ `^2.3.x` | 无障碍 UI 原语（Dialog / DropdownMenu / Select / Separator / Slot / Tabs / Tooltip） | **MIT** | [radix-ui/primitives](https://github.com/radix-ui/primitives) |
| **`leaflet`** (`@types/leaflet`) | `^1.9.4` (`^1.9.22`) | 政务域 CGCS2000 交互底图、四级镇街矢量面渲染与工单地理点位卡片 | **BSD-2-Clause** | [Leaflet/Leaflet](https://github.com/Leaflet/Leaflet) |
| **`@xyflow/react`** | `^12.12.0` | 顶部研判流水线工厂抽屉 React Flow 画布 | **MIT** | [xyflow/xyflow](https://github.com/xyflow/xyflow) |
| **`motion`** | `^12.4.7` | 抽屉、弹窗与卡片微动效 | **MIT** | [motiondivision/motion](https://github.com/motiondivision/motion) |
| **`lucide-react`** | `^1.16.0` | 统一矢量图标库 | **ISC** | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **`sonner`** | `^2.0.1` | 轻量 Toast 通知组件 | **MIT** | [emilkowalski/sonner](https://github.com/emilkowalski/sonner) |
| **`react-markdown`** / **`remark-gfm`** | `^10.1.0` / `^4.0.1` | Copilot 简报、治理专报与公文级处置建议 Markdown/表格渲染 | **MIT** | [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) |
| **`class-variance-authority`** / **`clsx`** / **`tailwind-merge`** | `^0.7.1` / `^2.1.1` / `^3.0.2` | 组件变体与 Tailwind 类名安全合并工具 | **Apache-2.0 / MIT** | — |

### 4. 数据持久化、文件流解析与可视化报表

| 依赖库名称 | 版本号 (`package.json`) | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`drizzle-orm`** | `^0.45.2` | 强类型 TypeScript ORM 与自定义 `halfvec(1024)` 列支持 | **Apache-2.0** | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| **`postgres`** *(postgres.js)* | `^3.4.9` | 高性能 PostgreSQL 客户端与多租户连接池 | **Unlicense** | [porsager/postgres](https://github.com/porsager/postgres) |
| **`@tanstack/react-table`** / **`@tanstack/react-virtual`** | `^8.21.3` / `^3.14.9` | 海量工单表格排序、筛选与虚拟滚动 | **MIT** | [tanstack/table](https://github.com/tanstack/table) |
| **`react-force-graph-2d`** | `^1.26.1` | 主题与实体拓扑关系力导向图 | **MIT** | [vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph) |
| **`xlsx`** / **`papaparse`** | `^0.18.5` / `^5.5.2` | Excel / CSV 批量工单解析与带防注入保护的 CSV 导出 | **Apache-2.0 / MIT** | [SheetJS](https://sheetjs.com/) / [PapaParse](https://github.com/mholt/PapaParse) |
| **`busboy`** / **`adm-zip`** | `^1.6.0` / `^0.6.1` | 大体积多文件/压缩包工单流式上传与解压（配合 `bodySizeLimit: "300mb"`） | **MIT** | [mscdex/busboy](https://github.com/mscdex/busboy) |

### 5. 身份认证与安全防护 (Better Auth)

| 依赖库名称 | 版本号 (`package.json`) | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`better-auth`** | `^1.7.1` | 认证核心：用户名/密码登录、Drizzle PG 适配器、RBAC `role` 字段与 `session.cookieCache`（5 分钟 HMAC 缓存） | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |
| **`@better-auth-ui/react`** | `^1.7.6` | Better Auth React UI 组件与 Hook | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |
| **`@better-auth-ui/core`** | `^1.7.6` | Better Auth UI 核心状态逻辑 | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |

### 6. 关键开发与数据库工具链 (`devDependencies`)
- **`drizzle-kit`** (`^0.31.10`)：数据库迁移脚本生成与 Drizzle Studio；
- **`typescript`** (`^5.7.3`) / **`tsx`** (`^4.23.12`)：类型检查与运维/测试脚本运行；
- **`postcss`** (`^8.5.3`) / **`@tailwindcss/postcss`** (`^4.0.9`) / **`tailwindcss`** (`^4.0.9`)：CSS 编译与原子化样式处理流水线；
- **`concurrently`** (`^10.0.6`) / **`@next/env`** (`^16.3.1`)：本地开发编排与环境变量加载。

---

## 二、外部服务与基础扩展清单

| 服务 / 扩展 | 角色与用途 | 配置来源 | 离线/降级能力 |
| :--- | :--- | :--- | :--- |
| **PostgreSQL 16 + `pgvector` + `pg_trgm`** | 多租户物理 Schema 存储、`halfvec(1024)` 语义向量检索、GIN 三元组模糊检索与覆盖索引 | `pgvector/pgvector:pg16`、`DATABASE_URL` | 本地/内网自托管 |
| **本地 / Colab / 云端 OpenAI 兼容 LLM** | System-2 抽取、主题建议、Copilot 研判与 AI Scout 拓荒（默认本地 `8132` + 云端 `OPENAI_*` 回退） | `SYSTEM_TWO_ENDPOINTS`、`OPENAI_*`、`public.compute_nodes` | 支持纯本地 `llama-server` / Ollama / vLLM 离线闭环 |
| **Embedding & Rerank 服务** | `BAAI/bge-m3` 向量化与 `bge-reranker-v2-m3` 精排 | `EMBEDDING_*`、`RERANK_*`、`public.compute_nodes` | 支持本地 `8133` 节点或云端回退 |
| **国家天地图 (Tianditu CGCS2000)** | 政务域矢量/影像/注记瓦片代理（`/api/map/tile`）与正逆地理编码（`/api/map/geocode`） | `TIANDITU_SERVER_KEY`（仅服务端读取） | 服务端 1000 瓦片 LRU 缓存 + 30 天浏览器不可变缓存；电商域（`hasGeoMap: false`）完全不调用 |
| **Stream-ASR 模型与 WASM 资源** | 端侧流式语音识别模型分片与 WASM 运行时 | `NEXT_PUBLIC_STREAM_ASR_MODEL_URL`、`NEXT_PUBLIC_STREAM_ASR_WASM_URL`（默认 `https://asr.firetable.tech`） | 可切换内网静态资源镜像；无麦/离线时自动退化纯文字输入 |
| **Project XiaoChun 数字人嵌入服务** | 3D 数字人渲染与语音动作编排 | `NEXT_PUBLIC_XIAOCHUN_EMBED_URL`（默认 `https://xiaochun.firetable.tech/embed`） | 可切换内网部署地址 |
| **可选通知通道 (Webhook / SMTP)** | 主动治理闭环告警与工单回执外发 | `AGENT_WEBHOOK_URL`、`SMTP_*` | 未配置时仅站内记录 `disposal_logs` 与模拟通道 |

---

## 三、前端与业务组件架构映射表

```text
app/
├── page.tsx                                   # 1. 数据总览 (Dashboard)
├── themes/ (page.tsx, [id]/page.tsx)          # 2. 多频工单看板与主题详情 (/themes)
├── multifreq/page.tsx                         # 3. 工单透势与四象限分析 (/multifreq)
├── tickets/ (page.tsx, [id]/page.tsx)         # 4. 工单中心：4态统一/缺资料/假闭环/人工复核 (/tickets)
├── agent/page.tsx                             # 5. 智能治理中心：L1/L2/L3 队列/48h回访/治理专报 (/agent)
├── dict/page.tsx                              # 6. 标准字典与别名知识库 (/dict)
├── sandbox/page.tsx                           # 7. 实时演练与 X-Ray 沙盒 (/sandbox)
├── submit/page.tsx                            # 8. 市民端自助上报：VoiceChatComposer + 小蠢 + 进度/重开 (/submit)
├── screen/page.tsx                            # 9. 独立大屏指挥舱 (/screen)
├── admin/ (page.tsx, regions/page.tsx)        # 10. 站点管理中心、动态算力节点池与 MCP 吊销 (/admin/regions)
├── login/page.tsx                             # 11. Better Auth 登录页 (/login)
├── mcp/authorize/page.tsx                     # 12. MCP OAuth 授权确认页 (/mcp/authorize)
└── _components/
    ├── civic/                                 # Civic Light 核心组件库
    │   ├── civic-nav.tsx / nav-items.ts       # 全局导航与站点切换器
    │   ├── civic-geo-map.tsx / civic-map.tsx  # Leaflet + 天地图 CGCS2000 政务态势地图
    │   ├── domain-channel-matrix.tsx          # 电商域 (hasGeoMap=false) 全渠道与仓网压力矩阵
    │   ├── voice-chat-composer.tsx            # 统一语音/文字输入器 (Stream-ASR 实时转写)
    │   ├── disposal-timeline.tsx              # 工单/主题处置审计时间线
    │   ├── ticket-verdict-view.tsx            # 工单详情研判卡与地理点位卡
    │   ├── compute-nodes-panel.tsx            # 动态算力节点在线管理面板
    │   ├── pipeline-drawer.tsx                # 顶部 AI 研判流水线抽屉 (仅 admin 订阅 SSE)
    │   └── quadrant.tsx / civic-charts.tsx    # 四象限与 ECharts 统计图表
    ├── agent/                                 # 3D 数字人与主动外呼组件
    │   ├── xiaochun-stage.tsx                 # @firetable/project-xiaochun 舞台封装
    │   └── voice-outreach-dialog.tsx          # 缺资料补全 / 48h 回访语音外呼弹窗
    ├── cockpit/                               # 指挥大屏组件 (cockpit-view.tsx 等)
    └── copilot/                               # light-copilot.tsx (含 civic-action 确认执行卡)

backend/agent/
├── ticket-agent.ts                            # 工单研判流水线 LangGraph
├── copilot-agent.ts                           # 副驾驶 LangGraph (1轮简报预取 + 3层 PII 防火墙)
└── copilot-tools.ts                           # 9 个绑定当前 region 的只读与提案工具

lib/
├── app-domain.ts / domain-profile.ts          # APP_DOMAIN 双域隔离与 DomainProfile (hasGeoMap)
├── agent-governance.ts                        # 市民受理/重开、L1/L2/L3 巡检、外呼补全、48h回访、专报
├── civic-cache.ts                             # globalThis 共享 SWR 软硬双过期缓存
├── civic-missing.ts                           # 缺资料判定规则与 PG 触发器 DDL 单一真源
├── civic-queries.ts / civic-dto.ts            # 4态统一、聚合查询与索引回退
├── map/                                       # boundary-service / tianditu-service / client-geocode / enterprise-address-enricher
└── mcp/                                       # discovery / clients / tools / http
```

---

## 四、合规性与数据安全声明

1. **协议合规**：全项目依赖包均采用宽松商业友好协议（MIT / ISC / BSD-2-Clause / Apache-2.0 / Unlicense），具备完整商业与政务交付合规性。
2. **数据不出域与 3 层脱敏保障**：系统内置 `@civic/anonymizer` 可逆脱敏引擎与 Copilot 3 层 PII 脱敏防火墙；支持全栈本地/内网离线推理，符合《网络安全法》与《个人信息保护法》要求。
3. **RBAC 与防滥用守卫**：`middleware.ts` 边缘 HMAC 验签 + `lib/auth/rbac.ts` 角色隔离 + `lib/security/agent-guard.ts` Host 校验与分通道限流，保障管理面、市民面与 AI 接口安全隔离。
