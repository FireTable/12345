/**
 * M5 P0 #9 + P0 #7 (copilot-tools) 综合测试：
 * - extractQueryTokens 去全标点、保留编码、混合词、>16字滑窗 2-gram、上限 12
 * - isSemanticQuery 过滤纯占位符与独立车牌
 * - deanonymizeArgs 含引号/反斜杠安全递归还原
 * - isEmbedEligible 保持对 '涉事方' 与 extractionFailed 兼容
 * - 独立临时租户 schema (verify_m5_search) 实测 searchTicketsByVector 下推 WHERE 防顶层淘汰 + search_tickets SQL 召回与脱敏
 *   (try/finally 物理清理并校验基线库零变动)
 */
import http from "node:http";
import { sql, getRegionDb } from "../db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "../db/schema";
import { destroyRegionTenant, registerRegion } from "../lib/tenant/schema-manager";
import { searchTicketsByVector, upsertTicketEmbeddings } from "../lib/ticket-embeddings";
import { isEmbedEligible } from "../backend/embed-policy";
import {
  createCopilotTools,
  deanonymizeArgs,
  extractQueryTokens,
  isSemanticQuery,
} from "../backend/agent/copilot-tools";

const RUN_SUFFIX = `${process.pid}_${Date.now()}`;
const TEST_REGION_ID = `verify_m5_search_${RUN_SUFFIX}`;
const TEST_SCHEMA_NAME = `region_verify_m5_search_${RUN_SUFFIX}`;

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
} as const;

let failures = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function makeVec(angleIdx: number): number[] {
  const vec = new Array<number>(1024).fill(0);
  vec[0] = Math.cos(angleIdx * 0.05);
  vec[1] = Math.sin(angleIdx * 0.05);
  return vec;
}

async function readCounts(schemaName: string) {
  const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".tickets`);
  const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".themes`);
  return { tickets: Number(tRow?.c ?? 0), themes: Number(thRow?.c ?? 0) };
}

async function assertBaselineUnchanged(stage: string) {
  const tianhe = await readCounts(BASELINE.gz_tianhe.schema);
  const shunde = await readCounts(BASELINE.fs_shunde.schema);
  assert(
    tianhe.tickets === BASELINE.gz_tianhe.tickets && tianhe.themes === BASELINE.gz_tianhe.themes,
    `[${stage}] gz_tianhe 基线零变动 (${tianhe.tickets}/${tianhe.themes})`
  );
  assert(
    shunde.tickets === BASELINE.fs_shunde.tickets && shunde.themes === BASELINE.fs_shunde.themes,
    `[${stage}] fs_shunde 基线零变动 (${shunde.tickets}/${shunde.themes})`
  );
}

async function cleanupTestTenant() {
  try {
    await destroyRegionTenant(sql, TEST_REGION_ID);
  } catch {
    // ignore
  }
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA_NAME}" CASCADE;`);
  await sql`DELETE FROM public.regions WHERE id = ${TEST_REGION_ID};`;
}

async function main() {
  // 1. Pure tokenization & semantic guard & deanonymizeArgs tests
  {
    const t1 = extractQueryTokens("天河南街道，夜间施工噪音扰民？！");
    assert(
      t1.phrase === "天河南街道 夜间施工噪音扰民" &&
        t1.anchorTerms.includes("天河南街道") &&
        t1.anchorTerms.includes("夜间施工噪音扰民"),
      "extractQueryTokens 剥离全部中文标点并保留锚点词"
    );

    const t2 = extractQueryTokens("SKU-GD2026-881 假货");
    assert(
      t2.tokens.includes("SKU-GD2026-881") && t2.tokens.includes("假货"),
      "extractQueryTokens 保留带连字符的 SKU 编码"
    );

    const t3 = extractQueryTokens("3号线夜间酒吧施工噪音持续扰民超过两周");
    assert(
      t3.tokens.includes("3号线") &&
        t3.tokens.includes("酒吧") &&
        t3.tokens.includes("施工") &&
        t3.tokens.includes("噪音") &&
        t3.tokens.length <= 12,
      `extractQueryTokens 提取混合词 '3号线' 与滑窗 2-gram 且上限 <= 12 (count=${t3.tokens.length})`
    );

    const tPlate = extractQueryTokens("粤A·12345");
    assert(
      tPlate.phrase === "粤A12345" &&
        tPlate.tokens.includes("粤A12345") &&
        tPlate.tokens.includes("粤A·12345") &&
        tPlate.tokens.includes("粤A-12345"),
      `extractQueryTokens 保留分隔符车牌并生成跨格式变体 (got: ${JSON.stringify(tPlate.tokens)})`
    );

    const tSemi = extractQueryTokens("噪音;违停.扰民");
    assert(
      tSemi.anchorTerms.includes("噪音") &&
        tSemi.anchorTerms.includes("违停") &&
        tSemi.anchorTerms.includes("扰民"),
      `extractQueryTokens 剥离 ASCII ';' 与 '.' (got: ${JSON.stringify(tSemi.anchorTerms)})`
    );

    const tLong = extractQueryTokens("今天深夜一点半左右在天河南二路楼下酒吧街持续噪音扰民");
    assert(
      tLong.tokens.length <= 12 &&
        tLong.tokens.includes("楼下") &&
        tLong.tokens.includes("酒吧") &&
        tLong.tokens.includes("持续") &&
        tLong.tokens.includes("噪音") &&
        tLong.tokens.includes("扰民"),
      `extractQueryTokens 长句保留中后段关键词且上限 <= 12 (got: ${JSON.stringify(tLong.tokens)})`
    );

    const tTail32 = extractQueryTokens("天河区体育西路地铁站出口旁边天桥底下昨晚有人占道摆摊售卖烧烤油烟");
    assert(
      tTail32.tokens.length <= 12 &&
        tTail32.tokens.includes("天河") &&
        tTail32.tokens.includes("体育") &&
        tTail32.tokens.includes("烧烤") &&
        tTail32.tokens.includes("油烟"),
      `extractQueryTokens 32字 >=12词长句首尾交替保留尾部核心词 '烧烤'/'油烟' (got: ${JSON.stringify(tTail32.tokens)})`
    );

    const tQ6Comma = extractQueryTokens(
      "天河区，体育西路，地铁站，出口旁边，天桥底下，昨晚有人，占道摆摊，售卖，烧烤油烟"
    );
    assert(
      tQ6Comma.tokens.length <= 12 &&
        tQ6Comma.anchorTerms.includes("烧烤油烟") &&
        tQ6Comma.tokens.includes("天河区") &&
        tQ6Comma.tokens.includes("烧烤") &&
        tQ6Comma.tokens.includes("油烟"),
      `extractQueryTokens >=7段逗号分隔长句首尾交替保留 '烧烤油烟'/'烧烤'/'油烟' (got: ${JSON.stringify(tQ6Comma.tokens)})`
    );

    const tQ7Space = extractQueryTokens(
      "天河区 体育西路 地铁站 出口 旁边 天桥 底下 昨晚 有人 占道 摆摊 售卖 烧烤 油烟"
    );
    assert(
      tQ7Space.tokens.length <= 12 &&
        tQ7Space.anchorTerms.includes("烧烤") &&
        tQ7Space.anchorTerms.includes("油烟") &&
        tQ7Space.tokens.includes("天河区") &&
        tQ7Space.tokens.includes("烧烤") &&
        tQ7Space.tokens.includes("油烟"),
      `extractQueryTokens >=7段空格分隔长句首尾交替保留 '烧烤'/'油烟' (got: ${JSON.stringify(tQ7Space.tokens)})`
    );

    const tKatakanaDotPlate = extractQueryTokens("粤A・12345");
    assert(
      tKatakanaDotPlate.phrase === "粤A12345" &&
        tKatakanaDotPlate.tokens.includes("粤A12345") &&
        tKatakanaDotPlate.tokens.includes("粤A·12345") &&
        tKatakanaDotPlate.tokens.includes("粤A-12345") &&
        tKatakanaDotPlate.tokens.includes("粤A・12345"),
      `extractQueryTokens 识别片假名中点 '粤A・12345' 并生成含 '・' 的跨格式车牌变体 (got: ${JSON.stringify(tKatakanaDotPlate.tokens)})`
    );
    assert(!isSemanticQuery("粤A・12345"), "isSemanticQuery 拒绝片假名中点分隔独立车牌");

    const tGuaPlate = extractQueryTokens("粤A・1234挂");
    assert(
      tGuaPlate.phrase === "粤A1234挂" &&
        tGuaPlate.tokens.includes("粤A1234挂") &&
        tGuaPlate.tokens.includes("粤A·1234挂") &&
        tGuaPlate.tokens.includes("粤A-1234挂") &&
        tGuaPlate.tokens.includes("粤A・1234挂") &&
        !tGuaPlate.tokens.includes("A1234"),
      `extractQueryTokens 保留 '粤A・1234挂' 全格式变体且不泄漏 'A1234' (got: ${JSON.stringify(tGuaPlate.tokens)})`
    );
    assert(!isSemanticQuery("粤A・1234挂"), "isSemanticQuery 拒绝挂车后缀独立车牌 '粤A・1234挂'");
    assert(!isSemanticQuery("粤A·1234学"), "isSemanticQuery 拒绝学车后缀独立车牌 '粤A·1234学'");
    assert(!isSemanticQuery("粤A1234警"), "isSemanticQuery 拒绝警车后缀独立车牌 '粤A1234警'");

    const tKatakanaDotsOnly = extractQueryTokens("・・・");
    assert(
      tKatakanaDotsOnly.phrase === "" &&
        tKatakanaDotsOnly.anchorTerms.length === 0 &&
        tKatakanaDotsOnly.tokens.length === 0,
      `extractQueryTokens 剥离纯片假名中点 '・・・' 返回空结果 (got: ${JSON.stringify(tKatakanaDotsOnly)})`
    );

    assert(!isSemanticQuery("{{LICENSE_PLATE_1}}"), "isSemanticQuery 拒绝纯脱敏占位符");
    assert(!isSemanticQuery("粤A12345"), "isSemanticQuery 拒绝独立车牌号");
    assert(!isSemanticQuery("SKU-GD2026-881"), "isSemanticQuery 拒绝编码");
    assert(isSemanticQuery("夜间施工噪音扰民"), "isSemanticQuery 允许中文语义短句");

    const restored = deanonymizeArgs(
      {
        query: "{{PERSON_NAME_1}} 车牌 {{LICENSE_PLATE_1}}",
        nested: ["{{PERSON_NAME_1}}"],
      },
      {
        "{{PERSON_NAME_1}}": '张"三\\测试',
        "{{LICENSE_PLATE_1}}": "粤A12345",
      }
    );
    assert(
      restored.query === '张"三\\测试 车牌 粤A12345' && restored.nested[0] === '张"三\\测试',
      "deanonymizeArgs 安全递归还原含双引号/反斜杠的实体且不抛 JSON 解析错误"
    );

    assert(!isEmbedEligible({ id: "1", canonicalSubject: "涉事方" }), "涉事方保持不可嵌入策略");
    assert(!isEmbedEligible({ id: "2", extractionFailed: true }), "extractionFailed 保持不可嵌入策略");
    assert(isEmbedEligible({ id: "3", canonicalSubject: "天河酒吧" }), "正常主体保持可嵌入");
  }

  // 2. Throwaway PG integration test for searchTicketsByVector pushdown + copilot-tools
  await assertBaselineUnchanged("前置");
  await cleanupTestTenant();

  try {
    await registerRegion(sql, {
      id: TEST_REGION_ID,
      name: "M5检索验证区",
      city: "广州市",
      province: "广东省",
      schemaName: TEST_SCHEMA_NAME,
    });

    const { db } = await getRegionDb(TEST_REGION_ID);
    const baseTime = new Date("2026-10-01T10:00:00Z");

    // 8 tickets in 天河南街道 (rank #1..#8 closest to vec(0)) + 2 tickets in 石牌街道 (rank #9..#10)
    const embedRows = [];
    for (let i = 0; i < 10; i++) {
      const isShipai = i >= 8;
      const id = `M5-T-${i + 1}`;
      const ticketNo = `TK-M5-${String(i + 1).padStart(3, "0")}`;
      await db.insert(ticketsTable).values({
        id,
        ticketNo,
        title: `${isShipai ? "石牌街道" : "天河南街道"}夜间施工噪音投诉 ${i + 1}`,
        summarizeTitle: `${isShipai ? "石牌" : "天河南"}施工噪音 ${i + 1}`,
        content: `市民张先生(1380013800${i})反映${isShipai ? "石牌街道" : "天河南街道"}夜间施工噪音严重。`,
        maskedContent: null,
        subdistrict: isShipai ? "石牌街道" : "天河南街道",
        sourceCategory: "生态环境",
        canonicalSubject: isShipai ? "石牌工地" : "天河南工地",
        eventType: "施工噪音",
        address: `${isShipai ? "石牌东路" : "体育西路"}${10 + i}号`,
        urgency: isShipai ? "URGENT" : "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + i * 60_000),
      });
      embedRows.push({
        ticketId: id,
        productHash: `hash-${i}`,
        model: "BAAI/bge-m3",
        vector: makeVec(i),
      });
    }

    // 1 embed-ineligible ticket ('涉事方', NOT in ticket_embeddings) with PII
    await db.insert(ticketsTable).values({
      id: "M5-T-INELIGIBLE",
      ticketNo: "TK-M5-999",
      title: "粤A12345货车夜间卸货噪音扰民",
      summarizeTitle: "粤A12345夜间卸货噪音",
      content: "市民李女士(13912345678)投诉粤A12345货车在天河南街道夜间卸货噪音极大。",
      maskedContent: "市民李女士(13912345678)投诉粤A·12345货车夜间卸货噪音。", // legacy dirty maskedContent
      subdistrict: "天河南街道",
      sourceCategory: "生态环境",
      canonicalSubject: "涉事方",
      eventType: "社会生活噪音",
      address: "天河南二路18号",
      urgency: "URGENT",
      status: "PENDING",
      createTime: new Date(baseTime.getTime() + 20 * 60_000),
    });

    await db.insert(themesTable).values({
      id: "TH-M5-1",
      title: "张先生反映粤A12345货车夜间扰民主题",
      canonicalSubject: "粤A12345货车",
      canonicalLocation: "天河南二路18号",
      eventType: "社会生活噪音",
      category: "生态环境",
      riskLevel: "HIGH",
      ticketCount: 3,
      timeSpanHours: 12,
      aiSummary: `${"情况概述".repeat(42)}联系人13912345678多次反映粤A12345货车扰民。`,
      recommendedAction: "牵头部门：城管执法队，联系张先生核查。",
    });
    await db.insert(ticketThemesTable).values({
      ticketId: "M5-T-INELIGIBLE",
      themeId: "TH-M5-1",
    });

    // Extra tickets for Iteration 2 regressions:
    // - M5-T-PLATE-DOT: DB stores '粤A·12345' (queried with '粤A12345')
    // - M5-T-HIGH: urgency = 'HIGH'
    // - M5-T-MULTI: embed-ineligible '涉事方' matching 3 tokens ('天河南', '施工', '噪音')
    // - M5-T-DIST: embedded unrelated distractor matching vec(0) closely
    await db.insert(ticketsTable).values([
      {
        id: "M5-T-PLATE-DOT",
        ticketNo: "TK-M5-DOT",
        title: "粤A·12345占道停放投诉",
        summarizeTitle: "粤A·12345占道停放",
        content: "群众反映粤A·12345长期占道停放影响通行。",
        subdistrict: "洗村街道",
        sourceCategory: "交通管理",
        canonicalSubject: "涉事方",
        eventType: "违停占道",
        address: "黄埔大道西88号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 21 * 60_000),
      },
      {
        id: "M5-T-HIGH",
        ticketNo: "TK-M5-HIGH",
        title: "天河南紧急高危排污投诉",
        summarizeTitle: "天河南排污HIGH",
        content: "天河南街道商铺违规排污，急需处置。",
        subdistrict: "天河南街道",
        sourceCategory: "生态环境",
        canonicalSubject: "天河南商铺",
        eventType: "违规排污",
        address: "天河南一路66号",
        urgency: "HIGH",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 22 * 60_000),
      },
      {
        id: "M5-T-MULTI",
        ticketNo: "TK-M5-MULTI",
        title: "天河南二路夜市占道经营扰民",
        summarizeTitle: "天河南二路夜市占道经营",
        content: "天河南二路夜间摊贩占道经营影响行人通行。",
        subdistrict: "天河南街道",
        sourceCategory: "城市管理",
        canonicalSubject: "涉事方",
        eventType: "占道经营",
        address: "天河南二路99号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() - 10 * 60_000),
      },
      {
        id: "M5-T-DIST",
        ticketNo: "TK-M5-DIST",
        title: "其他街道普通咨询事项",
        summarizeTitle: "普通业务咨询",
        content: "市民咨询窗口办事流程及所需材料。",
        subdistrict: "林和街道",
        sourceCategory: "政务服务",
        canonicalSubject: "政务窗口",
        eventType: "业务咨询",
        address: "林和中路1号",
        urgency: "NORMAL",
        status: "RESOLVED",
        createTime: new Date(baseTime.getTime() + 30 * 60_000),
      },
      {
        id: "M5-T-WS",
        ticketNo: "TK-M5-WS",
        title: "天河地下车库夜间异响问题",
        summarizeTitle: "天河地下车库夜间异响",
        content: `${"天河地下车库夜间异响问题"}${" ".repeat(783)}13899887766`,
        subdistrict: "天河南街道",
        sourceCategory: "城市管理",
        canonicalSubject: "涉事方",
        eventType: "设施异响",
        address: "天河南一路10号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 31 * 60_000),
      },
      {
        id: "M5-T-TAIL",
        ticketNo: "TK-M5-TAIL",
        title: "深夜烧烤油烟直排投诉",
        summarizeTitle: "深夜烧烤油烟直排",
        content: "群众反映每晚烧烤油烟直排严重污染空气。",
        subdistrict: "洗村街道",
        sourceCategory: "城市管理",
        canonicalSubject: "涉事方",
        eventType: "油烟扰民",
        address: "洗村路12号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 32 * 60_000),
      },
      {
        id: "M5-T-P-KANA",
        ticketNo: "TK-M5-P-KANA",
        title: "粤A・12345夜间违停投诉",
        summarizeTitle: "粤A・12345夜间违停",
        content: "群众反映粤A・12345货车夜间违停占用消防通道。",
        subdistrict: "洗村街道",
        sourceCategory: "交通管理",
        canonicalSubject: "涉事方",
        eventType: "违停占道",
        address: "洗村路22号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 33 * 60_000),
      },
      {
        id: "M5-T-P-GUA",
        ticketNo: "TK-M5-P-GUA",
        title: "粤A・1234挂半挂车占道投诉",
        summarizeTitle: "粤A・1234挂占道",
        content: "群众反映粤A・1234挂半挂车长期占道停放。",
        subdistrict: "洗村街道",
        sourceCategory: "交通管理",
        canonicalSubject: "涉事方",
        eventType: "违停占道",
        address: "洗村路23号",
        urgency: "NORMAL",
        status: "PENDING",
        createTime: new Date(baseTime.getTime() + 34 * 60_000),
      },
    ]);
    embedRows.push({
      ticketId: "M5-T-DIST",
      productHash: "hash-dist",
      model: "BAAI/bge-m3",
      vector: makeVec(5.5),
    });

    await upsertTicketEmbeddings(TEST_REGION_ID, embedRows);

    // 2a. Verify searchTicketsByVector filter pushdown avoids top-8 starvation
    const globalTop5 = await searchTicketsByVector(TEST_REGION_ID, makeVec(0), 5);
    assert(
      globalTop5.length === 5 && globalTop5.every((h) => h.township === "天河南街道"),
      "无过滤 3 参调用 searchTicketsByVector 返回全球 Top-5 天河南街道工单"
    );

    const filteredShipai = await searchTicketsByVector(TEST_REGION_ID, makeVec(0), 8, {
      subdistrict: "石牌街道",
      urgency: "URGENT",
    });
    assert(
      filteredShipai.length === 2 &&
        filteredShipai.map((h) => h.ticketNo).sort().join(",") === "TK-M5-009,TK-M5-010",
      "searchTicketsByVector 下推 WHERE 过滤后精准召回排名 #9-#10 的石牌街道工单"
    );

    // 2b. Verify copilot-tools sessionKeymap restoration + SQL recall for embed-ineligible + output masking
    const sessionKeymap: Record<string, string> = {
      "{{LICENSE_PLATE_1}}": "粤A12345",
      "{{PHONE_NUMBER_1}}": "13912345678",
    };
    const tools = createCopilotTools(TEST_REGION_ID, "GOV_12345", { sessionKeymap });
    const byName = new Map(tools.map((t) => [t.name, t]));
    const invokeTool = (name: string, args: Record<string, unknown>) =>
      (
        byName.get(name) as unknown as {
          invoke: (input: Record<string, unknown>) => Promise<unknown>;
        }
      ).invoke(args);

    const searchResRaw = await invokeTool("search_tickets", {
      query: "{{LICENSE_PLATE_1}}",
    });
    const searchResStr = String(searchResRaw);
    const searchRes = JSON.parse(searchResStr);
    assert(
      Array.isArray(searchRes.hits) &&
        searchRes.hits.some((h: any) => h.ticketNo === "TK-M5-999") &&
        searchRes.hits.some((h: any) => h.ticketNo === "TK-M5-DOT"),
      "search_tickets 还原占位符后跨格式召回 '粤A12345' (TK-M5-999) 与 '粤A·12345' (TK-M5-DOT)"
    );
    assert(
      !searchResStr.includes("粤A12345") &&
        !searchResStr.includes("粤A·12345") &&
        !searchResStr.includes("13912345678") &&
        !searchResStr.includes("李女士"),
      "search_tickets 对 title/body/旧库 dirty maskedContent 全部执行脱敏"
    );

    // 2b-2. Cross-format plate query with separator ('粤A·12345' / '粤A・12345' / '粤A12345' -> recalls all formats)
    const dotPlateRes = JSON.parse(String(await invokeTool("search_tickets", { query: "粤A·12345" })));
    assert(
      Array.isArray(dotPlateRes.hits) &&
        dotPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-999") &&
        dotPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-DOT") &&
        dotPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-P-KANA"),
      "search_tickets 带分隔符查询 '粤A·12345' 跨格式召回 TK-M5-999 / TK-M5-DOT / TK-M5-P-KANA"
    );

    const kanaPlateStr = String(await invokeTool("search_tickets", { query: "粤A・12345" }));
    const kanaPlateRes = JSON.parse(kanaPlateStr);
    assert(
      Array.isArray(kanaPlateRes.hits) &&
        kanaPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-P-KANA") &&
        kanaPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-999") &&
        kanaPlateRes.hits.some((h: any) => h.ticketNo === "TK-M5-DOT") &&
        !kanaPlateStr.includes("粤A・12345"),
      "search_tickets 查询 '粤A・12345' 跨格式召回含 '・' 的 TK-M5-P-KANA 并完整脱敏"
    );

    const plainToKanaRes = JSON.parse(String(await invokeTool("search_tickets", { query: "粤A12345" })));
    assert(
      Array.isArray(plainToKanaRes.hits) &&
        plainToKanaRes.hits.some((h: any) => h.ticketNo === "TK-M5-P-KANA"),
      "search_tickets 查询 '粤A12345' 反向召回存储 '粤A・12345' 的 TK-M5-P-KANA"
    );

    const guaPlateStr = String(await invokeTool("search_tickets", { query: "粤A・1234挂" }));
    const guaPlateRes = JSON.parse(guaPlateStr);
    const guaHitNos = (guaPlateRes.hits || []).map((h: any) => h.ticketNo);
    assert(
      guaHitNos.includes("TK-M5-P-GUA") &&
        !guaHitNos.includes("TK-M5-999") &&
        !guaHitNos.includes("TK-M5-DOT") &&
        !guaHitNos.includes("TK-M5-P-KANA") &&
        !guaPlateStr.includes("粤A・1234挂"),
      `search_tickets 查询 '粤A・1234挂' 精准召回 TK-M5-P-GUA 且不误召回 '粤A12345' 工单 (hits=${JSON.stringify(guaHitNos)})`
    );

    // 2b-3. Wildcard / punctuation-only queries MUST NOT perform full-table scan
    for (const badQ of ["%", "___", "\\", "？！", "..."]) {
      const badRes = JSON.parse(String(await invokeTool("search_tickets", { query: badQ, limit: 8 })));
      assert(
        badRes.retrievalMode === "none" &&
          Array.isArray(badRes.hits) &&
          badRes.hits.length === 0 &&
          badRes.note === "请提供有效关键词或筛选条件",
        `search_tickets 拒绝纯通配符/标点查询 '${badQ}' 防止全表扫描`
      );
    }

    // 2b-4. Wildcard query + structured filter runs ONLY structured filter; urgency='HIGH' works in SQL
    const wildcardWithUrgency = JSON.parse(
      String(await invokeTool("search_tickets", { query: "%", urgency: "HIGH", limit: 8 }))
    );
    assert(
      wildcardWithUrgency.hits?.length === 1 && wildcardWithUrgency.hits[0]?.ticketNo === "TK-M5-HIGH",
      "search_tickets 纯通配符+结构化筛选仅按结构化条件过滤 (urgency=HIGH 命中 TK-M5-HIGH)"
    );

    const highUrgencyRes = JSON.parse(
      String(await invokeTool("search_tickets", { query: "天河南", urgency: "HIGH", limit: 8 }))
    );
    assert(
      highUrgencyRes.hits?.length === 1 &&
        highUrgencyRes.hits[0]?.ticketNo === "TK-M5-HIGH" &&
        highUrgencyRes.hits.every((h: any) => h.urgency === "HIGH"),
      "search_tickets urgency='HIGH' 严格过滤而不静默丢弃条件"
    );

    // 2c. Punctuated multi-segment query recall
    const punctSearchRaw = await invokeTool("search_tickets", {
      query: "石牌街道，夜间施工噪音？！",
    });
    const punctSearch = JSON.parse(String(punctSearchRaw));
    assert(
      Array.isArray(punctSearch.hits) &&
        punctSearch.hits.some((h: any) => h.ticketNo === "TK-M5-009"),
      "search_tickets 带中文标点多词查询精准命中石牌街道施工噪音"
    );

    // 2d. get_ticket, search_themes, get_theme, propose_theme_action output masking
    const getTicketStr = String(await invokeTool("get_ticket", { ticketNo: "TK-M5-999" }));
    assert(
      !getTicketStr.includes("粤A12345") && !getTicketStr.includes("13912345678") && !getTicketStr.includes("李女士"),
      "get_ticket 返回全字段脱敏"
    );

    const searchThemesStr = String(
      await invokeTool("search_themes", { keyword: "{{LICENSE_PLATE_1}}" })
    );
    const searchThemesParsed = JSON.parse(searchThemesStr);
    assert(
      searchThemesParsed.themes?.length === 1 &&
        !searchThemesStr.includes("粤A12345") &&
        !searchThemesStr.includes("13912345678") &&
        !searchThemesStr.includes("张先生"),
      "search_themes 还原 keyword 查库并脱敏返回主题全部文本字段"
    );

    const getThemeStr = String(await invokeTool("get_theme", { themeId: "TH-M5-1" }));
    assert(
      !getThemeStr.includes("粤A12345") && !getThemeStr.includes("13912345678") && !getThemeStr.includes("张先生"),
      "get_theme 脱敏主题及成员工单标题"
    );

    const proposeStr = String(
      await invokeTool("propose_theme_action", {
        themeId: "TH-M5-1",
        action: "DISPATCH",
        owner: "城管张先生",
        note: "联系13912345678核查粤A12345",
      })
    );
    const proposeParsed = JSON.parse(proposeStr);
    assert(
      proposeParsed.ok === true &&
        !proposeStr.includes("粤A12345") &&
        !proposeStr.includes("13912345678") &&
        !proposeStr.includes("张先生"),
      "propose_theme_action 脱敏 proposal 与 actionBlock"
    );

    // 2e. Mask-before-clip check on search_themes summary (180-char boundary around '13912345678')
    assert(
      !searchThemesStr.includes("13912345") && !searchThemesStr.includes("1391"),
      "search_themes 先脱敏后截断，避免 180 字符边界漏出半截手机号"
    );

    // 2e-2. Whitespace-heavy body boundary check: 783 spaces pushing 13899887766 onto raw 800-char cut
    const wsSearchStr = String(await invokeTool("search_tickets", { query: "天河地下车库夜间异响" }));
    const wsSearchParsed = JSON.parse(wsSearchStr);
    const wsHit = (wsSearchParsed.hits || []).find((h: any) => h.ticketNo === "TK-M5-WS");
    assert(
      Boolean(wsHit) &&
        !wsSearchStr.includes("13899") &&
        String(wsHit?.body || "").includes("{{PHONE_NUMBER_"),
      "search_tickets 在 800 字符截断前折叠空白符，避免高空白正文将截断半截手机号拉入 240 字符窗口"
    );
    const wsGetTicketStr = String(await invokeTool("get_ticket", { ticketNo: "TK-M5-WS" }));
    const wsGetTicketParsed = JSON.parse(wsGetTicketStr);
    assert(
      !wsGetTicketStr.includes("13899") &&
        String(wsGetTicketParsed.body || "").includes("{{PHONE_NUMBER_"),
      "get_ticket 在 800 字符截断前折叠空白符，完整脱敏后置手机号"
    );

    // 2e-3. Tail-keyword pure-SQL recall for 32-char >=12-word, Q6 (comma), and Q7 (space) queries
    //       Temporarily clear external rerank & embed keys/endpoints to guarantee offline determinism
    {
      const savedRerankKey = process.env.RERANK_API_KEY;
      const savedEmbedKey = process.env.EMBEDDING_API_KEY;
      const savedEmbedEndpoints = process.env.EMBEDDING_ENDPOINTS;
      const savedEmbedClients = globalThis.__civic_embed_clients;
      try {
        process.env.RERANK_API_KEY = "";
        process.env.EMBEDDING_API_KEY = "";
        process.env.EMBEDDING_ENDPOINTS = "";
        globalThis.__civic_embed_clients = new Map();

        const tailRecallRes = JSON.parse(
          String(
            await invokeTool("search_tickets", {
              query: "黄埔区珠江新城地铁站出口旁边天桥底下昨晚有人占道摆摊售卖烧烤油烟",
              limit: 8,
            })
          )
        );
        assert(
          tailRecallRes.retrievalMode === "sql" &&
            Array.isArray(tailRecallRes.hits) &&
            tailRecallRes.hits.some((h: any) => h.ticketNo === "TK-M5-TAIL"),
          `search_tickets 纯SQL离线模式 32字 >=12词长句召回尾部关键词工单 TK-M5-TAIL (mode=${tailRecallRes.retrievalMode}, hits=${JSON.stringify((tailRecallRes.hits || []).map((h: any) => h.ticketNo))})`
        );

        const q6CommaRecallRes = JSON.parse(
          String(
            await invokeTool("search_tickets", {
              query: "天河区，体育西路，地铁站，出口旁边，天桥底下，昨晚有人，占道摆摊，售卖，烧烤油烟",
              limit: 8,
            })
          )
        );
        assert(
          q6CommaRecallRes.retrievalMode === "sql" &&
            Array.isArray(q6CommaRecallRes.hits) &&
            q6CommaRecallRes.hits.some((h: any) => h.ticketNo === "TK-M5-TAIL"),
          `search_tickets 纯SQL离线模式 Q6 (>=7段逗号分隔) 召回 TK-M5-TAIL (hits=${JSON.stringify((q6CommaRecallRes.hits || []).map((h: any) => h.ticketNo))})`
        );

        const q7SpaceRecallRes = JSON.parse(
          String(
            await invokeTool("search_tickets", {
              query: "黄埔区 珠江新城 地铁站 出口 旁边 天桥 底下 昨晚 有人 占道 摆摊 售卖 烧烤 油烟",
              limit: 8,
            })
          )
        );
        assert(
          q7SpaceRecallRes.retrievalMode === "sql" &&
            Array.isArray(q7SpaceRecallRes.hits) &&
            q7SpaceRecallRes.hits.some((h: any) => h.ticketNo === "TK-M5-TAIL"),
          `search_tickets 纯SQL离线模式 Q7 (>=7段空格分隔) 召回 TK-M5-TAIL (hits=${JSON.stringify((q7SpaceRecallRes.hits || []).map((h: any) => h.ticketNo))})`
        );
      } finally {
        if (savedRerankKey === undefined) delete process.env.RERANK_API_KEY;
        else process.env.RERANK_API_KEY = savedRerankKey;
        if (savedEmbedKey === undefined) delete process.env.EMBEDDING_API_KEY;
        else process.env.EMBEDDING_API_KEY = savedEmbedKey;
        if (savedEmbedEndpoints === undefined) delete process.env.EMBEDDING_ENDPOINTS;
        else process.env.EMBEDDING_ENDPOINTS = savedEmbedEndpoints;
        globalThis.__civic_embed_clients = savedEmbedClients;
      }
    }

    // 2f. Mock embed server regressions:
    //   (1) Internal 3500ms embed timeout degrades cleanly to SQL when caller signal is NOT aborted
    //   (2) Caller AbortSignal aborts cleanly with AbortError
    //   (3) Hybrid merge ranks multi-token SQL hits ahead of unmatched vector-only distractors
    const prevEndpoints = process.env.EMBEDDING_ENDPOINTS;
    const prevClients = globalThis.__civic_embed_clients;
    let mockMode: "hang" | "fast" = "fast";
    const mockServer = http.createServer((req, res) => {
      if (mockMode === "hang") {
        // Keep connection open past 3500ms embedQuery timeout without responding
        req.resume();
        return;
      }
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: makeVec(0) }],
            model: "BAAI/bge-m3",
          })
        );
      });
    });

    await new Promise<void>((resolve) => mockServer.listen(0, "127.0.0.1", () => resolve()));
    const port = (mockServer.address() as { port: number }).port;
    try {
      process.env.EMBEDDING_ENDPOINTS = `http://127.0.0.1:${port}/v1`;
      globalThis.__civic_embed_clients = new Map();

      // (3) Hybrid merge ranking: TK-M5-MULTI (multi-token SQL, unembedded) > TK-M5-DIST (vector sim ~ 0.96, 0 overlap)
      mockMode = "fast";
      const hybridRankRes = JSON.parse(
        String(await invokeTool("search_tickets", { query: "天河南二路占道经营", limit: 5 }))
      );
      const multiIdx = (hybridRankRes.hits || []).findIndex((h: any) => h.ticketNo === "TK-M5-MULTI");
      const distIdx = (hybridRankRes.hits || []).findIndex((h: any) => h.ticketNo === "TK-M5-DIST");
      assert(
        multiIdx === 0 && (distIdx === -1 || multiIdx < distIdx),
        `混合重排：多词 SQL 命中 TK-M5-MULTI 排在无词重叠向量干扰项 TK-M5-DIST 之前 (multiIdx=${multiIdx}, distIdx=${distIdx})`
      );

      // (1) Internal embed timeout -> degrades to SQL instead of crashing
      mockMode = "hang";
      globalThis.__civic_embed_clients = new Map();
      const nonAbortedAc = new AbortController();
      const toolsWithSignal = createCopilotTools(TEST_REGION_ID, "GOV_12345", {
        sessionKeymap,
        signal: nonAbortedAc.signal,
      });
      const searchWithNonAborted = toolsWithSignal.find((t) => t.name === "search_tickets") as unknown as {
        invoke: (input: Record<string, unknown>) => Promise<unknown>;
      };
      const timeoutFallbackRes = JSON.parse(
        String(await searchWithNonAborted.invoke({ query: "夜间施工噪音", limit: 5 }))
      );
      assert(
        timeoutFallbackRes.retrievalMode === "sql" &&
          Array.isArray(timeoutFallbackRes.hits) &&
          timeoutFallbackRes.hits.length > 0,
        `内部嵌入超时降级为 SQL 检索而非抛出 AbortError (mode=${timeoutFallbackRes.retrievalMode}, hits=${timeoutFallbackRes.hits?.length})`
      );

      // (2) Caller AbortSignal aborted -> rethrows AbortError
      const abortedAc = new AbortController();
      abortedAc.abort("caller cancelled");
      const toolsAborted = createCopilotTools(TEST_REGION_ID, "GOV_12345", {
        sessionKeymap,
        signal: abortedAc.signal,
      });
      const searchAborted = toolsAborted.find((t) => t.name === "search_tickets") as unknown as {
        invoke: (input: Record<string, unknown>) => Promise<unknown>;
      };
      let callerAbortedErr: unknown = null;
      try {
        await searchAborted.invoke({ query: "夜间施工噪音", limit: 5 });
      } catch (err) {
        callerAbortedErr = err;
      }
      assert(
        Boolean(
          callerAbortedErr &&
            typeof callerAbortedErr === "object" &&
            (callerAbortedErr as { name?: unknown }).name === "AbortError"
        ),
        "调用方主动 AbortSignal 中止时仍正常抛出 AbortError"
      );
    } finally {
      mockServer.closeAllConnections?.();
      await new Promise<void>((resolve) => mockServer.close(() => resolve()));
      if (prevEndpoints === undefined) {
        delete process.env.EMBEDDING_ENDPOINTS;
      } else {
        process.env.EMBEDDING_ENDPOINTS = prevEndpoints;
      }
      globalThis.__civic_embed_clients = prevClients;
    }
  } finally {
    await cleanupTestTenant();
    await assertBaselineUnchanged("清理后");
  }

  if (failures > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
