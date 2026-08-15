# Ticket Radar (多频工单智能识别系统)

基于轻量 GraphRAG 与持久化 LangGraph JS 的热线多频诉求智能识别、实体图谱聚类与批量核查看板系统。

---

## 核心特性
- **智能实体与主题抽取**：自动从海量诉求中提取被诉主体、发生地点、事件类型与宏观主题（Themes）。
- **实体规范化对齐 (Canonical Alignment)**：攻克市民不同口语表述痛点，将别名自动归一化至标准实体。
- **多频图聚类 (Graph Clustering)**：基于主体共现与主题网络，自动聚类多频群体并评估风险等级。
- **主题卡片看板 (Kanban)**：高/中/低风险分栏，实现海量诉求宏观主题压缩（压缩率超 85%）。
- **工单下钻核查与报表导出**：支持卡片下钻查看工单原文比对、批量核查确认与一键导出 CSV 报表。
- **全景知识图谱拓扑**：基于力导向图（Force-Directed Graph）直观呈现工单与实体的连通关系。
- **AI 研判副驾驶 (Copilot)**：基于热线图谱知识库提供实时自然语言问答与处置建议。

---

## 项目架构与目录树 (Project Structure)

```text
.
├── app/                              # Next.js App Router 前端与服务层
│   ├── _components/                  # 页面组件（Colocation 模式）
│   │   ├── copilot/                  # AI 智能研判副驾驶
│   │   │   └── light-copilot.tsx
│   │   ├── dashboard/                # 顶部宏观指标大盘与工具栏
│   │   │   ├── filter-toolbar.tsx
│   │   │   ├── header-stats.tsx
│   │   │   └── header.tsx
│   │   ├── graph/                    # 力导向知识图谱拓扑
│   │   │   └── graph-visualizer.tsx
│   │   ├── kanban/                   # 多频主题卡片墙
│   │   │   ├── theme-card.tsx
│   │   │   └── theme-kanban.tsx
│   │   ├── table/                    # 核查总表与工单下钻 Sheet
│   │   │   ├── master-table.tsx
│   │   │   └── ticket-detail-sheet.tsx
│   │   └── ui/                       # Shadcn UI 原子组件库
│   │       ├── badge.tsx
│   │       ├── button.tsx
│   │       ├── card.tsx
│   │       ├── dialog.tsx
│   │       ├── input.tsx
│   │       ├── separator.tsx
│   │       ├── sheet.tsx
│   │       ├── sonner.tsx
│   │       ├── table.tsx
│   │       ├── tabs.tsx
│   │       └── tooltip.tsx
│   ├── api/                          # RESTful API 路由
│   │   ├── cluster/                  # 触发 LangGraph JS 聚类与图谱计算
│   │   │   └── route.ts
│   │   ├── copilot/                  # AI 研判对话接口
│   │   │   └── route.ts
│   │   └── tickets/                  # 工单数据服务
│   │       └── route.ts
│   ├── globals.css                   # Tailwind CSS + Shadcn 变量与暗黑科技主题
│   ├── layout.tsx                    # 根布局与 Google Fonts
│   └── page.tsx                      # 主页面入口（异步拉取后端 API 数据）
├── backend/                          # 持久化 LangGraph JS 后端架构
│   ├── agent/
│   │   └── ticket-agent.ts           # StateGraph 编译主图 (extract -> canonical -> cluster -> summary)
│   ├── node/                         # LangGraph 流程节点
│   │   ├── canonical-node.ts         # 实体消歧与别名归一化
│   │   ├── cluster-node.ts           # 图连通分量与多频聚类
│   │   ├── extract-node.ts           # 四要素结构化提取
│   │   └── summary-node.ts           # 风险评估与统计分析
│   ├── agent.ts                      # 后端执行调度辅助函数
│   ├── checkpointer.ts               # MemorySaver 状态持久化
│   └── state.ts                      # LangGraph State Annotation 数据模型
├── lib/                              # 共享工具类与通用能力
│   ├── export-csv.ts                 # 批量核查报表 CSV 导出器
│   ├── mock-data.ts                  # 脱敏工单样例数据
│   └── utils.ts                      # Shadcn cn() 工具函数
├── docs/                             # 项目规范与合规文档
│   └── DEPS.md                       # 依赖许可证与组件披露清单
├── components.json                   # Shadcn UI 配置文件
├── langgraph.json                    # LangGraph JS 配置文件
├── next.config.ts                    # Next.js 配置文件
├── package.json                      # 项目依赖与运行脚本
├── postcss.config.mjs                # PostCSS 样式处理器配置
└── tsconfig.json                     # TypeScript 配置文件
```

---

## 技术栈与依赖库

| 层级 | 技术选型 | 说明 | 开源协议 |
| :--- | :--- | :--- | :--- |
| **全栈框架** | **Next.js 15/16 (App Router)** | 前后端一体化全栈脚手架 | MIT |
| **Agent / 图算法** | **@langchain/langgraph + LangGraph JS** | 持久化 StateGraph 工作流编排 | MIT |
| **UI 组件库** | **Shadcn UI + Radix UI + Tailwind CSS** | 现代化暗黑/科技感无障碍组件 | MIT |
| **图谱渲染** | **react-force-graph-2d** | 真实力导向知识网络拓扑渲染 | MIT |
| **动效系统** | **Motion (Framer Motion)** | 卡片展开、抽屉与页面平滑过渡 | MIT |
| **报表导出** | **PapaParse** | UTF-8 带 BOM 标准 CSV 导出 | MIT |

---

## 快速开始

### 1. 安装依赖
```bash
pnpm install
```

### 2. 启动开发环境
```bash
# 启动全栈服务（前端 + API 路由）
pnpm dev

# 或单独调试 LangGraph 后端
pnpm dev:backend
```

在浏览器打开 `http://localhost:3000` 即可开始使用！

### 3. 构建生产包
```bash
pnpm build
pnpm start
```
