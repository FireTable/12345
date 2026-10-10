import { SystemOneEngine } from "../src/engine";
import { CivicAnonymizer } from "@civic/anonymizer";
import { encodeCivicText, SHARED_MODEL_LABELS, modelScoresFullText } from "../src/adapters/onnx-adapter";
import * as fs from "node:fs";
import * as path from "node:path";

function assert(condition: unknown, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

async function main() {
  console.log("=== 启动 @civic/system-one 冒烟验证套件 ===\n");

  // 1. 初始化引擎
  const engine = await SystemOneEngine.create({ preferredMode: "auto" });
  console.log(`[Engine] 当前自适应激活的推断适配器: ${engine.currentAdapter}`);

  // 2. 测试样本
  const testTickets = [
    {
      title: "水管爆裂路面积水",
      content: "市民反映大良街道某路段主水管突发爆裂漏水严重，水流漫上车道导致双向交通严重受阻，要求供水抢修队立即加急到场处置。",
    },
    {
      title: "咨询港澳通行证签注",
      content: "市民咨询顺德区出入境办证大厅周六上午是否正常对外办理港澳通行证签注业务，需要携带哪些身份证明材料。",
    },
    {
      title: "拖欠农民工工资",
      content: "市民反映其在某工地从事钢筋工，项目已竣工验收但劳务公司拖欠2024年11月至12月劳动报酬共计18000元，多次催讨无果要求协调督促。",
    },
    {
      title: "超市售卖过期肉品",
      content: "市民投诉某大型超市销售的冷鲜肉品已过保质期两天，涉嫌销售不合格食品，要求市监局现场核查并予以处罚。",
    },
    {
      title: "楼道电动车飞线充电",
      content: "市民反映某住宅小区18栋楼道内多名租户私拉飞线为电动自行车充电，电线裸露且直接垂挂在木质扶手旁，存在重大火灾失火隐患！",
    },
  ];

  for (const raw of testTickets) {
    const clean = CivicAnonymizer.anonymize(raw.content);
    const decision = await engine.evaluate({
      title: raw.title,
      content: clean.text,
    });

    console.log(`\n【工单标题】: ${raw.title}`);
    console.log(`- 行为性质: ${decision.intent} (置信度: ${(decision.intentProbability * 100).toFixed(1)}%)`);
    console.log(`- 法定大类: ${decision.category} [${decision.categoryName}] (置信度: ${(decision.categoryProbability * 100).toFixed(1)}%)`);
    console.log(`- 紧迫度评级: Level ${decision.urgencyLevel} (承诺时限: ${decision.slaHours}小时)`);
    console.log(`- 涉稳红线拦截: ${decision.stabilityRisk ? "⚠️ 触发警报" : "正常"}`);
    console.log(`- 交叉扯皮预警: ${decision.crossDepartmentRisk ? "⚠️ 建议联合派单" : "单一承办"}`);
    console.log(`- 决策时延: ${decision.latencyMs} ms (驱动: ${decision.adapterUsed})`);
  }

  // 3. 属地动态分类插拔测试 (模拟广州海珠区定制分类: 琶洲会展经济保障 + 珠江港航海事)
  console.log("\n--- 测试属地动态自定义分类插拔 (海珠区定制分类注入) ---");
  const haizhuCustomCategories = {
    exhibition_economy: "琶洲广交会展会展馆周边秩序、参展商侵权维权、酒店违规哄抬房价、外商接待保障",
    port_shipping: "珠江水域船舶违规停靠、货运客运码头装卸噪声油污、内河水上安全事件",
    urban_management: "市政排水排污、违建乱搭乱建、市容卫生垃圾清运",
    traffic: "道路拥堵、公交地铁服务、交通违规停放",
  };
  const haizhuNameMap = {
    exhibition_economy: "会展经济保障",
    port_shipping: "港航海事监管",
    urban_management: "城市综合管理",
    traffic: "交通出行畅通",
  };

  const dynamicTicket = {
    title: "琶洲展馆外商酒店房费欺诈",
    content: "市民反映广交会期间某参展商预订了琶洲展馆附近的星级酒店，现场被告知要强制加价1200元，涉嫌欺诈要求会展专席立即协调督办退差价！",
  };
  const dynamicDecision = await engine.evaluate(
    { title: dynamicTicket.title, content: dynamicTicket.content },
    { categories: haizhuCustomCategories, categoryNameMap: haizhuNameMap }
  );

  console.log(`【动态属地工单】: ${dynamicTicket.title}`);
  console.log(`- 动态匹配分类: ${dynamicDecision.category} [${dynamicDecision.categoryName}] (置信度: ${(dynamicDecision.categoryProbability * 100).toFixed(1)}%)`);
  console.log(`- 行为性质: ${dynamicDecision.intent}`);
  console.log(`- 紧迫度: Level ${dynamicDecision.urgencyLevel}`);
  console.log(`- 驱动引擎: ${dynamicDecision.adapterUsed}`);

  // 4. 读取 fixtures 冒烟
  const fixturePath = path.join(process.cwd(), "packages/civic-system-one/fixtures/seed-dataset.jsonl");
  if (fs.existsSync(fixturePath)) {
    const lines = fs.readFileSync(fixturePath, "utf-8").trim().split("\n");
    console.log(`\n[Fixture] 成功验证冒烟种子库: ${lines.length} 条有效 Laya 标准 QA 记录。`);
  }

  const preset = JSON.parse(fs.readFileSync(path.resolve("lib/presets/foshan_shunde.json"), "utf-8"));
  const shundeTowns = preset.townships.map((town: { fullName: string }) => town.fullName);
  const banned = [...shundeTowns, "顺德区"];
  for (const name of banned) {
    assert(!SHARED_MODEL_LABELS.includes(name), `共享模型含有镇街类: ${name}`);
  }

  const vocab = JSON.parse(
    fs.readFileSync(path.resolve("packages/civic-system-one/models/vocab_civic.json"), "utf-8")
  );
  const tokenToId = new Map<string, number>();
  (vocab.tokens as string[]).forEach((token, index) => tokenToId.set(token, index));
  const longBody = "市民".repeat(200);
  const fullCount = encodeCivicText(tokenToId, longBody).length;
  assert(fullCount > 128, `长正文应超过 128 个 token，实际 ${fullCount}`);

  const emptyTitle = await engine.evaluate({ title: "", content: longBody });
  assert(engine.currentAdapter === "onnx" && emptyTitle.adapterUsed === "onnx", "应走 ONNX");
  assert(!!emptyTitle.intent && !!emptyTitle.category, "空标题也要给出意图和分类");
  assert([0, 1, 2, 3].includes(emptyTitle.urgencyLevel), "紧迫度缺失");
  assert(typeof emptyTitle.stabilityRisk === "boolean", "涉稳结果缺失");
  assert(emptyTitle.township === "UNKNOWN", `模型不应给出镇街: ${emptyTitle.township}`);
  assert(emptyTitle.bodyTokenCount === fullCount, `正文 token ${emptyTitle.bodyTokenCount}，全文是 ${fullCount}`);
  assert(emptyTitle.bodyTokenCount > 128, "正文仍被截成 128");
  assert(emptyTitle.titleTokenCount >= 1, "空标题没有送进模型");

  const noTown = await engine.evaluate({
    title: "",
    content: "市民来电咨询办理进度，希望得到回复。",
  });
  assert(noTown.township !== "大良街道", "正文没有镇街时不应填成大良街道");
  assert(noTown.township === "UNKNOWN", `无地点工单被填成镇街: ${noTown.township}`);
  assert(!!noTown.intent && !!noTown.category && typeof noTown.stabilityRisk === "boolean", "无地点工单缺少原有字段");

  const modelPath = path.resolve("packages/civic-system-one/models/civic-laya-onnx/model.onnx");
  assert(modelScoresFullText(modelPath), "线上模型不是全文导出");
  const importDynamic = new Function("modulePath", "return import(modulePath)");
  const ort = await importDynamic("onnxruntime-node");
  const session = await ort.InferenceSession.create(modelPath);
  const outputNames = session.outputNames as string[];
  assert(!outputNames.includes("township_logits"), "共享模型仍在输出镇街");
  assert(outputNames.includes("intent_logits") && outputNames.includes("stability_logits"), "四项输出缺失");
  if (typeof session.release === "function") await session.release();

  console.log("ASSERT_FIELDS intent category urgencyLevel stabilityRisk township bodyTokenCount");
  console.log(`ASSERT_OK emptyTitle=decision longBodyTokens=${emptyTitle.bodyTokenCount} classes=${SHARED_MODEL_LABELS.length}`);
  console.log("\n=== @civic/system-one 验证全部通过！===");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
