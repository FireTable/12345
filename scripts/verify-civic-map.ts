import { inferPatternType, civicModeFromPattern, deriveThemeMetrics } from "../backend/theme-metrics";
import { toClusterDto, toWorkorderDto, regionLabel } from "../lib/civic-dto";
import { buildOverview, buildTrends, buildInsights } from "../lib/civic-stats";
import type { EnrichedTicket } from "../backend/state";

function assert(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

function ticket(partial: Partial<EnrichedTicket> & { id: string }): EnrichedTicket {
  return {
    ticketNo: partial.id,
    createTime: "2026-08-01 10:00:00",
    citizenName: "市民甲",
    citizenPhone: "138****0001",
    district: "顺德区",
    subdistrict: "北滘镇",
    content: "噪音扰民",
    channel: "市民服务热线",
    status: "PENDING",
    entities: [],
    relations: [],
    themes: ["社会治理"],
    canonicalSubject: "某烧烤店",
    canonicalLocation: "济虹路160号",
    eventType: "夜间噪音扰民",
    ...partial,
  };
}

const sameCat = [
  ticket({ id: "a", citizenPhone: "1" }),
  ticket({ id: "b", citizenPhone: "2", createTime: "2026-08-10 10:00:00" }),
  ticket({ id: "c", citizenPhone: "3", createTime: "2026-08-12 10:00:00" }),
];
assert("多人同类型 → aggregate", civicModeFromPattern(inferPatternType(sameCat)) === "aggregate");

const oneCaller = [
  ticket({ id: "d", citizenPhone: "138****1111" }),
  ticket({ id: "e", citizenPhone: "138****1111", createTime: "2026-08-08 10:00:00" }),
];
assert("同一反映人 → repeat", civicModeFromPattern(inferPatternType(oneCaller)) === "repeat");

const mixed = [
  ticket({ id: "f", themes: ["生态环境"] }),
  ticket({ id: "g", themes: ["市容秩序"], eventType: "占道经营" }),
];
assert("多分类 → diverge", civicModeFromPattern(inferPatternType(mixed)) === "diverge");

const metrics = deriveThemeMetrics({
  eventType: "夜间噪音扰民",
  canonicalLocation: "济虹路160号",
  tickets: sameCat,
  patternType: "GROUP_GATHERING",
});
assert("features 长度为 4", metrics.features.length === 4);
assert("radar 5 维", metrics.radar.length === 5);
assert("confidence 在 0-99", metrics.aiConfidence >= 0 && metrics.aiConfidence <= 99);
assert("geo pct 由同地点比例算出", metrics.features[1].pct === 100);

const dto = toClusterDto({
  id: "THEME-1",
  title: "济虹路烧烤",
  category: "社会治理",
  ticketCount: 3,
  patternType: "GROUP_GATHERING",
  aiConfidence: metrics.aiConfidence,
  firstOccurrence: "2026-08-01",
  lastOccurrence: "2026-08-12",
  features: metrics.features,
  radar: metrics.radar,
  tickets: sameCat,
});
assert("DTO mode 为 aggregate", dto.mode === "aggregate");
assert("DTO count 来自 ticketCount", dto.count === 3);
assert("DTO 不含随机趋势当 trendPct 为空", dto.trend === "");

const wo = toWorkorderDto({
  id: "tk-1",
  ticketNo: "2501010001",
  title: "噪音",
  subdistrict: "北滘镇",
  status: "PENDING",
  createTime: new Date("2026-08-01T10:00:00Z"),
  content: "原文电话13825789123",
  maskedContent: "原文电话138****9123",
});
assert("region 去掉镇后缀", regionLabel("北滘镇") === "北滘");
assert("工单列表用脱敏正文", wo.content.includes("138****9123") && !wo.content.includes("13825789123"));

const overview = buildOverview(
  [
    { createTime: "2026-08-01", subdistrict: "北滘镇", sourceCategory: "城管", primaryThemeId: "T1" },
    { createTime: "2026-08-02", subdistrict: "大良街道", sourceCategory: "劳资" },
    { createTime: "2026-08-02", subdistrict: "北滘镇", sourceCategory: "城管", primaryThemeId: "T1" },
  ],
  1
);
assert("overview 总量=输入行数", overview.totalWorkorders === 3);
assert("overview 多频件数=带 primaryThemeId 的行", overview.multiFreqCount === 2);
assert("overview 镇街分布可加总回总量", Object.values(overview.regionDistribution).reduce((a, b) => a + b, 0) === 3);
assert("topRegion 是件数最多的镇", overview.topRegion === "北滘");

const trends = buildTrends([
  { createTime: "2026-08-01T00:00:00Z" },
  { createTime: "2026-08-01T03:00:00Z" },
  { createTime: "2026-08-02T00:00:00Z" },
]);
assert("trends 日桶之和=工单数", Object.values(trends.daily).reduce((a, b) => a + b, 0) === 3);

const insights = buildInsights([
  { id: "1", title: "聚集主题", patternType: "GROUP_GATHERING", ticketCount: 8, recommendedAction: "24h 派单" },
]);
assert("洞察来自真实主题标题", insights.some((c) => c.title === "聚集主题"));
assert("洞察不含设计稿写死的马龙村文案", !JSON.stringify(insights).includes("马龙村"));

if (process.exitCode) {
  console.error("verify-civic-map failed");
  process.exit(1);
}
console.log("verify-civic-map passed");
