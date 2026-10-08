# 民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 V2 Production)

> **每条工单都过 System 1 和 System 2。抽取产物再做向量，只把同一件事或同一个具体地点收成主题。登记日从工单编号前六位读取。**

---

## 💡 项目核心亮点 (Core Highlights)

```
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  ⚡ 每条都过 System 1│  │  🧠 每条都过 System 2│  │  🌐 多城市/多租户│
  │ 分类 时限 涉稳    │     │ 主体 地点 事件 摘要│     │ Schema隔离/AI拓荒│
  └─────────────────┘     └─────────────────┘     └─────────────────┘
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  🔍 同一件事才成主题│  │  🚨 假闭环时序狙击 │     │  🛡️ 纯离线数据不出域 │
  │ 向量加地点规则    │     │ 办结后再反映标出  │     │ 隐私脱敏/全私有部署 │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **⚡ System 1：每条工单先做分类**
   - 本地 ONNX，四个头：意图、民生分类、紧急程度、涉稳。模型不判断镇街，镇街字段固定是 `UNKNOWN`，业务不会把它写成街道名。
   - 分类、紧急程度、办理时限和涉稳标记都落在工单上。咨询和催办也继续往下走，不跳过 System 2。

2. **🧠 System 2：每条工单都抽实体，并写一句话摘要**
   - 本地 Bonsai 2 27B，思考关掉，只出 JSON。每条写下主体、地点、事件和一句话摘要。
   - 咨询件常常没有可核验的公司或门牌。模型交来的 `null`、`无`、`未知` 收成空字符串，不让整批校验失败。标题或事件还在就收下这一行；主体为空时置信度不超过 55，低于 60 进人工复核。
   - 两条及以上的工单收成主题之后，再为这个主题写一条处置建议。单独留下的工单不再写主题建议。主题建议同样关掉思考。

3. **🌐 多城市/多租户 Schema 物理级隔离与 AI 自动拓荒 (`/admin/regions`)**
   - **数据物理隔离**：基于 PostgreSQL 独立 Schema 架构（`region_{id}`），不同城市/区县站点数据、字典与聚类案卷 100% 物理隔离，杜绝跨区数据串扰；
   - **AI 智能拓荒 (Scout)**：30 秒输入任意新城市/区县（如广州海珠、北京朝阳），AI 自动生成标准化法定镇街、社区与权威别名知识库；
   - **站点热插拔与动态地图**：前端统一集成多站点实时切换器，自适应加载对应辖区 SVG 态势地图与多维指标（默认内置佛山顺德、广州海珠等预置站点）。

4. **🔍 同一件事或同一个具体地点才收成主题**
   - 先把 System 2 的摘要、主体、事件、地点、镇街和分类做成向量。
   - 规则已经判定是同一件事，就收成一个主题。规则没抓住时，向量余弦不低于 0.88，并且分类相同、镇街都写明且相同、地点是同一个小区或地标，才收在一起。
   - 门牌不同不并。不同地点的同类投诉不并，例如两处烟花、同一条路上的两家欠薪。空镇街不能当成同一个镇。
   - 新来的单张工单如果是同一件事，并入已有主题，不按相隔多久拆开。

登记日从工单编号前六位读。`250101000770102-01` 里，`250101` 是 2025-01-01，`000770` 是当天的受理序号，`102` 是事项代码，`-01` 是重办序号。这三段都不是时分秒，所以时间记成上海时区当天 00:00。正文里写的另一个日期不能替换编号上的日期。编号解析不了，才回退到正文里的时间。

5. **🎯 多辖区权威政务白名单与确定性物理校准，彻底根治大模型幻觉**
   - 固化辖区法定镇街、村居社区（预置顺德区 10 大镇街、98+ 村居等）及 7 大民生诉求分类为 **Prompt 强约束白名单**；
   - 彻底废除旧版低置信度反复套娃仲裁死循环，改由本地确定性字典与规则库进行物理校准。

6. **🚨 独创“假闭环”智能识别算法**
   - 办结后 7 天内，同一件事再次反映，标成假闭环。天数可用 `TICKET_RADAR_FAKE_CLOSURE_DAYS` 改。

7. **🔒 权威认证与全链路安全路由守卫 (Better Auth)**
   - 深度集成 **Better Auth** 生产级身份认证框架与 Drizzle ORM PostgreSQL 适配器；
   - 全局路由守卫与 Session Cookie 保护，内置管理员一键 Seeder（`pnpm db:seed-admin`）。

8. **🛡️ 政务信创纯离线与隐私脱敏安全气隙 (`@civic/anonymizer`)**
   - 会话级双向映射（Keymap），出站前对姓名、手机、身份证等 PII 自动掩码，模型返回后 $O(1)$ 速度无损反向还原；
   - 支持 Docker 纯离线部署与本地 Metal / Ollama / vLLM 推理，数据 100% 不出域。

9. **🎨 统一定制 Civic Light 政务级设计体系**
   - 全站五大核心模块（**数据总览**、**多频工单**、**工单透势**、**工单中心**、**标准字典**）统一遵循 Civic Light 设计语言；
   - 包含多辖区 SVG 态势地图、紧急×重要四象限透势图，悬浮 **AI 研判副驾驶 (Copilot)** 支持实时问数。

---

## 🎬 系统演示视频 (System Demo Videos)

项目录制了完整的产品功能演示视频，涵盖从宏观态势总览到微观多频工单穿透研判的全流程（以佛山顺德示范站点为例）：

| 演示模块 | 视频文件 | 核心演示内容与研判亮点 |
| :--- | :--- | :--- |
| 🌟 **系统全景总览** | [`民声智理_总览片_v1.mp4`](public/videos/民声智理_总览片_v1.mp4) | **全景总览与产品宣传片**：民声智理整体架构、核心价值、AI 研判闭环与基层赋能成效。 |
| 📊 **数据总览看板** | [`数据总览.mp4`](public/videos/数据总览.mp4) | **首页态势大盘**：辖区热点态势地图、实时工单统计、多维处置率指标与 AI Copilot 交互。 |
| 🗂️ **多频工单看板** | [`多频工单.mp4`](public/videos/多频工单.mp4) | **双轨聚类折叠**：183+ 多频主题群组智能聚类、一键折叠详情、实体拓扑与公文级处置建议。 |
| 📈 **工单透势研判** | [`工单透势.mp4`](public/videos/工单透势.mp4) | **四象限与假闭环追踪**：紧急×重要象限图、办结后再反映的假闭环预警与重点督办。 |
| 📑 **工单中心核查** | [`工单中心.mp4`](public/videos/工单中心.mp4) | **全量工单穿透**：高阶复合检索、四要素抽取明细、实体归一化与人工复核流转。 |
| 📖 **标准字典治理** | [`标准字典.mp4`](public/videos/标准字典.mp4) | **知识库与别名沉淀**：多辖区法定镇街/村居白名单、别名自学习沉淀与权威实体对齐管理。 |

---

## 📚 项目专属文档体系 (Documentation)

项目所有核心架构设计、工作流拓扑、数据库字典与部署运维手册均已完备沉淀：

| 文档名称 | 路径 | 核心内容说明 |
| :--- | :--- | :--- |
| 📐 **现行工作流** | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | **现在怎么跑**。每条工单过 System 1 和 System 2，抽取产物做向量，同一件事或同一地点才成主题。 |
| 📜 **早期设计稿** | [`.gemini/v2-workflow.md`](.gemini/v2-workflow.md) | 重构初期的设计记录。里面的咨询直通、72 小时并单、主题建议开思考，都已经不用了。 |
| 📜 **V1 历史工作流存档** | [`.gemini/v1-workflow.md`](.gemini/v1-workflow.md) | main 分支最初的 LangGraph 工作流。 |
| 🗄️ **数据库设计与字典规范** | [`docs/DBS.md`](docs/DBS.md) | **数据必读**。7 大核心数据表 ER 拓扑关系、Drizzle ORM Schema 定义与全量字段字典。 |
| 🚀 **系统部署与运维手册** | [`docs/DEPLOY.md`](docs/DEPLOY.md) | **运维必读**。本地开发启动、VPS 云端 Docker 部署与信创纯离线 Metal / vLLM 私有化配置。 |
| 📦 **依赖清单与组件架构** | [`docs/DEPS.md`](docs/DEPS.md) | **全栈依赖**。涵盖 Monorepo Packages 独立包、生产依赖与前端业务组件映射表。 |
| 📈 **架构演进与优化备忘** | [`docs/IMPROVE.md`](docs/IMPROVE.md) | **迭代日志**。V1 到 V2 双引擎重构、算法演进历史与 Civic UI 落地记录。 |
| 🗺️ **待办任务与路线图** | [`.gemini/roadmap.md`](.gemini/roadmap.md) | **演进大盘**。阶段 0 ~ 10 交付状态、System-1/2 攻坚记录与多租户 Schema 隔离规划。 |

---

## 📁 项目目录结构 (Project Structure)

```text
.
├── app/                              # Next.js App Router 前端与 API 服务
│   ├── _components/                  # 业务与 UI 组件 (Civic Light 体系)
│   ├── api/                          # RESTful API 端点 (双模态: cluster 批研判, tickets 单工单流式接入)
│   │   └── workbench/pipeline-state/ # 流水线工厂状态。任务状态大写；离线节点不报耗时
│   ├── dict/                         # 标准字典与别名知识库页面 (/dict)
│   ├── multifreq/                    # 工单透势全景研判页面 (/multifreq)
│   ├── themes/                       # 多频工单看板页面 (/themes)
│   ├── tickets/                      # 工单中心下钻核查页面 (/tickets)
│   └── workbench/                    # 研判画布组件，不是独立路由。入口是顶部抽屉 PipelineDrawer
├── backend/                          # 核心业务后端与认知中枢
│   ├── agent.ts                      # LangGraph 流水线。顺序是抽取、对齐、聚类、主题建议
│   ├── incremental-cluster.ts        # 新来的单张工单并入已有主题。同一件事才并，不按相隔多久拆开
│   ├── same-incident-cluster.ts      # 同一件事或同一个具体地点的判定。向量由调用方算好传进来
│   ├── embed-products.ts             # 把抽取产物做成向量。429 会等待后重试
│   ├── node/                         # 工作流节点
│   │   ├── extract-node.ts           # 每条工单：System 1，然后 System 2 抽实体和摘要
│   │   ├── canonical-node.ts         # 别名对齐，缩短地点写法
│   │   ├── cluster-node.ts           # 嵌入抽取产物，再按同一件事或同一地点成主题
│   │   ├── cluster-validator.ts      # 丢掉主体是「市民」这类空泛词的主题
│   │   └── summary-node.ts           # 只给两条及以上的主题写处置建议，思考关掉
│   └── rules.ts                      # 统一规则与险情红线词库
├── packages/                         # Monorepo 独立高性能核心引擎包
│   ├── civic-system-one/             # System-1 快思考引擎 (<1ms 前向分类 / 12,600 TPS)
│   ├── civic-system-two/             # System-2 慢思考通用认知引擎 (OpenAI 协议 / Metal 调优 / CoT 剥离)
│   └── civic-anonymizer/             # 全要素可逆隐私脱敏引擎 (出站加密 / 入库无损还原)
├── lib/                              # 公共服务库 (tokens.ts 集中预算管理, vocabulary.ts 动态词典)
├── scripts/                          # 迁移、种子、开发启动、样本重跑
├── tests/                            # 不改库的规则核对
│   ├── test-work-order-date.ts       # 编号日期：正文里的另一个日期不能替换编号
│   ├── test-same-incident-cluster.ts # 东湖学府并在一起，不同地点的烟花和欠薪不并
│   └── test-incident-profile.ts      # 同一条路上的两家欠薪、相邻门牌不并
└── docs/                             # 系统权威技术规范与架构文档
```

后端其余文件：`prompt.ts` 写抽取和主题建议的提示，主体和地点允许为空字符串；`state.ts` 是流水线状态，`theme-metrics.ts` 计算主题节奏。`lib/work-order-date.ts` 从工单编号读登记日。`lib/ticket-ingest.ts` 入库时先用这个日期。数据库字段见 [`docs/DBS.md`](docs/DBS.md)。

AI 研判流水线工厂是全站顶部抽屉，不是 `/workbench` 页面。窄屏和宽屏用同一块 React Flow 画布，标题可以换行。自动刷新时保留节点已量到的宽高，否则卡片会整批消失。节点耗时优先用模型的 `predicted_ms`，界面一律写成秒。细节见 [`docs/WORKFLOW.md`](docs/WORKFLOW.md) 第六节。

---

## 🛠️ 技术栈与架构选型

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **全栈框架** | **Next.js 15+ (App Router) + React 19** | 前后端一体化全栈框架 |
| **工作流编排** | **@langchain/langgraph + LangGraph JS** | 状态机驱动的高可靠 Agent 图工作流 |
| **数据库 & ORM** | **PostgreSQL + Drizzle ORM** | 高性能多租户独立 Schema 物理隔离与类型安全 ORM |
| **UI 设计系统** | **Tailwind CSS + Radix UI + Lucide Icons** | 统一定制的 Civic Light 政务视觉规范 |
| **大模型** | **本地 Bonsai 2 27B + BAAI/bge-m3** | 每条工单抽实体和摘要；抽取产物做向量。主题建议只写给多条工单的主题 |
| **测试与执行** | **TSX + TypeScript 5.7+** | 零编译极速 TypeScript 脚本与类型保障 |

---

## 🚀 快速开始指引

### 1. 安装项目依赖
```bash
pnpm install
```

### 2. 配置环境变量
复制根目录的 `.env.example` 为 `.env.local`，并配置 PostgreSQL 数据库连接、模型 API Key 与认证密钥：
```ini
# PostgreSQL Database Connection URL (Drizzle ORM)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ticket_radar

# OpenAI-compatible Chat LLM
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://www.78code.cc/v1
OPENAI_MODEL=gpt-5.6-terra

# Better Auth 生产级认证配置
BETTER_AUTH_SECRET=your_32_character_random_secret_here
BETTER_AUTH_URL=http://localhost:3000

# 默认系统管理员账号 (pnpm db:seed-admin 读取;生产请覆盖 ADMIN_PASSWORD)
ADMIN_EMAIL=admin@civic.local
ADMIN_USERNAME=admin
ADMIN_PASSWORD=admin
```

> 注：`pnpm db:init-admin` 通过 `process.env` 读取上述 `ADMIN_*`。本地开发若直接 `pnpm db:init-admin` 而未在 shell 里 source `.env.local`,将使用代码内置默认值 `admin@civic.local / admin / admin`。生产环境务必用 `.env.vps` 覆盖后执行。

### 3. 一键初始化数据库与双站点体系
```bash
# 一键完成全量初始化：自动执行表迁移、顺德与天河双站点、高精行政边界、全套数据字典与管理员账号
pnpm db:init

# 若仅需单独重置管理员账号
pnpm db:init-admin
```

### 4. 核对日期和聚类规则
```bash
npx tsx tests/test-work-order-date.ts
npx tsx tests/test-same-incident-cluster.ts
npx tsx tests/test-incident-profile.ts
```

### 5. 启动本地全栈开发服务 (Next.js + System-2 本地慢思考引擎 + 研判队列)
```bash
pnpm dev
```
> 💡 **全栈一键拉起**：`pnpm dev` 由 [`scripts/dev.ts`](scripts/dev.ts) 编排两件套：
> 1. **System-2 慢思考推理**（[llama-server](https://github.com/ggerganov/llama.cpp) Metal 加速，端口 8132）——仅当本地模型物料存在时
> 2. **Next.js dev server**（端口 3000）——Web + API + 内嵌 in-process 研判 worker
>
> 研判 worker **直接跑在 next-server 进程内**（已删除 `scripts/cluster-worker.ts`），无独立 tsx 进程，详情见 [docs/WORKFLOW.md §3.1](docs/WORKFLOW.md)。**启动时自动 bootstrap**（[instrumentation.ts](instrumentation.ts)）：next-server 一启动自动扫描所有 region，对有未处理工单的 region 入队 + 启 worker，不需要手动点按钮。Ctrl+C 退出时 SIGTERM 广播给两个子进程，3 秒内未退的 SIGKILL 兜底，不会留孤儿。若只想启动前端/API（不跑大模型），用 `pnpm dev:web`（云端 API 灾备模式）。

在浏览器中访问 [http://localhost:3000](http://localhost:3000) 即可开始使用！
- **系统登录账号**：`admin`
- **系统登录密码**：`admin`

---

## 常用开发与维护指令

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | **全栈启动**：自动并行拉起 System-2 本地大模型推理引擎 (8132) + 研判队列 worker + Next.js (3000)；Ctrl+C 3s 内兜底 SIGKILL，不会留孤儿 |
| `pnpm dev:web` | **轻量启动**：仅启动 Next.js 本地开发服务 (大模型依赖云端 API 灾备模式) |
| `pnpm dev:llm` | **独立调试**：单独拉起 System-2 本地 Metal 推理服务 (Bonsai 2 27B) |
| `pnpm build` | 编译 Next.js 生产版本构建 |
| `pnpm db:init` | **全量一键初始化**：表结构迁移、顺德与天河双站点、高精天地图边界、全量字典、管理员账号 |
| `pnpm db:init-admin` | 初始化/重置默认系统管理员账号 (`admin` / `admin`) |
| `pnpm db:migrate` | 运行 Drizzle SQL 数据库迁移 |
| `pnpm db:init-tenants` | 初始化/同步多租户站点、行政边界与标准词汇别名知识库 |
| `pnpm db:clear` | 清空当前站点的工单与聚类主题数据 |
| `pnpm db:studio` | 打开 Drizzle Studio 可视化数据管理面板 |
| `npx tsc --noEmit` | 执行 TypeScript 全局静态类型检查 |

---

## 📚 核心技术文档体系 (Architecture & Docs)

- **[Spatial & Geo-Location Architecture](docs/SPATIAL.md)**：Fourth-level subdistrict polygon mesh, CGCS2000 zero-drift coordinates, Tianditu WMTS caching, and spatial-semantic clustering.
- **[AI Workflow & LangGraph Pipeline](docs/WORKFLOW.md)**：System-1 ONNX fast extraction, System-2 Bonsai 27B deep entity resolution, and incident clustering rules.
- **[Deployment & Ops Guide](docs/DEPLOY.md)**：Local dev, VPS Docker Compose orchestration, and isolated air-gapped government cloud setup.
- **[Multi-Tenant Database Architecture](docs/DBS.md)**：PostgreSQL schema physical isolation, Better Auth tenant routing, and migrations.

