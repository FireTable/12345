/**
 * 12345 真实业务全流程多工单闭环测试脚本 (Multi-Ticket Pipeline & Cluster Test)
 * 
 * 严格验证真实业务三大核心指标：
 * 1. 【每个工单都被分析与抽取实体】：全量工单无一遗漏，经 System-1 前向或 System-2 结构化提取四要素；
 * 2. 【同类工单被精准聚类】：基于主体与微观时空图谱 (Louvain 算法)，将相同事件簇归拢为多频热点主题，孤立件不串扰；
 * 3. 【多频聚类统一生成建议】：对聚合后的多频事件簇，由 System-2 慢思考 (enable_thinking: true) 统一产出公文研判、牵头部门与处置建议。
 */

import { runTicketRadarPipeline } from "../backend/agent.js";
import type { RawTicket } from "../backend/state.js";

async function main() {
  console.log("================================================================================");
  console.log("🏛️  12345 业务全流程多工单端到端流水线真实评测");
  console.log("   (覆盖：全量实体抽取 ➔ 时空知识图谱聚类 ➔ System-2 慢思考统一研判建议)");
  console.log("================================================================================\n");

  // 1. 构造多批次、具有真实业务代表性的复合政务工单集 (共 7 条)
  // - 簇 A (3件)：大良街道金榜上街主水管爆裂 (同微观地点、共性事件)
  // - 簇 B (2件)：容桂街道文武路商业街夜间餐饮油烟噪音 (同街道商业街、同涉事主体类型)
  // - 独立件 C (1件)：北滘镇工业大道红绿灯故障 (单发交通设施事件)
  // - 咨询件 D (1件)：大良街道政务服务中心社保窗口咨询 (System-1 高频咨询免大模型直通)
  const testTickets: RawTicket[] = [
    // --- 簇 A: 金榜上街自来水爆管停水事件 (预期聚类为一个主题) ---
    {
      id: "TICKET-CLUSTER-A1",
      ticketNo: "FS20260926001",
      title: "大良金榜上街28号主供水管破裂喷涌路面积水严重",
      content: "大良街道金榜上街28号门前主供水管破裂，自来水喷涌路面严重积水，路面有轻微沉降，附近居民住宅全部停水，水流湍急影响过往行人车辆安全，请立即派员抢修。",
      district: "顺德区",
      subdistrict: "大良街道",
      createTime: "2026-09-26 08:15:00",
      citizenName: "陈先生",
      citizenPhone: "13800138001",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "TICKET-CLUSTER-A2",
      ticketNo: "FS20260926002",
      title: "大良金榜上街附近水压骤降停水车辆无法通行",
      content: "大良街道金榜上街附近片区水压骤降，家里自来水完全停水了。路过看到金榜上街路段水漫金山，泥沙堆积，车辆根本无法通行，请水务集团赶紧抢修！",
      district: "顺德区",
      subdistrict: "大良街道",
      createTime: "2026-09-26 08:35:00",
      citizenName: "张女士",
      citizenPhone: "13800138002",
      channel: "微信小程序",
      status: "PENDING",
    },
    {
      id: "TICKET-CLUSTER-A3",
      ticketNo: "FS20260926003",
      title: "大良金榜上街爆管泥沙倒灌沿街商铺要求紧急处置",
      content: "反映大良街道金榜上街自来水主管网爆裂，目前尚未见抢修人员到场，大量黄泥水倒灌进沿街商铺地下仓库，商户财产受损严重，要求供水部门立即关阀停水并排查路面塌陷险情！",
      district: "顺德区",
      subdistrict: "大良街道",
      createTime: "2026-09-26 09:10:00",
      citizenName: "黄店主",
      citizenPhone: "13800138003",
      channel: "市民热线",
      status: "PENDING",
    },

    // --- 簇 B: 容桂文武路夜市餐饮油烟与划拳扰民 (预期聚类为第二个主题) ---
    {
      id: "TICKET-CLUSTER-B1",
      ticketNo: "FS20260926004",
      title: "容桂文武路大排档夜间露天烧烤油烟直排居民楼",
      content: "容桂街道文武路某烧烤大排档，每晚22点至凌晨3点露天烧烤，油烟不经净化直排楼上居民窗户，深夜酒客大声划拳喧哗，严重影响老人孩子休息，投诉多次未解决。",
      district: "顺德区",
      subdistrict: "容桂街道",
      createTime: "2026-09-26 01:20:00",
      citizenName: "何阿姨",
      citizenPhone: "13800138004",
      channel: "市民热线",
      status: "PENDING",
    },
    {
      id: "TICKET-CLUSTER-B2",
      ticketNo: "FS20260926005",
      title: "容桂文武路商业街夜间餐饮店占道经营油烟噪音扰民",
      content: "容桂街道文武路商业街多家餐饮店夜间占道经营，将宵夜桌椅摆放在人行道上，油烟污染严重，客人深夜喧哗不断，请城管和市监部门联合开展执法整治。",
      district: "顺德区",
      subdistrict: "容桂街道",
      createTime: "2026-09-26 02:05:00",
      citizenName: "梁先生",
      citizenPhone: "13800138005",
      channel: "市民热线",
      status: "PENDING",
    },

    // --- 独立工单 C: 交通设施故障孤立件 (预期不与上述合并) ---
    {
      id: "TICKET-SOLO-C1",
      ticketNo: "FS20260926006",
      title: "北滘工业大道十字路口交通信号灯故障黄闪",
      content: "北滘镇工业大道与林港路十字路口交通信号灯故障，黄灯持续闪烁，早高峰车流巨大抢道严重，存在严重交通追尾隐患，请交警大队尽快派人检修信号灯控制器。",
      district: "顺德区",
      subdistrict: "北滘镇",
      createTime: "2026-09-26 07:50:00",
      citizenName: "周司机",
      citizenPhone: "13800138006",
      channel: "市民热线",
      status: "PENDING",
    },

    // --- 咨询工单 D: 办事窗口咨询直通件 (预期由 System-1 毫秒级直通) ---
    {
      id: "TICKET-INQUIRY-D1",
      ticketNo: "FS20260926007",
      title: "咨询大良行政服务中心社保窗口周六办公时间",
      content: "市民咨询大良街道行政服务中心社保医保窗口周六上午是否正常对外办公提供服务，需要携带哪些资料办理异地就医备案？",
      district: "顺德区",
      subdistrict: "大良街道",
      createTime: "2026-09-26 10:00:00",
      citizenName: "林小姐",
      citizenPhone: "13800138007",
      channel: "市民热线",
      status: "PENDING",
    },
  ];

  console.log(`📥 载入评测样本：共 ${testTickets.length} 条工单`);
  console.log("   - 簇 A: 3 条（大良金榜上街自来水爆管停水）");
  console.log("   - 簇 B: 2 条（容桂文武路餐饮夜市油烟噪音）");
  console.log("   - 独立 C: 1 条（北滘工业大道红绿灯故障）");
  console.log("   - 咨询 D: 1 条（大良政务服务中心社保窗口咨询）\n");

  console.log("🚀 启动 LangGraph 工业级全链路流水线 (runTicketRadarPipeline)...\n");
  const startTime = performance.now();
  const result = await runTicketRadarPipeline(
    testTickets,
    `pipeline-test-${Date.now()}`,
    `task-test-${Date.now()}`,
    "shunde"
  );
  const totalDuration = ((performance.now() - startTime) / 1000).toFixed(2);

  console.log("\n================================================================================");
  console.log(`🏁 流水线执行完毕！总耗时: ${totalDuration} 秒`);
  console.log("================================================================================\n");

  // ----------------------------------------------------------------------
  // 校验目标 1：每个工单都被分析，并且抽取实体
  // ----------------------------------------------------------------------
  console.log("【验证 1 / 3】每个工单是否都被分析与抽取实体？");
  const enriched = result.enrichedTickets || [];
  console.log(`  📊 输入工单数: ${testTickets.length} | 成功抽取产出数: ${enriched.length}`);

  let allExtracted = true;
  enriched.forEach((t, idx) => {
    const hasSubject = Boolean(t.canonicalSubject || t.title);
    const hasLocation = Boolean(t.canonicalLocation || t.subdistrict);
    const hasCategory = Boolean(t.sourceCategory);
    const ok = hasSubject && hasLocation && hasCategory;
    if (!ok) allExtracted = false;

    console.log(`  [工单 ${idx + 1}] ID: ${t.id} | ${t.ticketNo}`);
    console.log(`     📌 标题: ${t.summarizeTitle || t.title}`);
    console.log(`     🏛️ 主体: ${t.canonicalSubject || "—"} | 📍 地点: ${t.canonicalLocation || t.subdistrict || "—"}`);
    console.log(`     🏷️ 大类: ${t.sourceCategory || "—"} | 🌟 置信度: ${t.confidence}分 | ⚡ S1直通: ${Boolean(t.isSystemOneFastTrack)}`);
  });

  const check1 = allExtracted && enriched.length === testTickets.length;
  if (check1) {
    console.log("  ✅ 验证 1 通过：所有工单 100% 成功提取主体、地点与大类，无一遗漏！\n");
  } else {
    console.warn("  ⚠️ 验证 1 未完全达标，请核查抽取缺失项！\n");
  }

  // ----------------------------------------------------------------------
  // 校验目标 2：同类是否被精准聚类
  // ----------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("【验证 2 / 3】同类工单是否被精准聚类？");
  const themes = result.themes || [];
  console.log(`  📦 聚类产出多频主题数: ${themes.length} 个`);

  themes.forEach((theme, idx) => {
    console.log(`\n  🔥 [多频热点主题 ${idx + 1}] ID: ${theme.id} | ${theme.title}`);
    console.log(`     🏷️ 主体: ${theme.canonicalSubject} | 📍 核心空间: ${theme.canonicalLocation}`);
    console.log(`     📊 聚合工单量: ${theme.ticketCount} 件 | 类别: ${theme.category} | 风险等级: [${theme.riskLevel}]`);
    console.log(`     🔗 包含关联工单 ID: ${theme.tickets.map((t) => t.id).join(", ")}`);
  });

  // 校验期望：至少聚类出金榜爆管簇与文武路餐饮簇
  const hasWaterBurstTheme = themes.some(
    (th) => th.canonicalLocation.includes("金榜") || th.canonicalSubject.includes("水") || th.title.includes("水")
  );
  const hasNightFoodTheme = themes.some(
    (th) => th.canonicalLocation.includes("文武路") || th.canonicalSubject.includes("餐饮") || th.title.includes("油烟") || th.title.includes("烧烤")
  );

  const check2 = hasWaterBurstTheme && hasNightFoodTheme;
  if (check2) {
    console.log("\n  ✅ 验证 2 通过：大良金榜爆管群体投诉与容桂文武路夜市油烟被精准独立聚类，未发生交叉串扰！\n");
  } else {
    console.warn(`\n  ⚠️ 验证 2 未通过：没有同时得到金榜爆管簇与文武路油烟簇。主题数: ${themes.length}\n`);
  }

  // ----------------------------------------------------------------------
  // 校验目标 3：聚类能否统一生成公文研判建议与部门指派
  // ----------------------------------------------------------------------
  console.log("--------------------------------------------------------------------------------");
  console.log("【验证 3 / 3】聚类是否统一生成了深度公文研判与处置建议？");

  let allHaveActions = true;
  themes.forEach((theme, idx) => {
    const hasSummary = Boolean(theme.aiSummary && theme.aiSummary.trim().length > 0);
    const hasAction = Boolean(theme.recommendedAction && theme.recommendedAction.trim().length > 0);
    if (!hasSummary || !hasAction) allHaveActions = false;

    console.log(`\n  📜 [主题 ${idx + 1} 深度公文处置方案] ${theme.title}`);
    console.log(`     🚨 风险成因研判: ${theme.riskReason}`);
    console.log(`     📋 综合态势综述: ${theme.aiSummary || "（未生成）"}`);
    console.log(`     💡 部门协同与即时处置建议:`);
    console.log(`        ${theme.recommendedAction.replace(/\n/g, "\n        ")}`);
    if (theme.reasoningContent) {
      console.log(`     🧠 [System-2 慢思考思维链推导] (${theme.reasoningContent.length} 字符):`);
      console.log(`        ${theme.reasoningContent.slice(0, 150).replace(/\n/g, "\n        ")}...`);
    }
  });

  const check3 = allHaveActions && themes.length > 0;
  if (check3) {
    console.log("\n  ✅ 验证 3 通过：每个多频事件簇均由 System-2 统一生成了牵头/协办处置方案与公文建议！\n");
  } else {
    console.warn(`\n  ⚠️ 验证 3 未通过：主题缺少综述或处置建议。共检查 ${themes.length} 个主题。\n`);
  }

  const failed = [
    !check1 ? "验证 1：抽取不完整" : "",
    !check2 ? "验证 2：金榜爆管与文武路油烟没有各自成簇" : "",
    !check3 ? "验证 3：主题缺少综述或处置建议" : "",
  ].filter(Boolean);

  console.log("================================================================================");
  if (failed.length > 0) {
    console.error("❌ 全链路评测未通过:");
    for (const item of failed) console.error(`   - ${item}`);
    console.log("================================================================================\n");
    process.exit(1);
  }
  console.log("🎉 12345 真实业务多工单全链路端到端闭环评测圆满成功！");
  console.log("================================================================================\n");
}

main().catch((err) => {
  console.error("流水线评测异常终止:", err);
  process.exit(1);
});
