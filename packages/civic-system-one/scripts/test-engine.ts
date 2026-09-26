import { SystemOneEngine } from "../src/engine.js";

async function main() {
  console.log("====================================================");
  console.log("⚡ 开始 System One 快思考预审引擎集成测试");
  console.log("====================================================\n");

  const engine = await SystemOneEngine.create();
  console.log(`🔌 当前激活适配器: ${engine.currentAdapter}\n`);

  const testCases = [
    {
      title: "测试用例 1: 容桂红绿灯故障紧急工单",
      ticket: {
        title: "容桂街道红绿灯故障导致严重堵车",
        content: "容桂文武庙路口红绿灯故障黑屏，早高峰双向车流瘫痪发生刮蹭，请交警速派人现场疏导！",
        subdistrict: "容桂街道",
      },
    },
    {
      title: "测试用例 2: 大良餐饮油烟直排扰民",
      ticket: {
        title: "大良街道餐饮夜间油烟直排扰民",
        content: "大良中区某烧烤店夜间将油烟排气管直插居民下水道，气味呛人影响老人孩子休息。",
        subdistrict: "大良街道",
      },
    },
    {
      title: "测试用例 3: 涉稳群访群体纠纷（触发护栏）",
      ticket: {
        title: "某工地拖欠数百名工人工资扬言封桥维权",
        content: "某楼盘总包跑路，300名农民工被欠薪超过半年，情绪激动正聚集准备堵路维权，情况紧急。",
        subdistrict: "大良街道",
      },
    },
  ];

  let totalLatency = 0;

  for (const { title, ticket } of testCases) {
    console.log(`----------------------------------------------------`);
    console.log(`【${title}】`);
    const start = performance.now();
    const decision = await engine.evaluate(ticket);
    const duration = performance.now() - start;
    totalLatency += duration;

    console.log(`⏱️ 决策耗时: ${duration.toFixed(3)} ms (内部推理: ${decision.latencyMs.toFixed(3)} ms)`);
    console.log(`📋 诉求性质: [${decision.intent}] (置信度: ${(decision.intentProbability * 100).toFixed(1)}%)`);
    console.log(`🏷️ 业务分类: ${decision.categoryName} (${decision.category}, 置信度: ${(decision.categoryProbability * 100).toFixed(1)}%)`);
    console.log(`🚨 紧迫度: L${decision.urgencyLevel} (${decision.urgencyScore.toFixed(2)}分) | SLA承诺时限: ${decision.slaHours}小时`);
    console.log(`🛡️ 涉稳红线: ${decision.stabilityRisk ? "⚠️ 触发高危涉稳预警" : "✅ 正常"}`);
    console.log(`⚖️ 权责交叉: ${decision.crossDepartmentRisk ? "⚠️ 存在多部门推诿交叉风险" : "✅ 单一部门明晰"}`);
    console.log();
  }

  const avgLatency = (totalLatency / testCases.length).toFixed(3);
  console.log("====================================================");
  console.log(`🎉 System One 全部测试完成！平均单工单端到端延迟: ${avgLatency} ms`);
  console.log("====================================================");

  await engine.close();
}

main().catch((err) => {
  console.error("System One 测试失败:", err);
  process.exit(1);
});
