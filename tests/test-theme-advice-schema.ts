/**
 * 主题建议里漏写 riskLevel 不能让同批其余建议校验失败。
 */
import { BatchThemeEnrichmentSchema } from "../backend/prompt";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const parsed = BatchThemeEnrichmentSchema.safeParse({
  results: [
    {
      themeIndex: 1,
      riskLevel: "MEDIUM",
      riskReason: "噪音持续",
      aiSummary: "商铺音响扰民。",
      recommendedAction: "街道现场核查。",
    },
    {
      themeIndex: 2,
      riskReason: "废料堆放",
      aiSummary: "楼下堆着建筑废料。",
      recommendedAction: "城管清运。",
    },
  ],
});

assert(parsed.success, "同批有一条没写 riskLevel 时，整批仍然通过");
assert(parsed.success && parsed.data.results[1].riskLevel === undefined, "漏写的风险等级保持空，留给本地规则");
assert(parsed.success && parsed.data.results[0].recommendedAction === "街道现场核查。", "写全的处置建议原样保留");
