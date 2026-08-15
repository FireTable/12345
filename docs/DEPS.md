# 项目依赖与组件披露 (Dependencies & Component Disclosure)

本项目（民声智理 · 顺德 12345 AI 智能研判系统）采用的技术栈与依赖库均遵循宽松的开源协议（如 **MIT / ISC / Apache-2.0**），无任何 GPL/AGPL 等传染性协议，具备完全的合规性与商业友好度。

---

## 一、核心依赖库与开源协议清单

### 1. 核心 AI 与数据处理层
| 依赖库名称 | 用途说明 | 开源许可证 | 官方/开源地址 |
| :--- | :--- | :--- | :--- |
| **`zod`** | 结构化数据校验与 Schema 定义（保障大模型结构化输出稳定） | **MIT** | [colinhacks/zod](https://github.com/colinhacks/zod) |
| **`@langchain/core`** | 大模型基础调用接口与消息标准抽象 | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`@langchain/openai`** | OpenAI 兼容接口模型客户端封装 | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`p-queue`** | 批量工单处理并发限流控制调度器 | **MIT** | [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) |
| **`date-fns`** | 工单时间跨度、时间序列与频次统计计算 | **MIT** | [date-fns/date-fns](https://github.com/date-fns/date-fns) |

### 2. 前端交互与 UI 动效层
| 依赖库名称 | 用途说明 | 开源许可证 | 官方/开源地址 |
| :--- | :--- | :--- | :--- |
| **`react` / `react-dom`** | 现代响应式前端界面渲染引擎 | **MIT** | [facebook/react](https://github.com/facebook/react) |
| **`next`** / **`vite`** | 前端应用构建与现代工程化脚手架 | **MIT** | [vercel/next.js](https://github.com/vercel/next.js) |
| **`tailwindcss`** | 原子化样式引擎与暗黑/政务科技风主题系统 | **MIT** | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| **`@radix-ui/react-*`** | 无障碍基础组件原语（Dialog 抽屉、Tabs 分页、Tooltip 悬浮提示等） | **MIT** | [radix-ui/primitives](https://github.com/radix-ui/primitives) |
| **`motion`** *(Framer Motion)* | 卡片展开、抽屉下钻与过渡平滑动画 | **MIT** | [motiondivision/motion](https://github.com/motiondivision/motion) |
| **`lucide-react`** | 现代化专业图标系统（报警、工单、图谱、导出、搜索等） | **ISC** (兼容 MIT) | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **`sonner`** | 现代轻量 Toast 消息通知框 | **MIT** | [emilkowalski/sonner](https://github.com/emilkowalski/sonner) |
| **`clsx` / `tailwind-merge`** | 动态 CSS 类名合并工具 | **MIT** | [lukeed/clsx](https://github.com/lukeed/clsx) |

### 3. 图谱可视化与数据导出
| 依赖库名称 | 用途说明 | 开源许可证 | 官方/开源地址 |
| :--- | :--- | :--- | :--- |
| **`drizzle-orm`** / **`drizzle-kit`** | 现代化 TypeScript ORM 与数据库迁移工具 | **Apache-2.0** | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| **`postgres`** *(postgres.js)* | 高性能 PostgreSQL 驱动与连接池管理 | **Unlicense** (自由开源/兼容 MIT) | [porsager/postgres](https://github.com/porsager/postgres) |
| **`@tanstack/react-table`** | Shadcn 标准 Data Table 引擎（多列排序、过滤、分页、勾选） | **MIT** | [tanstack/table](https://github.com/tanstack/table) |
| **`@tanstack/react-virtual`** | 海量工单虚拟列表滚动引擎（保障超长列表丝滑性能） | **MIT** | [tanstack/virtual](https://github.com/tanstack/virtual) |
| **`react-force-graph-2d`** | 知识图谱网络拓扑可视化渲染（力导向图） | **MIT** | [vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph) |
| **`papaparse`** / **`xlsx`** | 多频工单批量核查报表 CSV / Excel 导出工具 | **MIT** / **Apache-2.0** | [mholt/PapaParse](https://github.com/mholt/PapaParse) |

---

## 二、项目业务组件结构披露

| 组件名称 | 路径 / 模块 | 核心职责 |
| :--- | :--- | :--- |
| **`HeaderStats`** | `app/_components/dashboard/header-stats.tsx` | 宏观指标大盘（工单总量、多频主题数、高风险事件数、压缩率） |
| **`ThemeKanban`** | `app/_components/kanban/theme-kanban.tsx` | 核心主题卡片墙（按高/中/低风险分栏，展示涉及件数、核心主体、AI 摘要） |
| **`ThemeCard`** | `app/_components/kanban/theme-card.tsx` | 单个多频主题卡片交互与动效封装 |
| **`TicketDetailSheet`** | `app/_components/table/ticket-detail-sheet.tsx` | 卡片下钻核查明细抽屉（展示工单详情、实体对齐理由、批量核查） |
| **`GraphVisualizer`** | `app/_components/graph/graph-visualizer.tsx` | 知识图谱关联网络浮窗（工单 ↔ 主体 ↔ 地点 ↔ Theme 拓扑） |
| **`FilterToolbar`** | `app/_components/dashboard/filter-toolbar.tsx` | 时间、风险、主体类别多维筛选与搜索栏 |
| **`MasterTable`** | `app/_components/table/master-table.tsx` | 满足企业要求的一键批量核查报表总表组件 |
| **`LightCopilot`** | `app/_components/copilot/light-copilot.tsx` | 轻量级 AI 智能问答副驾驶抽屉（自然语言统计与处置建议） |

---

## 三、合规性声明 (Compliance Statement)
- ✅ **无强传染性开源代码**：本项目未使用任何 GPL、AGPL、SSPL 或有争议的商业限制协议组件。
- ✅ **数据脱敏保护**：内置与演示所用工单数据均经过实体脱敏（姓名、电话、具体身份证号等均采用匿名掩码），符合个人信息保护与数据安全规范。
- ✅ **可商用与可交付**：所有依赖均允许二次分发、修改与商业化部署。
