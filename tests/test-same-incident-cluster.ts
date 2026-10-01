/**
 * 聚类决定不请求模型：同一件事或同一个具体地点才并，相似但不同地点的不并。
 */
import { incidentsMatch, profileTicket } from "../backend/ticket-profile";
import {
  chooseThemeAnchor,
  clusterLinked,
  shouldLinkIncidents,
  type IncidentLinkCandidate,
} from "../backend/same-incident-cluster";
import { SHUNDE_TOWNSHIPS } from "../lib/vocabulary";

const SAME = [1, 0];
const OTHER = [0, 1];

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function candidate(input: {
  title: string;
  content: string;
  township: string;
  category: string;
  vector: number[];
  subject?: string;
  placeEvidence?: string;
}): IncidentLinkCandidate {
  const profile = profileTicket(
    { title: input.title, content: input.content, subdistrict: input.township },
    SHUNDE_TOWNSHIPS
  );
  return {
    profile,
    category: input.category,
    township: input.township,
    placeEvidence: input.placeEvidence ?? `${profile.place || ""}\n${input.content}`,
    subject: input.subject ?? profile.subject ?? "",
    vector: input.vector,
  };
}

const donghuA = candidate({
  title: "来电",
  content: "容桂街道新有中东湖学府二期，另一位市民再次来电，说的是同一处楼盘。",
  township: "容桂街道",
  category: "城市管理",
  vector: SAME,
  subject: "市民",
});
const donghuB = candidate({
  title: "来电",
  content: "容桂街道东湖学府二期，情况与此前相同。",
  township: "容桂街道",
  category: "城市管理",
  vector: SAME,
  subject: "市民",
});
const donghuC = candidate({
  title: "来电",
  content: "容桂街道容里居委会东湖学府二期，仍是这一处。",
  township: "容桂街道",
  category: "城市管理",
  vector: SAME,
  subject: "市民",
});

assert(incidentsMatch(donghuA.profile, donghuB.profile) === false, "东湖学府两种写法规则本身并不");
assert(shouldLinkIncidents(donghuA, donghuB) && shouldLinkIncidents(donghuB, donghuC), "东湖学府同一地点靠向量和地名并");

const grouped = clusterLinked(
  [
    { id: "a", evidence: donghuA.placeEvidence },
    { id: "b", evidence: donghuB.placeEvidence },
    { id: "c", evidence: donghuC.placeEvidence },
  ],
  (item) => (item.id === "a" ? donghuA : item.id === "b" ? donghuB : donghuC)
);
assert(grouped.length === 1 && grouped[0].length === 3, `东湖学府三个写法是一组，实际 ${grouped.map((g) => g.length).join(",")}`);
const anchor = chooseThemeAnchor({
  subjects: ["市民", "市民", "市民"],
  placeEvidence: [donghuA.placeEvidence, donghuB.placeEvidence, donghuC.placeEvidence],
  eventType: "施工扰民",
});
assert(anchor.includes("东湖学府") && anchor !== "市民", `主题名用地点而不是市民：${anchor}`);

const foodCourt = candidate({
  title: "燃放烟花",
  content: "龙江镇万象美食城附近空地夜间燃放烟花。",
  township: "龙江镇",
  category: "公共安全",
  vector: SAME,
});
const gasStation = candidate({
  title: "燃放烟花",
  content: "加油站附近夜间非法燃放烟花。",
  township: "龙江镇",
  category: "公共安全",
  vector: SAME,
});
assert(shouldLinkIncidents(foodCourt, gasStation) === false, "万象美食城和加油站的烟花不并");

const wagePark = candidate({
  title: "拖欠工资",
  content: "市民致电反映其于10月1日至10月4日到乐从镇映翠南路南区公园工作，是对木桥木板修复处理，剩余工资500元至今未发放。",
  township: "乐从镇",
  category: "劳动社保",
  vector: SAME,
});
const wageShop = candidate({
  title: "拖欠工资问题",
  content: "市民反映单位（名称：鑫名美容服务中心，地址：顺德区乐从镇乐从社区映翠南路中嘉花园7座107铺）存在拖欠工资问题。",
  township: "乐从镇",
  category: "劳动社保",
  vector: SAME,
});
assert(shouldLinkIncidents(wagePark, wageShop) === false, "映翠南路两家欠薪不并");

const bar18 = candidate({
  title: "商业噪音",
  content: "容桂街道文武路18号酒吧夜间扰民。",
  township: "容桂街道",
  category: "生态环境",
  vector: SAME,
});
const bar20 = candidate({
  title: "商业噪音",
  content: "容桂街道文武路20号酒吧夜间扰民。",
  township: "容桂街道",
  category: "生态环境",
  vector: SAME,
});
assert(shouldLinkIncidents(bar18, bar20) === false, "文武路18号和20号不并");

const waterDoor = candidate({
  title: "停水",
  content: "大良街道金榜上街45号停水爆管。",
  township: "大良街道",
  category: "城市管理",
  vector: SAME,
});
const waterRoad = candidate({
  title: "停水",
  content: "大良街道金榜上街全线停水。",
  township: "大良街道",
  category: "城市管理",
  vector: OTHER,
});
assert(shouldLinkIncidents(waterDoor, waterRoad), "金榜上街停水按同一件事并，不靠向量");

const vagueA = candidate({
  title: "施工噪音",
  content: "施工噪音扰民。",
  township: "容桂街道",
  category: "生态环境",
  vector: SAME,
  placeEvidence: "施工噪音扰民",
  subject: "市民",
});
const vagueB = candidate({
  title: "施工噪音",
  content: "又有施工噪音扰民。",
  township: "容桂街道",
  category: "生态环境",
  vector: SAME,
  placeEvidence: "施工噪音扰民",
  subject: "市民",
});
assert(shouldLinkIncidents(vagueA, vagueB) === false, "没有具体地点的施工噪音不并");

const noTown = { ...donghuA, township: "" };
const noTownOther = { ...donghuB, township: "" };
assert(incidentsMatch(noTown.profile, noTownOther.profile) === false, "空镇街的东湖规则并不");
assert(shouldLinkIncidents(noTown, noTownOther) === false, "空镇街不能靠向量并");

if (!process.exitCode) console.log("same-incident cluster checks passed");
