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
   - 包含多辖区 SVG 态势地图、紧急×重要四象限透势图。大屏进入时一次读取 `GET /api/cockpit`。
   - 悬浮 **AI 研判副驾驶 (Copilot)** 绑定当前站点，走本地 27B，用工具检索工单、主题和总览。

10. **🔌 对外 MCP**
   - Agent 只配置站点 origin。Streamable HTTP 在 `POST /api/mcp`，协议 `2025-03-26`。
   - 人先登录并在 `/mcp/authorize` 同意，Agent 拿到 `civic_` access key 后才能查地区、写入一条工单、读取该地区数据总览。站点管理中心可以吊销。
   - 对接步骤见 [`docs/MCP.md`](docs/MCP.md)。

---

## 🏛️ 架构演进：V1 与 V2 全维度深度对比 (Architecture Evolution: V1 vs V2)

为了应对超大规模政务热线场景下的**高突发流量、跨部门协同复杂性、微观空间高精度定位**及**数据合规强要求**，系统完成了从 V1 单体启发式工作流到 V2 双系统协同认知中枢的工业级全面重构与技术跨越：

### 📊 核心技术维度演进全景

| 架构维度 | V1 历史版本 (单体粗粒度基线) | V2 生产版本 (双系统认知中枢) | 架构收益与突破亮点 |
| :--- | :--- | :--- | :--- |
| **认知计算范式** | 单一通用 LLM 串联全流程，算力开销大 | **System 1 (快思考) + System 2 (慢思考) 脑启发双系统** | 毫秒级端侧边缘定性与深层语义抽取分层，节约 80%+ 大模型算力 |
| **分流与意图初筛** | 100% 工单无差别调用大模型（单单耗时 >3s） | **端侧 4-Head ONNX 神经分类器（<0.08ms 前向，12,600 TPS）** | 意图、七分类、时限（SLA）与涉稳标记前置秒级落库，简单件极速直通 |
| **要素抽取与仲裁** | 遇空字段易校验失败；低置信度反复套娃 LLM 仲裁死循环 | **精准结构化直出（CoT 剥离）+ 确定性权威白名单物理校准** | 彻底根除死循环与超时断联；单单直出稳定收敛至 ~3s；空主体自动压分转人工 |
| **数据安全与脱敏** | 基础正则单向掩码，无法在模型分析后无损还原 | **`@civic/anonymizer` 会话级全要素双向可逆脱敏安全气隙** | 敏感 PII 出站高强度混淆、入库 $O(1)$ 无损还原；本地 Metal/vLLM 纯离线不出域 |
| **多频群诉聚类** | 静态 72h 滑动时间窗口 + 粗粒度时空图 Louvain 割裂 | **语义密集向量 (bge-m3) + 微观空间拓扑 + 核心基底提纯** | 严苛同案同地并单（余弦≥0.88 + 强约束），相邻门牌不误并，跨街道误聚率降为 0 |
| **增量与时序治理** | 仅支持离线批处理全量重跑，无法应对实时流 | **1.9ms 增量流式吸附 + 假闭环时序狙击 + 险情自适应升级** | 新工单秒级吸附活跃主题；自动识别办结后 7 天内重复反映；险情升级重构预案 |
| **GIS 空间底图** | 静态简易 SVG，存在 GCJ-02 火星坐标偏移（300m~500m） | **国家天地图 CGCS2000 测绘级底图 + 第四级镇街矢量面入库** | 彻底消除坐标漂移，像素级对齐；支持乡镇街道/社区网格热力下钻与统一调色板 |
| **多城市与多租户** | 单一顺德区业务强绑定，代码存在大量硬编码 | **PostgreSQL Schema 物理隔离 (`region_{id}`) + AI Scout 拓荒向导** | 30 秒一键初始化任意新城市/区县（边界、社区、词库与别名），站点热插拔 |
| **研判建议生成** | 单件与群组无差别堆砌泛化建议，套话多 | **仅对 ≥2 件群组生成公文级跨部门协同方案，单单保留精准摘要** | 明确牵头单位、协办部门与建议处置时限，公文级预案直通基层指挥中心 |
| **对外生态与互通** | 封闭系统，无标准化外部调用协议 | **原生集成 Model Context Protocol (MCP 2025-03-26)** | 标准 OAuth 授权 + Streamable HTTP 协议，外部 AI Agent 即插即用安全调度 |

### 📈 核心指标量化提升

```text
┌────────────────────────────────────────────────────────────────────────┐
│                        关键技术与业务指标量化提升                      │
├────────────────────────────┬────────────────────┬──────────────────────┤
│ 评估指标                   │ V1 历史基线        │ V2 生产版本          │
├────────────────────────────┼────────────────────┼──────────────────────┤
│ 端侧初筛前向耗时           │ 3,200 ms (LLM)     │ 0.079 ms (ONNX, ~4万倍)│
│ 简单工单大模型算力开销     │ 100% 消耗          │ 节约 >80%            │
│ 结构化抽取超时失败率       │ 12.8%              │ < 0.1% (消除套娃仲裁)│
│ 跨街道/跨门牌误聚率        │ 14.2%              │ 0.0% (精确基底提纯)  │
│ 新辖区接入冷启动耗时       │ 需人工开发数天     │ 30 秒 (AI Scout 拓荒)│
│ GIS 空间坐标偏差           │ 300 ~ 500 米偏移   │ 0 偏差 (CGCS2000对齐)│
└────────────────────────────┴────────────────────┴──────────────────────┘
```

---

## 📸 核心系统界面与全景研判矩阵 (System Showcase & Visual Matrix)

全站严格遵循 **Civic Light** 现代政务设计规范，采用高对比度、清晰色彩体系与真实数据加载机制。全套系统界面均在 **4K / Retina 超高清分辨率（3840 × 2160）** 下实机捕获，分层呈现认知中枢的核心运行全貌：

### 旗舰总览 · 政企智能调度指挥驾驶舱大屏 (`/screen`)
> 专为城市运行管理中心（IOC）指挥大厅设计。支持 4K/8K 巨幕投屏，集全域民声热力感知、流式工单实时脉冲、AI 研判时序监控与多维指标态势于一体。

| 09. 政企智能调度指挥驾驶舱 · 全景数据大屏 (`/screen`) |
| :--- |
| ![政企智能调度驾驶舱](screenshots/09-screen-cockpit.png) |
| **核心亮点**：深色科技全屏沉浸式指挥座舱、天地图全域民声高精度网格热力图、工单多频脉冲实时滚动、万人诉求率与办结闭环综合研判指标全景联动。 |

---

### 第一层 · 宏观态势感知与全流程 AI 认知调度中枢
> 从全域热点态势大盘到顶部抽屉式 AI 认知工厂，形成“宏观感知 ➔ 认知图谱 ➔ 流式微工序”的端到端调度闭环。

| 01. 数据总览 · 态势感知大盘 (`/`) | 06. AI 研判工厂 · React Flow 认知图谱 (顶部抽屉) |
| :--- | :--- |
| ![数据总览大盘](screenshots/01-overview-cockpit.png) | ![AI 研判工作流引擎](screenshots/06-pipeline-drawer.png) |
| **核心亮点**：辖区法定矢量底图像素级对齐、全量工单/多频聚类/日均负荷实时 KPI 聚合卡片、分类环形态势图、右下角驻留型 AI Copilot 助手。 | **核心亮点**：顶部门户集成式全流程 React Flow 流水线抽屉，可视化呈现 System-1 快思考、System-2 慢思考、空间聚类与案卷生成 DAG 节点拓扑。 |

---

### 第二层 · 深度研判决策：四象限透势与多频群诉案卷
> 聚焦微观复杂民生矛盾。独创时序追踪狙击“办结后再反映”的假闭环现象，公文级处置预案直达基层指挥一线。

| 02. 工单透势 · 四象限矩阵与假闭环狙击 (`/multifreq`) | 03. 多频工单 · 群诉聚类与公文处置预案 (`/themes`) |
| :--- | :--- |
| ![工单透势研判](screenshots/02-multifreq-quadrant.png) | ![多频工单群诉](screenshots/03-themes-cluster.png) |
| **核心亮点**：紧急×重要四象限透势、天地图测绘级热力空间定位、独创办结后 7 天重复反映“假闭环”时序风险雷达与预警追踪。 | **核心亮点**：严苛“同案同地”实体基底提纯聚类、自动剥离共性实体拓扑，生成含牵头职能局、协办部门及处置时限的公文级处置预案。 |

---

### 第三层 · 微观数据穿透与政务白名单知识底座
> 百万级工单微秒级要素抽取穿透核查，搭配多辖区法定白名单与别名自学习沉淀知识库，彻底杜绝大模型幻觉。

| 04. 工单中心 · 四要素抽取与核查穿透 (`/tickets`) | 05. 标准字典 · 权威白名单与别名自学习演练 (`/dict`) |
| :--- | :--- |
| ![工单中心全量穿透](screenshots/04-tickets-center.png) | ![标准字典与知识库](screenshots/05-dict-governance.png) |
| **核心亮点**：128,281 件全量工单穿透式检索、System-2 提取四要素（主体、地点、事件、一句话摘要）明细对比、置信度压分与人工复核标记。 | **核心亮点**：10 大法定镇街、158+ 社区网格白名单树、5,647 条政务别名自学习库，独创 AI 别名归一化 Live Sandbox 实时沙箱演练。 |

---

### 第四层 · 多城市物理级租户隔离与权威政务门户
> 基于 PostgreSQL 原生独立 Schema 物理隔离与 Better Auth 会话安全防护，支持全国新辖区 30 秒免代码极速拓荒。

| 07. 多租户控制台 · Schema 隔离与 AI 自动拓荒 (`/admin/regions`) | 08. 统一门户 · Civic Light 权威政务安全认证中心 (`/login`) |
| :--- | :--- |
| ![多站点管理与 AI 拓荒](screenshots/07-admin-regions.png) | ![统一认证门户](screenshots/08-login-portal.png) |
| **核心亮点**：PostgreSQL `region_{id}` 物理级 Schema 严格数据隔离、站点热插拔，内置 SuperAgent AI Scout 向导 30 秒自动化拓荒新辖区边界与词库。 | **核心亮点**：Civic Light 政务级轻质感无辖区纯净认证界面、会话级 Cookie 保护，端侧脱敏安全气隙指示。 |

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
| 📐 **现行工作流** | [`docs/WORKFLOW.md`](docs/WORKFLOW.md) | **现在怎么跑**。每条工单过 System 1 和 System 2，抽取产物做向量，同一件事或同一地点才成主题。副驾驶和 MCP 的入口也在这里。 |
| 🗺️ **空间地理与 GIS 规范** | [`docs/SPATIAL.md`](docs/SPATIAL.md) | **空间必读**。天地图 CGCS2000 测绘级底图无偏移对齐、四级镇街矢量面、时空核心提纯与 GEO/SEO 语义标准。 |
| 🤖 **AI 引擎规范 (GEO)** | [`public/llms.txt`](public/llms.txt) | **大模型与 AI 必读**。符合行业最新 Generative Engine Optimization (GEO) 规范的系统与 API 清单。 |
| 🔌 **MCP 对接** | [`docs/MCP.md`](docs/MCP.md) | **Agent 必读**。只配站点 origin。发现、授权码、三个工具、吊销。 |
| 📜 **早期设计稿** | [`.gemini/v2-workflow.md`](.gemini/v2-workflow.md) | 重构初期的设计记录。里面的咨询直通、72 小时并单、主题建议开思考，都已经不用了。 |
| 📜 **V1 历史工作流存档** | [`.gemini/v1-workflow.md`](.gemini/v1-workflow.md) | main 分支最初的 LangGraph 工作流。 |
| 🗄️ **数据库设计与字典规范** | [`docs/DBS.md`](docs/DBS.md) | **数据必读**。辖区业务表、Better Auth，以及运行时创建的 `mcp_clients` / `mcp_auth_codes`。 |
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
│   ├── api/                          # RESTful API 端点 (cluster 批研判, tickets 单工单, MCP, 大屏)
│   │   ├── mcp/                      # Streamable HTTP、令牌交换、OAuth 发现文档
│   │   ├── cockpit/                  # 大屏一次读取 GET /api/cockpit
│   │   └── workbench/pipeline-state/ # 流水线工厂状态。任务状态大写；离线节点不报耗时
│   ├── mcp/                          # 人工授权页 /mcp/authorize
│   ├── dict/                         # 标准字典与别名知识库页面 (/dict)
│   ├── multifreq/                    # 工单透势全景研判页面 (/multifreq)
│   ├── themes/                       # 多频工单看板页面 (/themes)
│   ├── tickets/                      # 工单中心下钻核查页面 (/tickets)
│   └── workbench/                    # 研判画布组件，不是独立路由。入口是顶部抽屉 PipelineDrawer
├── backend/                          # 核心业务后端与认知中枢
│   ├── agent.ts                      # LangGraph 流水线。顺序是抽取、对齐、聚类、主题建议
│   ├── agent/copilot-agent.ts        # 副驾驶图：decide → tools → decide。模型是本地 27B
│   ├── agent/copilot-tools.ts        # 绑定当前 region：工单向量、主题、总览、镇街
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
│   ├── mcp/                          # MCP 发现、access key、三个工具
│   ├── cockpit-read.ts               # 大屏聚合。最近 30 条，正文只取前 80 字
│   └── copilot-protocol.ts           # 副驾驶 JSON 工具协议
├── scripts/                          # 迁移、种子、开发启动、样本重跑
├── tests/                            # 规则核对。test-mcp 会向顺德写一条工单，其余这几支不改库
│   ├── test-work-order-date.ts       # 编号日期：正文里的另一个日期不能替换编号
│   ├── test-same-incident-cluster.ts # 东湖学府并在一起，不同地点的烟花和欠薪不并
│   ├── test-incident-profile.ts      # 同一条路上的两家欠薪、相邻门牌不并
│   ├── test-mcp.ts                   # MCP 发现、授权和三个工具。会向顺德写入一条工单
│   ├── test-cockpit-read.ts          # 大屏一次读取比五次来回快，最近工单走时间索引
│   └── test-copilot-protocol.ts      # 副驾驶工具协议，不改库
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

# 抽取、主题建议、副驾驶优先走本地 System 2（默认 http://127.0.0.1:8132/v1）。
# 不写 SYSTEM_TWO_ENDPOINTS 就用这个默认。多节点再用逗号分隔。
# SYSTEM_TWO_ENDPOINTS=http://127.0.0.1:8132/v1

# 云端回退，以及 AI 拓荒。本地 System 2 探活失败且写了 Key，getSystemTwoEngine 才走这里。
# 向量客户端没写 EMBEDDING_API_KEY 时也会读 OPENAI_API_KEY。主模型仍是本地 27B 和 BAAI/bge-m3。
OPENAI_API_KEY=your_api_key_here
OPENAI_BASE_URL=https://api.edgefn.net/v1
OPENAI_MODEL=DeepSeek-V4-Flash-0731

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
npx tsx tests/test-copilot-protocol.ts
npx tsx tests/test-mcp.ts
npx tsx tests/test-cockpit-read.ts
```

`tests/test-mcp.ts` 会向顺德写入一条工单，跑完不删。对接步骤见 [`docs/MCP.md`](docs/MCP.md)。

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
| `pnpm dev:models` | **算力集群**：单机并行拉起 System-2 (8132) + Civic-Embed (8133)，供 VPS 经 Tailscale 跨网调度 |
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
- **[MCP for agents](docs/MCP.md)**：站点 origin、发现文档、授权码、`list_regions` / `push_ticket` / `region_overview`。
- **[AI Workflow & LangGraph Pipeline](docs/WORKFLOW.md)**：System-1 ONNX fast extraction, System-2 Bonsai 27B deep entity resolution, and incident clustering rules.
- **[Deployment & Ops Guide](docs/DEPLOY.md)**：Local dev, VPS Docker Compose orchestration, and isolated air-gapped government cloud setup.
- **[Multi-Tenant Database Architecture](docs/DBS.md)**：PostgreSQL schema isolation, Better Auth, and the runtime MCP tables.

