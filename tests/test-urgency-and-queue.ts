import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { assessCivicUrgency, SystemOneEngine } from "../packages/civic-system-one/src/index";
import { profileTicket } from "../backend/ticket-profile";
import { buildRecordsFromRows } from "../lib/ticket-ingest";

type ExpectedCase = {
  label: string;
  title: string;
  content: string;
  expectedUrgency: "URGENT" | "MEDIUM" | "NORMAL";
  expectedSla: number;
};

const TEST_CASES: ExpectedCase[] = [
  {
    label: "电梯被困",
    title: "天河南街道华景新城22栋1单元406室反映电梯故障致住户被困存在安全隐患",
    content: "电梯故障致住户被困电梯内，存在安全隐患，请立即救援处理。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "井盖缺失",
    title: "天河南街道天河路308号路段反映井盖缺失致行人跌倒存在安全隐患",
    content: "路面窨井盖缺失致行人跌倒，存在安全隐患。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "消防通道堵塞",
    title: "棠下街道华景新城19栋2单元508室反映同类消防通道堵塞致存在安全隐患",
    content: "小区消防通道堵塞，严重影响消防应急通行。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "路面塌陷",
    title: "天河南街道天河南东路226号路段反映同类路面塌陷致坑洞扩大威胁行人安全",
    content: "路面塌陷坑洞不断扩大，威胁行人车辆安全。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "燃气泄漏",
    title: "反映居民楼楼道燃气泄漏刺鼻气味",
    content: "楼道内闻到明显燃气泄漏气味，担心发生危险。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "漏电风险",
    title: "反映路灯杆漏电威胁行人安全",
    content: "雨天路灯配电箱存在漏电情况，请迅速断电检修。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "火灾着火",
    title: "反映临街商铺后厨起火冒烟",
    content: "商铺后厨突发着火，现场有明火和浓烟。",
    expectedUrgency: "URGENT",
    expectedSla: 2,
  },
  {
    label: "大面积停水",
    title: "大良街道北区反映大面积停水影响居民生活",
    content: "多个小区今天凌晨起大面积停水，至今未恢复。",
    expectedUrgency: "MEDIUM",
    expectedSla: 24,
  },
  {
    label: "信号灯故障",
    title: "陈村路口反映信号灯故障无法正常通行",
    content: "十字路口红绿灯全部熄灭，早高峰交通混乱。",
    expectedUrgency: "MEDIUM",
    expectedSla: 24,
  },
  {
    label: "多次反映未果",
    title: "反映社区垃圾站异味问题多次反映未果",
    content: "此前已经投诉三次，多次反映未果，希望尽快督办。",
    expectedUrgency: "MEDIUM",
    expectedSla: 24,
  },
  {
    label: "否定语境-无安全隐患",
    title: "反映楼道照明灯损坏已检修无安全隐患",
    content: "物业已派人检查确认无安全隐患，仅需更换灯泡。",
    expectedUrgency: "NORMAL",
    expectedSla: 120,
  },
  {
    label: "否定语境-无人被困",
    title: "反映小区电梯停运故障无人被困",
    content: "电梯突发停运但并未困人、无人被困，请物业安排维修。",
    expectedUrgency: "NORMAL",
    expectedSla: 120,
  },
  {
    label: "已修复语境",
    title: "反映消防通道堵塞已清理恢复通行",
    content: "此前堆放的杂物消防通道已清理，无其他异常。",
    expectedUrgency: "NORMAL",
    expectedSla: 120,
  },
  {
    label: "夜间噪音",
    title: "兴华街道兴华路546号路段反映夜间施工噪音扰民致居民无法休息",
    content: "附近工地夜间施工噪音较大，影响居民夜间休息。",
    expectedUrgency: "NORMAL",
    expectedSla: 120,
  },
  {
    label: "政策咨询",
    title: "咨询社保转移办理流程",
    content: "请问外地社保转入广州需要准备什么材料？",
    expectedUrgency: "NORMAL",
    expectedSla: 0,
  },
];

function mapUrgencyFromDecision(decision: { stabilityRisk: boolean; urgencyLevel: number }) {
  return decision.stabilityRisk || decision.urgencyLevel === 3
    ? "URGENT"
    : decision.urgencyLevel === 2
      ? "MEDIUM"
      : "NORMAL";
}

async function main() {
  // 1. Symbolic assessCivicUrgency checks
  const neg = assessCivicUrgency("反映楼道照明灯损坏已检修无安全隐患");
  assert.equal(neg.level, 1);
  assert.equal(neg.negatedOnly, true);

  const negTrap = assessCivicUrgency("电梯故障无人被困并未困人");
  assert.equal(negTrap.level, 1);
  assert.equal(negTrap.negatedOnly, true);

  const urgentTrap = assessCivicUrgency("电梯故障致住户被困存在安全隐患");
  assert.equal(urgentTrap.level, 3);
  assert.equal(urgentTrap.urgency, "URGENT");

  // 2. Both ONNX and Fallback adapters
  const onnxEngine = await SystemOneEngine.create();
  assert.equal(onnxEngine.currentAdapter, "onnx", "ONNX adapter must load locally");
  const fallbackEngine = await SystemOneEngine.create({ preferredMode: "fallback" });

  for (const tc of TEST_CASES) {
    const onnxRes = await onnxEngine.evaluate({ title: tc.title, content: tc.content });
    const fbRes = await fallbackEngine.evaluate({ title: tc.title, content: tc.content });

    assert.equal(
      mapUrgencyFromDecision(onnxRes),
      tc.expectedUrgency,
      `ONNX urgency mismatch for [${tc.label}]: got level=${onnxRes.urgencyLevel}, stab=${onnxRes.stabilityRisk}`
    );
    assert.equal(
      onnxRes.slaHours,
      tc.expectedSla,
      `ONNX slaHours mismatch for [${tc.label}]: got ${onnxRes.slaHours}`
    );

    assert.equal(
      mapUrgencyFromDecision(fbRes),
      tc.expectedUrgency,
      `Fallback urgency mismatch for [${tc.label}]: got level=${fbRes.urgencyLevel}, stab=${fbRes.stabilityRisk}`
    );
    assert.equal(
      fbRes.slaHours,
      tc.expectedSla,
      `Fallback slaHours mismatch for [${tc.label}]: got ${fbRes.slaHours}`
    );
  }

  await onnxEngine.close();
  await fallbackEngine.close();

  // 3. profileTicket + buildRecordsFromRows ingest checks
  assert.equal(profileTicket({ title: "电梯被困", content: "住户被困在电梯里" }).urgency, "URGENT");
  assert.equal(profileTicket({ title: "井盖缺失", content: "路口井盖缺失" }).urgency, "URGENT");
  assert.equal(profileTicket({ title: "大面积停水", content: "小区大面积停水" }).urgency, "MEDIUM");
  assert.equal(profileTicket({ title: "照明故障已检修无安全隐患", content: "无安全隐患" }).urgency, "NORMAL");

  const { records, failedCount } = buildRecordsFromRows(
    [
      { title: "小区电梯故障致住户被困", content: "1栋电梯困人请救援" },
      { title: "北区大面积停水", content: "今日大面积停水请处理" },
      { title: "夜间施工噪音", content: "夜间施工噪音扰民" },
    ],
    "TEST-URG",
    { district: "天河区" }
  );
  assert.equal(failedCount, 0);
  assert.equal(records[0].urgency, "URGENT");
  assert.equal(records[1].urgency, "MEDIUM");
  assert.equal(records[2].urgency, "NORMAL");
  assert.equal(records[0].slaHours, null, "AGENT_TICKET_NULLS still keeps slaHours null for S1 extract-node");

  // 4. Verify cluster-queue reclaim fix transitions RUNNING -> PENDING cleanly
  const queueSrc = fs.readFileSync(path.resolve("lib/cluster-queue.ts"), "utf8");
  assert.ok(
    queueSrc.includes("SET status = 'PENDING'") && queueSrc.includes('status: "PENDING"'),
    "enqueueClusterJob stale reclaim must reset status back to PENDING so claimNextClusterJob can claim it"
  );

  // 5. Verify extract-node & civic-persist guards
  const extractSrc = fs.readFileSync(path.resolve("backend/node/extract-node.ts"), "utf8");
  assert.ok(extractSrc.includes("ticket.urgency &&"), "hasStoredSystemOne must require urgency");

  const persistSrc = fs.readFileSync(path.resolve("lib/civic-persist.ts"), "utf8");
  assert.ok(
    persistSrc.includes("urgency = COALESCE(v.urgency, t.urgency)"),
    "persistTicketAnalysis must use COALESCE for urgency"
  );

  console.log(`✅ All urgency, ingest, persist, and queue assertions passed (${TEST_CASES.length} S1 scenarios × 2 adapters)!`);
}

main().catch((err) => {
  console.error("❌ test-urgency-and-queue failed:", err);
  process.exit(1);
});
