import { extractSpatialCore, isSameSpatialEntity } from "./node/canonical-node";
import { CATEGORY, matchTownshipName, type StandardCategoryName, type TownshipInfo } from "@/lib/vocabulary";

/**
 * 从工单标题和正文里读出「这是哪一类事、发生在哪、找谁」。
 * 聚类只合并同一类事且地点或主体对得上的工单，不把同一标题的无关诉求捏成一团。
 */

export const ISSUE_FAMILY = {
  FIREWORKS: "FIREWORKS",
  FIRE_HAZARD: "FIRE_HAZARD",
  INDUSTRIAL_EXHAUST: "INDUSTRIAL_EXHAUST",
  COOKING_FUME: "COOKING_FUME",
  WATER_FAILURE: "WATER_FAILURE",
  WAGE_ARREARS: "WAGE_ARREARS",
  SOCIAL_INSURANCE: "SOCIAL_INSURANCE",
  CONSUMER_DISPUTE: "CONSUMER_DISPUTE",
  STREET_VENDING: "STREET_VENDING",
  WASTE_COLLECTION: "WASTE_COLLECTION",
  CONSTRUCTION_NOISE: "CONSTRUCTION_NOISE",
  COMMERCIAL_NOISE: "COMMERCIAL_NOISE",
  LIVING_NOISE: "LIVING_NOISE",
  MUNICIPAL_FACILITY: "MUNICIPAL_FACILITY",
  PROPERTY_DISPUTE: "PROPERTY_DISPUTE",
  PUBLIC_ORDER: "PUBLIC_ORDER",
  TRAFFIC_FACILITY: "TRAFFIC_FACILITY",
} as const;

export type IssueFamily = (typeof ISSUE_FAMILY)[keyof typeof ISSUE_FAMILY];

const FAMILY_LABEL: Record<IssueFamily, string> = {
  FIREWORKS: "烟花燃放",
  FIRE_HAZARD: "消防隐患",
  INDUSTRIAL_EXHAUST: "工业废气",
  COOKING_FUME: "油烟扰民",
  WATER_FAILURE: "供水故障",
  WAGE_ARREARS: "拖欠工资",
  SOCIAL_INSURANCE: "社保就业",
  CONSUMER_DISPUTE: "消费纠纷",
  STREET_VENDING: "占道经营",
  WASTE_COLLECTION: "垃圾清运",
  CONSTRUCTION_NOISE: "施工噪音",
  COMMERCIAL_NOISE: "商业噪音",
  LIVING_NOISE: "生活噪音",
  MUNICIPAL_FACILITY: "市政设施",
  PROPERTY_DISPUTE: "物业纠纷",
  PUBLIC_ORDER: "治安求助",
  TRAFFIC_FACILITY: "交通设施",
};

/** 认不出的值原样返回，库里已有的中文事件名还能显示。 */
export function familyLabel(family?: string | null): string {
  if (!family) return "";
  return FAMILY_LABEL[family as IssueFamily] || family;
}

const ISSUE_RULES: Array<{ family: IssueFamily; category: StandardCategoryName; test: RegExp }> = [
  { family: ISSUE_FAMILY.FIREWORKS, category: CATEGORY.PUBLIC_SAFETY, test: /烟花|爆竹/ },
  { family: ISSUE_FAMILY.FIRE_HAZARD, category: CATEGORY.PUBLIC_SAFETY, test: /消防隐患|消防通道|灭火器|消防出口|消防不合规/ },
  { family: ISSUE_FAMILY.INDUSTRIAL_EXHAUST, category: CATEGORY.ENVIRONMENT, test: /废气|塑胶味|恶臭|臭气/ },
  { family: ISSUE_FAMILY.COOKING_FUME, category: CATEGORY.ENVIRONMENT, test: /油烟/ },
  { family: ISSUE_FAMILY.WATER_FAILURE, category: CATEGORY.URBAN_MANAGEMENT, test: /停水|爆管|漏水|供水管|自来水/ },
  { family: ISSUE_FAMILY.WAGE_ARREARS, category: CATEGORY.LABOR, test: /拖欠工资|欠薪|克扣工资|工资未发|拖欠、克扣工资|劳资/ },
  { family: ISSUE_FAMILY.SOCIAL_INSURANCE, category: CATEGORY.LABOR, test: /失业|社保|医保|工伤|养老保险/ },
  { family: ISSUE_FAMILY.CONSUMER_DISPUTE, category: CATEGORY.MARKET_REGULATION, test: /网购|消费纠纷|退款|欺诈/ },
  { family: ISSUE_FAMILY.STREET_VENDING, category: CATEGORY.URBAN_MANAGEMENT, test: /占道|游商|流动摊贩|乱摆卖|小贩/ },
  { family: ISSUE_FAMILY.WASTE_COLLECTION, category: CATEGORY.URBAN_MANAGEMENT, test: /垃圾/ },
  { family: ISSUE_FAMILY.CONSTRUCTION_NOISE, category: CATEGORY.ENVIRONMENT, test: /施工噪|装修噪|施工噪声|装修噪声/ },
  { family: ISSUE_FAMILY.COMMERCIAL_NOISE, category: CATEGORY.ENVIRONMENT, test: /商业噪音|商业经营噪|酒吧|清吧|KTV|ktv/ },
  { family: ISSUE_FAMILY.LIVING_NOISE, category: CATEGORY.ENVIRONMENT, test: /生活噪音|社会生活噪|噪音|噪声|扰民/ },
  { family: ISSUE_FAMILY.MUNICIPAL_FACILITY, category: CATEGORY.URBAN_MANAGEMENT, test: /下水道|路灯|井盖|道路破损|坑洼/ },
  { family: ISSUE_FAMILY.PROPERTY_DISPUTE, category: CATEGORY.SOCIAL_GOVERNANCE, test: /物业/ },
  { family: ISSUE_FAMILY.PUBLIC_ORDER, category: CATEGORY.SOCIAL_GOVERNANCE, test: /家庭纠纷|公安|打架|偷窃/ },
  { family: ISSUE_FAMILY.TRAFFIC_FACILITY, category: CATEGORY.TRANSPORT, test: /信号灯|红绿灯|违停|堵塞道路/ },
];

const GENERIC_SUBJECT =
  /^(商家|商铺|店铺|店主|工厂|单位|公司|市民|业主|物业|部门|施工方|餐馆|大排档|小贩|摊贩|无名工厂|不知名|车辆|司机|涉事方|咨询市民|催办诉求人|相关主体)$/;

const SUBJECT_PATTERNS = [
  /单位名称[:：]\s*([^，,。；;\n]{2,40})/,
  /(?:店名|招牌|名称)[:：]\s*([^，,。；;\n（(]{2,30})/,
  /招牌叫[“"「]([^”"」]{1,24})/,
  /([\u4e00-\u9fffA-Za-z0-9·]{2,28}(?:有限公司|公司))/,
  /项目名称[:：]\s*([^，,。；;\n]{2,40})/,
  /([\u4e00-\u9fff0-9·]{2,24}(?:酒馆|民宿|烧烤|清吧))/,
];

const PLACE_PATTERN =
  /([\u4e00-\u9fff]{2,12}(?:大道|路|巷|街(?!道)|小区|花园|苑|轩|村(?!委)|社区|工业区|美食城|市场))(\d+(?:、\d+)*号)?/;

export interface IncidentProfile {
  family: IssueFamily | null;
  category: StandardCategoryName | null;
  township: string | null;
  subject: string | null;
  place: string | null;
  fingerprint: string;
  urgent: boolean;
}

export function cleanIssueTitle(title?: string | null): string {
  return (title || "")
    .replace(/（[^）]*）/g, "")
    .replace(/【[^】]*】/g, "")
    .replace(/\[[^\]]*\]/g, "")
    .replace(/\s+/g, "")
    .trim();
}

export function profileTicket(
  input: { title?: string | null; content?: string | null; subdistrict?: string | null },
  townships: TownshipInfo[] = []
): IncidentProfile {
  const title = input.title || "";
  const content = input.content || "";
  const issue = classifyIssue(title, content);
  const text = `${title}\n${content}`;
  const township =
    (input.subdistrict && matchTownshipName(input.subdistrict, townships)) ||
    matchTownshipName(text, townships);
  return {
    family: issue?.family ?? null,
    category: issue?.category ?? null,
    township,
    subject: extractSubject(text),
    place: extractPlace(text),
    fingerprint: fingerprintOf(content),
    urgent: /（急）|紧急/.test(title),
  };
}

export function incidentsMatch(a: IncidentProfile, b: IncidentProfile): boolean {
  if (a.fingerprint && a.fingerprint === b.fingerprint && (!a.family || !b.family || a.family === b.family)) {
    return true;
  }
  if (!a.family || a.family !== b.family) return false;
  if (a.township && b.township && a.township !== b.township) return false;
  if (a.subject && b.subject && sameSubject(a.subject, b.subject)) return true;
  if (placesMatch(a, b)) return true;
  return false;
}

const STREET_FAMILIES = new Set<IssueFamily>([
  ISSUE_FAMILY.WATER_FAILURE,
  ISSUE_FAMILY.MUNICIPAL_FACILITY,
  ISSUE_FAMILY.TRAFFIC_FACILITY,
  ISSUE_FAMILY.WASTE_COLLECTION,
]);
const COMPOUND_SITE = /小区|花园|苑|轩|村|社区|工业区|美食城/;
const DOOR_NUMBER = /\d+(?:、\d+)*号/;

/** 噪音、欠薪按门牌或店名区分；供水、市政、交通、垃圾清运才是整段路的同一件事。 */
function placesMatch(a: IncidentProfile, b: IncidentProfile): boolean {
  if (!a.place || !b.place || !isSameSpatialEntity(a.place, b.place)) return false;
  if (a.family && STREET_FAMILIES.has(a.family)) return true;
  const numberA = a.place.match(DOOR_NUMBER)?.[0];
  const numberB = b.place.match(DOOR_NUMBER)?.[0];
  if (numberA && numberB) return numberA === numberB;
  if (numberA || numberB) return false;
  if (!COMPOUND_SITE.test(a.place) || !COMPOUND_SITE.test(b.place)) return false;
  const coreA = extractSpatialCore(a.place);
  const coreB = extractSpatialCore(b.place);
  return Boolean(coreA && coreA === coreB);
}

export interface IncidentGroup<T> {
  family: IssueFamily | null;
  category: StandardCategoryName | null;
  township: string | null;
  anchor: string;
  place: string | null;
  members: T[];
}

export function clusterIncidents<T>(
  items: T[],
  read: (item: T) => IncidentProfile
): IncidentGroup<T>[] {
  const profiles = items.map(read);
  const parent = items.map((_, i) => i);

  const find = (i: number): number => {
    let root = i;
    while (parent[root] !== root) root = parent[root];
    let cursor = i;
    while (parent[cursor] !== root) {
      const next = parent[cursor];
      parent[cursor] = root;
      cursor = next;
    }
    return root;
  };
  const link = (i: number, j: number) => {
    const a = find(i);
    const b = find(j);
    if (a !== b) parent[b] = a;
  };

  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      if (incidentsMatch(profiles[i], profiles[j])) link(i, j);
    }
  }

  const buckets = new Map<number, number[]>();
  for (let i = 0; i < items.length; i++) {
    const root = find(i);
    const list = buckets.get(root);
    if (list) list.push(i);
    else buckets.set(root, [i]);
  }

  const groups: IncidentGroup<T>[] = [];
  for (const indexes of buckets.values()) {
    if (indexes.length < 2) continue;
    const members = indexes.map((i) => items[i]);
    const related = indexes.map((i) => profiles[i]);
    const family = majority(related.map((p) => p.family)) as IssueFamily | null;
    const category = (majority(related.map((p) => p.category)) as StandardCategoryName | null) || null;
    const township = majority(related.map((p) => p.township));
    const place = majority(related.map((p) => p.place));
    const anchor = majority(related.map((p) => p.subject)) || place || family || "";
    groups.push({ family, category, township, anchor, place, members });
  }

  groups.sort((a, b) => b.members.length - a.members.length);
  return groups;
}

function classifyIssue(title: string, content: string): { family: IssueFamily; category: StandardCategoryName } | null {
  // 标题括号里常常就是事件类型，例如（烟花爆竹）燃放噪音。先看完整标题，再看正文。
  const heading = title || "";
  for (const rule of ISSUE_RULES) {
    if (rule.test.test(heading)) return rule;
  }
  const body = content.slice(0, 500);
  for (const rule of ISSUE_RULES) {
    if (rule.test.test(body)) return rule;
  }
  return null;
}

function extractSubject(text: string): string | null {
  for (const pattern of SUBJECT_PATTERNS) {
    const match = text.match(pattern);
    const accepted = match?.[1] ? acceptSubject(match[1]) : null;
    if (accepted) return accepted;
  }
  return null;
}

function acceptSubject(raw: string): string | null {
  const flattened = raw.replace(/\s+/g, "").replace(/[（(].*$/, "").replace(/[“”"「」]/g, "");
  const tail = flattened.split(/为|在|于|：|:/).pop() || flattened;
  const company = tail.match(/[\u4e00-\u9fffA-Za-z0-9·]{2,24}(?:有限公司|公司)/);
  const name = (company ? company[0] : tail).split("、")[0].replace(/[）)]+$/, "");
  if (name.length < 3 || name.length > 40) return null;
  if (GENERIC_SUBJECT.test(name)) return null;
  if (/无法|不清楚|不详|某某|不知名|无名|\d{4}年/.test(name)) return null;
  return name;
}

function extractPlace(text: string): string | null {
  const source = text
    .replace(/广东省|佛山市|广州市|顺德区|天河区/g, "")
    .replace(/[\u4e00-\u9fff]{1,8}(?:街道|镇)/g, "");
  const global = new RegExp(PLACE_PATTERN.source, "g");
  let best: string | null = null;
  let bestScore = -1;
  let match: RegExpExecArray | null;
  while ((match = global.exec(source))) {
    const place = tightenPlace(`${match[1]}${match[2] || ""}`);
    if (!place) continue;
    const score = placeScore(place);
    if (score > bestScore) {
      best = place;
      bestScore = score;
    }
  }
  return best;
}

/** 地点正则会吞进「市民来电反映」「日在」这类叙述，只留下后缀上的路名或小区。 */
function tightenPlace(raw: string): string | null {
  const tail = raw.split(/反映|位于|地址|来电|致电|投诉|表示|在|于|对|的|把|被/).pop() || raw;
  const place = tail.replace(/^\d{1,2}日/, "").replace(/^(?:表示|的|了|是|为|到)+/, "");
  if (place.length < 3 || place.length > 24) return null;
  if (/(街道|镇)$/.test(place)) return null;
  if (/市民|反映|来电|致电|投诉|问题/.test(place)) return null;
  if (!PLACE_PATTERN.test(place)) return null;
  return place;
}

function placeScore(place: string): number {
  let score = 0;
  if (/\d+号$/.test(place)) score += 5;
  if (/小区|花园|苑|社区|工业区|美食城/.test(place)) score += 3;
  if (/村|街|路|巷|大道|市场/.test(place)) score += 2;
  if (place.length > 16) score -= 2;
  return score;
}

function fingerprintOf(content: string): string {
  let text = content.replace(/\*+/g, "").replace(/\s+/g, "");
  text = text.replace(/\d{4}[-年/.]\d{1,2}[-月/.]\d{1,2}日?\d{0,2}[:：]?\d{0,2}[:：]?\d{0,2}/g, "");
  text = text.replace(/^市民诉求[:：]诉求渠道[:：]其它/, "");
  text = text.replace(/^(市民致电反映|市民来电反映|市民反映|诉求人反映|具体情况描述[:：])/, "");
  if (text.length < 36) return "";
  return text.slice(0, 48);
}

function sameSubject(a: string, b: string): boolean {
  if (a === b) return true;
  const short = a.length <= b.length ? a : b;
  const long = a.length <= b.length ? b : a;
  return short.length >= 4 && long.includes(short);
}

function majority(values: Array<string | null>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    if (!value) continue;
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [value, count] of counts) {
    if (count > n) {
      best = value;
      n = count;
    }
  }
  return best;
}
