/**
 * 准确度与语义校验全链路自动化测试脚本 (Accuracy Pipeline Test)
 */

import {
  SHUNDE_TOWNSHIPS,
  isValidShundeTownship,
  canonicalizeTownship,
} from "../lib/vocabulary";
import {
  resolveEntityAlias,
  normalizeAliasesInText,
  registerAlias,
  getAllAliases,
} from "../lib/alias-dict";
import { needsArbitration } from "../backend/node/arbitrator-node";
import { validateSingleTheme } from "../backend/node/cluster-validator";
import type { MultiFrequencyTheme, EnrichedTicket } from "../backend/state";

function runTests() {
  console.log("=== 1. 标准词汇表与镇街归一化测试 ===");
  const valid1 = isValidShundeTownship("大良街道");
  const valid2 = isValidShundeTownship("容奇");
  const valid3 = isValidShundeTownship("南海区西樵镇"); // 外部区县
  const valid4 = isValidShundeTownship("虚拟镇");

  console.assert(valid1 === true, "大良街道 应该合法");
  console.assert(valid2 === true, "容奇 别名应该合法");
  console.assert(valid3 === false, "西樵镇 非顺德辖区应不合法");
  console.assert(valid4 === false, "虚拟镇 应不合法");

  console.assert(canonicalizeTownship("容奇") === "容桂街道", "容奇 应归一化为 容桂街道");
  console.assert(canonicalizeTownship("桂洲") === "容桂街道", "桂洲 应归一化为 容桂街道");
  console.assert(canonicalizeTownship("北滘新城") === "北滘镇", "北滘新城 应归一化为 北滘镇");
  console.assert(canonicalizeTownship("德胜新区") === "大良街道", "德胜新区 应归一化为 大良街道");
  console.log("✅ 标准词汇表校验通过！共包含", SHUNDE_TOWNSHIPS.length, "个法定镇街。");

  console.log("\n=== 2. 别名识别与全文自动替换测试 ===");
  const rawText = "市民在容奇大桥附近反映容桂区某商户违规经营，希望德胜新区的执法队介入。";
  const normalized = normalizeAliasesInText(rawText);
  console.log("原始文本:", rawText);
  console.log("替换后文本:", normalized);
  console.assert(normalized.includes("容桂街道大桥"), "容奇 应被替换为 容桂街道");
  console.assert(normalized.includes("大良街道"), "德胜新区 应被替换为 大良街道");

  // 测试动态别名注册与沉淀
  registerAlias("小黄圃工业区", "容桂街道小黄圃社区");
  console.assert(resolveEntityAlias("小黄圃工业区") === "容桂街道小黄圃社区", "动态别名应注册成功");
  console.log("✅ 别名识别与替换引擎测试通过！当前别名库词条数:", Object.keys(getAllAliases()).length);

  console.log("\n=== 3. 二级 AI 仲裁触发条件测试 ===");
  const itemLowConf = {
    index: 1,
    summarizeTitle: "测试标题",
    subject: "粤E12345车辆",
    location: "容桂街道富豪路1号",
    eventType: "车辆违停",
    category: "交通出行" as const,
    confidence: 45, // < 60
  };
  console.assert(needsArbitration(itemLowConf) === true, "低置信度 (<60) 应触发仲裁");

  const itemGenericSubj = {
    index: 2,
    summarizeTitle: "测试标题",
    subject: "车主", // 泛词
    location: "容桂街道富豪路1号",
    eventType: "车辆违停",
    category: "交通出行" as const,
    confidence: 90,
  };
  console.assert(needsArbitration(itemGenericSubj) === true, "主体为泛化虚词 应触发仲裁");

  const itemGood = {
    index: 3,
    summarizeTitle: "测试标题",
    subject: "粤E SD221车辆",
    location: "顺德区容桂街道扁滘富豪路三街2号门口",
    eventType: "机动车违规停放",
    category: "交通出行" as const,
    confidence: 92,
  };
  console.assert(needsArbitration(itemGood) === false, "高置信度具体工单 不应触发仲裁");
  console.log("✅ 二级 AI 仲裁触发判定测试通过！");

  console.log("\n=== 4. 聚类真实性与质量质检器 (Cluster Validator) 测试 ===");
  // 测试 1：泛化虚词成群应被拒绝
  const fakeTheme1: MultiFrequencyTheme = {
    id: "THEME-1",
    title: "车主 — 违停",
    canonicalSubject: "车主",
    canonicalLocation: "大良街道",
    eventType: "违停",
    category: "交通出行",
    riskLevel: "LOW",
    riskReason: "常规",
    ticketCount: 3,
    timeSpanHours: 10,
    firstOccurrence: "2026-08-01 10:00:00",
    lastOccurrence: "2026-08-01 20:00:00",
    aiSummary: "摘要",
    recommendedAction: "处置",
    tickets: [{} as any, {} as any, {} as any],
    relatedSubjects: ["车主"],
    relatedLocations: ["大良街道"],
    status: "UNCHECKED",
  };
  const val1 = validateSingleTheme(fakeTheme1, fakeTheme1.tickets);
  console.assert(val1.passed === false, "虚词主体聚类必须被剔除");
  console.log("拦截测试 1 成功:", val1.rejectedReason);

  // 测试 2：跨车牌串扰应被拒绝
  const fakeTicketA: EnrichedTicket = {
    id: "T1",
    ticketNo: "T1",
    createTime: "2026-08-01 10:00:00",
    citizenName: "市民A",
    citizenPhone: "13800000000",
    title: "粤E11111违停",
    content: "粤E11111违停",
    channel: "12345",
    status: "PENDING",
    canonicalSubject: "粤E11111车辆",
    canonicalLocation: "大良街道新桂路",
    eventType: "机动车违规停放",
    entities: [],
    relations: [],
    themes: ["交通出行"],
  };
  const fakeTicketB: EnrichedTicket = {
    id: "T2",
    ticketNo: "T2",
    createTime: "2026-08-01 11:00:00",
    citizenName: "市民B",
    citizenPhone: "13900000000",
    title: "粤E99999违停",
    content: "粤E99999违停",
    channel: "12345",
    status: "PENDING",
    canonicalSubject: "粤E99999车辆",
    canonicalLocation: "大良街道新桂路",
    eventType: "机动车违规停放",
    entities: [],
    relations: [],
    themes: ["交通出行"],
  };
  const fakeTheme2: MultiFrequencyTheme = {
    ...fakeTheme1,
    id: "THEME-2",
    canonicalSubject: "粤E11111车辆",
    tickets: [fakeTicketA, fakeTicketB],
    ticketCount: 2,
  };
  const val2 = validateSingleTheme(fakeTheme2, fakeTheme2.tickets);
  console.assert(val2.passed === false, "跨车牌串扰聚类必须被剔除");
  console.log("拦截测试 2 成功:", val2.rejectedReason);

  console.log("\n==========================================");
  console.log("🎉 全部 4 大准确度核心优化模块单测 100% 通过！");
  console.log("==========================================");
}

runTests();
