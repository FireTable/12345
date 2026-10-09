# 项目依赖清单与组件架构披露 (Dependencies & Components)

> **项目名称**：民声智理 · 12345 政务热线认知中枢与 AI 智能研判系统 (多城市 / 多租户 V2 生产架构)  
> **参赛团队**：赢了就回家吃鱼生  
> **合规结论**：全栈依赖均采用宽松开源许可证（**MIT / ISC / Apache-2.0 / Unlicense**），100% 商业友好，无任何 GPL/AGPL 传染性协议。

---

## 目录
1. [生产核心依赖清单与开源协议](#一生产核心依赖清单与开源协议)
2. [前端与业务组件架构映射表](#二前端与业务组件架构映射表)
3. [合规性与数据安全声明](#三合规性与数据安全声明)

---

## 一、生产核心依赖清单与开源协议

### 0. 核心私有 Monorepo 独立引擎包 (In-repo Packages)
| 模块名称 | 路径 | 核心能力说明 | 架构特性 |
| :--- | :--- | :--- | :--- |
| **`@civic/system-one`** | `packages/civic-system-one` | **本地分类**：四个头，意图、民生分类、紧急程度、涉稳。每条工单都跑。咨询和催办也继续交给 System 2 | 纯离线 ONNX 分类器。模型不带某个城市的镇街，镇街输出恒为 `UNKNOWN` |
| **`@civic/system-two`** | `packages/civic-system-two` | **慢思考通用认知大模型引擎**：适配 Bonsai 2 27B PTQ1_0 三值大模型，Apple Silicon Metal 深度调优。多端点池会把掉线节点探活后重新调度 | OpenAI 规范 / CoT 思维链剥离 / createJSON / 耗时记 `predicted_ms` |
| **`@civic/anonymizer`** | `packages/civic-anonymizer` | **全要素可逆隐私脱敏引擎**：出站掩码加密，入库前会话级 Keymap 确定性无损反向还原 | 国标数学校验 / 零外部网络依赖 |

### 1. 核心 AI 图状态机与数据流
| 依赖库名称 | 版本号 | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`@langchain/langgraph`** | `^0.2.54` | **核心引擎**：LangGraph JS 确定性图状态机与条件边路由控制 | **MIT** | [langchain-ai/langgraphjs](https://github.com/langchain-ai/langgraphjs) |
| **`@langchain/core`** | `^0.3.40` | 大模型基础接口抽象与统一消息模型 | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`@langchain/openai`** | `^0.4.4` | OpenAI 兼容接口（DeepSeek / vLLM / Ollama）客户端 | **MIT** | [langchain-ai/langchainjs](https://github.com/langchain-ai/langchainjs) |
| **`zod`** | `^3.24.2` | 强类型数据验证与 Prompt 结构化输出 Schema 约束 | **MIT** | [colinhacks/zod](https://github.com/colinhacks/zod) |
| **`p-queue`** | `^8.1.0` | 批量工单并发控制与限流调度器 | **MIT** | [sindresorhus/p-queue](https://github.com/sindresorhus/p-queue) |
| **`date-fns`** | `^4.1.0` | 工单爆发时序跨度与假闭环时间衰减计算 | **MIT** | [date-fns/date-fns](https://github.com/date-fns/date-fns) |

### 2. 现代前端全栈与 Civic Light 设计体系
| 依赖库名称 | 版本号 | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`next`** | `^15.2.1` | 现代 React 服务端渲染与 App Router 框架 | **MIT** | [vercel/next.js](https://github.com/vercel/next.js) |
| **`react` / `react-dom`** | `^19.0.0` | 现代化响应式前端交互核心 | **MIT** | [facebook/react](https://github.com/facebook/react) |
| **`tailwindcss`** | `^4.0.9` | 原子化样式引擎与 Civic Light 政务级设计系统 | **MIT** | [tailwindlabs/tailwindcss](https://github.com/tailwindlabs/tailwindcss) |
| **`@radix-ui/react-*`** | `^1.1.x` ~ `^2.3.x` | 无障碍 UI 原语（Dialog 弹窗、Tabs、Select 下拉、Tooltip 等） | **MIT** | [radix-ui/primitives](https://github.com/radix-ui/primitives) |
| **`motion`** *(Framer Motion)*| `^12.4.7` | 页面过渡、卡片抽屉展开与平滑微动效 | **MIT** | [motiondivision/motion](https://github.com/motiondivision/motion) |
| **`@xyflow/react`** | `^12.12.0` | 研判流水线工厂的 React Flow 画布。刷新时必须保留节点 `measured`，否则卡片会隐藏 | **MIT** | [xyflow/xyflow](https://github.com/xyflow/xyflow) |
| **`lucide-react`** | `^1.16.0` | 现代化图标系统（工单、报警、雷达、督办、字典等） | **ISC** (兼容 MIT) | [lucide-icons/lucide](https://github.com/lucide-icons/lucide) |
| **`sonner`** | `^2.0.1` | 现代轻量 Toast 消息通知框 | **MIT** | [emilkowalski/sonner](https://github.com/emilkowalski/sonner) |
| **`react-markdown`** / **`remark-gfm`** | `^10.1.0` / `^4.0.1` | 公文级处置建议与 Copilot 对话 Markdown 渲染引擎 | **MIT** | [remarkjs/react-markdown](https://github.com/remarkjs/react-markdown) |

### 3. 数据持久化、图谱与报表工具
| 依赖库名称 | 版本号 | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`drizzle-orm`** | `^0.45.2` | 现代化强类型 TypeScript ORM | **Apache-2.0** | [drizzle-team/drizzle-orm](https://github.com/drizzle-team/drizzle-orm) |
| **`postgres`** *(postgres.js)* | `^3.4.9` | 高性能 PostgreSQL 客户端与连接池 | **Unlicense** | [porsager/postgres](https://github.com/porsager/postgres) |
| **`@tanstack/react-table`** | `^8.21.3` | 高性能数据表格引擎（多维排序、筛选、虚拟滚动） | **MIT** | [tanstack/table](https://github.com/tanstack/table) |
| **`@tanstack/react-virtual`**| `^3.14.9` | 海量工单虚拟列表滚动引擎 | **MIT** | [tanstack/virtual](https://github.com/tanstack/virtual) |
| **`react-force-graph-2d`** | `^1.26.1` | 实体拓扑与共性网络力导向图可视化 | **MIT** | [vasturiano/react-force-graph](https://github.com/vasturiano/react-force-graph) |
| **`xlsx`** / **`papaparse`** | `^0.18.5` / `^5.5.2` | Excel / CSV 批量工单解析与导出支持 | **Apache-2.0** / **MIT** | [SheetJS](https://sheetjs.com/) / [PapaParse](https://github.com/mholt/PapaParse) |

### 4. 身份认证与安全防护 (Better Auth)
| 依赖库名称 | 版本号 | 用途说明 | 开源许可证 | 官方仓库 / 主页 |
| :--- | :--- | :--- | :--- | :--- |
| **`better-auth`** | `^1.1.21` | **生产级认证核心**：支持用户名/密码、Drizzle ORM 适配器、Session 会话管理与密码加盐哈希 | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |
| **`@better-auth-ui/react`** | `^0.1.13` | Better Auth 官方 React UI 组件库与客户端 Hook | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |
| **`@better-auth-ui/core`** | `^0.1.13` | Better Auth UI 核心逻辑与上下文状态管理 | **MIT** | [better-auth/better-auth](https://github.com/better-auth/better-auth) |

---

## 二、前端与业务组件架构映射表

```text
app/
├── (routes)/
│   ├── page.tsx                               # 1. 首页工作大盘 (Dashboard)
│   ├── themes/page.tsx                        # 2. 多频工单群组看板 (/themes)
│   ├── multifreq/page.tsx                     # 3. 工单透势全景研判 (/multifreq)
│   ├── tickets/page.tsx                       # 4. 工单中心下钻核查 (/tickets)
│   └── dict/page.tsx                          # 5. 标准字典与别名知识库 (/dict)
└── _components/
    ├── civic/                                 # Civic Light 核心组件库
    │   ├── civic-nav.tsx                      # 顶部全局导航栏 (含多城市/区县站点切换器)
    │   ├── stat-card.tsx                      # 核心态势指标卡片
    │   ├── civic-workflow.tsx                 # LangGraph 流程执行实时动态进度条
    │   ├── civic-charts.tsx                   # Civic 统计图表组件
    │   ├── pipeline-drawer.tsx                # 顶部 AI 研判流水线工厂抽屉（窄屏同一块画布，标题换行）
    │   ├── pipeline-floating-pill.tsx         # 研判进行中的悬浮胶囊。状态按大写 RUNNING / PENDING 判断
    │   ├── dynamic-map.tsx                    # 多辖区 SVG 态势地图自适应加载器
    │   ├── shunde-map.tsx                     # 内置预置顺德区 10 大镇街 SVG 态势地图
    │   ├── quadrant.tsx                       # 紧急×重要四象限透势图
    │   └── skeletons.tsx                      # 页面加载骨架屏
    ├── dashboard/                             # 工作大盘组件
    │   ├── header-stats.tsx                   # 宏观指标卡片区
    │   ├── header.tsx                         # 页面顶部状态与操作栏
    │   ├── upload-dialog.tsx                  # 原始工单批量导入与流式触发弹窗
    │   └── filter-toolbar.tsx                 # 镇街/分类/风险多维筛选栏
    ├── kanban/                                # 多频主题看板组件
    │   ├── theme-kanban.tsx                   # 多频群组分类泳道看板
    │   └── theme-card.tsx                     # 多频主题卡片 (含置信度/假闭环/督办状态)
    ├── table/                                 # 表格与下钻抽屉
    │   ├── master-table.tsx                   # 工单与主题全景数据核查总表
    │   ├── data-table.tsx                     # TanStack 驱动的高性能虚拟表格
    │   └── ticket-detail-sheet.tsx            # 工单穿透下钻抽屉（展示 AI 要素、置信度与公文建议）
    ├── copilot/                               # AI 研判副驾驶
    │   └── light-copilot.tsx                  # 浮动抽屉。请求 /api/copilot，工具在 backend/agent/
    └── graph/                                 # 知识图谱网络
        └── graph-visualizer.tsx               # 实体拓扑关系力导向图

app/workbench/                               # 不是独立页面。/workbench 路由已删除
├── workbench.css                            # 抽屉、画布、窄屏安全区
└── _components/
    ├── pipeline-canvas.tsx                   # 受控 React Flow。同步时保留 measured 与拖拽位置
    └── nodes/entity-node.tsx                 # 算力节点卡片。离线显示「无法连接」，不显示耗时

backend/agent/
├── copilot-agent.ts                           # 副驾驶 LangGraph：decide → tools → decide
└── copilot-tools.ts                           # 绑定当前 region 的六个工具

lib/
├── copilot-protocol.ts                        # 27B 的 JSON 工具协议
├── cockpit-read.ts                            # GET /api/cockpit 一次聚合
└── mcp/                                       # 发现、access key、list_regions / push_ticket / region_overview
    ├── discovery.ts
    ├── clients.ts
    ├── tools.ts
    └── http.ts

app/api/mcp/                                   # POST /api/mcp、/token、/grant、两份 well-known
app/mcp/authorize/                             # 已登录的人批准接入
app/admin/regions/                             # 站点管理中心。列出并吊销 MCP 客户端
```

副驾驶、大屏读取和 MCP 的行为见 [`WORKFLOW.md`](WORKFLOW.md) 第七节。Agent 对接见 [`MCP.md`](MCP.md)。

---

## 三、合规性与数据安全声明

1. **协议合规**：全项目所有依赖包均采用宽松商业友好协议（MIT / ISC / Apache-2.0 / Unlicense），未引入任何传染性开源协议，具备完全合规与交付能力。
2. **数据不出域与脱敏保障**：系统内置隐私脱敏机制，不保存市民真实敏感个人隐私数据；大模型调用支持本地离线推理（Ollama / vLLM），完全符合国家《网络安全法》与《个人信息保护法》规范。
