import { inferPatternType, civicModeFromPattern, deriveThemeMetrics } from "../backend/theme-metrics";
import { toClusterDto, toWorkorderDto, regionLabel } from "../lib/civic-dto";
import { buildOverview, buildTrends, buildInsights } from "../lib/civic-stats";
import { classifyDetailPayload } from "../lib/detail-load";
import { parseAdminArea, explicitAdmin } from "../lib/admin-area";
import { deriveClusterUrgency, spanDays, urgentCutFromUnprocessed } from "../lib/civic-cluster";
import { timeWindow } from "../lib/civic-time";
import { AGENT_TICKET_NULLS, buildTicketAgentPatch, buildThemePersistRow } from "../lib/civic-persist";
import type { EnrichedTicket, MultiFrequencyTheme } from "../backend/state";

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

const twoCallers = [
  ticket({ id: "t1", citizenPhone: "138****2001", citizenName: "甲" }),
  ticket({ id: "t2", citizenPhone: "138****2002", citizenName: "乙", createTime: "2026-08-09 10:00:00" }),
];
assert(
  "两个不同反映人同事件 → aggregate 不是 repeat",
  inferPatternType(twoCallers) === "GROUP_GATHERING" &&
    civicModeFromPattern(inferPatternType(twoCallers)) === "aggregate"
);

assert("详情首屏 pending 是加载不是 404", classifyDetailPayload("pending", null) === "loading");
assert("详情 success:false 才是 missing", classifyDetailPayload("done", { success: false }) === "missing");
assert("详情成功载荷是 ready", classifyDetailPayload("done", { success: true }) === "ready");

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
assert("未研判工单不展示镇街和类型", wo.region === "" && wo.category === "");

const analyzedWo = toWorkorderDto({
  id: "tk-2",
  ticketNo: "2501010002",
  title: "噪音",
  subdistrict: "北滘镇",
  sourceCategory: "生态环境",
  confidence: 91,
  createTime: new Date("2026-08-01T10:00:00Z"),
});
assert("研判后工单展示切分镇街", analyzedWo.region === "北滘" && analyzedWo.category === "生态环境");

const overview = buildOverview(
  [
    { createTime: "2026-08-01", subdistrict: "北滘镇", sourceCategory: "城管", primaryThemeId: "T1", confidence: 90 },
    { createTime: "2026-08-02", subdistrict: "大良街道", sourceCategory: "劳资", confidence: 82 },
    { createTime: "2026-08-02", subdistrict: "北滘镇", sourceCategory: "城管", primaryThemeId: "T1", confidence: 88 },
  ],
  1
);
assert("overview 总量=输入行数", overview.totalWorkorders === 3);
assert("overview 已研判=带 confidence 的行", overview.analyzedCount === 3);
assert("overview 多频件数=带 primaryThemeId 的行", overview.multiFreqCount === 2);
assert("overview 镇街分布可加总回已研判量", Object.values(overview.regionDistribution).reduce((a, b) => a + b, 0) === 3);
assert("topRegion 是件数最多的镇", overview.topRegion === "北滘");

const afterUpload = buildOverview(
  [
    { createTime: "2026-08-01", subdistrict: "综合辖区", sourceCategory: "城管" },
    { createTime: "2026-08-02" },
  ],
  0
);
assert("入库未研判不进镇街分布", Object.keys(afterUpload.regionDistribution).length === 0);
assert("入库未研判不进类型分布", Object.keys(afterUpload.categoryDistribution).length === 0);
assert("入库未研判仍计总量", afterUpload.totalWorkorders === 2 && afterUpload.analyzedCount === 0);

assert(
  "微观地点切出区+街道",
  parseAdminArea("顺德区容桂街道扁滘富豪路三街2号门口").district === "顺德区" &&
    parseAdminArea("顺德区容桂街道扁滘富豪路三街2号门口").subdistrict === "容桂街道"
);
assert("仅镇名也能切出镇街", parseAdminArea("北滘镇碧桂园西苑翠堤岸10号").subdistrict === "北滘镇");
assert(
  "含市前缀仍切到区+街道",
  parseAdminArea("佛山市顺德区大良街道").district === "顺德区" &&
    parseAdminArea("佛山市顺德区大良街道").subdistrict === "大良街道"
);
assert("小区不误判为区", parseAdminArea("北滘镇碧桂园西苑小区10号").district === null);
assert("占位辖区忽略", parseAdminArea("综合辖区").subdistrict === null && explicitAdmin("所属辖区") === null);

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

assert("持续天数按首末日计算", spanDays("2026-08-01", "2026-08-12") === 11);
assert("未处理≥200 时紧急阈=200", urgentCutFromUnprocessed([10, 80, 240]) === 200);
assert("小样本紧急阈按分位缩放", urgentCutFromUnprocessed([1, 2, 3, 4, 5]) >= 3);
assert(
  "城管类+高未处理 → urgent",
  deriveClusterUrgency(5, "城市管理", 3) === "urgent"
);
assert(
  "城管类+低未处理 → high",
  deriveClusterUrgency(1, "城市管理", 3) === "high"
);
const win = timeWindow("近7天", new Date(2025, 2, 31));
const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
assert("近7天相对数据集末日", !!win.from && ymd(win.from) === "2025-03-25");

assert(
  "入库行 agent 列为空",
  AGENT_TICKET_NULLS.confidence == null &&
    AGENT_TICKET_NULLS.district == null &&
    AGENT_TICKET_NULLS.sourceCategory == null &&
    AGENT_TICKET_NULLS.primaryThemeId == null
);

const ingestOnly = toWorkorderDto({
  id: "ingest-only",
  ticketNo: "WO-INGEST",
  title: "上传原文标题",
  subdistrict: null,
  sourceCategory: null,
  confidence: null,
  content: "市民电话13825789123 在顺德区均安镇仓门村夜市街反映噪音",
  maskedContent: "市民电话138****9123 在顺德区均安镇仓门村夜市街反映噪音",
});
assert("未研判 DTO 镇街/类型为空", ingestOnly.region === "" && ingestOnly.category === "");
assert("未研判仍保留原文 rawContent", ingestOnly.rawContent.includes("13825789123"));

const extracted: EnrichedTicket = {
  id: "tk-extracted",
  ticketNo: "WO-EXTRACT",
  createTime: "2026-08-01 10:00:00",
  citizenName: "市民甲",
  citizenPhone: "138****0001",
  content: "市民电话13825789123 在顺德区均安镇仓门村夜市街反映噪音",
  maskedContent: "市民电话138****9123 在顺德区均安镇仓门村夜市街反映噪音",
  channel: "市民服务热线",
  status: "PENDING",
  entities: [],
  relations: [],
  themes: ["生态环境"],
  sourceCategory: "生态环境",
  summarizeTitle: "均安镇仓门村夜市街噪音扰民",
  confidence: 92,
  canonicalSubject: "夜市街音响",
  canonicalLocation: "顺德区均安镇仓门村夜市街",
  eventType: "夜间营业音响喧哗与商业噪音扰民",
};
const agentPatch = buildTicketAgentPatch(extracted);
assert(
  "persist patch 切出镇街+七类+置信度",
  agentPatch.subdistrict === "均安镇" &&
    agentPatch.district === "顺德区" &&
    agentPatch.sourceCategory === "生态环境" &&
    agentPatch.confidence === 92
);
assert("persist patch 不携带原文 content", !("content" in agentPatch));

const afterPersistDto = toWorkorderDto({
  id: extracted.id,
  ticketNo: extracted.ticketNo,
  title: "上传原文标题",
  summarizeTitle: agentPatch.summarizeTitle,
  subdistrict: agentPatch.subdistrict,
  district: agentPatch.district,
  sourceCategory: agentPatch.sourceCategory,
  confidence: agentPatch.confidence,
  address: agentPatch.address,
  primaryThemeId: "THEME-VERIFY-1",
  content: extracted.content,
  maskedContent: extracted.maskedContent,
});
assert(
  "研判后 DTO 展示切分镇街与七类",
  afterPersistDto.region === "均安" && afterPersistDto.category === "生态环境"
);
assert("研判后 cluster_id 来自主题回写", afterPersistDto.cluster_id === "THEME-VERIFY-1");
assert("研判后原文不被脱敏覆盖", afterPersistDto.rawContent.includes("13825789123"));

const themeFixture: MultiFrequencyTheme = {
  id: "THEME-VERIFY-1",
  title: "仓门村夜市街噪音",
  canonicalSubject: "夜市街音响",
  canonicalLocation: "顺德区均安镇仓门村夜市街",
  eventType: "夜间营业音响喧哗与商业噪音扰民",
  category: "生态环境",
  riskLevel: "MEDIUM",
  riskReason: "短时集中",
  patternType: inferPatternType(sameCat),
  civicMode: civicModeFromPattern(inferPatternType(sameCat)),
  ticketCount: sameCat.length,
  timeSpanHours: 24,
  firstOccurrence: "2026-08-01 10:00:00",
  lastOccurrence: "2026-08-12 10:00:00",
  aiSummary: "同地点多市民噪音投诉",
  recommendedAction: "现场核查",
  tickets: sameCat.map((t) => ({ ...t, subdistrict: "均安镇", district: "顺德区" })),
  relatedSubjects: ["夜市街音响"],
  relatedLocations: ["顺德区均安镇仓门村夜市街"],
  status: "UNCHECKED",
  ...metrics,
  handlingStatus: "未处理",
  handlingProgress: 0,
};
const themeRow = buildThemePersistRow(themeFixture);
assert("theme persist 写入 civicMode", themeRow.civicMode === "aggregate");
assert("theme persist 写入 features/radar", !!themeRow.featuresJson && !!themeRow.radarJson);
assert("theme persist 写入首末日", !!themeRow.firstAt && !!themeRow.lastAt);
const themeDto = toClusterDto({
  ...themeRow,
  featuresJson: themeRow.featuresJson,
  radarJson: themeRow.radarJson,
  tickets: themeFixture.tickets,
});
assert("cluster DTO mode/features/radar 来自 persist 行", themeDto.mode === "aggregate" && themeDto.features.length === 4 && themeDto.radar.length === 5);
assert("cluster DTO first/last 来自 persist", themeDto.first_date.startsWith("2026-08-01") && themeDto.last_date.startsWith("2026-08-12"));

const mixedOverview = buildOverview(
  [
    { createTime: "2026-08-01", subdistrict: "均安镇", sourceCategory: "生态环境", confidence: 92 },
    { createTime: "2026-08-02", ingestCategory: "城管" } as any,
    { createTime: "2026-08-03" },
  ],
  1
);
assert("overview 总量含未研判", mixedOverview.totalWorkorders === 3);
assert("overview 镇街只计已研判", mixedOverview.analyzedCount === 1 && mixedOverview.regionDistribution["均安"] === 1);
assert("overview 类型只计已研判", mixedOverview.categoryDistribution["生态环境"] === 1);

async function persistRoundtrip() {
  const { db } = await import("../db/client");
  const { ticketsTable, themesTable, ticketThemesTable } = await import("../db/schema");
  const { persistClusterResult } = await import("../lib/civic-persist");
  const { eq } = await import("drizzle-orm");
  const { writeFileSync } = await import("node:fs");

  const stamp = Date.now();
  const ticketId = `vp-tk-${stamp}`;
  const themeId = `vp-th-${stamp}`;
  const original = "市民电话13825789123 在顺德区均安镇仓门村夜市街反映噪音";
  const masked = "市民电话138****9123 在顺德区均安镇仓门村夜市街反映噪音";

  await db.insert(ticketsTable).values({
    id: ticketId,
    ticketNo: `VP-${stamp}`,
    title: "上传原文标题",
    content: original,
    maskedContent: masked,
    ...AGENT_TICKET_NULLS,
    status: "PENDING",
    createTime: new Date("2026-08-01T10:00:00Z"),
  });

  const before = (await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)))[0];
  const member: EnrichedTicket = {
    ...extracted,
    id: ticketId,
    ticketNo: `VP-${stamp}`,
    clusterId: themeId,
  };
  await persistClusterResult({
    tickets: [member],
    themes: [{ ...themeFixture, id: themeId, tickets: [member] }],
    replaceThemes: false,
  });
  const after = (await db.select().from(ticketsTable).where(eq(ticketsTable.id, ticketId)))[0];
  const theme = (await db.select().from(themesTable).where(eq(themesTable.id, themeId)))[0];

  assert("DB persist 后 content 未改", after.content === original);
  assert("DB persist 后 masked 仍在", after.maskedContent === masked);
  assert(
    "DB persist 回写镇街/七类/置信度",
    after.subdistrict === "均安镇" && after.sourceCategory === "生态环境" && after.confidence === 92
  );
  assert("DB persist 写入 cluster_id", after.primaryThemeId === themeId);
  assert("DB persist 主题有 mode/features", theme?.civicMode === "aggregate" && !!theme?.featuresJson);

  const dump = process.env.CIVIC_VERIFY_DUMP;
  if (dump) {
    writeFileSync(
      dump,
      JSON.stringify(
        {
          before: {
            content: before.content,
            district: before.district,
            subdistrict: before.subdistrict,
            sourceCategory: before.sourceCategory,
            confidence: before.confidence,
            primaryThemeId: before.primaryThemeId,
          },
          after: {
            content: after.content,
            district: after.district,
            subdistrict: after.subdistrict,
            sourceCategory: after.sourceCategory,
            confidence: after.confidence,
            primaryThemeId: after.primaryThemeId,
            summarizeTitle: after.summarizeTitle,
          },
          theme: theme
            ? {
                id: theme.id,
                civicMode: theme.civicMode,
                category: theme.category,
                firstAt: theme.firstAt,
                lastAt: theme.lastAt,
                featuresJson: theme.featuresJson,
                radarJson: theme.radarJson,
              }
            : null,
        },
        null,
        2
      )
    );
  }

  await db.delete(ticketThemesTable).where(eq(ticketThemesTable.themeId, themeId));
  await db.delete(themesTable).where(eq(themesTable.id, themeId));
  await db.delete(ticketsTable).where(eq(ticketsTable.id, ticketId));
}

persistRoundtrip()
  .then(() => {
    if (process.exitCode) {
      console.error("verify-civic-map failed");
      process.exit(1);
    }
    console.log("verify-civic-map passed");
    process.exit(0);
  })
  .catch((err) => {
    console.error("persist roundtrip skipped/failed:", err.message);
    if (process.exitCode) {
      process.exit(1);
    }
    console.log("verify-civic-map passed (builders only)");
    process.exit(0);
  });
