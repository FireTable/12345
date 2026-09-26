# 民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 V2 Production)

> **基于 System-1 (神经快思考) + System-2 (深度慢思考) 双引擎分层协同、PostgreSQL 多城市 Schema 物理隔离与权威知识库、微观时空核心基底对齐 (Spatial Core) 与 72h 滑动窗口增量吸附算法的政务 12345 热线多频诉求智能识别、实体图谱聚类与全周期督办研判 SuperAgent 平台。**

---

## 💡 项目核心亮点 (Core Highlights)

```
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  ⚡ 快思考极速直通│     │  🧠 慢思考深度推导│     │  🌐 多城市/多租户│
  │ <1ms 咨询0Token直分 │     │ 3100+字CoT穿透权责 │     │ Schema隔离/AI拓荒│
  └─────────────────┘     └─────────────────┘     └─────────────────┘
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  🔍 时空基底增量吸附│     │  🚨 假闭环时序狙击 │     │  🛡️ 纯离线数据不出域 │
  │ 72h滑动窗口秒级归卷 │     │ 办结衰减/直推督办  │     │ 隐私脱敏/全私有部署 │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **⚡ System-1 快思考极速决策（<1ms 耗时，80%+ 简单工单 0 Token 消耗）**
   - 自适应本地 Apple Silicon MPS 神经芯片或 ONNX Runtime，单条纯推理耗时仅 **0.079 ms**，吞吐突破 **12,600 TPS**；
   - 对政策咨询（INQUIRY，0h SLA）及工单催办以 100 分置信度毫秒级直接分派，免调用昂贵大模型。

2. **🧠 System-2 慢思考与长工单深度公文研判（Bonsai 2 27B PTQ1_0）**
   - 本地 Apple Silicon Metal 硬件深度调优，三值量化权重仅 5.5GB，单流稳定 **20+ tokens/s**；
   - 显式分离思维链（CoT），在多频成团后统一推导 **3100+ 字符思考过程**，深度穿透跨部门权责争议，生成“牵头部门、协办单位、10分/30分/2小时分步办理与回访”的高可操作性预案。

3. **🌐 多城市/多租户 Schema 物理级隔离与 AI 自动拓荒 (`/admin/regions`)**
   - **数据物理隔离**：基于 PostgreSQL 独立 Schema 架构（`region_{id}`），不同城市/区县站点数据、字典与聚类案卷 100% 物理隔离，杜绝跨区数据串扰；
   - **AI 智能拓荒 (Scout)**：30 秒输入任意新城市/区县（如广州海珠、北京朝阳），AI 自动生成标准化法定镇街、社区与权威别名知识库；
   - **站点热插拔与动态地图**：前端统一集成多站点实时切换器，自适应加载对应辖区 SVG 态势地图与多维指标（默认内置佛山顺德、广州海珠等预置站点）。

4. **🔍 微观时空核心基底提纯 (`extractSpatialCore`) 与 72h 滑动窗口增量吸附**
   - **空间提纯**：自动剥离门牌号（“28号”）、店铺名等修饰噪点，提纯出公共道路核心基底（如 `大良街道金榜上街`），彻底解决地址微小差异无法聚类的顽疾；
   - **滑动窗口增量吸附**：以“距离该事件最后一个事件发生时间的 72 小时滑动窗口”为准，后续追加工单 **1.9 毫秒** 秒级吸附进在办案卷，平时继承老方案（0 秒等待），突发险情质变精准触发慢思考升级。

5. **🎯 多辖区权威政务白名单与确定性物理校准，彻底根治大模型幻觉**
   - 固化辖区法定镇街、村居社区（预置顺德区 10 大镇街、98+ 村居等）及 7 大民生诉求分类为 **Prompt 强约束白名单**；
   - 彻底废除旧版低置信度反复套娃仲裁死循环，改由本地确定性字典与规则库进行物理校准。

6. **🚨 独创“假闭环”智能识别算法**
   - 针对“数字办结、问题依旧”的基层治理痛点，建立 72 小时时序衰减与空间拓扑追踪模型；
   - 自动识别办结后短期内同点同因再次投诉的**假闭环工单**，标记红色警报并直达生成《12345 重点督查督办单》。

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
| 📈 **工单透势研判** | [`工单透势.mp4`](public/videos/工单透势.mp4) | **四象限与假闭环追踪**：紧急×重要象限图、72h 时序衰减追踪、假闭环红色预警与重点督办单生成。 |
| 📑 **工单中心核查** | [`工单中心.mp4`](public/videos/工单中心.mp4) | **全量工单穿透**：高阶复合检索、四要素抽取明细、实体归一化与人工复核流转。 |
| 📖 **标准字典治理** | [`标准字典.mp4`](public/videos/标准字典.mp4) | **知识库与别名沉淀**：多辖区法定镇街/村居白名单、别名自学习沉淀与权威实体对齐管理。 |

---

## 📚 项目专属文档体系 (Documentation)

项目所有核心架构设计、工作流拓扑、数据库字典与部署运维手册均已完备沉淀：

| 文档名称 | 路径 | 核心内容说明 |
| :--- | :--- | :--- |
| 📐 **V2 工作流全景架构** | [`.gemini/v2-workflow.md`](.gemini/v2-workflow.md) | **最新生产架构必读**。System-1/2 双引擎分层、微观时空基底提纯、增量滑动吸附与端到端实测数据。 |
| 📜 **V1 历史工作流存档** | [`.gemini/v1-workflow.md`](.gemini/v1-workflow.md) | **历史演进备忘**。记录 main 分支原始 LangGraph 工作流设计与演进痛点。 |
| 📐 **AI 工作流工程规范** | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | **架构必读**。端到端各节点职责、字段保底矩阵、保真质检器与多模态 API 接入。 |
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
│   ├── dict/                         # 标准字典与别名知识库页面 (/dict)
│   ├── multifreq/                    # 工单透势全景研判页面 (/multifreq)
│   ├── themes/                       # 多频工单看板页面 (/themes)
│   └── tickets/                      # 工单中心下钻核查页面 (/tickets)
├── backend/                          # 核心业务后端与认知中枢
│   ├── agent.ts                      # LangGraph 流水线与 ingestSingleTicketPipeline 单工单增量接入
│   ├── incremental-cluster.ts        # 增量时空工单吸附引擎 (72h滑动窗口 / 条件慢思考升级)
│   ├── node/                         # 工作流节点
│   │   ├── extract-node.ts           # System-2 结构化直出 (think: false, ~3s/件)
│   │   ├── canonical-node.ts         # extractSpatialCore 微观空间提纯与纯行政区划防吸附
│   │   ├── cluster-node.ts           # 存量在办主题吸附 + Louvain 双轨多频聚类
│   │   ├── cluster-validator.ts      # 聚类真实性与质量交叉质检器
│   │   └── summary-node.ts           # System-2 深度慢思考 (think: true, 3100+字思维链公文建议)
│   └── rules.ts                      # 统一规则与险情红线词库
├── packages/                         # Monorepo 独立高性能核心引擎包
│   ├── civic-system-one/             # System-1 快思考引擎 (<1ms 前向分类 / 12,600 TPS)
│   ├── civic-system-two/             # System-2 慢思考通用认知引擎 (OpenAI 协议 / Metal 调优 / CoT 剥离)
│   └── civic-anonymizer/             # 全要素可逆隐私脱敏引擎 (出站加密 / 入库无损还原)
├── lib/                              # 公共服务库 (tokens.ts 集中预算管理, vocabulary.ts 动态词典)
├── scripts/                          # 自动化测试与评测脚本
│   ├── test-pipeline-cluster.ts      # 7 工单真实业务端到端全链路闭环评测
│   └── test-incremental-clustering.ts # 增量时空吸附与 72h 滑动时间窗口评测
└── docs/                             # 系统权威技术规范与架构文档
```
│   ├── prompt.ts                     # 结构化 Prompt 模版与 Zod Schemas
│   ├── rules.ts                      # 业务规则与常量配置
│   ├── state.ts                      # LangGraph 状态机 State 数据模型
│   └── theme-metrics.ts              # 主题统计特征与雷达维度计算
├── db/                               # PostgreSQL 数据库与 Drizzle ORM
│   ├── migrations/                   # 数据库版本迁移 SQL 脚本
│   ├── client.ts                     # PostgreSQL 数据库连接客户端
│   └── schema.ts                     # 数据表结构定义 (Tickets, Themes, Vocabularies, Aliases 等)
├── docs/                             # 专题架构与业务文档体系 (详见上方文档说明)
├── lib/                              # 共享通用类库与知识字典
│   ├── admin-area.ts                 # 行政区划解析器
│   ├── alias-dict.ts                 # 别名映射与实体归一化引擎
│   ├── civic-cluster.ts              # 聚类多频模式与紧急度常量
│   ├── civic-dto.ts                  # 数据传输对象转换器
│   ├── civic-persist.ts              # 聚类结果持久化引擎
│   ├── civic-queries.ts              # 业务多维聚合查询
│   ├── civic-stats.ts                # 态势洞察与指标生成器
│   ├── tenant/                       # 多租户 Schema 与多城市会话管理
│   ├── presets/                      # 预置辖区站点字典 (foshan_shunde.json 等)
│   └── vocabulary.ts                 # 多辖区法定镇街与 7 大分类动态标准词汇库
├── public/                           # 静态资源与多媒体展示文件
│   ├── civic/                        # 辖区态势地图矢量 (内置顺德 10 镇街 SVG 等) 与 ECharts 离线库
│   └── videos/                       # 系统全流程高清演示视频 (总览/看板/透势/工单/字典)
├── scripts/                          # 自动化脚本与测试套件
│   ├── db-migrate.ts                 # 数据库迁移执行脚本
│   ├── db-seed.ts                    # 样例工单数据入库脚本
│   ├── seed-vocabulary.ts            # 权威政务词汇与别名初始化脚本
│   └── test-accuracy-pipeline.ts     # 全链路准确度自动化测试套件
├── package.json                      # 项目依赖与指令配置
└── tsconfig.json                     # TypeScript 配置
```

---

## 🛠️ 技术栈与架构选型

| 层次 | 技术选型 | 说明 |
| :--- | :--- | :--- |
| **全栈框架** | **Next.js 15+ (App Router) + React 19** | 前后端一体化全栈框架 |
| **工作流编排** | **@langchain/langgraph + LangGraph JS** | 状态机驱动的高可靠 Agent 图工作流 |
| **数据库 & ORM** | **PostgreSQL + Drizzle ORM** | 高性能多租户独立 Schema 物理隔离与类型安全 ORM |
| **UI 设计系统** | **Tailwind CSS + Radix UI + Lucide Icons** | 统一定制的 Civic Light 政务视觉规范 |
| **大模型生态** | **ChatOpenAI (gpt-5.6-terra / BGE-M3)** | 结构化要素抽取、二级仲裁与公文研判 |
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

> 注：`pnpm db:seed-admin` 通过 `process.env` 读取上述 `ADMIN_*`。本地开发若直接 `pnpm db:seed-admin` 而未在 shell 里 source `.env.local`,将使用代码内置默认值 `admin@civic.local / admin / admin`。生产环境务必用 `.env.vps` 覆盖后执行。

### 3. 初始化数据库结构与标准词汇表
```bash
# 1. 执行数据库迁移（自动创建 regions, tickets, themes, vocabularies, aliases, user, session 等全部表）
pnpm db:migrate

# 2. 一键初始化预置辖区（默认佛山顺德，亦可通过 /admin/regions 随时一键 AI 拓荒任意城市）法定镇街、社区与 72+ 条别名映射知识库
pnpm db:vocab

# 3. 初始化系统默认管理员账号 (admin / admin)
pnpm db:seed-admin

# 4. （可选）写入内置样本工单数据
pnpm db:seed
```

### 4. 运行全链路准确度测试
```bash
npx tsx scripts/test-accuracy-pipeline.ts
```

### 5. 启动本地开发服务
```bash
pnpm dev
```
在浏览器中访问 [http://localhost:3000](http://localhost:3000) 即可开始使用！
- **系统登录账号**：`admin`
- **系统登录密码**：`admin`

---

## 常用开发与维护指令

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动 Next.js 本地开发服务 |
| `pnpm build` | 编译 Next.js 生产版本构建 |
| `pnpm db:migrate` | 运行 Drizzle SQL 数据库迁移 |
| `pnpm db:vocab` | 一键初始化/同步标准政务词汇表与别名知识库 |
| `pnpm db:seed-admin` | 初始化/重置默认系统管理员账号 (`admin` / `admin`) |
| `pnpm db:seed` | 导入样例脱敏工单数据 |
| `pnpm db:studio` | 打开 Drizzle Studio 可视化数据管理面板 |
| `npx tsc --noEmit` | 执行 TypeScript 全局静态类型检查 |
