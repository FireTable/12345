import { SystemOneEngine } from "../src/engine";
import { FallbackAdapter } from "../src/adapters/fallback-adapter";
import { hasCivicRedlineSignal, matchCivicRedline } from "../src/redline";
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

    if (raw.title === "超市售卖过期肉品") {
      assert(
        decision.stabilityRisk === false,
        "常规市监局食品抽检投诉不应触发涉稳红线！"
      );
    }
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

  // 5. 10 类极端高危涉稳红线硬互锁 + 否定/非红线防误杀校验 (ONNX + Fallback 双适配器)
  const fallback = new FallbackAdapter();
  const redlineCases: Array<{ label: string; title: string; content: string }> = [
    { label: "1.自杀轻生", title: "业主欲跳楼轻生", content: "拖欠工程款导致精神崩溃，扬言明天上午去楼顶跳楼。" },
    { label: "2.极端暴力", title: "扬言报复社会", content: "当事人情绪极度失控，声称要带汽油去物业中心同归于尽。" },
    { label: "3.群体上访", title: "组织集体上访", content: "多名业主准备明天集体上访并进京反映小区违建问题。" },
    { label: "4.群体聚集", title: "拉横幅群体维权", content: "数十名购房者在售楼部拉横幅群体维权，现场聚众闹事。" },
    { label: "5.堵路堵门", title: "聚集封桥堵门", content: "部分人员在小区正门堵门并前往大桥封桥阻断交通。" },
    { label: "6.集体罢工", title: "煽动集体罢工", content: "劳资纠纷引发车间员工集体停工并号召全厂罢工。" },
    { label: "7.重大险情", title: "突发路面塌陷", content: "地铁施工附近路面塌陷伴随燃气严重泄漏，有人员伤亡风险。" },
    { label: "8.群体中毒", title: "疑似食物中毒", content: "单位食堂就餐后十余人集体腹泻呕吐，怀疑发生食物中毒。" },
    { label: "9.重大舆情", title: "媒体曝光热搜", content: "投诉人已联系媒体曝光并发布到社交平台冲上热搜，要求立刻处理。" },
    { label: "10.极端威胁", title: "扬言出人命", content: "商户被逼得扬言再不退费就要闹事出人命，现场冲突一触即发。" },
    { label: "11.无证食堂食物中毒", title: "无证食堂食物中毒", content: "无证食堂食物中毒多人送医。" },
    { label: "12.无人处理扬言跳楼", title: "无人处理扬言跳楼", content: "无人处理扬言跳楼请派人核查。" },
    { label: "13.无资质施工路面塌陷", title: "无资质施工路面塌陷", content: "无资质施工路面塌陷威胁行人安全。" },
    { label: "14.转折词后真实跳楼", title: "紧急求助", content: "没有问题但有人跳楼请快来救命！" },
    { label: "15.化工厂突发爆炸起火", title: "化工厂爆燃警情", content: "化工厂车间突发爆炸起火" },
    { label: "16.无人伤亡但发生爆炸", title: "厂区突发爆燃", content: "无人伤亡但发生爆炸" },
    { label: "17.大规模群殴斗殴", title: "治安突发警情", content: "夜市十几人发生大规模群殴斗殴" },
    { label: "18.居民担心危房随时坍塌", title: "危房安全隐患", content: "居民担心危房随时坍塌" },
    { label: "19.居民担心化工厂发生爆炸", title: "化工厂安全隐患", content: "居民担心化工厂发生爆炸" },
    { label: "20.电瓶车充电棚爆炸起火", title: "小区充电棚火灾", content: "小区电瓶车充电棚发生爆炸起火" },
    { label: "21.无证食堂食物中毒及群体腹泻", title: "无证食堂食安警情", content: "无证食堂食物中毒及群体腹泻" },
    { label: "22.持刀伤人恶性事件", title: "菜市场发生持刀伤人恶性事件", content: "有人持菜刀砍伤两名群众，现场混乱" },
    { label: "23.重大交通安全事故", title: "高速路段发生重大交通事故连环相撞", content: "多车追尾起火，现场造成人员重伤被困" },
    { label: "24.涉黑涉恶保护费", title: "举报涉黑涉恶团伙强迫交易保护费", content: "长期敲诈勒索商户收取保护费，涉黑恶势力欺行霸市" },
    { label: "25.燃气管道发生爆炸", title: "燃气险情通报", content: "燃气管道发生爆炸，周边居民已疏散" },
    { label: "26.现场爆炸起火", title: "突发火灾警情", content: "现场爆炸起火，浓烟滚滚" },
  ];

  const explosionMatch = matchCivicRedline("无人伤亡但发生爆炸");
  assert(
    explosionMatch.matched && explosionMatch.keyword?.includes("爆炸"),
    `无人伤亡但发生爆炸应通过爆炸命中而非伤亡，实际: ${JSON.stringify(explosionMatch)}`
  );

  for (const tc of redlineCases) {
    assert(hasCivicRedlineSignal(`${tc.title} ${tc.content}`), `符号红线应命中: ${tc.label}`);
    const onnxDec = await engine.evaluate({ title: tc.title, content: tc.content });
    assert(
      onnxDec.stabilityRisk === true && onnxDec.urgencyLevel === 3 && onnxDec.slaHours === 2,
      `ONNXAdapter 红线未触发或未升急 (${tc.label}): stabilityRisk=${onnxDec.stabilityRisk}, urgency=${onnxDec.urgencyLevel}, sla=${onnxDec.slaHours}`
    );
    const fbDec = await fallback.evaluate({ title: tc.title, content: tc.content });
    assert(
      fbDec.stabilityRisk === true && fbDec.urgencyLevel === 3 && fbDec.slaHours === 2,
      `FallbackAdapter 红线未触发或未升急 (${tc.label}): stabilityRisk=${fbDec.stabilityRisk}, urgency=${fbDec.urgencyLevel}, sla=${fbDec.slaHours}`
    );
  }

  const nonRedlineCases: Array<{ label: string; title: string; content: string }> = [
    { label: "否定-并非跳楼", title: "施工脚手架安全咨询", content: "现场工人是在做高空绳索检修，并非跳楼事件，请勿误传。" },
    { label: "否定-没有发生食物中毒", title: "校园食堂卫生检查反馈", content: "经疾控中心核查，没有发生食物中毒，学生体检各项指标正常。" },
    { label: "否定-无食物中毒", title: "餐饮店复查通报", content: "现场抽检结果合格，无食物中毒及群体腹泻情况。" },
    { label: "否定-无任何人员伤亡", title: "抢修情况说明", content: "现场已处置完毕，无任何人员伤亡。" },
    { label: "否定-已排除群体上访", title: "街道信访隐患排查", content: "经社区沟通调解，已排除群体上访隐患，各方情绪平稳。" },
    { label: "非红线-交通拥堵路况", title: "早高峰交通拥堵路况反映", content: "市民反映大良路段早高峰交通拥堵路况严重，建议优化红绿灯配时。" },
    { label: "非红线-聚集拥堵路况", title: "路段出行建议", content: "早高峰车流聚集拥堵路况明显，建议优化信号灯配时。" },
    { label: "非红线-要求市监局现场核查", title: "超市价格标签不清", content: "市民反映某超市货架标价签与结账不符，要求市监局现场核查处理。" },
    { label: "担忧语境-担心报复社会", title: "社区治安巡逻建议", content: "好担心哪天遇到一个报复社会的醉汉在小区门口晃悠，建议加强夜巡。" },
    { label: "非红线-弱势群体补助咨询", title: "弱势群体补助咨询", content: "市民咨询本区弱势群体医疗与生活补助申请流程。" },
    { label: "非红线-老年群体服务咨询", title: "老年群体服务咨询", content: "咨询社区老年群体助餐补贴如何办理。" },
    { label: "预防语境-建议维修避免伤亡", title: "老旧护栏维修建议", content: "小区楼梯护栏松动，建议尽快维修避免伤亡。" },
    { label: "非红线-道路封路施工", title: "道路施工出行建议", content: "近期附近有道路封路施工，造成绕行不便。" },
    { label: "否定-路口轻微刮擦无人伤亡", title: "交通事故定损咨询", content: "路口两车轻微刮擦，现场无人伤亡，仅咨询保险定损。" },
    { label: "非红线-家用灯泡爆炸", title: "消费质量纠纷", content: "网购的灯泡爆炸，要求商家退款换货。" },
    { label: "非红线-家用热水器爆炸", title: "家电质量售后", content: "家中使用的热水器爆炸损坏，联系厂家售后维权。" },
    { label: "否定-3项食物中毒及集体腹泻链", title: "食安核查反馈", content: "经检查无明显食物中毒、群体中毒及集体腹泻" },
    { label: "否定-疾控中心未出现3项食安链", title: "疾控检测通报", content: "经疾控中心检测未出现任何食物中毒、群体中毒和集体腹泻" },
    { label: "否定-未出现食物中毒集体腹泻和集体呕吐", title: "医院检测通报", content: "未出现食物中毒、集体腹泻和集体呕吐" },
    { label: "否定-现场未发生爆炸", title: "燃气管道检修安全提示", content: "抢修队及时处置阀门泄漏，现场未发生爆炸，无人员受伤" },
    { label: "否定-化工厂未发生爆炸", title: "化工厂安全巡检", content: "化工厂未发生爆炸，安全排查正常" },
    { label: "否定-燃气管道没有爆炸", title: "管道巡检通报", content: "燃气管道没有爆炸，阀门已安全关闭" },
    { label: "否定-未见爆炸并未爆炸", title: "现场核查说明", content: "经现场核查未见爆炸，并未爆炸，无人员受伤" },
    { label: "否定-未造成重大交通事故无人员重伤", title: "高速路段险情排查", content: "货车急刹避让未造成重大交通事故，现场无人员重伤" },
    { label: "否定-未发生持刀伤人不涉及黑恶势力", title: "治安核查反馈", content: "经民警核查未发生持刀伤人事件，亦不涉及黑恶势力" },
    { label: "非红线-预防建议容易造成重大交通事故", title: "路口交通优化建议", content: "行人经常横跨马路容易造成重大交通事故，建议增设斑马线" },
  ];

  for (const tc of nonRedlineCases) {
    assert(!hasCivicRedlineSignal(`${tc.title} ${tc.content}`), `否定/常规文本不应命中符号红线: ${tc.label}`);
    const fbDec = await fallback.evaluate({ title: tc.title, content: tc.content });
    assert(
      fbDec.stabilityRisk === false,
      `FallbackAdapter 不应误报涉稳红线 (${tc.label})`
    );
    const onnxDec = await engine.evaluate({ title: tc.title, content: tc.content });
    assert(
      onnxDec.stabilityRisk === false,
      `ONNXAdapter 不应误报涉稳红线 (${tc.label})`
    );
  }

  console.log("✅ 10 类极端红线硬互锁 + 否定/非红线防误杀校验全部通过！");
  console.log("\n=== @civic/system-one 验证全部通过！===");
  await engine.close();
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
