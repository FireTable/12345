# 多频工单智能研判系统 — TODO

> 2026-08-15 起,本文档作为状态面板使用。已交付项用 `[x]` 勾选并附 commit hash + 备注;待办项用 `[ ]`,按优先级排序。
>
> **优先级口径**:
> - **P0** = 黑客松命题核心(完成度/落地潜力)
> - **P1** = 主仓收尾(merge to main、冒烟、清理)
> - **P2** = 演示件/路演前单独开(需 human-in-the-loop 批准)
> - **P3+** = Sidecar(需 human-in-the-loop 批准,且 P2+ 启动前必须明确指令)
>
> **当前工作分支**:`main`(`e311b48`,本机,未推送 remote)

---

## P0 — 黑客松命题核心(已全部完成 ✅)

- [x] **#1 分类对齐 spec 7 类** — `daee967` `feat(classify & review): 对齐 spec 7大民生分类体系,新增抽取置信度评分与人工复核队列`
  - 触达:`backend/prompt.ts`, `extract-node.ts`, `cluster-node.ts`, `state.ts`, `db/schema.ts`, `db/migrations/0003_lovely_yellowjacket.sql`, `app/api/review/route.ts`, `lib/review-queue.ts`, `app/api/cluster/route.ts`, `app/api/themes/route.ts`, `scripts/verify-classify-confidence.ts`
  - 备注:Zod 枚举 7 类,旧标签 normalize 进 schema 不抛。19/19 验证通过。
  - **负责人**:Gemini · **分支**:`feat/p0-classify-and-confidence`

- [x] **#2 置信度评分 + 复核队列(API 层)** — `daee967`(同 commit)
  - 触达:`lib/review-queue.ts`, `app/api/review/route.ts`
  - 备注:LLM 自评 0-100 + 离线兜底按要素完整度评分(85/70/45)。**UI 仍未做**,见 P2。

- [x] **#3 闭环哨兵(7 天假闭环检测)** — `8a25e72` + `750a4ff`
  - 触达:`db/schema.ts`, `0004_fake_closure.sql`, `backend/node/fake-closure.ts`, `cluster-node.ts`, `summary-node.ts`, `state.ts`, `master-table.tsx`, `upload/route.ts`, `cluster/route.ts`, `scripts/verify-fake-closure.ts`
  - 备注:`markFakeClosures` 对照全部前序已办结票(非相邻),窗口 7 天读 `RULES.fakeClosure.windowDays`。**现网 300 条无办结时间,线上不会凭空标红**,等源数据补齐。

- [x] **#4 核查总表打磨** — `8222225`
  - 触达:`app/_components/table/master-table.tsx`, `lib/export-csv.ts`
  - 备注:加 `eventType` 列 + `recommendedAction` 列,CSV 补 `category`。**未实现** `reopenedOnly` 与假闭环 badge(见 P2/P3)。

- [x] **#5 红黄蓝三级规则化** — `8d58024` + `750a4ff`(Grok) + `43f50da`(Agent C)
  - 触达:`backend/rules.ts`, `risk-rules.ts`, `cluster-node.ts`, `summary-node.ts`, `state.ts`, `prompt.ts`, `scripts/verify-risk-rules.ts`
  - 备注:形态打标 `INDIVIDUAL_REPEAT` / `GROUP_GATHERING`,负面词 + 件数叠加。LLM 不可改档 HIGH。镇街硬编码已删。

- [x] **P0 合并到 `feat/p0-merge-midfix`** — `c6a4dd1` + `3d4fcb6` + `8d98134` + `2922c52`
  - 备注:三 worktree squash merge,冲突已全部解决,`pnpm exec tsc --noEmit` + `pnpm build` 零错误。

---

## P1 — 主仓收尾(本周内,自主推进)

- [x] **把 `feat/p0-merge-midfix` squash merge 到 `main`** — `e311b48` `feat: 多频诉求智能研判核心交付(#1-#5 全套)`
  - 26 files changed, 1970 insertions(+), 57 deletions(-),零冲突。
- [x] **主仓冒烟**:`pnpm exec tsc --noEmit` 零错 + `pnpm build` 通过(12 路由全部编译)
  - 备注:`pnpm dev` + 上传样本端到端待你手动跑(需要 PG 数据库实例)
- [ ] **数据库迁移**:`pnpm db:migrate`,确认 `0003_lovely_yellowjacket` + `0004_fake_closure` 都到位
  - 备注:无 PG 实例,需你本地先启库
- [ ] **验证 master-table 字段**:风险、eventType、recommendedAction 都出现,CSV 导出含新列
  - 备注:同上,需手动跑 dev + 导入样本
- [x] **清理 worktree**:`wt-merge-midfix` / `wt-fake-closure` / `wt-classify-confidence` / `wt-table-and-risk` 全部 `--force` 移除;4 个分支 `branch -D` 删除
  - `git worktree list` → 只剩 `/Users/FireTable/OpenClaw/Code/12345  e311b48 [main]`
- [x] **删除 `docs/TODOS.md` 中的 `feat/p0-merge-midfix` 引用** — 当前工作分支已写为 `main`,文件无需再改

---

## P2 — 演示件/路演前单独开(需 human-in-the-loop)

- [ ] **#6 热点穿透 / 24 小时柱图**
  - 先修造假数字:`multiFrequencyRate=38%` / `compressionRatio=95%` / `avgResponseTimeSavedHours=5.2`(目前 `app/api/cluster/route.ts` 是写死的)。
  - 再决定 24 桶图(22:00–01:00 之类)。**叶子组件自己 fetch `/api/stats`,不要扩 `app/page.tsx` 顶层数据流**。
  - 重开条件:路演前单独开;24 桶总和对 `createTime` 非空的票,不要强行等于 `totalTickets`。

- [ ] **#2 review_queue UI(最小复核页)**
  - 等分类稳定后用**规则分**代替模型自评分:抽不到主体/地点 = 低置信。`scripts/verify-classify-confidence.ts` 已有 19/19 检查通过。
  - 不要改 `ticket-agent.ts`(全员红线)。

- [ ] **#3 假闭环源数据接入**
  - 等数据方补「办结时间 / 办结状态」字段后,重跑上传 + 聚类。逻辑已在,无需改代码。

- [ ] **假闭环 badge 在 master-table 显示** — `reopenCount > 0` 时主表工单数列旁 🔴「疑似假闭环 ×N」
  - **前提**:源数据到位(见上一条)。

---

## P3+ — Sidecar(需 human-in-the-loop 批准,默认不碰)

- [ ] **P2 合规**:按需还原 PII / `revealPII` / `pii_audit`。脱敏双写已在 main,不要再改 `anonymizer` 方向。
- [ ] **P3**:Copilot 三段式 / 历史知识库 / 智能问数 / 数字人
- [ ] **P4**:四象限、迁移到企业、完整向量记忆

> 记忆提醒:`sidecar-needs-approval.md` — **P2+ sidecar / 纯 sidecar 必须 human-in-the-loop**,P0/P1 可自主推进。

---

## 已取消/合并项(历史)

- ~~#2 改 `ticket-agent.ts` 派 LLM 自评路径~~ — 改为规则分,见 P2
- ~~#4 `reopenedOnly` 在 `/api/tickets` 滤 `reopenCount`~~ — 取消,会让 agent 发明坏逻辑。假闭环 badge 改在 master-table。
- ~~`SPREAD_SAME_TYPE` 同类蔓延跨地点合并~~ — 推翻 cluster-node「严禁跨地点拉郎配」不变量,取消。
- ~~`wt-hotspot-stats` worktree(#6)~~ — 不建,等路演前单独开

---

## 全员红线(动之前先看)

**禁止触碰**:
- `langgraph.json`
- `backend/agent/ticket-agent.ts`
- `app/page.tsx` 顶层数据流(只在叶子组件加列/加卡)
- 已生成的旧 migration 文件(只允许本次 `drizzle-kit generate` 的新文件)

**Schema**:`db/schema.ts` 改了必须 `pnpm exec drizzle-kit generate`,新 SQL + snapshot 一并 commit。

**Zod / LLM**:枚举变更必须兼容旧输出。用映射表把 `生态环保/住建管理/市容秩序/综合民生` 收成新 7 类。

**自检**:
```bash
pnpm exec tsc --noEmit
pnpm build
```

---

## 紧急联系

- build / drizzle 失败:贴完整错误回主对话,不要回滚 main
- 需要动红线文件:先问
- 映射表与抽检语料冲突:写 `BLOCKED.md` 引用权威表,不要自行发明第 8 类
- Sidecar 启动:需要明确指令,默认不开