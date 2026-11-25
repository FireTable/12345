import assert from "node:assert/strict";
import {
  classifyConfidence,
  HIGH_CONFIDENCE_THRESHOLD,
  LOW_CONFIDENCE_THRESHOLD,
} from "../lib/confidence";
import { isGenericOrPlaceholderSubject } from "../backend/rules";
import {
  incidentsMatch,
  ISSUE_FAMILY,
  profileTicket,
} from "../backend/ticket-profile";
import {
  categoriesCompatible,
  clusterLinked,
  shouldLinkIncidents,
  type IncidentLinkCandidate,
} from "../backend/same-incident-cluster";
import {
  clusterFromStoredNeighbors,
  clusterFromStoredNeighborsYielding,
} from "../backend/embed-neighbors";
import { validateSingleTheme } from "../backend/node/cluster-validator";
import {
  fallbackDynamicExtraction,
  LOW_CONFIDENCE_THRESHOLD as EXTRACT_LOW_THRESHOLD,
  sanitizeExtraction,
} from "../backend/node/extract-node";
import type { EnrichedTicket, MultiFrequencyTheme } from "../backend/state";
import type { TownshipInfo } from "../lib/vocabulary";

const TIANHE_TOWNSHIPS: TownshipInfo[] = [
  {
    name: "石牌",
    fullName: "石牌街道",
    aliases: ["石牌", "石牌街"],
    communities: [],
    landmarks: [],
  },
  {
    name: "沙河",
    fullName: "沙河街道",
    aliases: ["沙河", "沙河街"],
    communities: [],
    landmarks: [],
  },
];

function makeCandidate(
  input: {
    title?: string;
    content: string;
    subdistrict?: string;
    category: string;
    subject?: string;
    placeEvidence?: string;
    vector?: number[];
  }
): IncidentLinkCandidate {
  const profile = profileTicket(
    {
      title: input.title || "",
      content: input.content,
      subdistrict: input.subdistrict || "",
    },
    TIANHE_TOWNSHIPS
  );
  return {
    profile,
    category: input.category,
    township: profile.township || input.subdistrict || "",
    placeEvidence: input.placeEvidence || `${input.subdistrict || ""}${input.content}`,
    subject: input.subject ?? profile.subject ?? "",
    vector: input.vector || [1, 0, 0, 0],
  };
}

function makeEnrichedTicket(
  id: string,
  overrides: Partial<EnrichedTicket>
): EnrichedTicket {
  return {
    id,
    ticketNo: `T-${id}`,
    createTime: "2026-11-25 10:00:00",
    citizenName: "测试市民",
    citizenPhone: "13800000000",
    content: "",
    channel: "12345热线",
    status: "PENDING",
    entities: [],
    relations: [],
    themes: [],
    canonicalSubject: "",
    canonicalLocation: "",
    eventType: "",
    confidence: 80,
    ...overrides,
  };
}

function testConfidenceCalibration() {
  assert.equal(LOW_CONFIDENCE_THRESHOLD, 70);
  assert.equal(HIGH_CONFIDENCE_THRESHOLD, 85);
  assert.equal(EXTRACT_LOW_THRESHOLD, 70);

  assert.deepEqual(classifyConfidence(null), {
    level: "calibrated",
    label: "已校准",
    needsHumanReview: false,
  });
  assert.deepEqual(classifyConfidence(undefined), {
    level: "calibrated",
    label: "已校准",
    needsHumanReview: false,
  });
  assert.deepEqual(classifyConfidence(55), {
    level: "low",
    label: "低置信度",
    needsHumanReview: true,
  });
  assert.deepEqual(classifyConfidence(69), {
    level: "low",
    label: "低置信度",
    needsHumanReview: true,
  });
  assert.deepEqual(classifyConfidence(70), {
    level: "medium",
    label: "中置信度",
    needsHumanReview: false,
  });
  assert.deepEqual(classifyConfidence(76), {
    level: "medium",
    label: "中置信度",
    needsHumanReview: false,
  });
  assert.deepEqual(classifyConfidence(85), {
    level: "high",
    label: "高置信度",
    needsHumanReview: false,
  });

  // sanitizeExtraction: placeholder subject cleared, streetlight/micro-location not crushed to 55
  const streetlight = sanitizeExtraction({
    index: 1,
    summarizeTitle: "天河路123号路灯不亮",
    subject: "某单位",
    location: "天河路123号",
    eventType: "路灯不亮",
    category: "城市管理",
    confidence: 88,
  });
  assert.equal(streetlight.subject, "");
  assert.equal(streetlight.confidence, 76);

  const missingMicro = sanitizeExtraction({
    index: 2,
    summarizeTitle: "咨询政策",
    subject: "某建设工程工地",
    location: "天河区",
    eventType: "政策咨询",
    category: "社会治理",
    confidence: 88,
  });
  assert.equal(missingMicro.subject, "");
  assert.equal(missingMicro.confidence, 55);

  // fallbackDynamicExtraction: never emits "涉事方", distinguishes 62 vs 50
  const fallbackWithPlaceAndFamily = fallbackDynamicExtraction({
    id: "fb-1",
    ticketNo: "202611250001",
    title: "路面路灯故障",
    content: "石牌街道天河路123号附近路灯不亮，请尽快维修。",
    subdistrict: "石牌街道",
    createTime: "2026-11-25 09:00:00",
    citizenName: "张三",
    citizenPhone: "13800000001",
    channel: "热线",
    status: "PENDING",
  });
  assert.equal(fallbackWithPlaceAndFamily.subject, "");
  assert.equal(fallbackWithPlaceAndFamily.location, "天河路123号");
  assert.equal(fallbackWithPlaceAndFamily.confidence, 62);
  assert.ok(fallbackWithPlaceAndFamily.confidence < LOW_CONFIDENCE_THRESHOLD);

  const fallbackUnextracted = fallbackDynamicExtraction({
    id: "fb-2",
    ticketNo: "202611250002",
    title: "咨询",
    content: "咨询一下政策办理流程。",
    subdistrict: "石牌街道",
    createTime: "2026-11-25 09:05:00",
    citizenName: "李四",
    citizenPhone: "13800000002",
    channel: "热线",
    status: "PENDING",
  });
  assert.equal(fallbackUnextracted.subject, "");
  assert.equal(fallbackUnextracted.confidence, 50);
  assert.ok(fallbackUnextracted.confidence < LOW_CONFIDENCE_THRESHOLD);
}

function testPlaceholderSubjectRejection() {
  const shouldReject = [
    "某号",
    "某工地",
    "某建设工程工地",
    "某在建地产及市政项目工地",
    "某建筑公司",
    "某公司",
    "某单位",
    "某餐厅",
    "某湘菜馆",
    "某餐饮",
    "某商铺",
    "某项目",
    "某路段",
    "某小区",
    "某号一楼临街重餐饮烧烤湘菜馆",
    "建设工程工地",
    "在建工地",
    "施工工地",
    "工地",
    "项目工地",
    "总承包方",
    "施工方",
    "开发商",
    "临街重餐饮",
    "烧烤湘菜馆",
    "餐饮店",
    "涉事方",
    "责任主体",
    "当事人",
    "市民",
    "车主",
    "商家",
    "物业",
    "物业公司",
  ];
  for (const term of shouldReject) {
    assert.equal(
      isGenericOrPlaceholderSubject(term),
      true,
      `Expected placeholder/generic subject to be rejected: ${term}`
    );
  }

  const shouldAccept = [
    "中建三局华南国际港项目部",
    "万科物业",
    "保利物业服务有限公司",
    "天河雅居乐餐厅",
    "广州建工集团有限公司",
  ];
  for (const term of shouldAccept) {
    assert.equal(
      isGenericOrPlaceholderSubject(term),
      false,
      `Expected concrete subject to be accepted: ${term}`
    );
  }
}

function testIssue2WageArrearsSiteIsolation() {
  // THEME-35: 石牌 中山大道西某建设工程工地 vs 石牌 龙口东路某建设工程工地 must NOT merge
  const siteA = makeCandidate({
    title: "拖欠工资",
    content: "反映石牌中山大道西某建设工程工地总承包方拖欠工人工资。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    subject: "某建设工程工地",
    vector: [0.99, 0.14, 0, 0],
  });
  const siteB = makeCandidate({
    title: "拖欠工资",
    content: "反映石牌龙口东路某建设工程工地施工方拖欠农民工工资。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    subject: "某建设工程工地",
    vector: [0.98, 0.19, 0, 0], // cosine > 0.99
  });

  assert.equal(siteA.profile.family, ISSUE_FAMILY.WAGE_ARREARS);
  assert.equal(siteB.profile.family, ISSUE_FAMILY.WAGE_ARREARS);
  assert.equal(siteA.profile.place, "中山大道西");
  assert.equal(siteB.profile.place, "龙口东路");
  assert.equal(siteA.profile.subject, null);
  assert.equal(siteB.profile.subject, null);

  assert.equal(incidentsMatch(siteA.profile, siteB.profile), false);
  assert.equal(shouldLinkIncidents(siteA, siteB), false);

  // Same concrete employer/project name + same site -> MUST merge
  const sameSite1 = makeCandidate({
    title: "拖欠工资",
    content: "石牌街道中建三局华南国际港项目部拖欠水电班组工资，地点在中山大道西188号。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    vector: [0.6, 0.8, 0, 0],
  });
  const sameSite2 = makeCandidate({
    title: "欠薪投诉",
    content: "反映中建三局华南国际港项目部长期拖欠工资，位于石牌中山大道西188号。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    vector: [0.55, 0.83, 0, 0],
  });
  assert.equal(sameSite1.profile.subject, "中建三局华南国际港项目部");
  assert.equal(sameSite2.profile.subject, "中建三局华南国际港项目部");
  assert.equal(incidentsMatch(sameSite1.profile, sameSite2.profile), true);
  assert.equal(shouldLinkIncidents(sameSite1, sameSite2), true);

  // Same employer at two DIFFERENT concrete roads -> MUST NOT merge for WAGE_ARREARS
  const sameEmployerDiffRoad1 = makeCandidate({
    title: "拖欠工资",
    content: "单位名称：中建三局，石牌中山大道西工地拖欠工资。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    subject: "中建三局",
    vector: [1, 0, 0, 0],
  });
  const sameEmployerDiffRoad2 = makeCandidate({
    title: "拖欠工资",
    content: "单位名称：中建三局，石牌龙口东路工地拖欠工资。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    subject: "中建三局",
    vector: [1, 0, 0, 0],
  });
  assert.equal(incidentsMatch(sameEmployerDiffRoad1.profile, sameEmployerDiffRoad2.profile), false);
  assert.equal(shouldLinkIncidents(sameEmployerDiffRoad1, sameEmployerDiffRoad2), false);

  // Transitive union-find chaining guard for WAGE_ARREARS via placeless bridge
  const bridgeNoPlace = makeCandidate({
    title: "拖欠工资",
    content: "单位名称：中建三局，石牌街道拖欠工资。",
    subdistrict: "石牌街道",
    category: "劳动社保",
    subject: "中建三局",
    vector: [1, 0, 0, 0],
  });
  bridgeNoPlace.profile.place = null;
  const wageGroups = clusterLinked(
    [
      { id: "w1", cand: sameEmployerDiffRoad1 },
      { id: "w2", cand: bridgeNoPlace },
      { id: "w3", cand: sameEmployerDiffRoad2 },
    ],
    (item) => item.cand
  );
  // w1 + w2 may link (one lacks place), or w2 + w3, NEVER w1 + w2 + w3 all together!
  for (const g of wageGroups) {
    const ids = new Set(g.map((x) => x.id));
    assert.equal(ids.has("w1") && ids.has("w3"), false, "Transitive WAGE_ARREARS merge across distinct roads blocked");
  }
}

function testIssue3CategoryAndSpatialIsolation() {
  assert.equal(categoriesCompatible("", "交通出行"), true);
  assert.equal(categoriesCompatible("综合民生", "生态环境"), true);
  assert.equal(categoriesCompatible("其他", "劳动社保"), true);
  assert.equal(categoriesCompatible("未分类", "城市管理"), true);
  assert.equal(categoriesCompatible("交通出行", "交通出行"), true);
  assert.equal(categoriesCompatible("交通出行", "生态环境"), false);
  assert.equal(categoriesCompatible("劳动社保", "城市管理"), false);

  // THEME-10: 信号灯配时(交通出行) + 濂泉路夜间施工(生态环境) + 沙河大街湘菜馆油烟(生态环境) + 水荫四横路违停(交通出行)
  const highCosineVec = [0.95, 0.31, 0, 0];
  const highCosineVec2 = [0.96, 0.28, 0, 0]; // cosine ~ 0.999

  const t1Signal = makeCandidate({
    title: "交通信号灯配时问题",
    content: "沙河街道先烈东路路口交通信号灯配时过短，早高峰拥堵。",
    subdistrict: "沙河街道",
    category: "交通出行",
    vector: highCosineVec,
  });
  const t2NightWork = makeCandidate({
    title: "夜间施工噪音",
    content: "沙河街道濂泉路某工地夜间施工噪音扰民严重。",
    subdistrict: "沙河街道",
    category: "生态环境",
    subject: "某建设工程工地",
    vector: highCosineVec2,
  });
  const t3Fume = makeCandidate({
    title: "餐饮油烟扰民",
    content: "沙河街道沙河大街某号一楼临街重餐饮烧烤湘菜馆油烟直排。",
    subdistrict: "沙河街道",
    category: "生态环境",
    subject: "某号一楼临街重餐饮烧烤湘菜馆",
    vector: highCosineVec,
  });
  const t4Parking = makeCandidate({
    title: "机动车违停",
    content: "沙河街道水荫四横路路段长期有车辆违停堵塞道路。",
    subdistrict: "沙河街道",
    category: "交通出行",
    vector: highCosineVec2,
  });

  // No pair among these 4 distinct incidents should link
  const all = [t1Signal, t2NightWork, t3Fume, t4Parking];
  for (let i = 0; i < all.length; i++) {
    for (let j = i + 1; j < all.length; j++) {
      assert.equal(
        shouldLinkIncidents(all[i], all[j]),
        false,
        `THEME-10 pair (${i}, ${j}) must NOT link`
      );
    }
  }

  // Transitive chaining test with a wildcard "综合民生" bridge
  const wildcardBridgeA = makeCandidate({
    title: "噪声扰民",
    content: "沙河街道濂泉路夜间施工噪声大，影响休息。",
    subdistrict: "沙河街道",
    category: "综合民生",
    vector: highCosineVec,
  });
  const wildcardBridgeB = makeCandidate({
    title: "信号灯故障",
    content: "沙河街道先烈东路信号灯异常。",
    subdistrict: "沙河街道",
    category: "交通出行",
    vector: highCosineVec,
  });
  // Force identical vectors and test clusterLinked across mixed categories
  const linkedGroups = clusterLinked(
    [
      { id: "sig", cand: t1Signal },
      { id: "night", cand: t2NightWork },
      { id: "fume", cand: t3Fume },
      { id: "park", cand: t4Parking },
      { id: "wild", cand: wildcardBridgeA },
      { id: "sig2", cand: wildcardBridgeB },
    ],
    (x) => x.cand
  );
  for (const grp of linkedGroups) {
    const cats = new Set(grp.map((g) => g.cand.category).filter((c) => c !== "综合民生"));
    assert.ok(cats.size <= 1, `Cluster must not mix concrete categories: ${Array.from(cats).join(",")}`);
    const ids = new Set(grp.map((g) => g.id));
    assert.equal(ids.has("night") && ids.has("fume"), false, "Distinct roads 濂泉路 vs 沙河大街 must stay separate");
    assert.equal(ids.has("sig") && ids.has("park"), false, "Distinct roads 先烈东路 vs 水荫四横路 must stay separate");
  }

  // Fingerprint guard: identical boilerplate > 36 chars with conflicting concrete places or families must NOT link
  const longText = "市民反映存在严重问题请有关部门尽快核实处理并回复市民诉求谢谢配合";
  const fpA = makeCandidate({
    title: "施工噪音",
    content: `${longText} 地点在中山大道西。`,
    subdistrict: "石牌街道",
    category: "生态环境",
  });
  const fpB = makeCandidate({
    title: "施工噪音",
    content: `${longText} 地点在龙口东路。`,
    subdistrict: "石牌街道",
    category: "生态环境",
  });
  fpA.profile.fingerprint = fpB.profile.fingerprint = longText;
  assert.equal(incidentsMatch(fpA.profile, fpB.profile), false);
}

function testClusterValidatorPurity() {
  const baseTheme: MultiFrequencyTheme = {
    id: "THEME-TEST",
    title: "测试主题",
    canonicalSubject: "某建设工程工地",
    canonicalLocation: "石牌街道",
    eventType: "拖欠工资",
    category: "劳动社保",
    riskLevel: "HIGH",
    riskReason: "test",
    ticketCount: 2,
    timeSpanHours: 10,
    firstOccurrence: "2026-11-25 08:00:00",
    lastOccurrence: "2026-11-25 18:00:00",
    aiSummary: "",
    recommendedAction: "",
    tickets: [],
    relatedSubjects: [],
    relatedLocations: [],
    status: "UNCHECKED",
  };

  // 1. Placeholder subject rejected
  const tPlaceholder = [
    makeEnrichedTicket("1", { subdistrict: "石牌街道", sourceCategory: "劳动社保" }),
    makeEnrichedTicket("2", { subdistrict: "石牌街道", sourceCategory: "劳动社保" }),
  ];
  const r1 = validateSingleTheme(baseTheme, tPlaceholder, {
    regionId: "tianhe",
    regionName: "天河区",
    cityName: "广州市",
    provinceName: "广东省",
    townships: TIANHE_TOWNSHIPS,
    departments: [],
    categories: [],
  });
  assert.equal(r1.passed, false);

  // 2. Mixed categories (< 75% dominant) -> 跨业务类型混杂
  const mixedCatTickets = [
    makeEnrichedTicket("c1", { subdistrict: "沙河街道", sourceCategory: "交通出行", canonicalLocation: "先烈东路" }),
    makeEnrichedTicket("c2", { subdistrict: "沙河街道", sourceCategory: "交通出行", canonicalLocation: "先烈东路" }),
    makeEnrichedTicket("c3", { subdistrict: "沙河街道", sourceCategory: "生态环境", canonicalLocation: "先烈东路" }),
    makeEnrichedTicket("c4", { subdistrict: "沙河街道", sourceCategory: "生态环境", canonicalLocation: "先烈东路" }),
  ];
  const r2 = validateSingleTheme(
    { ...baseTheme, canonicalSubject: "先烈东路整治", eventType: "综合诉求", category: "交通出行", ticketCount: 4 },
    mixedCatTickets
  );
  assert.equal(r2.passed, false);
  assert.ok(r2.rejectedReason?.includes("跨业务类型混杂"), `Expected 跨业务类型混杂, got: ${r2.rejectedReason}`);

  // 3. Scattered WAGE_ARREARS sites (>= 5 tickets, dominant place < 50%) -> 多主体/多工地混杂
  const scatteredWageTickets = [
    makeEnrichedTicket("s1", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "中山大道西某工地", eventType: "拖欠工资" }),
    makeEnrichedTicket("s2", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "龙口东路某工地", eventType: "拖欠工资" }),
    makeEnrichedTicket("s3", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "天河北路某工地", eventType: "拖欠工资" }),
    makeEnrichedTicket("s4", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "科韵路某工地", eventType: "拖欠工资" }),
    makeEnrichedTicket("s5", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "黄埔大道某工地", eventType: "拖欠工资" }),
  ];
  const r3 = validateSingleTheme(
    { ...baseTheme, canonicalSubject: "天河欠薪核查", eventType: "拖欠工资", category: "劳动社保", ticketCount: 5 },
    scatteredWageTickets
  );
  assert.equal(r3.passed, false);
  assert.ok(r3.rejectedReason?.includes("多主体/多工地混杂"), `Expected 多主体/多工地混杂, got: ${r3.rejectedReason}`);

  // 4. Legitimate single-site theme passes
  const validTickets = [
    makeEnrichedTicket("v1", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "中山大道西188号", canonicalSubject: "中建三局华南国际港项目部" }),
    makeEnrichedTicket("v2", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "中山大道西188号", canonicalSubject: "中建三局华南国际港项目部" }),
    makeEnrichedTicket("v3", { subdistrict: "石牌街道", sourceCategory: "劳动社保", canonicalLocation: "中山大道西188号", canonicalSubject: "中建三局华南国际港项目部" }),
  ];
  const r4 = validateSingleTheme(
    { ...baseTheme, canonicalSubject: "中建三局华南国际港项目部", canonicalLocation: "石牌街道中山大道西188号", ticketCount: 3 },
    validTickets
  );
  assert.equal(r4.passed, true);
}

async function testEmbedNeighborsGuardedUnion() {
  // Verify clusterFromStoredNeighbors and clusterFromStoredNeighborsYielding enforce component guards
  const items = [
    {
      id: "e-w1",
      cand: makeCandidate({
        title: "拖欠工资",
        content: "单位名称：中建三局，石牌中山大道西工地拖欠工资。",
        subdistrict: "石牌街道",
        category: "劳动社保",
        subject: "中建三局",
        vector: [1, 0, 0, 0],
      }),
    },
    {
      id: "e-w2",
      cand: (() => {
        const c = makeCandidate({
          title: "拖欠工资",
          content: "单位名称：中建三局，石牌街道拖欠工资。",
          subdistrict: "石牌街道",
          category: "劳动社保",
          subject: "中建三局",
          vector: [1, 0, 0, 0],
        });
        c.profile.place = null;
        return c;
      })(),
    },
    {
      id: "e-w3",
      cand: makeCandidate({
        title: "拖欠工资",
        content: "单位名称：中建三局，石牌龙口东路工地拖欠工资。",
        subdistrict: "石牌街道",
        category: "劳动社保",
        subject: "中建三局",
        vector: [1, 0, 0, 0],
      }),
    },
    {
      id: "e-c1",
      cand: makeCandidate({
        title: "信号灯故障",
        content: "沙河街道先烈东路信号灯故障。",
        subdistrict: "沙河街道",
        category: "交通出行",
        vector: [0.95, 0.31, 0, 0],
      }),
    },
    {
      id: "e-c2",
      cand: makeCandidate({
        title: "夜间施工噪音",
        content: "沙河街道濂泉路夜间施工噪音扰民。",
        subdistrict: "沙河街道",
        category: "生态环境",
        vector: [0.95, 0.31, 0, 0],
      }),
    },
  ];

  const forcedNeighborPairs: Array<[number, number]> = [
    [0, 1],
    [1, 2],
    [3, 4],
  ];

  const syncGroups = clusterFromStoredNeighbors(items, (x) => x.cand, forcedNeighborPairs);
  const asyncGroups = await clusterFromStoredNeighborsYielding(items, (x) => x.cand, forcedNeighborPairs, 1);

  for (const groups of [syncGroups, asyncGroups]) {
    for (const g of groups) {
      const ids = new Set(g.map((x) => x.id));
      assert.equal(ids.has("e-w1") && ids.has("e-w3"), false, "embed-neighbors must block transitive WAGE_ARREARS site chaining");
      assert.equal(ids.has("e-c1") && ids.has("e-c2"), false, "embed-neighbors must keep incompatible categories separate");
    }
  }
}

async function main() {
  testConfidenceCalibration();
  testPlaceholderSubjectRejection();
  testIssue2WageArrearsSiteIsolation();
  testIssue3CategoryAndSpatialIsolation();
  testClusterValidatorPurity();
  await testEmbedNeighborsGuardedUnion();
  console.log("test-cluster-precision: all assertions passed");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
