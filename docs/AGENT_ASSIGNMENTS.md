# 多频工单智能研判系统 — Agent 任务派单

> 本文档用于多 agent 协同开发。每个 agent 只读自己负责的部分,任务详情通过 `claude` TaskList 拉取(对应 ID 见下表)。

---

## 一、项目背景(必读,30 秒扫完)

**赛题**:顺德区 12345 热线多频工单识别(同一事件/主体的反复投诉,加强重视办理)。
**核心命题**:从 1800+ 单/日海量诉求中自动聚类多频、分类打标、批量核查。
**最低成果**:批量核查表(评委只看这张表)。
**评价重点**:完成度、落地潜力。
**仓库**:`/Users/FireTable/OpenClaw/Code/12345`
**技术栈**:Next.js 15 + LangGraph JS + Drizzle ORM + PostgreSQL + react-force-graph-2d

**参考文档**:
- 项目总结 docx:`/Users/FireTable/Downloads/项目总结:基于AI大模型的顺德12345多频诉求智能研判系统…docx`(可用 `textutil -convert txt` 转 txt 后读)
- 政数局赛题 md:`/Users/FireTable/Downloads/顺德区政数局——12345热线多频工单识别.md`
- 当前代码入口:见各任务"触达文件"段

---

## 二、通用 Worktree 规则(每个 agent 必须遵守)

### 1. 工作目录
绝对不要在 `/Users/FireTable/OpenClaw/Code/12345` 主目录里改代码 — 那是用户的本地开发分支。你只能在给你的 `wt-*` 目录里改。

### 2. 分支与 commit
- 分支名已固定(见下表),**不要改分支名**
- commit message 用中文 Conventional Commits:`<类型>(<范围>): <中文描述>`
- 一个任务 = 一个 commit,小步快跑
- 不要 amend、不要 rebase、不要 force push
- 不要 push 到 remote(用户本地合并)

### 3. 改动约束(全员适用)
**绝对禁止触碰的文件**:
- `langgraph.json`
- `backend/agent/ticket-agent.ts`(除非任务明确说改)
- `app/page.tsx` 顶层数据流(只在叶子组件层加东西)
- 任何 `migrations/` 下已生成的文件(除非你新生成的)

**Schema 变更强制要求**:
- 修改 `db/schema.ts` 后必须跑 `pnpm drizzle-kit generate`
- 把新生成的 migration 文件 commit 进当前分支
- migration 文件名不要改

**自检(完成前必跑)**:
```bash
pnpm build  # 必须通过,任何 TS 错误都不放过
```

### 4. 验收
每个任务 description 里有"验收标准"段 — 自检时**逐条对照**。完成后在工作目录跑 `git status` 确认 clean。

### 5. 任务详情获取方式
在你的 worktree 目录里跑 `claude`,然后让 claude 帮你执行 `TaskList` + `TaskGet` 拉取对应 ID 的完整 description(含文件行号、代码位置、验收用例)。

或者直接读本文档对应章节复制走(任务详情在本文件 §四-§六)。

---

## 三、工作树清单(用户已建好)

| Worktree 路径 | 分支 | 任务 | Agent |
|---|---|---|---|
| `../wt-classify-confidence` | `feat/p0-classify-and-confidence` | #1 + #2 | **Gemini Flash** |
| `../wt-fake-closure` | `feat/p0-fake-closure` | #3 | **Grok** |
| `../wt-table-polish` | `feat/p0-table-polish` | #4 | **minimax(我)** |
| `../wt-pattern-level` | `feat/p1-pattern-level` | #5 | **Grok**(round 2) |
| `../wt-hotspot-stats` | `feat/p1-hotspot-stats` | #6 | **minimax(我)**(round 2) |

**Round 1** = 三个 worktree 并行。
**Round 2** = 后两个复用(待 round 1 完成、用户 merge 之后)。

### Agent 分工

| 代号 | 角色 | 擅长 | 分配任务 |
|---|---|---|---|
| **Grok** | 逻辑型 | 推理 / 跨文件算法设计 | #3 + #5(集群算法 + 风险等级规则) |
| **Gemini Flash** | 结构型 | Schema / Zod / 类型 / 批量 CRUD | #1 + #2(枚举对齐 + 复核队列) |
| **minimax(我)** | 工程型 | 前端 / API / 聚合查询 | #4 + #6(表格打磨 + 热点统计) |

**理由**:
- Grok 拿 #3 是因为它跨 6 个文件且算法密度最高(7 天窗口检测 + 形态推导)
- Gemini Flash 拿 #1+#2 是因为全是大批量结构化改动(枚举重映射 + 新表 + 3 个新接口)
- 我拿 #4+#6 是因为前端 + stats 聚合 + 柱图可视化,贴近 UI 完成度

---

## 三-A、Grok — 任务 #3(round 1)+ 任务 #5(round 2)

> 占位段,详见 §五。

---

## 四、Gemini Flash — 任务 #1 + #2(分类对齐 + 置信度复核)

**Worktree**: `../wt-classify-confidence`
**分支**: `feat/p0-classify-and-confidence`
**任务 TaskList ID**: #1 + #2(在主仓库跑 `claude` 后用 TaskList 拉详情)
**角色定位**:结构型 — Schema / Zod / 类型 / 批量 CRUD 改动

### 任务 #1 — 分类体系对齐 spec 7 类

**目标**:`category` 枚举从当前 7 类对齐到 spec 7 类。

**当前**:`市容秩序/生态环保/住建管理/市场监管/公共安全/交通出行/综合民生`
**目标**:`城市管理/市场监管/社会治理/交通出行/生态环境/劳动社保/公共安全`

**触达文件**:
- `backend/prompt.ts:8-35`(`ExtractedTicketItemSchema.category` 改 z.enum)
- `backend/prompt.ts:50-80`(规则段同步枚举)
- `backend/node/extract-node.ts:55`(JSON 解析 fallback 默认值 `"综合民生"` → `"城市管理"`)
- `backend/node/extract-node.ts:101-128`(`fallbackDynamicExtraction` 9 个分支全部重映射:噪音→生态环境 / 物业、下水道→城市管理 / 默认兜底→城市管理)
- `backend/node/extract-node.ts:136`(兜底 fallback → `"城市管理"`)
- `db/schema.ts:50`(`themesTable.category` 默认值 → `"城市管理"`)

**不动**:`backend/state.ts` / 任何 `app/_components/**` / `lib/export-csv.ts`

**验收**:
1. 噪音文本 → `生态环境`
2. 物业/电梯文本 → `城市管理`
3. 下水道/排污文本 → `城市管理`
4. 默认兜底 → `城市管理`
5. grep `住建管理|综合民生|市容秩序|生态环保` 在业务代码中应消失(注释/历史 commit 除外)

---

### 任务 #2 — 置信度评分 + 人工复核队列

**目标**:工单带 `confidence: 0-100`,<60 入复核队列。

**触达文件**:
- `backend/prompt.ts:8-35`(`ExtractedTicketItemSchema` 加 `confidence: z.number().min(0).max(100)`)
- `backend/state.ts:36-46`(`EnrichedTicket` 加 `confidence?: number`)
- `backend/node/extract-node.ts:49-58`(JSON fallback 解析 confidence,LLM 失败给 0)
- `backend/node/extract-node.ts:165-198`(写 `confidence`,新增 `lowConfidenceTickets` 返回)
- 新增常量 `LOW_CONFIDENCE_THRESHOLD = 60`
- `db/schema.ts`(新表 `reviewQueueTable`,见 description)
- `app/api/review/route.ts`(新文件,GET/POST/seed 三个 handler)
- `backend/agent/ticket-agent.ts`(extract 后调 `seedReviewQueue(lowConfidenceTickets)`)

**reviewQueueTable schema**:
```ts
{
  id: varchar(64).primaryKey()
  ticketId: varchar(64).notNull().references(ticketsTable.id)
  reason: varchar(128).notNull().default("LOW_CONFIDENCE")
  confidence: integer
  status: varchar(32).notNull().default("PENDING")  // PENDING/REVIEWED/DISMISSED
  operator: varchar(64)
  note: text
  createdAt: timestamp with timezone.defaultNow().notNull()
  reviewedAt: timestamp with timezone
}
```
索引:`idx_review_queue_status`, `idx_review_queue_ticket_id`。

**`/api/review` 接口**:
- `GET /api/review?status=PENDING` 返回待复核列表(join ticket 显示 ticketNo/subject/location/confidence)
- `POST /api/review` body `{reviewId, action: "REVIEWED"|"DISMISSED", note?, operator}` 写 status/operator/reviewedAt
- `POST /api/review/seed` body `{tickets: [{ticketId, confidence, reason}]}` 批量落库

**不动**:`ExtractedEntity.confidence`(实体级,与工单级并存)

**验收**:
1. 5 条 mock 工单跑完 extract,`enrichedTickets[*].confidence` 存在且 0-100
2. `lowConfidenceTickets.length` 等于 confidence<60 的条数
3. DB `review_queue` 表新增对应行
4. `GET /api/review?status=PENDING` 返回非空
5. `POST /api/review {action:"REVIEWED",operator:"tester"}` 后该行 status 变更 + reviewedAt 写入
6. 不破坏现有聚类输出

**完成前**:`pnpm build` 通过 + `pnpm drizzle-kit generate` 生成 migration 文件已 commit。

---

## 五、Grok — 任务 #3(round 1)+ 任务 #5(round 2)

**Worktree round 1**: `../wt-fake-closure`(分支 `feat/p0-fake-closure`)
**Worktree round 2**: `../wt-pattern-level`(分支 `feat/p1-pattern-level`,**基于 `feat/p0-fake-closure` merge 后的 main 拉新分支**)

**任务 TaskList ID**: #3(round 1) + #5(round 2)
**角色定位**:逻辑型 — 推理 / 跨文件算法设计 / 规则引擎

---

### 任务 #3 — 闭环哨兵(办结 7 天再投诉 = 🔴假闭环)

**目标**:检测"已办结工单在 7 天内又被同主体或同地点投诉",标 🔴,纳入高风险统计。

**触达文件**:
- `db/schema.ts`(ticketsTable 加列):
  ```ts
  closedAt: timestamp("closed_at", { withTimezone: true })
  closureStatus: varchar("closure_status", { length: 32 })  // RESOLVED/REOPENED/null
  isFakeClosure: boolean("is_fake_closure").default(false)
  ```
  索引:`idx_tickets_closed_at`
- `backend/state.ts:20-34`(`RawTicket` 加 `closedAt?` / `closureStatus?` / `isFakeClosure?`)
- `backend/state.ts:48-67`(`MultiFrequencyTheme` 加 `reopenCount?: number` / `reopenTicketIds?: string[]`)
- `backend/state.ts:92-103`(`OverallStats` 加 `fakeClosureCount: number`)
- `backend/node/cluster-node.ts`(两处聚类,模式 1 L113-132 与模式 2 L182-201):
  - 新增常量 `FAKE_CLOSURE_WINDOW_DAYS = 7`
  - 检测逻辑:组内按 createTime 排序,若 `prev.closedAt && prev.closureStatus === "RESOLVED" && (curr.createTime - prev.closedAt) ≤ 7 天` → 标 `curr.isFakeClosure = true` / `closureStatus = "REOPENED"` / theme.reopenCount++ / theme.reopenTicketIds.push(curr.id)
- `backend/node/summary-node.ts:115-135`(stats 新增 `fakeClosureCount = sum(t.reopenCount)`;`highRiskCount` 计算加条件 `riskLevel === "HIGH" || reopenCount > 0`)
- `app/_components/table/master-table.tsx:98-116`(工单数列旁加 🔴 badge:
  ```tsx
  {row.original.reopenCount > 0 && (
    <span className="ml-2 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded">
      疑似假闭环 ×{row.original.reopenCount}
    </span>
  )}
  ```)

**验收**:
1. A(办结,T-3d) + B(同主体,C 未办结) + C(同主体,T-1d):C.isFakeClosure=true
2. D(办结,T-30d) + E(同主体,T-1d):不触发
3. theme.reopenCount≥1 时 master-table 行内出现 🔴 badge
4. stats.fakeClosureCount = cluster 中 reopenCount 总和
5. 不破坏同地点聚类

**完成前**:`pnpm build` 通过 + `pnpm drizzle-kit generate` migration 已 commit。

---

### 任务 #5 — 红黄蓝三级规则化(round 2,等 #3 merge 后启)

**目标**:riskLevel 从"按 ticketCount"升级为"按 spec 红黄蓝触发规则 + LLM 综合判定"。

**触达文件**:
- `backend/state.ts:48-67`(`MultiFrequencyTheme` 加 `patternType: "GROUP_GATHERING" | "SPREAD_SAME_TYPE" | "INDIVIDUAL_REPEAT"`)
- `backend/prompt.ts:85-98`(`ThemeEnrichmentSchema` 加 `patternType` 与 `negativeSentimentHit: boolean`)
- `backend/prompt.ts:105-140`(`buildThemeEnrichmentPrompt` 加负面情绪词库:`危险|着火|断水|断电|群体聚集|事故|爆|倒塌|中毒|死亡`,并明确"命中负面词 + GROUP_GATHERING → 强制 HIGH")
- `backend/node/cluster-node.ts:120,189`(新增 `derivePatternType()` 与 `scanNegativeSentiment()`;`riskLevel` 计算改为:
  ```
  let level = tickets.length >= 5 ? "MEDIUM" : "LOW"
  if (patternType === "GROUP_GATHERING" && scanNegativeSentiment(tickets)) level = "HIGH"
  else if (tickets.length >= 5) level = "HIGH"
  else if (tickets.length >= 3) level = "MEDIUM"
  ```
- `backend/node/summary-node.ts:34-43`(接收 `patternType` 与 `negativeSentimentHit` 写入 theme;LLM 输出 riskLevel 若与本地规则冲突,**以本地规则为准**)

**验收**:
1. 同地点 5 单 + 内容含"危险/着火" → riskLevel=HIGH / patternType=GROUP_GATHERING
2. 同地点 3 单 + 正常内容 → riskLevel=MEDIUM / patternType=GROUP_GATHERING
3. 同主体 2 单 + 无负面词 → riskLevel=LOW / patternType=INDIVIDUAL_REPEAT
4. LLM 输出 riskLevel=LOW 时,本地 HIGH 不被覆盖
5. 不破坏 force graph / stats 计算

---

## 六、minimax(我)— 任务 #4(round 1)+ 任务 #6(round 2)

**Worktree round 1**: `../wt-table-polish`(分支 `feat/p0-table-polish`)
**Worktree round 2**: `../wt-hotspot-stats`(分支 `feat/p1-hotspot-stats`)

**任务 TaskList ID**: #4(round 1) + #6(round 2)
**角色定位**:工程型 — 前端 / API / 聚合查询 / UI 可视化

---

### 任务 #4 — 批量核查表打磨

**目标**:master-table 覆盖核心展示字段,新增查询参数过滤"假闭环"。

**触达文件**:
- `app/_components/table/master-table.tsx`:
  - L84-90 后插入 `eventType` 列:`<span className="text-[12px] text-slate-600">{row.original.eventType}</span>`
  - L98-116 工单数列旁加 假闭环 badge(若 #3 未并行完成,先留渲染占位):
    ```tsx
    {row.original.reopenCount > 0 && (
      <span className="ml-2 text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200 px-1.5 py-0.5 rounded">
        疑似假闭环 ×{row.original.reopenCount}
      </span>
    )}
    ```
  - L137-153 操作列前加"建议处置"摘要 cell:`<span className="text-[11.5px] text-slate-500 line-clamp-2">{row.original.recommendedAction}</span>`
- `app/api/tickets/route.ts`:
  - `GET /api/tickets?reopenedOnly=true` 过滤逻辑:只在返回 themes 列表上加 `t => (t.reopenCount || 0) > 0`(若 themes 在此处聚合)
  - 返回结构不变
- `lib/export-csv.ts`:检查是否需同步加列(若有,补 `eventType` / `recommendedAction` / `reopenCount` 三列)

**不动**:`app/page.tsx` 顶层 / `kanban/**` / 任何 backend 代码

**验收**:
1. master-table 每行含:风险等级 + 主题名 + subject + eventType + location + ticketCount + timeSpanHours + recommendedAction + 假闭环 badge(若有) + 下钻按钮
2. CSV 导出覆盖新列
3. `GET /api/tickets?reopenedOnly=true` 返回 reopen≥1 的 themes(或空数组)
4. 默认行为(不传 query)与改动前完全一致

---

### 任务 #6 — 时空锁定 / 数据穿透展示(round 2)

**目标**:前端顶部大盘透出"7 天热点增长率 + 时段分布"。

**触达文件**:
- `app/api/stats/route.ts`:
  - 末尾追加聚合查询:
    - `hotspot7d`:最近 7 天 vs 前 7-14 天对比,返回 `{growthRate, topLocation, topLocationCount}`
    - `hourlyDistribution`:按 EXTRACT(HOUR FROM createTime) 分桶(24 项)
    - `topLocations`:top 5 subdistrict × count
  - 返回结构新增 `hotspot` / `hourly` / `topLocations` 字段
  - 7 天增长率公式:`growthRate = previous7d > 0 ? Math.round(((current7d - previous7d) / previous7d) * 100) : null`
- `backend/state.ts:92-103`(`OverallStats` 加):
  ```ts
  hotspot?: { topLocation: string, growthRate: number | null, topLocationCount: number }
  hourly?: Array<{ hour: number, count: number }>
  ```
- `app/_components/dashboard/header-stats.tsx`:
  - 5 卡片 grid 下方新增一行(宽 5 列跨 grid)
  - 卡片"🔥 7 天热点穿透":
    - 标题:`{stats.hotspot.topLocation} · {categoryLabel}`
    - 副标题:`投诉激增 ↑ 186% (基线 X → 当前 Y 单)`(增长率空时显示"暂无对比基线")
    - 时段柱图:24 根 div bar 渲染(纯 flex),22:00-01:00 高亮 rose 色,其余 slate
  - 仅当 `stats.hotspot?.topLocation` 存在时渲染(空数据整卡片隐藏)

**验收**:
1. `GET /api/stats` 返回 JSON 含 `hotspot.topLocation` / `hotspot.growthRate` / `hourly` 字段
2. 24 hour 桶总和等于 totalTickets(允许 ±0 误差)
3. 前端"7 天热点穿透"卡片可见,显示 topLocation + 增长率 + 时段柱图(空数据时隐藏)
4. 不影响现有 5 卡片

**完成前**:`pnpm build` 通过。

---

## 七、合并顺序(用户执行,agent 不管)

```
1. merge feat/p0-fake-closure  → main         (提供 #5 的依赖基底)
2. merge feat/p0-classify-and-confidence → main
3. merge feat/p0-table-polish  → main         (依赖 #3 字段)
4. merge feat/p1-pattern-level (基于 #3) → main
5. merge feat/p1-hotspot-stats → main
```

每个分支 squash merge 即可。merge 后用户会跑一遍 `pnpm build` 与 `pnpm dev` 端到端冒烟。

---

## 八、Sidecar 红线(全员严禁碰)

下列内容在用户明示"开始 sidecar"前**严禁触碰**:

- **P2 合规 sidecar**:按需还原 PII + 审计日志(revealPII 接口 / pii_audit 表)
- **P3 加分 sidecar**:Copilot 三段式输出 / 历史知识库 / 智能问数 / 数字人
- **P4 纯 sidecar**:数字人 / 迁移功能(政府/企业) / 四象限 / 完整向量化记忆库

判断标准:不在 §四-§六 任务清单里的功能,默认是 sidecar,先问再做。

---

## 九、紧急联系 / 反馈

- 任务描述有歧义:停下,在主仓库跑 `claude` 用 TaskList 重新拉取,不要瞎猜
- 发现 spec 互相冲突(分类枚举 vs 业务逻辑):停下,在 worktree 写一份 `BLOCKED.md` 说明冲突点,不要擅自决定
- build / drizzle 生成失败:贴完整错误回主对话,**不要回滚到 main**
- 跨任务文件冲突:停下,告知主对话等待其他 agent 完成

---

**开始干活吧。各 agent 进自己的工作目录 → `claude` → TaskList 拉详情 → 按 description 推进 → commit 完报告。**