/**
 * Batch 1 M4 (P0 #6, P0 #7, P0 #10) 独立回归与边界验收测试
 *
 * 严格使用临时 Schema `verify_p0_m4_patrol`，并在 try/finally 中物理清理，零污染基线数据。
 */

import { sql, getRegionDb } from "../db/client";
import { themesTable, ticketsTable, vocabulariesTable } from "../db/schema";
import { GOV_12345_PROFILE } from "../lib/domain-profile";
import {
  SQL_CORE_REDLINE_PATTERN,
  SQL_ECOM_REDLINE_PATTERN,
  hasRedlineSignal,
  invalidateAgentGovernanceCache,
  runAgentPatrol,
  submitCitizenTicket,
} from "../lib/agent-governance";
import { hasCivicRedlineSignal } from "../packages/civic-system-one/src/redline";
import { destroyRegionTenant, registerRegion } from "../lib/tenant/schema-manager";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import { buildArbitrationPrompt, buildBatchExtractionPrompt } from "../backend/prompt";
import { anonymize, deanonymize } from "../backend/anonymizer";
import type { RawTicket } from "../backend/state";

const REGION_ID = "verify_p0_m4_patrol";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
  ecom_demo: { schema: "region_ecom_demo", tickets: 3240, themes: 40 },
} as const;

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${msg}`);
  }
}

async function assertBaselineUnchanged(stage: string) {
  for (const [id, expected] of Object.entries(BASELINE)) {
    const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${expected.schema}".tickets`);
    const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${expected.schema}".themes`);
    const tCount = Number(tRow?.c ?? 0);
    const thCount = Number(thRow?.c ?? 0);
    assert(
      tCount === expected.tickets && thCount === expected.themes,
      `[${stage}] ${id} 基线零变动 (tickets=${tCount}/${expected.tickets}, themes=${thCount}/${expected.themes})`
    );
  }
}

async function cleanup() {
  try {
    await destroyRegionTenant(sql, REGION_ID);
  } catch {
    // ignore
  }
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${REGION_ID}" CASCADE;`);
  await sql`DELETE FROM public.regions WHERE id = ${REGION_ID};`;
  invalidateAgentGovernanceCache(REGION_ID);
  invalidateCivicAggregates(REGION_ID);

  const [{ reg }] = await sql<Array<{ reg: string | null }>>`
    SELECT to_regclass('public.citizen_submissions')::text AS reg
  `;
  if (reg) {
    await sql`DELETE FROM public.citizen_submissions WHERE region_id = ${REGION_ID};`;
  }
}

async function setupTenant() {
  await registerRegion(sql, {
    id: REGION_ID,
    name: "M4巡检临时验收区",
    city: "广州市",
    province: "广东省",
    schemaName: REGION_ID,
    isDefault: false,
    categoryConfigJson: JSON.stringify({ domainProfile: GOV_12345_PROFILE }),
    description: "M4 P0 patrol verification ephemeral schema",
  });

  const { db } = await getRegionDb(REGION_ID);
  await db.insert(vocabulariesTable).values([
    { id: "m4-t1", type: "TOWNSHIP", name: "天河南", fullName: "天河南街道", isStandard: true },
  ]);
}

async function testPromptAndSeedKeymap() {
  const rawTicket: RawTicket = {
    id: "tk-raw-1",
    ticketNo: "GV-KEYMAP-01",
    title: "投诉人李四反映粤B·67890违停",
    content: "市民张三反映粤A-12345违停占用消防通道，请处理。",
    createTime: new Date().toISOString(),
    citizenName: "张三",
    citizenPhone: "13800138000",
    subdistrict: "天河南街道",
    channel: "12345热线",
    status: "PENDING",
  };

  const batchPrompt = buildBatchExtractionPrompt([rawTicket]);
  assert(
    !batchPrompt.includes("张三") &&
      !batchPrompt.includes("李四") &&
      !batchPrompt.includes("粤A-12345") &&
      !batchPrompt.includes("粤B·67890"),
    "buildBatchExtractionPrompt 标题与正文 PII 全部脱敏"
  );
  assert(
    batchPrompt.includes("{{PERSON_NAME_1}}") &&
      batchPrompt.includes("{{PERSON_NAME_2}}") &&
      batchPrompt.includes("{{LICENSE_PLATE_1}}") &&
      batchPrompt.includes("{{LICENSE_PLATE_2}}"),
    "buildBatchExtractionPrompt 标题与正文共享 seedKeymap，编号连续无碰撞 (_1 / _2)"
  );

  const arbPrompt = buildArbitrationPrompt(rawTicket, {
    index: 1,
    summarizeTitle: "违停诉求",
    subject: "涉事车辆",
    location: "",
    eventType: "违停",
    category: "交通出行",
    confidence: 45,
  });
  assert(
    !arbPrompt.includes("张三") &&
      !arbPrompt.includes("李四") &&
      arbPrompt.includes("{{PERSON_NAME_1}}") &&
      arbPrompt.includes("{{PERSON_NAME_2}}"),
    "buildArbitrationPrompt 标题与正文共享 seedKeymap，无碰撞"
  );

  // Partial pre-masked body (standard DB RawTicket / xray shape: maskedContent set, maskedTitle absent)
  const dbStylePrompt = buildBatchExtractionPrompt([
    {
      ...rawTicket,
      maskedContent: "市民{{PERSON_NAME_1}}称{{LICENSE_PLATE_1}}违停占用消防通道，请处理。",
    },
  ]);
  assert(
    !dbStylePrompt.includes("李四") &&
      !dbStylePrompt.includes("粤B·67890") &&
      dbStylePrompt.includes("登记标题: 投诉人{{PERSON_NAME_2}}反映{{LICENSE_PLATE_2}}违停"),
    "buildBatchExtractionPrompt 仅预脱敏 maskedContent 时标题编号递增 (_2) 无 _1 碰撞"
  );

  // Symmetrical partial pre-masked title only
  const titleOnlyPrompt = buildBatchExtractionPrompt([
    {
      ...rawTicket,
      maskedTitle: "投诉人{{PERSON_NAME_1}}反映{{LICENSE_PLATE_1}}违停",
    } as RawTicket,
  ]);
  assert(
    !titleOnlyPrompt.includes("张三") &&
      !titleOnlyPrompt.includes("粤A-12345") &&
      titleOnlyPrompt.includes("市民{{PERSON_NAME_2}}反映{{LICENSE_PLATE_2}}违停占用消防通道"),
    "buildBatchExtractionPrompt 仅预脱敏 maskedTitle 时正文编号递增 (_2) 无 _1 碰撞"
  );

  // buildArbitrationPrompt with seedKeymap + unmasked content & title
  const arbWithSeedPrompt = buildArbitrationPrompt(
    rawTicket,
    {
      index: 1,
      summarizeTitle: "违停诉求",
      subject: "涉事车辆",
      location: "",
      eventType: "违停",
      category: "交通出行",
      confidence: 45,
    },
    undefined,
    {
      "{{PERSON_NAME_1}}": "王五",
      "{{LICENSE_PLATE_1}}": "粤C99999",
    }
  );
  assert(
    !arbWithSeedPrompt.includes("张三") &&
      !arbWithSeedPrompt.includes("李四") &&
      !arbWithSeedPrompt.includes("粤A-12345") &&
      !arbWithSeedPrompt.includes("粤B·67890") &&
      arbWithSeedPrompt.includes("市民{{PERSON_NAME_2}}反映{{LICENSE_PLATE_2}}违停占用消防通道") &&
      arbWithSeedPrompt.includes("登记标题：投诉人{{PERSON_NAME_3}}反映{{LICENSE_PLATE_3}}违停"),
    "buildArbitrationPrompt 传入 seedKeymap 且无预脱敏正文时正文(_2)与标题(_3)均不与 _1 碰撞"
  );

  // Simulate extract-node merged keymap anonymization + deanonymization
  const contentAnon = anonymize(rawTicket.content);
  const titleAnon = anonymize(rawTicket.title || "", { seedKeymap: contentAnon.keymap });
  const mergedKm = { ...contentAnon.keymap, ...titleAnon.keymap };
  const restored = deanonymize(
    { summarizeTitle: `${titleAnon.text}`, subject: "{{LICENSE_PLATE_2}}" },
    mergedKm
  );
  assert(
    restored.summarizeTitle === "投诉人李四反映粤B·67890违停" &&
      restored.subject === "粤B·67890",
    "合并 content+title keymap 后 deanonymize 无损还原标题专有实体"
  );
}

async function testSubmitCitizenTicketInterlock() {
  // 1) Normal try path (ONNX + symbolic interlock)
  const redRes = await submitCitizenTicket({
    regionId: REGION_ID,
    userId: "u-m4-1",
    userName: "测试市民",
    title: "工人扬言封桥跳楼维权",
    content: "建筑队拖欠工资半年，多位工人扬言明天去大桥封桥跳楼。",
    subdistrict: "天河南街道",
    category: "劳动社保",
    source: "FORM",
    skipAutoCluster: true,
  });
  const { db } = await getRegionDb(REGION_ID);
  const rows1 = await sql.unsafe(
    `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
    [redRes.ticketId]
  );
  assert(
    rows1[0]?.stability_risk === true &&
      rows1[0]?.urgency === "URGENT" &&
      Number(rows1[0]?.sla_hours) === 2,
    `submitCitizenTicket try 分支红线硬互锁生效 (stability=${rows1[0]?.stability_risk}, urgency=${rows1[0]?.urgency}, sla=${rows1[0]?.sla_hours})`
  );

  const negRes = await submitCitizenTicket({
    regionId: REGION_ID,
    userId: "u-m4-2",
    userName: "测试市民",
    title: "高空作业安全核查",
    content: "经街道到场核实，现场并非跳楼，系物业外墙高空绳索维修作业。",
    subdistrict: "天河南街道",
    category: "城市管理",
    source: "FORM",
    skipAutoCluster: true,
  });
  const rows2 = await sql.unsafe(
    `SELECT stability_risk FROM "${REGION_ID}".tickets WHERE id = $1`,
    [negRes.ticketId]
  );
  assert(
    rows2[0]?.stability_risk === false,
    `submitCitizenTicket try 分支否定语境不误触发红线 (stability=${rows2[0]?.stability_risk})`
  );

  const advButRes = await submitCitizenTicket({
    regionId: REGION_ID,
    userId: "u-m4-2b",
    userName: "测试市民",
    title: "紧急求助",
    content: "没有问题但有人跳楼请快来救命！",
    subdistrict: "天河南街道",
    category: "公共安全",
    source: "FORM",
    skipAutoCluster: true,
  });
  const rows2b = await sql.unsafe(
    `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
    [advButRes.ticketId]
  );
  assert(
    rows2b[0]?.stability_risk === true &&
      rows2b[0]?.urgency === "URGENT" &&
      Number(rows2b[0]?.sla_hours) === 2,
    "submitCitizenTicket try 分支跨越转折词但后真实跳楼触发红线 (URGENT/2h)"
  );

  const wuZhengRes = await submitCitizenTicket({
    regionId: REGION_ID,
    userId: "u-m4-2c",
    userName: "测试市民",
    title: "无证食堂食物中毒",
    content: "辖区无证食堂食物中毒多人送医。",
    subdistrict: "天河南街道",
    category: "市场监管",
    source: "FORM",
    skipAutoCluster: true,
  });
  const rows2c = await sql.unsafe(
    `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
    [wuZhengRes.ticketId]
  );
  assert(
    rows2c[0]?.stability_risk === true &&
      rows2c[0]?.urgency === "URGENT" &&
      Number(rows2c[0]?.sla_hours) === 2,
    "submitCitizenTicket try 分支无证食堂食物中毒不被无字否定误抑制"
  );

  const weakGroupRes = await submitCitizenTicket({
    regionId: REGION_ID,
    userId: "u-m4-2d",
    userName: "测试市民",
    title: "弱势群体补助咨询",
    content: "市民咨询本区弱势群体补助申请材料。",
    subdistrict: "天河南街道",
    category: "劳动社保",
    source: "FORM",
    skipAutoCluster: true,
  });
  const rows2d = await sql.unsafe(
    `SELECT stability_risk FROM "${REGION_ID}".tickets WHERE id = $1`,
    [weakGroupRes.ticketId]
  );
  assert(
    rows2d[0]?.stability_risk === false,
    "submitCitizenTicket try 分支弱势群体常规咨询不误触红线"
  );

  // 2) Forced catch fallback path
  const origPromise = globalThis.__intakeSystemOnePromise;
  globalThis.__intakeSystemOnePromise = Promise.reject(new Error("forced S1 outage"));
  try {
    const catchRedRes = await submitCitizenTicket({
      regionId: REGION_ID,
      userId: "u-m4-3",
      userName: "测试市民",
      title: "扬言封桥",
      content: "普通拖欠款项描述，但标题含红线。",
      subdistrict: "天河南街道",
      category: "劳动社保",
      source: "FORM",
      skipAutoCluster: true,
    });
    const rows3 = await sql.unsafe(
      `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
      [catchRedRes.ticketId]
    );
    assert(
      rows3[0]?.stability_risk === true &&
        rows3[0]?.urgency === "URGENT" &&
        Number(rows3[0]?.sla_hours) === 2,
      "submitCitizenTicket catch 分支覆盖 title+content 红线并升急为 URGENT/2h"
    );

    const catchNegRes = await submitCitizenTicket({
      regionId: REGION_ID,
      userId: "u-m4-4",
      userName: "测试市民",
      title: "食品安全复查",
      content: "经区部门检验确认无食物中毒及群体腹泻情况，属于常规咨询。",
      subdistrict: "天河南街道",
      category: "市场监管",
      source: "FORM",
      skipAutoCluster: true,
    });
    const rows4 = await sql.unsafe(
      `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
      [catchNegRes.ticketId]
    );
    assert(
      rows4[0]?.stability_risk === false &&
        rows4[0]?.urgency === "NORMAL" &&
        Number(rows4[0]?.sla_hours) === 120,
      "submitCitizenTicket catch 分支否定语境不误杀"
    );

    const catchAdvRes = await submitCitizenTicket({
      regionId: REGION_ID,
      userId: "u-m4-4b",
      userName: "测试市民",
      title: "紧急求助",
      content: "没有问题但有人跳楼请快来救命！",
      subdistrict: "天河南街道",
      category: "公共安全",
      source: "FORM",
      skipAutoCluster: true,
    });
    const rows4b = await sql.unsafe(
      `SELECT stability_risk, urgency, sla_hours FROM "${REGION_ID}".tickets WHERE id = $1`,
      [catchAdvRes.ticketId]
    );
    assert(
      rows4b[0]?.stability_risk === true &&
        rows4b[0]?.urgency === "URGENT" &&
        Number(rows4b[0]?.sla_hours) === 2,
      "submitCitizenTicket catch 分支跨越转折词但后真实跳楼触发红线 (URGENT/2h)"
    );
  } finally {
    globalThis.__intakeSystemOnePromise = origPromise;
  }

  // Clean tickets created by submitCitizenTicket before patrol tests
  await sql.unsafe(`TRUNCATE TABLE "${REGION_ID}".tickets CASCADE;`);
  await db.delete(themesTable);
}

async function testPatrolDedupOrderingOverdueAndRedlineFallback() {
  const { db } = await getRegionDb(REGION_ID);
  const now = new Date();
  const hoursAgo = (h: number) => new Date(now.getTime() - h * 3600_000);
  const hoursLater = (h: number) => new Date(now.getTime() + h * 3600_000);

  // A. Overdue gate themes:
  // - 2 non-overdue themes (fresh <24h, future ETA)
  // - 6 genuinely overdue themes (exceeding 4-bucket slice so pagination runs past initial batch)
  await db.insert(themesTable).values([
    {
      id: "th-fresh-not-overdue",
      title: "天河南 · 刚发生的普通积水主题",
      canonicalSubject: "体育西路积水点",
      canonicalLocation: "天河南街道",
      eventType: "道路积水",
      category: "城市管理",
      riskLevel: "HIGH",
      ticketCount: 8,
      timeSpanHours: 1,
      handlingStatus: "PENDING",
      handlingEta: null,
      firstAt: now,
      lastAt: now,
    },
    {
      id: "th-future-eta-not-overdue",
      title: "天河南 · 尚未到ETA的计划主题",
      canonicalSubject: "天河路井盖维修",
      canonicalLocation: "天河南街道",
      eventType: "井盖破损",
      category: "城市管理",
      riskLevel: "HIGH",
      ticketCount: 10,
      timeSpanHours: 48,
      handlingStatus: "PENDING",
      handlingEta: hoursLater(24),
      firstAt: hoursAgo(48),
      lastAt: hoursAgo(30),
    },
    ...Array.from({ length: 6 }, (_, i) => ({
      id: `th-overdue-${String(i + 1).padStart(2, "0")}`,
      title: `天河南 · 超期积压主题 ${i + 1}`,
      canonicalSubject: `涉事工地${i + 1}`,
      canonicalLocation: "天河南街道",
      eventType: "施工噪音",
      category: "生态环境",
      riskLevel: i < 2 ? "HIGH" : i < 4 ? "MEDIUM" : "LOW",
      ticketCount: 10 + i,
      timeSpanHours: i === 0 ? 12 : 30,
      handlingStatus: i % 2 === 0 ? "PENDING" : "pending",
      handlingEta: i === 0 ? hoursAgo(2) : null,
      firstAt: hoursAgo(30),
      lastAt: i === 1 ? hoursAgo(26) : hoursAgo(2),
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `th-resolved-${String(i + 1).padStart(2, "0")}`,
      title: `天河南 · 已办结待回访主题 ${i + 1}`,
      canonicalSubject: `餐饮油烟商户${i + 1}`,
      canonicalLocation: "天河南街道",
      eventType: "油烟扰民",
      category: "生态环境",
      riskLevel: "MEDIUM",
      ticketCount: 3 + i,
      timeSpanHours: 6,
      handlingStatus: i % 2 === 0 ? "RESOLVED" : "已办结",
      firstAt: hoursAgo(12),
      lastAt: hoursAgo(1),
    })),
  ]);

  // B. 35 MISSING_INFO tickets (> LIMIT 30!) + 10 fallback REDLINE tickets (stability_risk=false) + 2 negated/traffic non-redline tickets
  const ticketRows: Array<typeof ticketsTable.$inferInsert> = [];

  for (let i = 1; i <= 35; i++) {
    const pad = String(i).padStart(2, "0");
    ticketRows.push({
      id: `tk-miss-${pad}`,
      ticketNo: `GV-MISS-${pad}`,
      title: `缺门牌待核实工单 ${pad}`,
      content: `市民反映小区路灯故障 ${pad}`,
      subdistrict: "天河南街道",
      address: i <= 30 ? null : `某路${i}号`, // first 30 missing address (priority 0), 31..35 low confidence (priority 1)
      canonicalSubject: i <= 30 ? null : "路灯设施",
      confidence: 50,
      status: "PENDING",
      stabilityRisk: false,
      createTime: hoursAgo(40 - i),
    });
  }

  for (let i = 1; i <= 10; i++) {
    const pad = String(i).padStart(2, "0");
    ticketRows.push({
      id: `tk-redfb-${pad}`,
      ticketNo: `GV-REDFB-${pad}`,
      title: `兜底红线工单 ${pad}`,
      content: i % 2 === 0 ? "劳资纠纷扬言自杀跳楼维权" : "多名业主在售楼部拉横幅围堵",
      subdistrict: "天河南街道",
      address: "天河路100号",
      canonicalSubject: "涉事施工方",
      confidence: 90,
      status: "PENDING",
      stabilityRisk: false,
      createTime: hoursAgo(10 - i),
    });
  }

  // Negated redline & traffic jam (must NOT trigger REDLINE_BLOCK; missing address -> enters MISSING_INFO)
  ticketRows.push({
    id: "tk-neg-redline",
    ticketNo: "GV-NEG-01",
    title: "并非食物中毒只是普通快递延误",
    content: "买家说明并非食物中毒，只是生鲜快递晚到了半天，请求核实。",
    subdistrict: "天河南街道",
    address: null,
    canonicalSubject: null,
    confidence: 55,
    status: "PENDING",
    stabilityRisk: false,
    createTime: now,
  });
  ticketRows.push({
    id: "tk-traffic-jam",
    ticketNo: "GV-TRF-01",
    title: "早高峰交通拥堵路况反映",
    content: "反映交通拥堵路况严重，请交警优化信号灯配时。",
    subdistrict: "天河南街道",
    address: null,
    canonicalSubject: null,
    confidence: 55,
    status: "PENDING",
    stabilityRisk: false,
    createTime: now,
  });

  await db.insert(ticketsTable).values(ticketRows);

  assert(
    !hasRedlineSignal("并非食物中毒只是普通快递延误") &&
      !hasRedlineSignal("早高峰交通拥堵路况反映") &&
      !hasRedlineSignal("弱势群体补助咨询") &&
      !hasRedlineSignal("建议维修避免伤亡") &&
      !hasRedlineSignal("无任何人员伤亡") &&
      !hasRedlineSignal("聚集拥堵路况") &&
      hasRedlineSignal("扬言自杀跳楼") &&
      hasRedlineSignal("无证食堂食物中毒") &&
      hasRedlineSignal("无人处理扬言跳楼") &&
      hasRedlineSignal("无资质施工路面塌陷") &&
      hasRedlineSignal("没有问题但有人跳楼请快来救命！"),
    "hasRedlineSignal 正确过滤否定/预防/弱势群体/拥堵路况，准确命中无证/无人/无资质/转折后真实红线"
  );

  // Run patrol repeatedly until drained; max 15 runs
  let totalCreated = 0;
  let runCount = 0;
  let firstRunTasks: Array<{ taskType: string; targetId: string }> = [];
  let latestTasks: Array<{ taskType: string; targetId: string; status: string }> = [];

  for (let run = 1; run <= 15; run++) {
    const res = await runAgentPatrol(REGION_ID);
    runCount = run;
    latestTasks = res.tasks.map((t) => ({ taskType: t.taskType, targetId: t.targetId, status: t.status }));
    if (run === 1) {
      firstRunTasks = res.tasks.map((t) => ({ taskType: t.taskType, targetId: t.targetId }));
    }
    if (res.createdCount === 0) break;
    totalCreated += res.createdCount;
  }

  assert(runCount > 4 && totalCreated === 57, `多轮巡检持续推进防饿死 (runs=${runCount}, totalCreated=${totalCreated})`);

  // Verify zero duplicates across all agent_tasks
  const dupRows = await sql.unsafe(`
    SELECT target_type, target_id, task_type, count(*)::int AS c
    FROM "${REGION_ID}".agent_tasks
    GROUP BY target_type, target_id, task_type
    HAVING count(*) > 1
  `);
  assert(dupRows.length === 0, `agent_tasks 零重复入队 (dups=${dupRows.length})`);

  const redlineIds = latestTasks.filter((t) => t.taskType === "REDLINE_BLOCK").map((t) => t.targetId);
  const missingIds = latestTasks.filter((t) => t.taskType === "MISSING_INFO").map((t) => t.targetId);
  const overdueIds = latestTasks.filter((t) => t.taskType === "SLA_OVERDUE").map((t) => t.targetId);
  const callbackIds = latestTasks.filter((t) => t.taskType === "REOPEN_CALLBACK").map((t) => t.targetId);

  assert(
    redlineIds.length === 10 &&
      !redlineIds.includes("tk-neg-redline") &&
      !redlineIds.includes("tk-traffic-jam"),
    `10 条真实兜底红线全部入队且否定/拥堵路况未被误拦截 (redline=${redlineIds.length})`
  );
  assert(
    missingIds.length === 37 &&
      missingIds.includes("tk-miss-35") &&
      missingIds.includes("tk-neg-redline") &&
      missingIds.includes("tk-traffic-jam"),
    `全部 35+2 条 MISSING_INFO 突破 LIMIT 30 完整召回 (missing=${missingIds.length})`
  );
  assert(
    overdueIds.length === 6 &&
      !overdueIds.includes("th-fresh-not-overdue") &&
      !overdueIds.includes("th-future-eta-not-overdue"),
    `仅 6 条真超期主题触发 SLA_OVERDUE，新鲜/未来ETA主题被拦下 (overdue=${overdueIds.length})`
  );
  assert(
    callbackIds.length === 4,
    `4 条已办结主题（含大小写与中文已办结）全部召回 REOPEN_CALLBACK (cb=${callbackIds.length})`
  );

  // Verify deterministic ordering in run 1:
  const firstOverdue = firstRunTasks.find((t) => t.taskType === "SLA_OVERDUE");
  assert(
    firstOverdue?.targetId === "th-overdue-02",
    `SLA_OVERDUE 确定性排序：HIGH + ticket_count 最大优先 (${firstOverdue?.targetId})`
  );
  const firstRedline = firstRunTasks.find((t) => t.taskType === "REDLINE_BLOCK");
  assert(
    firstRedline?.targetId === "tk-redfb-10",
    `REDLINE_BLOCK 确定性排序：create_time 最新优先 (${firstRedline?.targetId})`
  );

  // Verify REJECTED re-discovery
  await sql.unsafe(`
    UPDATE "${REGION_ID}".agent_tasks
    SET status = 'REJECTED'
    WHERE target_type = 'TICKET' AND target_id = 'tk-miss-01' AND task_type = 'MISSING_INFO'
  `);
  const afterReject = await runAgentPatrol(REGION_ID);
  assert(
    afterReject.createdCount === 1 &&
      afterReject.tasks.some(
        (t) => t.targetId === "tk-miss-01" && t.taskType === "MISSING_INFO" && t.status === "PENDING"
      ),
    "REJECTED 任务在下一轮巡检中可被重新发现入队"
  );

  // Verify fallback redline LIMIT 24 anti-starvation:
  // 26 newer negated rows + 4 traffic jam rows must NOT starve 1 older real fallback redline ticket
  await sql.unsafe(`TRUNCATE TABLE "${REGION_ID}".tickets CASCADE;`);
  await sql.unsafe(`TRUNCATE TABLE "${REGION_ID}".agent_tasks CASCADE;`);
  const starveRows: Array<typeof ticketsTable.$inferInsert> = [
    {
      id: "tk-starve-real",
      ticketNo: "GV-STARVE-REAL",
      title: "投诉人扬言自杀跳楼",
      content: "多方投诉未果，投诉人扬言明天去楼顶自杀跳楼。",
      subdistrict: "天河南街道",
      address: "天河路200号",
      canonicalSubject: "涉事物业",
      confidence: 90,
      status: "PENDING",
      stabilityRisk: false,
      createTime: hoursAgo(48),
    },
    ...Array.from({ length: 26 }, (_, i) => ({
      id: `tk-starve-neg-${String(i + 1).padStart(2, "0")}`,
      ticketNo: `GV-STARVE-NEG-${i + 1}`,
      title: "并非食物中毒只是快递延误",
      content: "市民说明并非食物中毒，只是常规物流延迟咨询。",
      subdistrict: "天河南街道",
      address: "天河路201号",
      canonicalSubject: "快递站点",
      confidence: 90,
      status: "PENDING",
      stabilityRisk: false,
      createTime: hoursAgo(1),
    })),
    ...Array.from({ length: 4 }, (_, i) => ({
      id: `tk-starve-trf-${i + 1}`,
      ticketNo: `GV-STARVE-TRF-${i + 1}`,
      title: "早高峰交通拥堵路况反映",
      content: "路段早高峰拥堵路段较长，建议优化配时。",
      subdistrict: "天河南街道",
      address: "天河路202号",
      canonicalSubject: "交通路口",
      confidence: 90,
      status: "PENDING",
      stabilityRisk: false,
      createTime: hoursAgo(0.5),
    })),
  ];
  await db.insert(ticketsTable).values(starveRows);
  const antiStarveRes = await runAgentPatrol(REGION_ID);
  assert(
    antiStarveRes.tasks.some(
      (t) => t.taskType === "REDLINE_BLOCK" && t.targetId === "tk-starve-real"
    ) &&
      !antiStarveRes.tasks.some((t) => t.targetId.startsWith("tk-starve-neg-")) &&
      !antiStarveRes.tasks.some((t) => t.targetId.startsWith("tk-starve-trf-")),
    "26 条较新否定红线 + 4 条拥堵路况不饿死较旧的真实兜底红线工单 (tk-starve-real)"
  );

  // Verify REOPEN_CALLBACK fallback idempotency when BOTH resolved theme and resolved ticket coexist:
  await sql.unsafe(`TRUNCATE TABLE "${REGION_ID}".tickets, "${REGION_ID}".themes, "${REGION_ID}".agent_tasks CASCADE;`);
  await db.insert(themesTable).values({
    id: "th-idem-resolved",
    title: "已办结主题幂等校验",
    canonicalSubject: "测试商户",
    canonicalLocation: "天河南街道",
    eventType: "消费纠纷",
    category: "城市综合管理",
    riskLevel: "LOW",
    handlingStatus: "resolved",
    ticketCount: 3,
    timeSpanHours: 12,
    lastAt: hoursAgo(4),
  });
  await db.insert(ticketsTable).values({
    id: "tk-idem-resolved",
    ticketNo: "GV-IDEM-01",
    title: "已办结单工单幂等校验",
    content: "测试已办结主题与已办结单工单共存时不重复触发单工单回访。",
    subdistrict: "天河南街道",
    address: "天河路300号",
    canonicalSubject: "测试商户",
    confidence: 95,
    status: "RESOLVED",
    stabilityRisk: false,
    createTime: hoursAgo(6),
    closedAt: hoursAgo(2),
  });
  const idemRun1 = await runAgentPatrol(REGION_ID);
  assert(
    idemRun1.createdCount === 1 &&
      idemRun1.tasks[0]?.taskType === "REOPEN_CALLBACK" &&
      idemRun1.tasks[0]?.targetType === "THEME" &&
      idemRun1.tasks[0]?.targetId === "th-idem-resolved",
    `已办结主题与已办结工单共存时 Run 1 仅入队已办结主题 (created=${idemRun1.createdCount})`
  );
  const idemRun2 = await runAgentPatrol(REGION_ID);
  assert(
    idemRun2.createdCount === 0,
    `已办结主题与已办结工单共存时 Run 2 不得降级生成幽灵单工单 REOPEN_CALLBACK (created=${idemRun2.createdCount})`
  );
}

async function testSqlRedlineAndParity() {
  const sqlCases: Array<{ text: string; core: boolean; ecom: boolean }> = [
    { text: "拥堵路况", core: false, ecom: false },
    { text: "拥堵路段", core: false, ecom: false },
    { text: "早高峰交通拥堵路况严重", core: false, ecom: false },
    { text: "道路封路施工造成绕行不便", core: false, ecom: false },
    { text: "施工封路影响通行", core: false, ecom: false },
    { text: "村民堵路维权", core: true, ecom: true },
    { text: "聚众堵路", core: true, ecom: true },
    { text: "聚集堵路", core: true, ecom: true },
    { text: "堵路", core: true, ecom: true },
    { text: "封路维权", core: true, ecom: true },
    { text: "无故封路", core: true, ecom: true },
    { text: "封路", core: true, ecom: true },
    { text: "疑似买到假货", core: false, ecom: true },
    { text: "邻里纠纷对方威胁半夜纵火烧房", core: true, ecom: true },
    { text: "菜市场门口有人持刀砍人", core: true, ecom: true },
    { text: "对方威胁要杀人", core: true, ecom: true },
    { text: "货车违停完全阻断交通无法通行", core: true, ecom: true },
    { text: "维权人员在门口静坐绝食", core: true, ecom: true },
    { text: "部分人员前往大桥堵桥", core: true, ecom: true },
    { text: "部分人员前往大桥封桥", core: true, ecom: true },
    { text: "夜市十几人发生大规模群殴斗殴", core: true, ecom: true },
    { text: "化工厂车间突发爆炸起火", core: true, ecom: true },
    { text: "网购灯泡爆炸要求退款", core: false, ecom: false },
    { text: "家中热水器爆炸损坏", core: false, ecom: false },
    { text: "抢修队及时处置阀门泄漏，现场未发生爆炸，无人员受伤", core: false, ecom: false },
    { text: "化工厂未发生爆炸，安全排查正常", core: false, ecom: false },
    { text: "燃气管道没有爆炸", core: false, ecom: false },
    { text: "未发生爆炸", core: false, ecom: false },
    { text: "没有爆炸", core: false, ecom: false },
    { text: "未见爆炸", core: false, ecom: false },
    { text: "并未爆炸", core: false, ecom: false },
    { text: "无人员受伤", core: false, ecom: false },
    { text: "无人员重伤", core: false, ecom: false },
    { text: "燃气管道发生爆炸", core: true, ecom: true },
    { text: "现场爆炸起火", core: true, ecom: true },
    { text: "化工厂车间爆炸", core: true, ecom: true },
    { text: "菜市场发生持刀伤人恶性事件", core: true, ecom: true },
    { text: "高速路段发生重大交通事故连环相撞", core: true, ecom: true },
    { text: "举报涉黑涉恶团伙强迫交易保护费", core: true, ecom: true },
  ];

  for (const c of sqlCases) {
    const [row] = await sql<Array<{ core_m: boolean; ecom_m: boolean }>>`
      SELECT
        (${c.text}::text ~ ${SQL_CORE_REDLINE_PATTERN}) AS core_m,
        (${c.text}::text ~ ${SQL_ECOM_REDLINE_PATTERN}) AS ecom_m
    `;
    assert(
      row?.core_m === c.core && row?.ecom_m === c.ecom,
      `PostgreSQL SQL_CORE/ECOM_REDLINE_PATTERN "${c.text}" -> core=${row?.core_m}(预期${c.core}), ecom=${row?.ecom_m}(预期${c.ecom})`
    );
  }

  const parityCases: Array<{ text: string; expected: boolean }> = [
    { text: "道路封路施工造成绕行不便", expected: false },
    { text: "施工封路影响通行", expected: false },
    { text: "封路维权", expected: true },
    { text: "无故封路", expected: true },
    { text: "现场抽检结果合格，无食物中毒及群体腹泻情况。", expected: false },
    { text: "经检查无明显食物中毒及群体腹泻", expected: false },
    { text: "未出现食物中毒、群体腹泻和呕吐", expected: false },
    { text: "路口两车轻微刮擦，现场无人伤亡，仅咨询保险定损", expected: false },
    { text: "无人处理扬言跳楼", expected: true },
    { text: "无人伤亡但发生爆炸", expected: true },
    { text: "化工厂车间突发爆炸起火", expected: true },
    { text: "灯泡爆炸", expected: false },
    { text: "热水器爆炸", expected: false },
    { text: "邻里纠纷对方威胁半夜纵火烧房", expected: true },
    { text: "菜市场门口有人持刀砍人", expected: true },
    { text: "没有发生聚众闹事，但是对方威胁要杀人", expected: true },
    { text: "货车违停完全阻断交通无法通行", expected: true },
    { text: "维权人员在门口静坐绝食", expected: true },
    { text: "堵桥封桥阻断交通", expected: true },
    { text: "夜市十几人发生大规模群殴斗殴", expected: true },
    { text: "无证食堂食物中毒及群体腹泻", expected: true },
    { text: "居民担心危房随时坍塌", expected: true },
    { text: "居民担心化工厂发生爆炸", expected: true },
    { text: "小区燃气管道老化，居民担心如果发生爆炸后果严重", expected: true },
    { text: "小区电瓶车充电棚发生爆炸起火", expected: true },
    { text: "经检查无明显食物中毒、群体中毒及集体腹泻", expected: false },
    { text: "经疾控中心检测未出现任何食物中毒、群体中毒和集体腹泻", expected: false },
    { text: "未出现食物中毒、集体腹泻和集体呕吐", expected: false },
    { text: "抢修队及时处置阀门泄漏，现场未发生爆炸，无人员受伤", expected: false },
    { text: "化工厂未发生爆炸，安全排查正常", expected: false },
    { text: "燃气管道没有爆炸", expected: false },
    { text: "未见爆炸，并未爆炸，无人员受伤", expected: false },
    { text: "货车急刹未造成重大交通事故，现场无人员重伤", expected: false },
    { text: "经民警核查未发生持刀伤人事件，亦不涉及黑恶势力", expected: false },
    { text: "行人经常横跨马路容易造成重大交通事故，建议增设斑马线", expected: false },
    { text: "燃气管道发生爆炸", expected: true },
    { text: "现场爆炸起火", expected: true },
    { text: "化工厂车间爆炸", expected: true },
    { text: "菜市场发生持刀伤人恶性事件", expected: true },
    { text: "有人持菜刀砍伤两名群众，现场混乱", expected: true },
    { text: "高速路段发生重大交通事故连环相撞", expected: true },
    { text: "多车追尾起火，现场造成人员重伤被困", expected: true },
    { text: "举报涉黑涉恶团伙强迫交易保护费", expected: true },
    { text: "长期敲诈勒索商户收取保护费，涉黑恶势力欺行霸市", expected: true },
  ];

  for (const p of parityCases) {
    const govSignal = hasRedlineSignal(p.text);
    const civicSignal = hasCivicRedlineSignal(p.text);
    assert(
      govSignal === p.expected && civicSignal === p.expected,
      `hasRedlineSignal 与 hasCivicRedlineSignal 一致性 "${p.text}" -> gov=${govSignal}, civic=${civicSignal}, expected=${p.expected}`
    );
  }

  assert(
    hasRedlineSignal("吃了海鲜后出现腹泻呕吐") === true,
    `hasRedlineSignal 保留真实腹泻呕吐预警 ("吃了海鲜后出现腹泻呕吐" -> true)`
  );
}

async function main() {
  await assertBaselineUnchanged("前置");
  await cleanup();
  try {
    await setupTenant();
    await testSqlRedlineAndParity();
    await testPromptAndSeedKeymap();
    await testSubmitCitizenTicketInterlock();
    await testPatrolDedupOrderingOverdueAndRedlineFallback();
  } finally {
    await cleanup();
    await assertBaselineUnchanged("清理后");
    const leftovers = await sql<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name = ${REGION_ID}
    `;
    assert(leftovers.length === 0, `临时 schema 已彻底销毁 (${leftovers.length})`);
  }

  console.log(`\n断言汇总: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) process.exit(1);
  console.log("✅ tests/test-p0-m4-patrol.ts 全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
