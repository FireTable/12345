import { runTicketRadarPipeline } from "../backend/agent";
import { MOCK_RAW_TICKETS } from "../lib/mock-data";

async function testAgent() {
  console.log("==================================================");
  console.log("🚀 正在测试 LangGraph Agent Workflow 实际执行...");
  console.log(`📥 输入工单总量: ${MOCK_RAW_TICKETS.length} 条`);
  console.log("==================================================\n");

  const startTime = Date.now();
  const result = await runTicketRadarPipeline(MOCK_RAW_TICKETS, "test-thread-001");
  const elapsed = Date.now() - startTime;

  console.log(`\n🎉 LangGraph Agent 执行完成！(耗时: ${elapsed}ms)`);
  console.log("--------------------------------------------------");
  console.log("📊 统计指标 (Stats):", JSON.stringify(result.stats, null, 2));
  console.log("--------------------------------------------------");
  console.log(`🧩 生成多频主题总数: ${result.themes.length} 个`);
  result.themes.slice(0, 5).forEach((t, i) => {
    console.log(`  [${i + 1}] 风险: ${t.riskLevel} | 主体: ${t.canonicalSubject} | 件数: ${t.ticketCount}单 | 主题: ${t.title}`);
  });
  console.log("--------------------------------------------------");
  console.log(`🌐 知识图谱生成节点数: ${result.graphData.nodes.length} 个, 边关系数: ${result.graphData.links.length} 条`);
  console.log("==================================================\n");
}

testAgent().catch(console.error);
