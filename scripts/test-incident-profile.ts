/**
 * 同一事件画像：类别认标题里的事件类型，聚类不按整条路合并噪音和欠薪。
 */
import { ISSUE_FAMILY, clusterIncidents, incidentsMatch, profileTicket } from "../backend/ticket-profile";
import { CATEGORY, SHUNDE_TOWNSHIPS } from "../lib/vocabulary";

const towns = SHUNDE_TOWNSHIPS;

function profile(title: string, content: string, subdistrict?: string) {
  return profileTicket({ title, content, subdistrict }, towns);
}

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`✗ ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`✓ ${message}`);
  }
}

const fireworks = profile(
  "（烟花爆竹）燃放噪音",
  "沿着东平河每年跨年夜放烟花、爆竹，凌晨燃放烟花的噪音严重扰民。"
);
assert(
  fireworks.family === ISSUE_FAMILY.FIREWORKS && fireworks.category === CATEGORY.PUBLIC_SAFETY,
  "烟花燃放归公共安全，不因「噪音」落进生态环境"
);

const blank = profile("咨询办事进度", "市民来电询问上次反映的事项办到哪一步了。");
assert(blank.family === null && blank.category === null, "对不上事件家族的工单类别留空");

const wagePark = profile(
  "拖欠工资",
  "市民致电反映其于10月1日至10月4日到乐从镇映翠南路南区公园工作，是对木桥木板修复处理，剩余工资500元至今未发放。",
  "乐从镇"
);
const wageShop = profile(
  "拖欠工资问题",
  "市民反映单位（名称：鑫名美容服务中心，地址：顺德区乐从镇乐从社区映翠南路中嘉花园7座107铺）存在拖欠工资问题。",
  "乐从镇"
);
assert(incidentsMatch(wagePark, wageShop) === false && incidentsMatch(wageShop, wagePark) === false, "同一条路上的两家欠薪不并");

const noiseSite = profile(
  "（城管）施工噪音",
  "市民反映于2025年1月1日8:26分在顺德区容桂街道新有中路的东湖学府二期楼盘工地正在施工。",
  "容桂街道"
);
const noiseDoor = profile(
  "（城管）建筑施工噪声",
  "市民来电表示广东省佛山市顺德区容里社区新有中路66、68号的工地正在施工，施工噪声非常扰民。",
  "容桂街道"
);
assert(incidentsMatch(noiseSite, noiseDoor) === false && incidentsMatch(noiseDoor, noiseSite) === false, "同一条路上的两个施工点不并");
assert(noiseDoor.place?.includes("66、68号"), `施工门牌被保留：${noiseDoor.place}`);

const shortRoad = profile("（城管）噪音扰民", "市民反映位于顺德区东康路的樱花锁业旁边商铺在装修。");
assert(shortRoad.place === "东康路", `二字路名保留：${shortRoad.place}`);

const waterDoor = profile("停水", "大良街道金榜上街45号停水爆管。", "大良街道");
const waterRoad = profile("停水", "大良街道金榜上街全线停水。", "大良街道");
assert(incidentsMatch(waterDoor, waterRoad) && incidentsMatch(waterRoad, waterDoor), "供水故障按整段路并");

const bar18 = profile("商业噪音", "容桂街道文武路18号酒吧夜间扰民。", "容桂街道");
const bar20 = profile("商业噪音", "容桂街道文武路20号酒吧夜间扰民。", "容桂街道");
assert(!incidentsMatch(bar18, bar20) && !incidentsMatch(bar20, bar18), "相邻门牌的商业噪音不并");

const company = profile(
  "（重办）大气污染问题",
  "市民来电反映小区周边很多塑料厂（其中一家的单位名称：广东圆融新材料有限公司）排污，味道很臭。",
  "北滘镇"
);
assert(company.subject === "广东圆融新材料有限公司", `公司名去掉尾巴：${company.subject}`);

const yuanrong = [
  ["250101013479902-01", "（重办）塑胶废气", "市民来电反映北滘马龙村工厂排放塑胶废气。涉事主体名称：广东圆融新材料有限公司、衍源塑胶厂。地址在龙涌工业区。"],
  ["250101013819902-01", "（重办）塑胶废气", "市民来电反映北滘马龙村工厂排放塑胶废气。涉事主体名称：广东圆融新材料有限公司、衍源塑胶厂。地址在龙涌工业区。"],
  ["250101014549902-01", "（重办）大气污染", "污染源：广东圆融新材料有限公司排放废气。事发地址：佛山市顺德区北滘镇马龙大道清越花园。"],
  ["250101014739902-01", "（重办）大气污染问题", "市民来电反映北滘镇马龙村周边很多塑料厂（其中一家的单位名称：广东圆融新材料有限公司）排放废气，味道很臭。"],
].map(([ticketNo, title, content]) => ({ ticketNo, title, content, subdistrict: "北滘镇" }));

const groups = clusterIncidents(yuanrong, (row) => profile(row.title, row.content, row.subdistrict));
assert(groups.length === 1 && groups[0].members.length === 4, "四张圆融废气工单并成一个主题");

if (process.exitCode) {
  console.error("\n画像检查未通过");
  process.exit(process.exitCode);
}
console.log("\n画像检查通过");
