# 民声智理 · 顺德 12345 AI 智能研判系统

> **基于 LangGraph JS 图工作流、PostgreSQL 权威知识库与轻量 GraphRAG 的政务 12345 热线多频诉求智能识别、实体拓扑聚类、二级 AI 仲裁纠偏与全周期督办研判平台。**

---

## 💡 项目核心亮点 (Core Highlights)

```
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  🎯 零幻觉强约束 │     │  🚨 假闭环狙击  │     │  ⚖️ 二级 AI 仲裁 │
  │  10大镇街/7类白名单 │     │ 72h时序追踪/直推督办 │     │ 低置信消歧/人机协同 │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
  ┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
  │  🔍 高保真双轨聚类 │     │  📝 公文级精准建议 │     │  🛡️ 纯离线数据不出域 │
  │ 主体/地点精准隔离  │     │ 牵头/协办/时限/路径 │     │ 隐私脱敏/全私有部署 │
  └─────────────────┘     └─────────────────┘     └─────────────────┘
```

1. **🎯 权威政务白名单，彻底根治大模型幻觉**
   - 固化佛山市顺德区 10 大法定镇街、98+ 村居社区及 7 大民生诉求分类为 **Prompt 强约束白名单**；
   - 结合口语俗称边界安全替换（如 `容奇/桂洲` $\to$ `容桂街道`、`德胜新区` $\to$ `大良街道`）与 **别名自学习沉淀引擎**，彻底杜绝模型凭空捏造虚构镇街与机构。

2. **🚨 独创“假闭环”智能识别算法**
   - 针对“数字办结、问题依旧”的基层治理痛点，建立 72 小时时序衰减与空间拓扑追踪模型；
   - 自动识别办结后短期内同点同因再次投诉的**假闭环工单**，标记红色警报并直达生成《12345 重点督查督办单》。

3. **⚖️ 低置信度二级 AI 仲裁与事实消歧**
   - 首轮抽取综合置信度 `< 60`、主体命中泛词（如“车主/商家”）或地点模糊时，自动触发**二级专家模型**深度事实复核；
   - 修正失败自动推入 `review_queue` 人工复核队列，实现可信高效的“人机协同”闭环。

4. **🔍 高保真双轨聚类与质检器硬核拦截 (Cluster Validator)**
   - **主体型多频**（如同一车牌号、同一商户字号）：要求 **100% 字符精确对齐**，严禁跨主体串扰；
   - **微观地点型多频**（同一小区、具体门牌点位）：微观空间拓扑聚合，自动区分“群体聚集”与“个体重复”；
   - **质检拦截**：严禁空泛虚词（如“车主”）独立成群，严格拦截跨镇街时空拓扑误聚。

5. **📝 公文级针对性协同处置建议**
   - 告别千篇一律的“现场核实并处理”式套话；
   - 深度结合基层权责清单，精准指定**牵头部门**（如交警中队）、**协办部门**（如综合执法办）、**响应时限**（如1小时到场）与**法定办理路径**，可直接转化为标准政务公文。

6. **🔒 权威认证与全链路安全路由守卫 (Better Auth)**
   - 深度集成 **Better Auth** 生产级身份认证框架与 Drizzle ORM PostgreSQL 适配器；
   - **全局路由守卫**：内置 Next.js Middleware 鉴权拦截，除 `/login` 与公共静态资源外，全站核心研判页面及 API 均受 session cookie 保护；
   - **默认管理员**：内置 `admin` / `admin` 系统管理员账号与一键 Seeder（`pnpm db:seed-admin`），支持用户名/密码安全登录与会话持久化；
   - **一体化 Header**：统一 34px 高度度量衡，集成**高清演示视频点播弹窗**（支持 6 大核心模块快速切换与独立播放）、**GitHub 官方源码仓库直达**及**一体化管理员状态与退出卡片**。

7. **🛡️ 政务信创纯离线与隐私脱敏保障**
   - 内置 `anonymizer.ts` 全流程脱敏处理器，对姓名、手机、身份证等关键 PII 自动掩码；
   - 支持 Docker 一键部署与政务内网 **本地模型纯离线推理 (vLLM / Ollama)**，数据 100% 不出域，满足等保与政务合规红线。

8. **🎨 统一定制 Civic Light 政务级设计体系**
   - 全站五大核心模块（**数据总览**、**多频工单**、**工单透势**、**工单中心**、**标准字典**）统一遵循 Civic Light 设计语言；
   - 包含顺德 10 镇街 SVG 态势地图、紧急×重要四象限透势图，右下角悬浮 **AI 研判副驾驶 (Copilot)** 支持实时自然语言问数与建议生成。

---

## 🎬 系统演示视频 (System Demo Videos)

项目录制了完整的产品功能演示视频，涵盖从宏观态势总览到微观多频工单穿透研判的全流程：

| 演示模块 | 视频文件 | 核心演示内容与研判亮点 |
| :--- | :--- | :--- |
| 🌟 **系统全景总览** | [`民声智理_总览片_v1.mp4`](public/videos/民声智理_总览片_v1.mp4) | **全景总览与产品宣传片**：民声智理整体架构、核心价值、AI 研判闭环与基层赋能成效。 |
| 📊 **数据总览看板** | [`数据总览.mp4`](public/videos/数据总览.mp4) | **首页态势大盘**：10 镇街热点地图、全区实时工单统计、多维处置率指标与 AI Copilot 交互。 |
| 🗂️ **多频工单看板** | [`多频工单.mp4`](public/videos/多频工单.mp4) | **双轨聚类折叠**：183+ 多频主题群组智能聚类、一键折叠折叠详情、实体拓扑与公文级处置建议。 |
| 📈 **工单透势研判** | [`工单透势.mp4`](public/videos/工单透势.mp4) | **四象限与假闭环追踪**：紧急×重要象限图、72h 时序衰减追踪、假闭环红色预警与重点督办单生成。 |
| 📑 **工单中心核查** | [`工单中心.mp4`](public/videos/工单中心.mp4) | **全量工单穿透**：高阶复合检索、四要素抽取明细、二级 AI 仲裁消歧记录与人工复核流转。 |
| 📖 **标准字典治理** | [`标准字典.mp4`](public/videos/标准字典.mp4) | **知识库与别名沉淀**：顺德 10 大镇街/98+村居白名单、别名自学习沉淀与权威实体对齐管理。 |

---

## 📚 项目专属文档体系 (Documentation)

项目所有核心架构设计、数据库字典、工作流机制与部署运维手册均沉淀在 **[`docs/`](docs/)** 目录中，推荐查阅：

| 文档名称 | 路径 | 核心内容说明 |
| :--- | :--- | :--- |
| 📐 **AI 工作流全景架构** | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | **架构必读**。包含完整 LangGraph 图工作流 Mermaid 拓扑图、各节点职责、保真质检器与保底填充矩阵。 |
| 🗄️ **数据库设计与字典规范** | [`docs/DBS.md`](docs/DBS.md) | **数据必读**。7 大核心数据表 ER 拓扑关系、Drizzle ORM Schema 定义、全量字段字典与数据库常用运维命令。 |
| 🚀 **系统部署与运维手册** | [`docs/DEPLOY.md`](docs/DEPLOY.md) | **运维必读**。涵盖本地开发启动、VPS 云端 Docker 容器化部署、政务信创/内网纯离线私有化部署及排障指南。 |
| 📦 **依赖清单与组件架构** | [`docs/DEPS.md`](docs/DEPS.md) | **全栈依赖**。生产依赖与开源许可证合规说明、前端与业务组件完整架构映射表。 |
| 📈 **架构演进与优化备忘** | [`docs/IMPROVE.md`](docs/IMPROVE.md) | **迭代日志**。算法演进历史、准确度提升路径与 Civic UI 落地重构记录。 |
| 🗺️ **待办任务与路线图** | [`docs/TODOS.md`](docs/TODOS.md) | **任务面板**。黑客松核心功能交付状态、P0-P3 优先级规划与全员开发红线。 |

---

## 📁 项目目录结构 (Project Structure)

```text
.
├── app/                              # Next.js App Router 前端与 API 服务
│   ├── _components/                  # 业务与 UI 组件
│   │   ├── civic/                    # Civic Light 核心组件 (Nav, StatCard, Charts, Map, Quadrant 等)
│   │   ├── copilot/                  # AI 研判副驾驶浮动抽屉
│   │   ├── dashboard/                # 工作大盘看板组件与导入筛选栏
│   │   ├── graph/                    # 力导向知识图谱渲染器
│   │   ├── kanban/                   # 多频主题泳道看板与卡片
│   │   ├── table/                    # 工单核查总表、虚拟表格与下钻抽屉
│   │   └── ui/                       # Radix / Tailwind 原子组件库 (Select, Dialog, Tabs 等)
│   ├── api/                          # RESTful API 端点
│   │   ├── cluster/                  # 触发 LangGraph 聚类与实时进度推送
│   │   ├── clusters/                 # 多频主题群组服务
│   │   ├── copilot/                  # AI 智能研判对话接口
│   │   ├── dict/                     # 词典与别名知识库管理接口
│   │   ├── graph/                    # 知识图谱拓扑数据接口
│   │   ├── overview/                 # 数据总览统计接口
│   │   ├── review/                   # 人工复核队列管理接口
│   │   ├── stats/                    # 核心态势指标服务
│   │   ├── themes/                   # 多频工单看板数据接口
│   │   ├── tickets/                  # 工单检索与分页接口
│   │   ├── trends/                   # 趋势图表时序数据接口
│   │   └── workorders/               # 工单中心数据服务
│   ├── dict/                         # 标准字典与别名知识库页面 (/dict)
│   ├── multifreq/                    # 工单透势全景研判页面 (/multifreq)
│   ├── themes/                       # 多频工单看板页面 (/themes)
│   ├── tickets/                      # 工单中心下钻核查页面 (/tickets)
│   ├── globals.css                   # 全局 Tailwind CSS + Civic Light 样式
│   └── page.tsx                      # 首页数据总览 (Dashboard)
├── backend/                          # LangGraph JS 图工作流后端引擎
│   ├── node/                         # 核心工作流节点
│   │   ├── arbitrator-node.ts        # 二级 AI 仲裁与事实消歧节点
│   │   ├── canonical-node.ts         # 实体对齐与别名沉淀节点
│   │   ├── cluster-node.ts           # 双轨多频聚类节点
│   │   ├── cluster-validator.ts      # 聚类真实性与质量交叉质检器
│   │   ├── extract-node.ts           # 大模型四要素结构化抽取节点
│   │   ├── fake-closure.ts           # 假闭环诉求识别算法
│   │   ├── risk-rules.ts             # 风险红黄蓝规则裁定引擎
│   │   └── summary-node.ts           # 公文级全貌研判与处置建议节点
│   ├── anonymizer.ts                 # 个人隐私数据脱敏处理器
│   ├── model.ts                      # 大模型 / Embedding / Rerank 统一客户端
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
│   ├── vocabulary.ts                 # 顺德区法定 10 大镇街与 7 大分类标准词汇库
├── public/                           # 静态资源与多媒体展示文件
│   ├── civic/                        # 顺德地图矢量与 ECharts 离线库
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
| **数据库 & ORM** | **PostgreSQL + Drizzle ORM** | 高性能关系型存储与类型安全 ORM |
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
```

### 3. 初始化数据库结构与标准词汇表
```bash
# 1. 执行数据库迁移（自动创建 tickets, themes, vocabularies, aliases, user, session 等全部表）
pnpm db:migrate

# 2. 一键初始化顺德区 10 大法定镇街、社区与 72+ 条别名映射知识库
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
