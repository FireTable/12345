# 顺德区 12345 热线智能工单管理平台 (Ticket Radar)

基于 **LangGraph JS 图工作流**、**PostgreSQL 权威知识库** 与 **轻量 GraphRAG** 的政务 12345 热线多频诉求智能识别、实体拓扑聚类、二级 AI 仲裁纠偏与全周期督办研判平台。

---

## 🌟 核心业务与技术特性

### 1. 权威政务标准词汇库与 Prompt 白名单约束
- **法定区划保真**：严格固化佛山市顺德区 10 大法定辖区（大良街道、容桂街道、伦教街道、勒流街道、陈村镇、北滘镇、乐从镇、龙江镇、杏坛镇、均安镇）及 98+ 个重点村居社区与产业园区。
- **杜绝模型幻觉**：将法定行政区划与 7 大标准民生分类（城市管理、市场监管、社会治理、交通出行、生态环境、劳动社保、公共安全）作为权威白名单强约束注入 Prompt，**彻底杜绝大模型凭空捏造不存在的镇街或虚构机构**。

### 2. 别名识别、自学习沉淀与自动归一化替换
- **口语与缩写安全替换**：将市民口语俗称（如 `容奇/桂洲` $\to$ `容桂街道`、`德胜新区` $\to$ `大良街道`、`碧桂园总部` $\to$ `北滘镇`）在入模前进行边界安全替换。
- **知识库自学习沉淀**：AI 运行时新挖掘出的实体同义词自动异步持久化写入 PostgreSQL `aliasesTable`，支持全系统自增进化与后台可视化统一维护。

### 3. 低置信度二级 AI 仲裁与事实消歧机制
- **智能分级分流**：当首轮抽取置信度 `< 60`、主体为泛词（如“车主/商家/当事人”）或地点存在歧义时，自动触发二级专家模型进行深度事实复核与消歧纠偏。
- **人机协同闭环**：争议工单自动打标推入 `review_queue` 人工复核队列。

### 4. 高保真双轨聚类与假闭环识别
- **两大真实政务场景**：
  - **【主体型多频】**：同一明确责任主体（如同一车牌号、同一商户字号）的多次诉求；
  - **【微观地点型多频】**：同一具体物理空间（同一小区、具体门牌点位）的群发共性民生治理事件。
- **形态与假闭环判别**：算法区分 `GROUP_GATHERING`（群体聚集）与 `INDIVIDUAL_REPEAT`（个体重复），自动识别办结后短时间内再次投诉的“假闭环”工单。

### 5. 聚类质量与真实性交叉质检器 (Cluster Validator)
- **多维度硬核拦截**：
  - 车牌号 100% 字符精确对齐，严防跨车牌号串扰混淆；
  - 严禁空泛虚词（如“车主”）独立成群；
  - 校验镇街时空拓扑连续性，拦截跨多个镇街的误拉郎配。

### 6. 公文级全貌研判与针对性协同处置建议
- 告别“现场核实并处理”的千篇一律套话，根据具体民生领域精准指定**牵头部门/科室**、**响应时限**与**具体办理路径**（如交警+综合执法1小时到场排查、市监2个工作日核查账目等）。

### 7. 统一 Civic Light / Tailwind / shadcn 设计体系
- 全站五大核心模块（工作面板、工单中心、多频透视、群组中心、字典管理）统一采用 **Civic Light Design System**，拥有统一的指标卡片（`StatCard`）、Radix 下拉选择器（`Select`）、抽屉与交互弹窗。

---

## 📚 项目专属文档体系 (Documentation)

项目所有核心架构设计、数据库字典、工作流机制与规范文档均沉淀在 **[`docs/`](docs/)** 目录中，推荐查阅：

| 文档名称 | 路径 | 核心内容说明 |
| :--- | :--- | :--- |
| **AI 工作流全景架构** | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | **必读**。包含完整 LangGraph 图工作流 Mermaid 拓扑图、各节点逻辑、仲裁机制与质检器规范。 |
| **数据库设计与字典规范** | [`docs/DBS.md`](docs/DBS.md) | PostgreSQL 核心表结构、Drizzle ORM Schema 定义、索引与字段说明。 |
| **依赖清单与合规许可证** | [`docs/DEPS.md`](docs/DEPS.md) | 全栈依赖组件、版本及开源许可协议清单。 |
| **架构演进与优化备忘** | [`docs/IMPROVE.md`](docs/IMPROVE.md) | 算法演进历史、准确度提升路径与重构记录。 |
| **待办任务与路线图** | [`docs/TODOS.md`](docs/TODOS.md) | 后续功能迭代、GIS 热力图与批量流转规划。 |

---

## 📁 项目目录结构 (Project Structure)

```text
.
├── app/                              # Next.js App Router 前端与 API 服务
│   ├── _components/                  # 业务与 UI 组件
│   │   ├── civic/                    # Civic 核心组件 (CivicNav, StatCard, Workflow)
│   │   ├── dashboard/                # 工作大盘看板组件与筛选栏
│   │   ├── graph/                    # 力导向知识图谱渲染器
│   │   └── ui/                       # Shadcn / Radix 原子组件库 (Select, Dialog, Tabs 等)
│   ├── api/                          # RESTful API 端点
│   │   ├── cluster/                  # 触发 LangGraph 聚类与实时进度推送
│   │   ├── clusters/                 # 多频主题群组服务
│   │   ├── copilot/                  # AI 智能研判对话接口
│   │   ├── dict/                     # 词典与别名知识库管理接口
│   │   ├── tickets/                  # 工单检索与分页接口
│   │   └── workorders/               # 工单中心数据服务
│   ├── dict/                         # 字典与别名知识库管理页面 (/dict)
│   ├── multifreq/                    # 多频透视全景研判页面 (/multifreq)
│   ├── themes/                       # 群组中心看板页面 (/themes)
│   ├── tickets/                      # 工单中心下钻核查页面 (/tickets)
│   ├── globals.css                   # 全局 Tailwind CSS + Civic Light 样式
│   └── page.tsx                      # 首页工作面板 (Dashboard)
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
│   └── state.ts                      # LangGraph 状态机 State 数据模型
├── db/                               # PostgreSQL 数据库与 Drizzle ORM
│   ├── migrations/                   # 数据库版本迁移 SQL 脚本
│   ├── client.ts                     # PostgreSQL 数据库连接客户端
│   └── schema.ts                     # 数据表结构定义 (Tickets, Themes, Vocabularies, Aliases 等)
├── docs/                             # 专题架构与业务文档体系 (详见上方文档说明)
├── lib/                              # 共享通用类库与知识字典
│   ├── admin-area.ts                 # 行政区划解析器
│   ├── alias-dict.ts                 # 别名映射与实体归一化引擎
│   ├── civic-cluster.ts              # 聚类多频模式与紧急度常量
│   ├── vocabulary.ts                 # 顺德区法定 10 大镇街与 7 大分类标准词汇库
│   └── utils.ts                      # 通用工具函数 (cn 等)
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
复制根目录的 `.env.example` 为 `.env.local`，并配置 PostgreSQL 数据库连接与模型 API Key：
```ini
# PostgreSQL Database Connection URL (Drizzle ORM)
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/ticket_radar

# OpenAI-compatible Chat LLM
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://www.78code.cc/v1
OPENAI_MODEL=gpt-5.6-terra
```

### 3. 初始化数据库结构与标准词汇表
```bash
# 1. 执行数据库迁移（自动创建 tickets, themes, vocabularies, aliases 等全部表）
pnpm db:migrate

# 2. 一键初始化顺德区 10 大法定镇街、社区与 72+ 条别名映射知识库
pnpm db:vocab

# 3. （可选）写入内置样本工单数据
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

---

## 常用开发与维护指令

| 命令 | 说明 |
| :--- | :--- |
| `pnpm dev` | 启动 Next.js 本地开发服务 |
| `pnpm build` | 编译 Next.js 生产版本构建 |
| `pnpm db:migrate` | 运行 Drizzle SQL 数据库迁移 |
| `pnpm db:vocab` | 一键初始化/同步标准政务词汇表与别名知识库 |
| `pnpm db:seed` | 导入样例脱敏工单数据 |
| `pnpm db:studio` | 打开 Drizzle Studio 可视化数据管理面板 |
| `npx tsc --noEmit` | 执行 TypeScript 全局静态类型检查 |
