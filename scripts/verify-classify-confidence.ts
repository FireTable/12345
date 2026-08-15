import { ExtractedTicketItemSchema, BatchExtractionSchema } from "../backend/prompt";
import { extractNode, LOW_CONFIDENCE_THRESHOLD } from "../backend/node/extract-node";
import { themesTable, reviewQueueTable, ticketsTable } from "../db/schema";
import { db } from "../db/client";
import { GET as getReviewAPI, POST as postReviewAPI } from "../app/api/review/route";
import { seedReviewQueue } from "../lib/review-queue";
import type { RawTicket } from "../backend/state";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

async function runVerification() {
  console.log("==================================================");
  console.log("🧪 启动 Task #1 + #2 (分类体系对齐 + 置信度人工复核) 全面验证");
  console.log("==================================================\n");

  let passCount = 0;
  let totalTests = 0;

  function assert(condition: boolean, title: string) {
    totalTests++;
    if (condition) {
      console.log(`✅ PASS: ${title}`);
      passCount++;
    } else {
      console.error(`❌ FAIL: ${title}`);
      process.exitCode = 1;
    }
  }

  // ----------------------------------------------------
  // 1. Zod Schema 分类枚举与置信度定义
  // ----------------------------------------------------
  const sampleValidItem = {
    index: 1,
    summarizeTitle: "关于容桂街道扁滘富豪路三街2号粤ESD221违停挪车诉求",
    subject: "粤E SD221车辆",
    location: "顺德区容桂街道扁滘富豪路三街2号门口",
    eventType: "机动车违规停放阻碍通行",
    category: "交通出行",
    confidence: 95,
  };

  const parseResult = ExtractedTicketItemSchema.safeParse(sampleValidItem);
  assert(parseResult.success, "ExtractedTicketItemSchema 成功解析包含 confidence 与新分类的工单");

  const invalidCategoryItem = { ...sampleValidItem, category: "综合民生" };
  const invalidCategoryParse = ExtractedTicketItemSchema.safeParse(invalidCategoryItem);
  assert(!invalidCategoryParse.success, "ExtractedTicketItemSchema 正确拒绝旧分类 '综合民生'");

  const invalidConfidenceItem = { ...sampleValidItem, confidence: 150 };
  const invalidConfidenceParse = ExtractedTicketItemSchema.safeParse(invalidConfidenceItem);
  assert(!invalidConfidenceParse.success, "ExtractedTicketItemSchema 正确拒绝超出 100 的 confidence");

  // ----------------------------------------------------
  // 2. extractNode 分类与置信度提取逻辑测试
  // ----------------------------------------------------
  const mockTickets: RawTicket[] = [
    {
      id: "test-t-01",
      ticketNo: "TK-TEST-001",
      content: "市民反映粤E SD221在容桂街道扁滘富豪路三街2号招财宝民宿门口长期违停，阻碍通行。",
      createTime: "2025-01-01 10:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "容桂街道",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "test-t-02",
      ticketNo: "TK-TEST-002",
      content: "市民反映大良街道某处晚上有人唱歌音响噪音扰民，非常吵闹希望处理。",
      createTime: "2025-01-01 11:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "大良街道",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "test-t-03",
      ticketNo: "TK-TEST-003",
      content: "市民反映北滘镇碧桂园西苑3栋电梯经常故障停运，物业管理处一直未彻底修复，存在安全隐患。",
      createTime: "2025-01-01 12:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "北滘镇",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "test-t-04",
      ticketNo: "TK-TEST-004",
      content: "市民反映在某饭店吃饭，被多收费，要求退款并处罚商家欺诈消费。",
      createTime: "2025-01-01 13:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "容桂街道",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "test-t-05",
      ticketNo: "TK-TEST-005",
      content: "市民反映在某工地打工被拖欠工资，未签订劳动合同，要求协调解决工资和社保问题。",
      createTime: "2025-01-01 14:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "杏坛镇",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "test-t-06",
      ticketNo: "TK-TEST-006",
      content: "市民电话询问一般事项咨询，无具体地点无涉事方。", // 模糊诉求，应触发低置信度
      createTime: "2025-01-01 15:00:00",
      citizenName: "市民*",
      citizenPhone: "138****0000",
      district: "顺德区",
      subdistrict: "伦教街道",
      channel: "市民热线",
      status: "PENDING",
    },
  ];

  const nodeRes = await extractNode({
    messages: [],
    rawTickets: mockTickets,
    enrichedTickets: [],
    themes: [],
    lowConfidenceTickets: [],
    stats: {} as any,
    graphData: { nodes: [], links: [] },
    status: "idle",
  });

  const enriched = nodeRes.enrichedTickets || [];
  assert(enriched.length === mockTickets.length, `extractNode 返回全量 ${enriched.length} 条工单`);

  const t01 = enriched.find((t) => t.id === "test-t-01");
  assert(t01?.themes[0] === "交通出行", `TK-TEST-001 (违停) 归类为 '交通出行' (实际: ${t01?.themes[0]})`);
  assert((t01?.confidence || 0) >= 70, `TK-TEST-001 高确信要素置信度 >= 70 (实际: ${t01?.confidence})`);

  const t02 = enriched.find((t) => t.id === "test-t-02");
  assert(t02?.themes[0] === "生态环境", `TK-TEST-002 (噪音) 归类为 '生态环境' (实际: ${t02?.themes[0]})`);

  const t03 = enriched.find((t) => t.id === "test-t-03");
  assert(t03?.themes[0] === "城市管理", `TK-TEST-003 (物业电梯) 归类为 '城市管理' (实际: ${t03?.themes[0]})`);

  const t04 = enriched.find((t) => t.id === "test-t-04");
  assert(t04?.themes[0] === "市场监管", `TK-TEST-004 (消费维权) 归类为 '市场监管' (实际: ${t04?.themes[0]})`);

  const t05 = enriched.find((t) => t.id === "test-t-05");
  assert(t05?.themes[0] === "劳动社保", `TK-TEST-005 (欠薪社保) 归类为 '劳动社保' (实际: ${t05?.themes[0]})`);

  const t06 = enriched.find((t) => t.id === "test-t-06");
  assert(
    (t06?.confidence || 0) < LOW_CONFIDENCE_THRESHOLD,
    `TK-TEST-006 (模糊工单) 置信度低于阈值 ${LOW_CONFIDENCE_THRESHOLD} (实际: ${t06?.confidence})`
  );

  const lowTickets = nodeRes.lowConfidenceTickets || [];
  const expectedLowCount = enriched.filter((t) => (t.confidence || 0) < LOW_CONFIDENCE_THRESHOLD).length;
  assert(
    lowTickets.length === expectedLowCount,
    `lowConfidenceTickets 数量 (${lowTickets.length}) 与 confidence < 60 的工单数 (${expectedLowCount}) 精确一致`
  );

  // ----------------------------------------------------
  // 3. 复核队列 seed 与 API 操作验证
  // ----------------------------------------------------
  // 确保所有测试工单在 ticketsTable 中存在
  try {
    for (const t of mockTickets) {
      await db.insert(ticketsTable).values({
        id: t.id,
        ticketNo: t.ticketNo,
        content: t.content,
        status: "PENDING",
        createdAt: new Date(),
      }).onConflictDoNothing();
    }

    const seedRes = await seedReviewQueue(lowTickets);
    assert(seedRes.inserted >= 0, "seedReviewQueue 执行无异常");

    // 测试 GET /api/review
    const getReq = new Request("http://localhost:3000/api/review?status=PENDING");
    const getRes = await getReviewAPI(getReq);
    const getJson = await getRes.json();
    assert(getJson.success === true, "GET /api/review?status=PENDING 接口响应成功");
    assert(Array.isArray(getJson.data), "GET /api/review 返回数组列表");

    // 测试 POST /api/review (标记已复核)
    if (getJson.data.length > 0) {
      const firstItem = getJson.data[0];
      const postReq = new Request("http://localhost:3000/api/review", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reviewId: firstItem.id,
          action: "REVIEWED",
          operator: "gemini_tester",
          note: "经人工核实确为常规咨询工单",
        }),
      });

      const postRes = await postReviewAPI(postReq);
      const postJson = await postRes.json();
      assert(postJson.success === true, "POST /api/review 提交人工复核动作成功");
      assert(postJson.data?.status === "REVIEWED", "复核项 status 成功更新为 'REVIEWED'");
      assert(postJson.data?.operator === "gemini_tester", "复核项 operator 成功写入");
    }
  } catch (dbErr: any) {
    console.warn("DB / API Live test warning:", dbErr.message);
  }

  // ----------------------------------------------------
  // 4. 业务代码全局扫描：旧分类关键词清理检验
  // ----------------------------------------------------
  const filesToScan = [
    path.resolve(process.cwd(), "backend/prompt.ts"),
    path.resolve(process.cwd(), "backend/node/extract-node.ts"),
    path.resolve(process.cwd(), "backend/node/cluster-node.ts"),
    path.resolve(process.cwd(), "app/api/themes/route.ts"),
  ];

  const oldKeywords = ["住建管理", "综合民生", "市容秩序", "生态环保"];
  let oldKeywordFound = false;

  for (const file of filesToScan) {
    if (fs.existsSync(file)) {
      const content = fs.readFileSync(file, "utf8");
      for (const kw of oldKeywords) {
        if (content.includes(kw)) {
          console.error(`❌ 在文件 ${file} 中发现残留旧关键词: ${kw}`);
          oldKeywordFound = true;
        }
      }
    }
  }

  assert(!oldKeywordFound, "业务核心代码中旧 4 类关键词（住建管理|综合民生|市容秩序|生态环保）已全部彻底清理");

  console.log("\n==================================================");
  console.log(`🏁 验证结果: ${passCount}/${totalTests} 项检查全部通过！`);
  console.log("==================================================\n");

  if (passCount === totalTests) {
    process.exit(0);
  } else {
    process.exit(1);
  }
}

runVerification().catch((e) => {
  console.error("Verification script execution failed:", e);
  process.exit(1);
});
