/**
 * 12345 增量工单时空吸附与研判业务验证脚本 (Incremental Clustering Test)
 * 
 * 验证目标：
 * 1. 【增量自动吸附】：当已有多频主题在办时，后续同地工单无需重新建群，秒级判定并入；
 * 2. 【时间只记节奏】：隔了 4 天的同一件事仍然并入，节奏记为反复，不另开主题；
 * 3. 【平时 0 耗时继承】：普通追加工单不调用大模型慢思考，直接继承已有处置方案，0 Token、0 等待；
 * 4. 【突发险情质变升级】：当追加工单出现严重险情词时，精准触发慢思考升级，生成紧急救援预案。
 */

import { evaluateIncrementalTicket, upgradeThemeWithSystemTwo } from "../backend/incremental-cluster";
import { CADENCE, describeCadence } from "../backend/theme-metrics";
import type { EnrichedTicket, MultiFrequencyTheme } from "../backend/state";
import { HANDLING_STATUS } from "../lib/civic-dto";
import { CATEGORY } from "../lib/vocabulary";

function cloneTheme(theme: MultiFrequencyTheme): MultiFrequencyTheme {
  return {
    ...theme,
    tickets: theme.tickets.map((ticket) => ({ ...ticket })),
    relatedSubjects: [...theme.relatedSubjects],
    relatedLocations: [...theme.relatedLocations],
  };
}

async function main() {
  console.log("================================================================================");
  console.log("🏛️  12345 增量工单时空吸附与动态研判机制实测");
  console.log("   (验证：同一事件并入 ➔ 隔天仍并入并记反复 ➔ 平时继承老方案 ➔ 质变按需触发慢思考)");
  console.log("================================================================================\n");

  // 1. 模拟系统已存量的在办主题 (THEME-1: 金榜上街爆管事件，已包含 3 件工单)
  const existingTheme: MultiFrequencyTheme = {
    id: "THEME-1",
    title: "大良街道金榜上街 · 供水管网破裂致路面积水停水",
    canonicalSubject: "大良街道金榜上街主供水管",
    canonicalLocation: "大良街道金榜上街",
    eventType: "供水管网破裂",
    category: CATEGORY.URBAN_MANAGEMENT,
    riskLevel: "MEDIUM",
    riskReason: "同一微观点位短时集中反映（3件）",
    ticketCount: 3,
    timeSpanHours: 1,
    firstOccurrence: "2026-09-26 08:15:00",
    lastOccurrence: "2026-09-26 09:10:00", // 最后一件发生时间
    aiSummary: "大良街道金榜上街主供水管破裂，导致路面积水及片区停水，正开展市政抢修。",
    recommendedAction: "大良街道城管办牵头联合供水抢修队现场关阀抢修，2小时内恢复供水。",
    handlingStatus: HANDLING_STATUS.IN_PROGRESS,
    status: "CONFIRMED",
    relatedSubjects: ["大良街道金榜上街主供水管"],
    relatedLocations: ["大良街道金榜上街28号", "大良街道金榜上街沿街商铺"],
    tickets: [
      { id: "T1", ticketNo: "FS001", createTime: "2026-09-26 08:15:00" } as any,
      { id: "T2", ticketNo: "FS002", createTime: "2026-09-26 08:35:00" } as any,
      { id: "T3", ticketNo: "FS003", createTime: "2026-09-26 09:10:00" } as any,
    ],
  };

  const activeThemes: MultiFrequencyTheme[] = [existingTheme];

  console.log(`📦 [当前活跃主题池] 已有 ${activeThemes.length} 个在办多频主题:`);
  console.log(`   - 主题: [${existingTheme.id}] ${existingTheme.title}`);
  console.log(`   - 核心空间: ${existingTheme.canonicalLocation} | 状态: ${existingTheme.handlingStatus}`);
  console.log(`   - 现有工单量: ${existingTheme.ticketCount} 件 | 最后反映时间: ${existingTheme.lastOccurrence}\n`);

  // ---------------------------------------------------------------------------
  // 测试用例 1：第 4 张新工单到达（普通追加诉求，发生于最后单 1 小时后）
  // ---------------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("👉 【测试 1】涌入第 4 张工单（普通追加停水诉求）");
  const ticket4: EnrichedTicket = {
    id: "TICKET-NEW-04",
    ticketNo: "FS20260926008",
    title: "金榜上街45号居民反映家中完全停水",
    content: "大良金榜上街45号居民楼，家里自来水完全停水了，做饭洗漱受影响，请问什么时候恢复？",
    createTime: "2026-09-26 10:15:00", // 距离 lastOccurrence (09:10) 仅约 1 小时
    citizenName: "李先生",
    citizenPhone: "13900139001",
    district: "顺德区",
    subdistrict: "大良街道",
    channel: "市民热线",
    status: "PENDING",
    canonicalLocation: "大良街道金榜上街45号",
    canonicalSubject: "大良街道金榜上街自来水管",
    eventType: "停水诉求",
    sourceCategory: CATEGORY.URBAN_MANAGEMENT,
    confidence: 95,
    entities: [],
    relations: [],
    themes: [CATEGORY.URBAN_MANAGEMENT],
  };

  console.log(`📥 接收工单: [${ticket4.ticketNo}] ${ticket4.title}`);
  console.log(`   - 发生时间: ${ticket4.createTime} (距最后一起仅 1.08 小时)`);
  console.log(`   - 地点: ${ticket4.canonicalLocation}`);

  const startT1 = performance.now();
  const res1 = evaluateIncrementalTicket(ticket4, [cloneTheme(existingTheme)]);
  const dur1 = (performance.now() - startT1).toFixed(3);

  console.log(`\n⚡ 算法研判结果 (耗时: ${dur1} ms):`);
  console.log(`   - 决策动作: [${res1.action}]`);
  console.log(`   - 归属主题: ${res1.matchedThemeId}`);
  console.log(`   - 研判原因: ${res1.reason}`);
  console.log(`   - 主题工单数自动刷新: ${res1.matchedTheme?.ticketCount} 件 (最后发生时间更新为: ${res1.matchedTheme?.lastOccurrence})`);
  console.log(`   - 慢思考质变升级: ${res1.needDeepThinkingUpgrade ? "⚠️ 是" : "🟢 否（直接继承既有处置方案，0 等待！）"}`);
  console.log(`   - 坐席直接获取已有处置预案: "${res1.matchedTheme?.recommendedAction}"`);

  // ---------------------------------------------------------------------------
  // 测试用例 2：来了一张完全无关的异地工单（北滘红绿灯故障）
  // ---------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("👉 【测试 2】涌入完全无关的异地单（北滘工业大道红绿灯故障）");
  const ticketOther: EnrichedTicket = {
    id: "TICKET-OTHER-01",
    ticketNo: "FS20260926009",
    title: "北滘工业大道十字路口红绿灯不亮",
    content: "北滘工业大道与林港路交汇处红绿灯灭灯，存在严重安全隐患，请交警排查。",
    createTime: "2026-09-26 10:20:00",
    citizenName: "周先生",
    citizenPhone: "13900139002",
    district: "顺德区",
    subdistrict: "北滘镇",
    channel: "市民热线",
    status: "PENDING",
    canonicalLocation: "北滘镇工业大道与林港路",
    canonicalSubject: "北滘工业大道红绿灯",
    eventType: "信号灯故障",
    sourceCategory: "交通出行",
    confidence: 96,
    entities: [],
    relations: [],
    themes: ["交通出行"],
  };

  const startT2 = performance.now();
  const res2 = evaluateIncrementalTicket(ticketOther, [cloneTheme(existingTheme)]);
  const dur2 = (performance.now() - startT2).toFixed(3);

  console.log(`📥 接收工单: [${ticketOther.ticketNo}] ${ticketOther.title}`);
  console.log(`⚡ 算法研判结果 (耗时: ${dur2} ms):`);
  console.log(`   - 决策动作: [${res2.action}]`);
  console.log(`   - 研判原因: ${res2.reason}`);

  // ---------------------------------------------------------------------------
  // 测试用例 3：滑动时间窗口验证（超过 72 小时后发生的新诉求）
  // ---------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("👉 【测试 3】4 天后同一地点再来报修，仍并入原主题，节奏记为反复");
  const ticketExpired: EnrichedTicket = {
    id: "TICKET-EXPIRED-01",
    ticketNo: "FS20260926010",
    title: "金榜上街附近又有轻微漏水",
    content: "大良金榜上街附近路面又有自来水冒出。",
    createTime: "2026-09-30 11:00:00", // 距离 09-26 已经过去 96 小时 (> 72 小时滑动窗口)
    citizenName: "黄先生",
    citizenPhone: "13900139003",
    district: "顺德区",
    subdistrict: "大良街道",
    channel: "市民热线",
    status: "PENDING",
    canonicalLocation: "大良街道金榜上街",
    canonicalSubject: "自来水管",
    eventType: "漏水报修",
    sourceCategory: CATEGORY.URBAN_MANAGEMENT,
    confidence: 90,
    entities: [],
    relations: [],
    themes: [CATEGORY.URBAN_MANAGEMENT],
  };

  const res3 = evaluateIncrementalTicket(ticketExpired, [cloneTheme(existingTheme)]);
  const closedTheme = cloneTheme(existingTheme);
  closedTheme.handlingStatus = HANDLING_STATUS.RESOLVED;
  const res3Closed = evaluateIncrementalTicket(ticketExpired, [closedTheme]);
  console.log(`📥 接收工单: [${ticketExpired.ticketNo}] 发生时间: ${ticketExpired.createTime}`);
  console.log(`⚡ 算法研判结果:`);
  console.log(`   - 决策动作: [${res3.action}]`);
  console.log(`   - 研判原因: ${res3.reason}`);

  // ---------------------------------------------------------------------------
  // 测试用例 4：质变突发险情升级（出现严重次生灾害关键词）
  // ---------------------------------------------------------------------------
  console.log("\n--------------------------------------------------------------------------------");
  console.log("👉 【测试 4】质变测试：同一地点涌入严重险情诉求（冲刷塌陷、车辆遇险）");
  const ticketHazard: EnrichedTicket = {
    id: "TICKET-HAZARD-01",
    ticketNo: "FS20260926011",
    title: "金榜上街自来水冲刷导致路面严重塌陷车辆陷落危险！",
    content: "大良金榜上街爆管水流掏空路基，路面发生大面积塌陷事故，有私家车前轮陷落深坑，情况十分危险，旁边就是居民楼，随时有倒塌危险！请应急和消防立即到场救险！",
    createTime: "2026-09-26 10:30:00",
    citizenName: "紧急报案人",
    citizenPhone: "13900139004",
    district: "顺德区",
    subdistrict: "大良街道",
    channel: "市民热线",
    status: "PENDING",
    canonicalLocation: "大良街道金榜上街28号",
    canonicalSubject: "大良街道金榜上街塌陷路面",
    eventType: "路面塌陷险情",
    sourceCategory: CATEGORY.URBAN_MANAGEMENT,
    confidence: 98,
    entities: [],
    relations: [],
    themes: [CATEGORY.URBAN_MANAGEMENT],
  };

  console.log(`📥 接收工单: [${ticketHazard.ticketNo}] ${ticketHazard.title}`);
  const res4 = evaluateIncrementalTicket(ticketHazard, [cloneTheme(existingTheme)]);
  console.log(`⚡ 算法研判结果:`);
  console.log(`   - 决策动作: [${res4.action}]`);
  console.log(`   - 归属主题: ${res4.matchedThemeId}`);
  console.log(`   - 慢思考质变升级判定: ${res4.needDeepThinkingUpgrade ? "🚨 触发严重险情质变升级！" : "否"}`);
  console.log(`   - 升级原因: ${res4.upgradeReason}`);

  const failures: string[] = [];
  if (res1.action !== "ATTACHED") failures.push(`测试 1：期望 ATTACHED，实际 ${res1.action}`);
  if (res1.needDeepThinkingUpgrade) failures.push("测试 1：普通追加不应触发慢思考");
  if (res1.matchedTheme?.ticketCount !== 4) {
    failures.push(`测试 1：吸附后工单数应为 4，实际 ${res1.matchedTheme?.ticketCount}`);
  }
  if (res2.action !== "STANDALONE") failures.push(`测试 2：期望 STANDALONE，实际 ${res2.action}`);
  if (res3.action !== "ATTACHED") failures.push(`测试 3：期望 ATTACHED，实际 ${res3.action}`);
  if (res3.cadence !== CADENCE.RECURRING) failures.push(`测试 3：节奏应为反复，实际 ${res3.cadence}`);
  if (res3.needDeepThinkingUpgrade) failures.push("测试 3：隔天再反映不应触发慢思考");
  if (res3.matchedTheme?.ticketCount !== 4) {
    failures.push(`测试 3：并入后工单数应为 4，实际 ${res3.matchedTheme?.ticketCount}`);
  }
  if (res3Closed.action !== "ATTACHED" || (res3Closed.matchedTheme?.reopenCount || 0) < 1) {
    failures.push("测试 3：已办结主题再次反映应按复发并入");
  }
  if (res1.cadence !== CADENCE.BURST) failures.push(`测试 1：节奏应为突发，实际 ${res1.cadence}`);
  if (res4.action !== "ATTACHED") failures.push(`测试 4：期望 ATTACHED，实际 ${res4.action}`);
  if (!res4.needDeepThinkingUpgrade) failures.push("测试 4：险情工单应触发升级");
  if (res4.matchedTheme?.riskLevel !== "HIGH") failures.push("测试 4：险情应由规则写成高风险");

  if (describeCadence(["2025-01-01 00:00:00", "2025-01-01 00:00:00"]) !== CADENCE.SAME_DAY) {
    failures.push("同一天且没有钟点应记为同日");
  }
  if (describeCadence(["2025-01-01 08:15:00", "2025-01-01 10:15:00"]) !== CADENCE.BURST) {
    failures.push("同一天有钟点仍记突发");
  }

  const donghuTheme: MultiFrequencyTheme = {
    id: "THEME-DONGHU",
    title: "容桂街道 · 东湖学府 · 施工噪音",
    canonicalSubject: "东湖学府",
    canonicalLocation: "容桂街道东湖学府二期工地",
    eventType: "施工噪音",
    category: CATEGORY.URBAN_MANAGEMENT,
    riskLevel: "LOW",
    riskReason: "",
    ticketCount: 2,
    timeSpanHours: 1,
    firstOccurrence: "2025-01-01 00:00:00",
    lastOccurrence: "2025-01-01 00:00:00",
    aiSummary: "容桂街道东湖学府二期施工噪音",
    recommendedAction: "已有建议",
    handlingStatus: HANDLING_STATUS.IN_PROGRESS,
    status: "CONFIRMED",
    relatedSubjects: ["东湖学府"],
    relatedLocations: ["容桂街道东湖学府二期工地"],
    tickets: [],
  };
  const donghuTicket: EnrichedTicket = {
    id: "TICKET-DONGHU",
    ticketNo: "250101009990109-01",
    title: "来电",
    content: "容桂街道新有中东湖学府二期，另一位市民再次来电，说的是同一处楼盘。",
    createTime: "2025-01-01 00:00:00",
    citizenName: "市民",
    citizenPhone: "",
    district: "顺德区",
    subdistrict: "容桂街道",
    channel: "市民热线",
    status: "PENDING",
    canonicalLocation: "容桂街道东湖学府二期",
    canonicalSubject: "市民",
    summarizeTitle: "东湖学府二期施工噪音",
    eventType: "施工噪音",
    sourceCategory: CATEGORY.URBAN_MANAGEMENT,
    confidence: 90,
    entities: [],
    relations: [],
    themes: [],
  };
  const donghuPlain = evaluateIncrementalTicket(donghuTicket, [cloneTheme(donghuTheme)]);
  const donghuEmbedded = evaluateIncrementalTicket(donghuTicket, [cloneTheme(donghuTheme)], {
    ticketVector: [1, 0],
    themeVectors: new Map([["THEME-DONGHU", [1, 0]]]),
  });
  if (donghuPlain.action !== "STANDALONE") {
    failures.push(`东湖学府没有向量时不应并入，实际 ${donghuPlain.action}`);
  }
  if (donghuEmbedded.action !== "ATTACHED") {
    failures.push(`东湖学府有向量时应并入，实际 ${donghuEmbedded.action}`);
  }
  if (donghuEmbedded.cadence !== CADENCE.SAME_DAY) {
    failures.push(`东湖学府同一天零点应记同日，实际 ${donghuEmbedded.cadence}`);
  }

  if (failures.length > 0) {
    console.error("\n❌ 增量评测未通过:");
    for (const item of failures) console.error(`   - ${item}`);
    process.exit(1);
  }

  if (process.env.SKIP_SYSTEM_TWO === "1") {
    console.log("\n确定性断言已通过。SKIP_SYSTEM_TWO=1，跳过慢思考调用。");
  } else if (res4.matchedTheme) {
    console.log("\n🧠 正在启动 System-2 慢思考进行【应急增量再研判】(重新推导多部门联合救险预案)...");
    const upgraded = await upgradeThemeWithSystemTwo(res4.matchedTheme);
    if (!upgraded.recommendedAction?.trim()) {
      console.error("❌ 测试 4：慢思考没有给出处置建议");
      process.exit(1);
    }
    console.log(`\n✅ System-2 增量研判推导完成！`);
    console.log(`   - 最新风险等级: [${upgraded.riskLevel}]`);
    console.log(`   - 最新成因剖析: ${upgraded.riskReason}`);
    console.log(`   - 升级后的联动预案: ${upgraded.recommendedAction}`);
  }

  console.log("\n================================================================================");
  console.log("🎉 12345 增量时空吸附与动态研判机制全项验证圆满成功！");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("评测异常:", err);
  process.exit(1);
});
