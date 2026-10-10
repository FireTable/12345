/**
 * 已落库的抽取不再整表扫镇街和别名。归并让出事件循环后，并案结果与同步版本一致。
 */
import { canonicalNode } from "../backend/node/canonical-node";
import { extractNode } from "../backend/node/extract-node";
import { everyTicketStored, storedTicketToEnriched } from "../backend/node/stored-ticket";
import {
  clusterFromStoredNeighbors,
  clusterFromStoredNeighborsYielding,
} from "../backend/embed-neighbors";
import type { IncidentLinkCandidate } from "../backend/same-incident-cluster";
import type { EnrichedTicket, RawTicket, TicketRadarState } from "../backend/state";
import { profileTicket } from "../backend/ticket-profile";
import { SHUNDE_TOWNSHIPS } from "../lib/vocabulary";
import { sql } from "../db/client";
import { mapInChunks } from "../lib/yield-loop";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function raw(id: string, extra: Partial<RawTicket> = {}): RawTicket {
  return {
    id,
    ticketNo: "250101000770102-01",
    title: "噪音",
    summarizeTitle: "夜间噪音",
    createTime: "2025-01-01 08:00:00",
    citizenName: "热线市民",
    citizenPhone: "",
    content: "正文里写了大良街道金榜上街，不要据此填镇街",
    channel: "市民服务热线",
    status: "PENDING",
    confidence: 86,
    canonicalSubject: "某酒吧",
    eventType: "噪音扰民",
    address: "容桂街道文武路18号",
    subdistrict: "",
    sourceCategory: "生态环境",
    ...extra,
  };
}

const stored = storedTicketToEnriched(raw("t1"));
assert(everyTicketStored([raw("t1"), raw("t2")]), "置信度、摘要、事件类型都在，就算抽取完成");
assert(!stored.subdistrict, "空镇街保持空，不从正文扫镇街");
assert(stored.canonicalSubject === "某酒吧", "已落库主体原样保留");
assert(
  !everyTicketStored([raw("t3", { summarizeTitle: "", eventType: "", confidence: 0 })]),
  "没有摘要、事件类型和置信度的工单仍要抽"
);

const resumed = await extractNode({
  rawTickets: [raw("t1"), raw("t2", { id: "t2" })],
  status: "idle",
} as TicketRadarState);
assert(resumed.extractionFresh === false, "全部已落库时抽取节点标记为不用再对齐");
assert(resumed.enrichedTickets?.length === 2, "已落库工单仍进入后续工序");
assert(!resumed.enrichedTickets?.[0].subdistrict, "抽取节点不再把正文里的镇街写回去");

function asEnriched(id: string, subject: string): EnrichedTicket {
  return {
    ...storedTicketToEnriched(raw(id, { canonicalSubject: subject })),
    canonicalSubject: subject,
  };
}

const skipped = await canonicalNode({
  enrichedTickets: [asEnriched("a", "金榜烧烤店"), asEnriched("b", "金榜烧烤店分店")],
  extractionFresh: false,
  status: "extracting",
} as TicketRadarState);
assert(skipped.enrichedTickets?.[0].canonicalSubject === "金榜烧烤店", "已落库不再把主体并到更长的店名");
assert(skipped.enrichedTickets?.[1].canonicalSubject === "金榜烧烤店分店", "已落库的另一条主体保持原样");

const aligned = await canonicalNode({
  enrichedTickets: [asEnriched("a", "金榜烧烤店"), asEnriched("b", "金榜烧烤店分店")],
  extractionFresh: true,
  status: "extracting",
} as TicketRadarState);
assert(
  aligned.enrichedTickets?.[0].canonicalSubject === "金榜烧烤店分店" &&
    aligned.enrichedTickets?.[1].canonicalSubject === "金榜烧烤店分店",
  "新抽取仍把同一家店并到更长的名称"
);

function link(input: {
  id: string;
  title: string;
  content: string;
  township: string;
  category: string;
  vector: number[];
}): IncidentLinkCandidate & { id: string } {
  const profile = profileTicket(
    { title: input.title, content: input.content, subdistrict: input.township },
    SHUNDE_TOWNSHIPS
  );
  return {
    id: input.id,
    profile,
    category: input.category,
    township: input.township,
    placeEvidence: `${profile.place || ""}\n${input.content}`,
    subject: profile.subject || "",
    vector: input.vector,
  };
}

const same = [1, 0];
const orthogonal = [0, 1];
const sample = [
  link({
    id: "door-18",
    title: "商业噪音",
    content: "容桂街道文武路18号酒吧夜间扰民。",
    township: "容桂街道",
    category: "生态环境",
    vector: same,
  }),
  link({
    id: "door-20",
    title: "商业噪音",
    content: "容桂街道文武路20号酒吧夜间扰民。",
    township: "容桂街道",
    category: "生态环境",
    vector: same,
  }),
  link({
    id: "water-45",
    title: "停水",
    content: "大良街道金榜上街45号停水爆管。",
    township: "大良街道",
    category: "城市管理",
    vector: same,
  }),
  link({
    id: "water-line",
    title: "停水",
    content: "大良街道金榜上街全线停水。",
    township: "大良街道",
    category: "城市管理",
    vector: orthogonal,
  }),
];

function membership(groups: Array<Array<{ id: string }>>): string {
  return groups
    .map((group) => group.map((item) => item.id).sort().join(","))
    .sort()
    .join("|");
}

const syncGroups = clusterFromStoredNeighbors(sample, (item) => item, [[0, 1]]);
const asyncGroups = await clusterFromStoredNeighborsYielding(sample, (item) => item, [[0, 1]], 1);
assert(
  membership(syncGroups) === membership(asyncGroups),
  "分批让出的归并和全表同步归并是同一批工单"
);
assert(membership(asyncGroups) === "water-45,water-line", "不同门牌不并，同街停水即使不在近邻里也并");

let interleaved = false;
setImmediate(() => {
  interleaved = true;
});
await mapInChunks(
  Array.from({ length: 400 }, (_, index) => index),
  (value) => value,
  50
);
assert(interleaved, "分批整理会让出事件循环");

await sql.end({ timeout: 1 });
process.exit(process.exitCode ?? 0);
