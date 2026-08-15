import { deriveRiskLevel, scanNegativeSentiment } from "../backend/node/risk-rules";
import { RULES } from "../backend/rules";

function assert(name: string, ok: boolean) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}`);
  if (!ok) process.exitCode = 1;
}

const fireTerm = RULES.negativeTerms[0];
const highN = RULES.risk.highCount;
const midN = RULES.risk.mediumCount;

const gatheringHot = Array.from({ length: highN }, (_, i) => ({
  content: i === 0 ? `现场${fireTerm}请马上处理` : "同一地点诉求",
}));

assert(
  "聚集 + 险情词 + 高件数 → HIGH",
  deriveRiskLevel({
    ticketCount: highN,
    patternType: "GROUP_GATHERING",
    hitNegative: scanNegativeSentiment(gatheringHot),
  }) === "HIGH" && scanNegativeSentiment(gatheringHot)
);

assert(
  "聚集 + 中件数 + 无险情 → MEDIUM",
  deriveRiskLevel({
    ticketCount: midN,
    patternType: "GROUP_GATHERING",
    hitNegative: scanNegativeSentiment([{ content: "夜间音响偏大" }]),
  }) === "MEDIUM"
);

assert(
  "个体重复低于中件数 → LOW",
  deriveRiskLevel({
    ticketCount: Math.max(RULES.minClusterSize, midN - 1),
    patternType: "INDIVIDUAL_REPEAT",
    hitNegative: false,
  }) === "LOW"
);

const localHigh = deriveRiskLevel({
  ticketCount: highN,
  patternType: "GROUP_GATHERING",
  hitNegative: true,
});
assert("本地 HIGH 不被 LLM LOW 覆盖", localHigh === "HIGH");

if (process.exitCode) {
  console.error("verify-risk-rules failed");
  process.exit(1);
}
console.log("verify-risk-rules passed");
