/**
 * 驱动已交付的资格、哈希、工序 04 触发、宕机续跑和进度函数。
 */
import { batchSizeForProfile } from "@civic/embed";
import {
  embeddingProgressFraction,
  embeddingProgressLabel,
  embedEligibleBatches,
  isEmbedEligible,
  isJobHeartbeatHealthy,
  memberLastAt,
  productHashForTicket,
  selectEmbedTicketIds,
  shouldStartStage04,
  type EmbedTicketInput,
  type StoredEmbedding,
} from "../backend/embed-policy";
import {
  clusterFromStoredNeighbors,
  hnswCreateIndexSql,
  neighborLookupSql,
  rankNeighborIndexes,
} from "../backend/embed-neighbors";
import { profileTicket } from "../backend/ticket-profile";
import type { IncidentLinkCandidate } from "../backend/same-incident-cluster";
import { PIPELINE_STAGE_WEIGHTS, stagePercent } from "../lib/pipeline-progress";
import { SHUNDE_TOWNSHIPS } from "../lib/vocabulary";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function ticket(partial: Partial<EmbedTicketInput> & { id: string }): EmbedTicketInput {
  return {
    summarizeTitle: "供水故障",
    canonicalSubject: "金榜上街主水管",
    eventType: "停水",
    canonicalLocation: "大良街道金榜上街45号",
    subdistrict: "大良街道",
    sourceCategory: "城市管理",
    confidence: 90,
    extractionFailed: false,
    ...partial,
  };
}

async function main() {
  const failedSubject = ticket({ id: "fallback", canonicalSubject: "涉事方", confidence: 50 });
  const failedExtract = ticket({ id: "llm-down", canonicalSubject: "粤A12345车辆", extractionFailed: true });
  const ready = ticket({ id: "ready" });
  assert(!isEmbedEligible(failedSubject), "主体仍是涉事方的工单不嵌");
  assert(!isEmbedEligible(failedExtract), "抽取失败的工单不嵌");
  assert(isEmbedEligible(ready), "抽取完成的工单可以嵌");

  const stored: StoredEmbedding[] = [
    { ticketId: "ready", productHash: productHashForTicket(ready), model: "BAAI/bge-m3" },
  ];
  let modelCalls = 0;
  const unchanged = await embedEligibleBatches({
    tickets: [failedSubject, failedExtract, ready],
    stored,
    batchSize: batchSizeForProfile("bulk"),
    embedBatch: async () => {
      modelCalls += 1;
      return [];
    },
  });
  assert(modelCalls === 0 && unchanged.modelCalls === 0, "哈希没变不调用模型");
  assert(unchanged.rows.some((row) => row.ticketId === "ready"), "未变化的行留在结果里");

  const extracted = ticket({ id: "tianhe", confidence: 92 });
  const missing = shouldStartStage04({
    tickets: [extracted],
    stored: [],
    justFinishedExtractCanonical: false,
  });
  assert(missing.start && missing.ticketIds.includes("tianhe"), "已经抽完但缺哈希的区仍然嵌入");

  const matched = shouldStartStage04({
    tickets: [ready],
    stored,
  });
  assert(!matched.start && matched.reason === "hashes-match", "哈希已经对齐则不启动");

  const heartbeat = shouldStartStage04({
    tickets: [extracted],
    stored: [],
    heartbeatHealthy: true,
    healthyStage: "EMBEDDING",
  });
  const clusteringBeat = shouldStartStage04({
    tickets: [extracted],
    stored: [],
    heartbeatHealthy: true,
    healthyStage: "CLUSTERING",
  });
  assert(!heartbeat.start && heartbeat.reason === "healthy-heartbeat", "健康的 EMBEDDING 心跳不启动");
  assert(!clusteringBeat.start, "健康的 CLUSTERING 心跳不启动");
  assert(
    isJobHeartbeatHealthy({ stage: "EMBEDDING", lastBeatMs: 1_000, nowMs: 10_000 }),
    "30 秒内的 EMBEDDING 心跳算健康"
  );
  assert(
    !isJobHeartbeatHealthy({ stage: "EXTRACTING", lastBeatMs: 9_000, nowMs: 10_000 }),
    "抽取阶段的心跳不挡住嵌入"
  );

  const other = ticket({ id: "other", canonicalLocation: "容桂街道东湖学府" });
  const only = selectEmbedTicketIds({
    tickets: [extracted, other],
    stored: [],
    onlyTicketId: "other",
  });
  assert(only.length === 1 && only[0] === "other", "新来的一条只选自己");
  const single = shouldStartStage04({
    tickets: [extracted, other],
    stored: [],
    onlyTicketId: "other",
  });
  assert(single.start && single.ticketIds.join(",") === "other", "单条触发的工单列表只有自己");

  const prior: StoredEmbedding[] = [
    { ticketId: "kept", productHash: "abc", model: "BAAI/bge-m3", vector: [1] },
  ];
  const outage = await embedEligibleBatches({
    tickets: [ticket({ id: "new-row" }), ticket({ id: "kept", canonicalLocation: "别处" })],
    stored: prior,
    batchSize: 4,
    embedBatch: async () => {
      throw new Error("all embedding endpoints failed");
    },
  });
  assert(outage.failed, "全部端点宕机时这一轮记失败");
  const kept = outage.rows.find((row) => row.ticketId === "kept");
  assert(kept?.productHash === "abc" && kept.vector?.[0] === 1, "宕机后原先写入的行还在");

  const progressTickets = [0, 1, 2, 3, 4].map((index) => ticket({ id: `p${index}`, canonicalLocation: `地点${index}` }));
  const events: Array<{ completed: number; eligible: number }> = [];
  const batched = await embedEligibleBatches({
    tickets: progressTickets,
    stored: [],
    batchSize: 2,
    embedBatch: async (texts) => texts.map(() => [0.1, 0.2]),
    onProgress: (event) => events.push({ completed: event.completed, eligible: event.eligible }),
  });
  assert(batched.progressEvents === 3 && events.length === 3, "每批一条进度，不是每条工单一条");
  assert(events.every((event) => event.eligible === 5), "进度分母是应嵌工单数");
  const firstFraction = embeddingProgressFraction(events[0].completed, events[0].eligible);
  const secondFraction = embeddingProgressFraction(events[0].completed, events[0].eligible, firstFraction);
  assert(secondFraction >= firstFraction, "同一批行再读一次，进度不会变小");
  assert(embeddingProgressLabel(2, 5) === "嵌入中（2/5）", "嵌入进度文案带已完成和应嵌");

  const finished = shouldStartStage04({
    tickets: [extracted],
    stored: [],
    justFinishedExtractCanonical: true,
  });
  assert(finished.start && finished.reason === "extract-finished", "本轮刚抽完并对齐完会进入嵌入");

  assert(hnswCreateIndexSql(true) === null, "回填写行期间不建 HNSW");
  const indexSql = hnswCreateIndexSql(false) || "";
  assert(indexSql.includes("m = 16") && indexSql.includes("ef_construction = 64"), "HNSW 使用 m=16、ef_construction=64");
  const lookup = neighborLookupSql();
  assert(lookup.includes("hnsw.ef_search = 40") && lookup.includes("LIMIT 20"), "查询 ef_search=40，取 20 个近邻");
  assert(lookup.includes("source_category") && lookup.includes("subdistrict"), "近邻先按分类和镇街过滤");
  const ranked = rankNeighborIndexes(
    [
      { category: "城市管理", township: "大良街道", vector: [1, 0] },
      { category: "交通出行", township: "大良街道", vector: [1, 0] },
      { category: "城市管理", township: "容桂街道", vector: [1, 0] },
      { category: "城市管理", township: "大良街道", vector: [0.9, 0.1] },
    ],
    20
  );
  assert(
    ranked.length === 1 && ranked[0][0] === 0 && ranked[0][1] === 3,
    "近邻只留同分类同镇街"
  );

  const clock = memberLastAt("250101000770102-01", null, new Date("2026-10-09T00:00:00Z"));
  assert(clock.toISOString() === "2024-12-31T16:00:00.000Z", "挂接时间用工单编号上的日期，不用当前时间");

  const same = [1, 0];
  const orthogonal = [0, 1];
  const link = (input: {
    title: string;
    content: string;
    township: string;
    category: string;
    vector: number[];
  }): IncidentLinkCandidate => {
    const profile = profileTicket(
      { title: input.title, content: input.content, subdistrict: input.township },
      SHUNDE_TOWNSHIPS
    );
    return {
      profile,
      category: input.category,
      township: input.township,
      placeEvidence: `${profile.place || ""}\n${input.content}`,
      subject: profile.subject || "",
      vector: input.vector,
    };
  };
  const doorGroups = clusterFromStoredNeighbors(
    [
      link({
        title: "商业噪音",
        content: "容桂街道文武路18号酒吧夜间扰民。",
        township: "容桂街道",
        category: "生态环境",
        vector: same,
      }),
      link({
        title: "商业噪音",
        content: "容桂街道文武路20号酒吧夜间扰民。",
        township: "容桂街道",
        category: "生态环境",
        vector: same,
      }),
    ],
    (item) => item,
    [[0, 1]]
  );
  assert(doorGroups.length === 0, "文武路不同门牌即使被近邻召回也不并");
  const waterGroups = clusterFromStoredNeighbors(
    [
      link({
        title: "停水",
        content: "大良街道金榜上街45号停水爆管。",
        township: "大良街道",
        category: "城市管理",
        vector: same,
      }),
      link({
        title: "停水",
        content: "大良街道金榜上街全线停水。",
        township: "大良街道",
        category: "城市管理",
        vector: orthogonal,
      }),
    ],
    (item) => item,
    []
  );
  assert(waterGroups.length === 1 && waterGroups[0].length === 2, "金榜上街规则对不在近邻窗口里也并成主题");

  const weightSum = Object.values(PIPELINE_STAGE_WEIGHTS).reduce((sum, weight) => sum + weight, 0);
  assert(
    weightSum === 100 &&
      PIPELINE_STAGE_WEIGHTS.S2 === 88 &&
      PIPELINE_STAGE_WEIGHTS.EMBED === 2 &&
      PIPELINE_STAGE_WEIGHTS.CLUSTER === 3 &&
      PIPELINE_STAGE_WEIGHTS.S2 > PIPELINE_STAGE_WEIGHTS.EMBED,
    "System 2 仍是最重的一段，总和仍是 100"
  );
  assert(
    stagePercent("S2", 0, 1, "min") === 2 && stagePercent("EMBED", 0, 1, "min") === 90,
    "嵌入进度排在抽取之后"
  );

  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
