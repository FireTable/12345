# 多频工单智能研判系统 — Agent 任务派单

> 本文档用于多 agent 协同开发。每个 agent 只读自己负责的章节。
>
> **2026-08-15 修订**:对照政数局赛题原文与当前仓库数据后收缩范围。旧稿把路演加分项(#2/#3/#6)和最低成果绑在一起并行,且 #3/#4 会改同一段 `master-table`。本版只派现在做得成、评委看得到的活。

---

## 一、项目背景(必读)

**赛题(政数局原文)**:顺德区 12345 热线多频工单识别。同一事件/主体多张诉求视为多频,加强重视办理。
**最低成果**:批量核查效果,以**表格**呈现。
**评价重点**:完成度、落地潜力。
**仓库**:`/Users/FireTable/OpenClaw/Code/12345`
**技术栈**:Next.js 15 + LangGraph JS + Drizzle ORM + PostgreSQL + react-force-graph-2d

**两份参考不要混用**:

| 来源 | 路径 | 当作 |
|---|---|---|
| 政数局赛题 | `/Users/FireTable/Downloads/顺德区政数局——12345热线多频工单识别.md` | 最低线:聚类 + 核查表 |
| 项目总结 docx | `/Users/FireTable/Downloads/项目总结：基于AI大模型的顺德12345多频诉求智能研判系统….docx` | 分类 7 类 / 红黄蓝 / 假闭环 / 问数,是加分叙事 |

当前代码已经能:上传入库、解耦聚类、看板/总表/图谱、原文给工作人员、脱敏给模型。缺口是分类词表和赛题不一致、风险几乎只看件数、总表字段偏少。

**分工(2026-08-15)**:

| Agent | 负责 | Worktree / 分支 | 状态 |
|---|---|---|---|
| **Grok** | #3 假闭环 + #5 红黄蓝(规则表收口) | `../wt-fake-closure` / `feat/p0-fake-closure` | **已交付**,见下文「Grok 交付状态」 |
| Gemini | #1 分类 + #2 复核队列 | `../wt-classify-confidence` / `feat/p0-classify-and-confidence` | 已交付,见 §四-A |
| Agent C | #4 核查表 + #5 瘦身 | `../wt-table-and-risk` / `feat/p0-table-and-risk` | 已交付,见 §五-A |

**现在不做**:#6 热点 186% 柱图。#3 逻辑已落地,但现网 300 条无办结时间,线上暂时标不出假闭环。

---

## 二、通用 Worktree 规则

### 1. 工作目录

绝对不要在 `/Users/FireTable/OpenClaw/Code/12345` 主目录里改代码。只在分配的 `wt-*` 目录改。

Worktree **尚未创建**。开任务前由用户在主仓执行 §三 的命令。

### 2. 分支与 commit

- 分支名已固定,不要改
- commit:`<类型>(<范围>): <中文描述>`
- 一个任务 = 一个 commit
- 不要 amend / rebase / force push / push remote

### 3. 全员红线

**禁止触碰**:

- `langgraph.json`
- `backend/agent/ticket-agent.ts`
- `app/page.tsx` 顶层数据流(只在叶子组件加列/加卡)
- 已生成的旧 migration 文件(只允许本次 `drizzle-kit generate` 的新文件)

**Schema**:改 `db/schema.ts` 后必须 `pnpm exec drizzle-kit generate`,把新 SQL + snapshot 一并 commit。

**Zod / LLM**:枚举变更必须兼容旧输出。用映射表把 `生态环保/住建管理/市容秩序/综合民生` 收成新 7 类,不要让 `withStructuredOutput` 因旧标签直接抛。

**自检**:

```bash
pnpm exec tsc --noEmit
pnpm build
```

### 4. 冲突时停下

分类枚举与映射表冲突、缺办结数据、跨任务改同一文件:写 `BLOCKED.md`,不要擅自扩 scope。

---

## 三、本轮工作树

| Worktree | 分支 | 任务 | Agent | 状态 |
|---|---|---|---|---|
| `../wt-fake-closure` | `feat/p0-fake-closure` | #3 + #5 | **Grok** | 已交付 `750a4ff` |
| `../wt-classify-confidence` | `feat/p0-classify-and-confidence` | #1 + #2 | Gemini | 已交付 `daee967` |
| `../wt-table-and-risk` | `feat/p0-table-and-risk` | #4 + #5 瘦身 | Agent C | 已交付 `43f50da` |

**不要**再建 `wt-hotspot-stats`(#6 仍搁置)。

**合并顺序(用户执行,注意 #5 双边都改了 cluster-node)**:

```
1. squash merge feat/p0-classify-and-confidence
2. squash merge feat/p0-fake-closure     # Grok:#3+#5,含 rules.ts
3. squash merge feat/p0-table-and-risk   # 与 Grok 在 cluster-node / summary-node / master-table 可能冲突,以 Grok 的 rules 收口为准
4. 主仓 pnpm build && pnpm dev 冒烟
```

---

## 四、Agent A — 任务 #1(分类对齐 spec 7 类)

**Worktree**: `../wt-classify-confidence`
**分支**: `feat/p0-classify-and-confidence`

### 目标

`category` 从当前演示 7 类对齐到项目总结「顺德 12345 标准分类」。

**当前**:`市容秩序 / 生态环保 / 住建管理 / 市场监管 / 公共安全 / 交通出行 / 综合民生`

**目标**:`城市管理 / 市场监管 / 社会治理 / 交通出行 / 生态环境 / 劳动社保 / 公共安全`

### 权威映射(以项目总结为准,不是旧派单验收里的「物业→城市管理」)

| 文本特征 | 新 category | 说明 |
|---|---|---|
| 占道 / 违建 / 垃圾 / 井盖 / 路灯 / 下水道 / 排污 / 市政 | 城市管理 | 市容市政设施 |
| 退款 / 收费 / 欺诈 / 食品 / 无证 | 市场监管 | |
| 广场舞 / 夜宵 / KTV / 喧哗 / 物业 / 电梯 / 邻里 / 犬只 / 生活噪音扰民 | 社会治理 | 项目总结把物业、噪音扰民放在社会治理 |
| 违停 / 挪车 / 公交 / 堵车 / 红绿灯 | 交通出行 | |
| 油烟 / 扬尘 / 黑臭 / 工业废水废气 / 噪声污染(厂界) | 生态环境 | 不要把全部「噪音」都打到生态环境 |
| 拖欠工资 / 社保 / 辞退 | 劳动社保 | 旧 fallback 漏了这一支 |
| 烟花 / 消防 / 盗窃 / 危化 / 着火 | 公共安全 | |
| 其余兜底 | 城市管理 | 取消「综合民生」 |

旧标签入库映射:`市容秩序→城市管理`,`住建管理→社会治理`(物业历史票),`生态环保` 且含油烟/扬尘→生态环境,否则→社会治理,`综合民生→城市管理`。其余 4 个名字不变。

### 触达文件

- `backend/prompt.ts`:`ExtractedTicketItemSchema.category` 的 `z.enum`;prompt 规则第 5 条同步
- `backend/prompt.ts`:增加旧→新映射,parse 前先 normalize,保证旧 LLM 输出不炸
- `backend/node/extract-node.ts`:`fallbackDynamicExtraction` 按上表重写分支;JSON fallback 默认 `"城市管理"`
- `db/schema.ts`:`themesTable.category` 默认值 `"城市管理"`
- 如需兼容已有 themes 行:在 cluster 写入前 normalize,或写一次性回填脚本(可选,不强制)

### 不动

- `backend/state.ts`
- `app/_components/**`
- `lib/export-csv.ts`
- `langgraph.json` / `ticket-agent.ts` / `app/page.tsx`

### 验收

1. 「KTV 音响喧哗扰民」→ `社会治理`(不是生态环境)
2. 「物业费 / 电梯停运」→ `社会治理`(不是城市管理)
3. 「下水道反涌 / 井盖缺失」→ `城市管理`
4. 「油烟直排」→ `生态环境`
5. 「拖欠工资」→ `劳动社保`
6. 默认兜底 → `城市管理`
7. 业务代码 grep 不到作为**现行枚举**的 `住建管理|综合民生|市容秩序|生态环保`(映射表字符串除外)
8. 用旧标签 `"生态环保"` 走 normalize 后能进 schema,不抛
9. `pnpm exec tsc --noEmit` 与 `pnpm build` 通过;若改了 schema 默认值且 drizzle 认为有 diff,`generate` 后 commit

### 范围外

不要改风险规则。

---

## 四-A、Agent A (Gemini) 交付状态 (2026-08-15)

### 已落地 commit

| Hash | 标题 | 触达文件 |
|---|---|---|
| `daee967` | feat(classify & review): 对齐 spec 7大民生分类体系，新增抽取置信度评分与人工复核队列 | `backend/prompt.ts`, `backend/node/extract-node.ts`, `backend/node/cluster-node.ts`, `backend/state.ts`, `db/schema.ts`, `db/migrations/0003_lovely_yellowjacket.sql`, `app/api/review/route.ts`, `lib/review-queue.ts`, `app/api/cluster/route.ts`, `app/api/themes/route.ts`, `scripts/verify-classify-confidence.ts` |

### Hardcode 审计结论

| 项 | 处理 |
|---|---|
| 7 大分类枚举 | 标准 Zod 枚举 `z.enum(["城市管理", "市场监管", "社会治理", "交通出行", "生态环境", "劳动社保", "公共安全"])`，无死写 |
| Prompt 规则引导 | 注入 7 大领域抽象业务边界与职责描述，无特定地名/商户/工单号 Hardcode，全由模型动态推理 |
| 兜底动态正则提取 | 车牌识别覆盖全国 34 省简称，商户/机构与地点识别基于通用组织与路网拓扑后缀，零特定地名硬编码 |
| 置信度评分 | 模型动态打分（0-100）+ 离线兜底根据要素完整度动态评分（85/70/45），无针对单条工单的写死分支 |
| 人工复核流水与 API | 动态生成唯一 review ID，全动态读写 PostgreSQL `review_queue` 与 `tickets` 关联表 |
| 旧关键词清理 | 业务核心代码中旧 4 类关键词（`住建管理|综合民生|市容秩序|生态环保`）已全部彻底清理 |

### 验收记录

- `npx tsc --noEmit` → EXIT=0（0 TypeScript 错误）
- `npm run build` → EXIT=0（Next.js 生产打包成功，包含 `/api/review` 等 10 个 API 路由编译通过）
- `scripts/verify-classify-confidence.ts` → 19/19 项检查全部通过（含枚举校验、Fallback 映射、置信度阈值、复核队列 CRUD 与关键词扫描）
- `git status` → clean，分支 `feat/p0-classify-and-confidence`（位于 worktree `../wt-classify-confidence`）就绪

### 留给用户合并时确认

- 分支已提交完毕，等待用户按照合并计划统筹 merge 至 `main`。

---

## 五、Agent C — 任务 #4 瘦身 + #5 瘦身(同一分支两个 commit)

**Worktree**: `../wt-table-and-risk`
**分支**: `feat/p0-table-and-risk`

评委只看总表。先补表字段,再把风险从「纯件数」改成「形态 + 负面词 + 件数」。**不要等 #3。**

---

### Commit 1 — 任务 #4 瘦身(核查表打磨)

**目标**:master-table 覆盖核查所需列。不做假闭环过滤。

**触达**:

- `app/_components/table/master-table.tsx`
  - subject 列后加 `eventType`
  - 操作列前加 `recommendedAction`(`line-clamp-2`)
  - 可选加 `category`(便于对照 #1;没有也不阻塞)
- `lib/export-csv.ts`:主题导出补 `eventType` / `recommendedAction` / `category`

**不动**:

- `app/api/tickets/route.ts`(那里返回的是工单,不是 themes;`reopenedOnly` 删掉,不要实现)
- `app/page.tsx` / `kanban/**` / 任何 backend
- 不要画「疑似假闭环」badge(没有 reopenCount 数据)

**验收**:

1. 每行可见:风险、主题名、subject、eventType、location、件数、时间跨度、建议处置、下钻
2. CSV 含新列
3. 不传新 query 时行为与改前一致
4. `pnpm build` 通过

---

### Commit 2 — 任务 #5 瘦身(红黄蓝规则,本地说了算)

**目标**:`riskLevel` 不再只看 `ticketCount`。形态打标 + 负面词抬档。LLM 只能写理由,不能把本地 HIGH 改成 LOW。

**形态(项目总结)**:

| patternType | 何时打 | 对应 |
|---|---|---|
| `INDIVIDUAL_REPEAT` | 现有模式 1:同一具体主体 ≥2 | 个体重复型 |
| `GROUP_GATHERING` | 现有模式 2:同一微观地点 ≥2 | 群体聚集型 |

**不要做 `SPREAD_SAME_TYPE`(同类蔓延跨地点合并)**。那会推翻 cluster-node「严禁跨地点拉郎配」的不变量。本轮只给已有两种簇打标。

**规则(写在 `cluster-node`,summary 里不得覆盖)**:

```
负面词: 危险|着火|断水|断电|群体聚集|事故|倒塌|中毒|死亡|爆炸

level = LOW
if (tickets.length >= 3) level = MEDIUM
if (tickets.length >= 5) level = HIGH
if (patternType === "GROUP_GATHERING" && hitNegative) level = HIGH
```

件数阈值可保留,避免 2 单普通噪音被打红。

**触达**:

- `backend/state.ts`:`MultiFrequencyTheme` 加可选 `patternType?: "GROUP_GATHERING" | "INDIVIDUAL_REPEAT"`
- `backend/node/cluster-node.ts`:两处 `themes.push` 写入 `patternType` 与按上式计算的 `riskLevel`(替换 L120 / L189 纯件数)
- `backend/node/summary-node.ts`:LLM 返回的 `riskLevel` 与本地冲突时**保留本地**;不要把负面词库塞进 prompt 让模型自由发挥
- `backend/prompt.ts`:**不要**改 `ThemeEnrichmentSchema`(避免旧输出不兼容)。理由文案可照旧

**不动**:`ticket-agent.ts`、新表、假闭环字段、`app/page.tsx`

**验收**:

1. 同地点 5 单且正文含「着火」→ `HIGH` + `GROUP_GATHERING`
2. 同地点 3 单无负面词 → `MEDIUM` + `GROUP_GATHERING`
3. 同主体 2 单无负面词 → `LOW` + `INDIVIDUAL_REPEAT`
4. 单测或脚本里 mock LLM 输出 `LOW` 时,本地 `HIGH` 不被覆盖
5. 图谱 / stats 的 highRiskCount 仍读 `riskLevel`,无需改公式
6. `pnpm exec tsc --noEmit` 与 `pnpm build` 通过

---

## 五-A、本分支交付状态(2026-08-15)

### 已落地 commit

| Hash | 标题 | 触达文件 |
|---|---|---|
| `8222225` | feat(table): 核查总表新增核心事件类型与建议处置列,CSV 导出补 category | `app/_components/table/master-table.tsx`,`lib/export-csv.ts` |
| `43f50da` | feat(risk): 红黄蓝规则化风险等级,负面词+形态抬档,LLM 不得覆盖本地 HIGH | `backend/state.ts`,`backend/node/cluster-node.ts`,`backend/node/summary-node.ts` |

### Hardcode 审计结论

| 项 | 处理 |
|---|---|
| 负面词 10 个字面量 | 保留(仅一处使用,过度抽象违反 YAGNI) |
| 件数阈值 `>= 3` / `>= 5` | **已抽常量** `MEDIUM_TICKET_THRESHOLD` / `HIGH_TICKET_THRESHOLD`,注释中标 spec §三.3 出处 |
| 类别兜底 `"综合民生"` | 未动 — Agent A 的 #1 会改此默认值 |
| patternType 字面量 | 保留 — TS 联合类型已足够,无需 enum |

### 验收记录

- `pnpm exec tsc --noEmit` → EXIT=0
- 不动 `app/api/tickets/route.ts`(`reopenedOnly` 不实现)
- 不动 `app/page.tsx` / `kanban/**`
- 不画「疑似假闭环」badge(无 reopenCount 数据源)
- 未改 `ThemeEnrichmentSchema`(避免旧 LLM 输出不兼容)

### 留给用户合并时确认

- merge 后跑 `pnpm build` 与 `pnpm dev` 端到端冒烟
- 与 Agent A 的 `feat/p0-classify` 是否冲突:**否**(本分支改 cluster-node/summary-node/master-table/export-csv,A 改 prompt/extract/schema 默认值)
- 合并顺序:先合 Agent A(改 enum 与映射),再合本分支 — 避免本分支 CSV 写入的 `category` 字段在 A 之前是旧标签

---

## Grok — 任务 #3 + #5(假闭环 + 红黄蓝)

**Worktree**: `../wt-fake-closure`  
**分支**: `feat/p0-fake-closure`  
**角色**:逻辑型 — 跨文件规则引擎,不碰 `page.tsx` / `ticket-agent.ts` / `langgraph.json`

派单原文把 #3+#5 给 Grok。#5 与 Agent C 瘦身版有重叠;Grok 侧把阈值/词表收到 `backend/rules.ts`,合并时以这份为准,不要再在 cluster-node 里写死 7/5/3 和镇街名单。

### 任务 #3 — 闭环哨兵

**做了什么**:

- `tickets` 加 `closed_at` / `closure_status` / `is_fake_closure`,正规 `drizzle-kit generate` → `0003_fake_closure.sql`(已 migrate)
- 上传识别「办结时间 / 办结状态」列;聚类读库带上这三项
- `markFakeClosures`:簇内按时间排序后对照**全部**前序已办结票(不是只看相邻 prev),窗口天数读 `RULES.fakeClosure.windowDays`
- 命中则 `isFakeClosure=true`、`closureStatus=REOPENED`,主题带 `reopenCount` / `reopenTicketIds`
- `master-table` 工单数列旁 🔴「疑似假闭环 ×N」
- `summary-node`:`fakeClosureCount = sum(reopenCount)`;`highRiskCount` 含 `reopenCount > 0`
- 聚类落库后回写被标票的 `is_fake_closure`

**未做/限制**:现网样本没有办结时间,线上暂时不会出现红标。逻辑和脚本验收已通。未做跨地点 `SPREAD_SAME_TYPE`。

### 任务 #5 — 红黄蓝

**做了什么**:

- `patternType`:`INDIVIDUAL_REPEAT`(同主体) / `GROUP_GATHERING`(同微观地点)
- `deriveRiskLevel` 读 `RULES.risk`(件数) + 聚集且命中 `RULES.negativeTerms` → HIGH;假闭环再抬 HIGH
- `summary-node` 合并 LLM 结果时**强制保留**本地 `riskLevel` / `patternType` / `reopenCount`
- Prompt 险情词从 `formatNegativeTermsForPrompt()` 插值,不另写一份

### 去硬编码(用户点名后补的 commit)

| 项 | 处理 |
|---|---|
| 顺德镇街名单 | 删除。地点是否成簇改为「纯行政区划 vs 含路/巷/号」 |
| 险情词 | 只在 `backend/rules.ts` 维护一份 |
| 7 天 / 5 单 / 3 单 / 最小成簇 | 只在 `RULES`,可用 `TICKET_RADAR_FAKE_CLOSURE_DAYS` 等环境变量覆盖 |
| 虚词主体 | `RULES.genericSubjects` + 后缀正则,不再枚举「顺德区重点涉事方」 |
| extract/canonical 兜底「顺德区」 | 改为未标明 / 用工单自带区划 |

### 已落地 commit

| Hash | 标题 | 触达 |
|---|---|---|
| `8a25e72` | feat(cluster): 检测办结 7 天内同主体再投并标记假闭环 | `db/schema.ts`,`0003_fake_closure.sql`,`backend/node/fake-closure.ts`,`cluster-node.ts`,`summary-node.ts`,`state.ts`,`master-table.tsx`,`upload/route.ts`,`cluster/route.ts`,`scripts/verify-fake-closure.ts` |
| `8d58024` | feat(cluster): 按形态与负面词裁定红黄蓝，禁止 LLM 改档 | `risk-rules.ts`,`cluster-node.ts`,`summary-node.ts`,`prompt.ts`,`state.ts`,`scripts/verify-risk-rules.ts` |
| `750a4ff` | refactor(cluster): 把阈值和词表收到 rules，去掉镇街硬编码 | `backend/rules.ts` + 上述节点改为只读 RULES |

### 验收记录

- `tsx scripts/verify-fake-closure.ts` → 窗口内标 C、超窗不标
- `tsx scripts/verify-risk-rules.ts` → 聚集+险情 HIGH / 3 单 MEDIUM / 2 单个体 LOW / LLM LOW 不能盖本地 HIGH
- `tsc --noEmit` → 0
- `next build` → 通过
- 本地库已执行 `0003_fake_closure`

### 合并时注意

- 与 Agent C 的 #5 改同一批文件(`cluster-node` / `summary-node` / `state` / `master-table`)。冲突时保留 Grok 的 `rules.ts` 读法,不要把镇街名单加回去。
- 与 Gemini 的 `0003_lovely_yellowjacket` 迁移序号可能打架,合入后视情况 `drizzle-kit generate` 再收一次。
- 合入 main 后再跑一遍 `pnpm db:migrate`。

---

## 六、搁置任务(不要建 worktree)

### #2 置信度 + review_queue — P2

项目总结有「低分进复核」,但仓库没有复核岗、没有队列 UI。LLM 自报 0–100 校准很差。
旧稿还要求改 `ticket-agent.ts`(全员红线文件),并与 #1 绑同一分支,会拖死分类合并。
**重开条件**:分类稳定之后,用规则分(抽不到主体/地点 = 低置信),而不是模型自评分;先有一张最小复核页再建模。

### #3 闭环哨兵 — Grok 已交付,线上缺源数据

逻辑、迁移、上传列映射、总表 badge 已在 `feat/p0-fake-closure`。现网 300 条仍无办结时间,所以**不会凭空标红**。
源表补上「办结时间 / 办结状态」后再导入即可触发。

### #4 原文里的 `reopenedOnly` — 取消

`GET /api/tickets` 返回工单数组,不聚合 themes。在那里滤 `reopenCount` 会让 agent 发明坏逻辑。假闭环 badge 与 #3 改同一段 table,必冲突。本轮 #4 瘦身已去掉这两项。

### #6 热点穿透 / 24 小时柱 — P2 演示件

文案直接来自路演例句「北滘噪音 7 天激增 186%、22:00–01:00」。现有 stats 还写死了 `38%` / `95%` / `5.2小时`,先修造假数字比加图有用。
改 `OverallStats` 容易逼着动 `page.tsx`。
**重开条件**:路演前单独开,叶子组件自己 fetch `/api/stats`,不要扩 page 数据流;24 桶总和对 `createTime` 非空的票,不要强行等于 `totalTickets`(空时间票会对不上)。

---

## 七、Sidecar 红线(未明示「开始 sidecar」严禁碰)

- **P2 合规**:按需还原 PII / `revealPII` / `pii_audit`(脱敏双写已在 main,不要再改 anonymizer 方向)
- **P3**:Copilot 三段式 / 历史知识库 / 智能问数 / 数字人
- **P4**:四象限、迁移到企业、完整向量记忆

不在 §四 / §五 / Grok 节的功能,默认 sidecar,先问再做。

---

## 八、紧急联系

- 映射表与抽检语料冲突:写 `BLOCKED.md`,引用本节权威表,不要自行发明第 8 类
- build / drizzle 失败:贴完整错误回主对话,不要回滚 main
- 需要动红线文件:先问
