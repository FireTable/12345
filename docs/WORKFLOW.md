# 12345 政务热线智能工单研判平台 · AI 工作流全景架构文档 (多城市 / 多租户 V2 生产架构)

> **版本**：V2.0 Production  
> **核心定位**：基于 **System-1 (神经快思考) + System-2 (深度慢思考) 双引擎分层协同**，融合 **PostgreSQL 多城市独立 Schema 隔离与权威政务词库**、**微观时空核心基底对齐 (Spatial Core)** 与 **72h 滑动窗口增量吸附算法** 的政务 12345 热线多频诉求智能识别、实体拓扑聚类与全周期公文督办研判 SuperAgent 平台。

---

## 一、工作流整体架构与拓扑图 (V2 Architecture)

```mermaid
flowchart TD
    subgraph 接入层 [双模态工单接入]
        A1[单工单实时上报 (POST /api/tickets)]
        A2[批量工单集中研判 (POST /api/cluster)]
    end

    A1 & A2 --> B[【安全气隙】anonymizer.ts <br/>本地敏感信息加密与 Keymap 映射]
    
    B --> C{1. System-1 快思考引擎<br/><b>ONNX / MPS 神经分类器 (&lt;1ms)</b>}
    
    %% 快思考分流
    C -->|高频政策咨询 (INQUIRY) / 重复催办 (REMINDER)| D[⚡ 毫秒级直通分派 / 即时办结<br/><b>免大模型调用 (0 Token)</b>]
    C -->|民生事件 / 复杂诉求 / 涉稳预警| E[2. extractNode (System-2 极速抽取)<br/><b>enableThinking: false (~3s/件)</b>]
    
    %% 要素抽取与时空基底规范化
    E --> F[3. canonicalNode (实体与时空基底规范化)<br/><b>extractSpatialCore 道路微观基底提纯</b><br/>+ 纯行政区划防串并隔离]
    
    %% 时空图谱增量与成团
    F --> G{4. 增量时空吸附与聚类判定<br/><b>incremental-cluster.ts</b>}
    G -->|命中在办活跃主题 (72h滑动窗口内)| G1[⚡ 秒级直接吸附并入已有主题<br/>工单数+1 / 继承既有处置方案 (0等待)]
    G1 -->|若新单出现冲刷塌陷等严重险情| G2[🚨 质变触发: 启动 System-2 慢思考升级预案]
    
    G -->|未命中任何存量活跃主题| H{独立工单 or 批内成团?}
    H -->|单发独立事件 (&lt;2件)| H1[独立事件待办库 / 常规单件处置]
    H -->|批内同地/同主体群发 (&gt;=2件)| I[📦 聚合为新多频热点治理主题 (MultiFrequencyTheme)]
    
    %% 慢思考深度推导
    I --> J[5. summaryNode (System-2 深度慢思考)<br/><b>enableThinking: true (~90s 全局统一推导)</b>]
    
    %% 闭环落地
    J & G1 & G2 --> K[🏛️ 成果输出与治理闭环<br/>• 3100+ 字符思维链穿透权责边界<br/>• 明确牵头/协办部门与响应时限 (10m/30m/2h)<br/>• 督办指引、处置闭环与态势大屏]
```

### 核心设计范式：
> **“双模态灵活驱动：单单入库即吸附，批量导入成新群；平时继承老方案，质变升级再深思。”**

---

## 二、端到端核心节点详细说明

### 1. 数据隐私脱敏与安全气隙 (`@civic/anonymizer`)
- **文件与模块**：[`packages/civic-anonymizer`](../packages/civic-anonymizer/)
- **核心逻辑**：
  1. **敏感信息掩码**：市民真实姓名（`张*`）、手机号（`138****0000`）、身份证号、私人门牌号出站前自动替换为唯一占位符（如 `{{LICENSE_PLATE_1}}`）；
  2. **确定性无损反向还原**：模型返回后，通过会话级 `keymap` 以 $O(1)$ 速度无损还原真实实体，确保政务数据合规。

---

### 2. System-1 快思考极速决策引擎 (`SystemOneEngine`)
- **文件与模块**：[`packages/civic-system-one`](../packages/civic-system-one/)
- **核心逻辑**：
  - **毫秒级神经前向推理**：自适应本地 Apple Silicon MPS 或 ONNX Runtime（耗时 **< 1ms**）；
  - **极速直通分流**：对政策咨询（INQUIRY，0h SLA）及工单催办件以 100 分置信度直接产出标准工单元数据并分派，**跳过后续大模型抽取，节约 80%+ 简单工单的算力开销**；
  - **涉稳红线报警**：前置拦截群体性聚集与极端安全隐患，打上加急标记。

---

### 3. System-2 极速结构化要素抽取 (`extractNode`)
- **文件与模块**：[`backend/node/extract-node.ts`](../backend/node/extract-node.ts)、[`backend/prompt.ts`](../backend/prompt.ts)
- **核心逻辑**：
  - **显式关闭慢思考 (`enableThinking: false`)**：仅作结构化要素提取（是谁、在哪、什么事），单件耗时仅约 **3 秒**，直接产出标准 Zod 校验 JSON；
  - **彻底废除旧版套娃二次仲裁**：不再对低置信度工单循环重复调用 LLM，改由权威字典与本地确定性规则进行物理校准。

---

### 4. 实体对齐与微观时空核心基底提纯 (`canonicalNode`)
- **文件与模块**：[`backend/node/canonical-node.ts`](../backend/node/canonical-node.ts)
- **核心逻辑**：
  - **微观空间提纯 (`extractSpatialCore`)**：剥离市民描述中的门牌号（“28号”）、店铺名、修饰词，提纯公共道路/小区基底（如 `大良街道金榜上街`），彻底解决地址表达微小差异无法聚类的顽疾；
  - **纯行政区划防吸附隔离**：严禁将只填写“大良街道”等纯行政区划的工单误并入具体某条道路，杜绝跨级串扰。

---

### 5. 增量时空工单吸附与滑动窗口机制 (`incremental-cluster.ts`)
- **文件与模块**：[`backend/incremental-cluster.ts`](../backend/incremental-cluster.ts)
- **核心逻辑**：
  1. **毫秒级吸附判定（~1.9ms）**：新工单优先检索当前处于处置中的存量活跃主题；
  2. **72 小时滑动时间窗口**：以**“距离该事件最后一个事件反映时间（lastOccurrence）的滑动窗口”**为准，只要事件持续发生且现场未办结，滑动窗口自动向前滚动，持续并入同一历史案卷；
  3. **平时 0 耗时继承方案**：普通追加诉求直接继承已有处置预案（0 秒等待、0 Token 消耗），座席秒级答复“已在现场抢修”；
  4. **突发险情质变升级**：出现路面塌陷、次生灾害等恶性险情时，精准触发 System-2 慢思考进行应急处置升级。

---

### 6. 时空知识图谱精准聚类 (`clusterNode`) —— 纯确定性算法
- **文件与模块**：[`backend/node/cluster-node.ts`](../backend/node/cluster-node.ts)
- **核心逻辑**：
  - **双轨聚类**：同一主体多次反映或同一微观物理点位群发共性诉求；
  - **质量质检拦截 (`cluster-validator.ts`)**：严禁空泛虚词（如“车主”）独立成群，严格拦截跨车牌混淆；
  - **数量门槛强制控制**：>= 2 件方可成团，单发孤立工单保持独立，绝不强行拉郎配。

---

### 7. System-2 慢思考统一公文研判与协同建议 (`summaryNode`)
- **文件与模块**：[`backend/node/summary-node.ts`](../backend/node/summary-node.ts)、[`packages/civic-system-two`](../packages/civic-system-two/)
- **核心逻辑**：
  - **全局统一慢思考 (`enableThinking: true`)**：对聚合后的事件簇集中调用 1 次慢思考，推导 **3100+ 字符** 的深度思维链（CoT）；
  - **输出成果**：明确牵头部门（市政管理科/城管执法）、协办单位、响应时限（10分钟到场/30分钟止水/2小时恢复供水）及分步办理与回访闭环。

---

### 8. 生产业务 API 双模态接入
- **文件与模块**：
  - [app/api/tickets/route.ts](../app/api/tickets/route.ts)：单单流式接入，后台异步触发增量吸附，入库即智能归卷；
  - [app/api/cluster/route.ts](../app/api/cluster/route.ts)：批量研判入口，自动加载未结案活跃主题，支持跨批次连续治理。

---

## 三、关键字段流转与保底填充矩阵

| 字段名 | 核心含义 | AI / 算法产生逻辑 | 缺失/异常时的保底填充 |
| :--- | :--- | :--- | :--- |
| `summarizeTitle` | 公文诉求标题 | System-2 极速抽取提炼 | `关于${location}${subject}${eventType}的诉求` |
| `canonicalSubject` | 规范涉事主体 | 实体识别 + 别名字典对齐 | `${subdistrict}特定涉事方` 或 `特定诉求涉事方` |
| `canonicalLocation` | 微观空间核心基底 | `extractSpatialCore` 道路提纯 | `${subdistrict}辖区` 或 `未标明微观地点` |
| `subdistrict` | 所属法定镇街/街道 | 别名替换 + 目标辖区法定区划白名单映射 | 规则解析从地址推导，未知时填 `未指定` |
| `eventType` | 核心事件定性 | System-2 极速抽取 | 关键词正则推导，保底为 `城市管理日常诉求跟进` |
| `category` | 7 大民生分类 | System-1 前置判别 / S2 核定 | 语义推断，保底归入 `城市管理` |
| `confidence` | 抽取置信度 | 模型自评 (0-100) | 规则兜底评估（45-85 分） |
| `riskLevel` | 风险预警等级 | 险情词 + 群发频次 + 慢思考裁定 | 规则默认保底为 `LOW`，命中险情必升 `HIGH` |
| `recommendedAction` | 协同处置建议 | System-2 慢思考公文生成 | 转派所属辖区行业主管部门牵头核实标准建议 |
| `reasoningContent` | 深度思维链过程 | System-2 慢思考思维链剥离 | 供座席与督办领导调阅权责争议溯源推导 |

---

## 四、维护与评测验证指引

```bash
# 1. 运行真实业务多工单全链路端到端评测流水线
npx tsx scripts/test-pipeline-cluster.ts

# 2. 运行增量工单时空吸附与动态研判专项实测
npx tsx scripts/test-incremental-clustering.ts

# 3. 运行双引擎联合推理验证
npx tsx scripts/test-dual-systems.ts

# 4. TypeScript 全局类型校验
npx tsc --noEmit
```
