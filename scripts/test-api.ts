import { GET } from "../app/api/cluster/route";

async function testClusterAPI() {
  console.log("==================================================");
  console.log("🌐 正在测试 /api/cluster 接口真实返回数据...");
  console.log("==================================================\n");

  const req = new Request("http://localhost:3000/api/cluster");
  const res = await GET(req);
  const json = await res.json();

  console.log("✅ 接口响应成功:");
  console.log("   数据来源 (Source):", json.source);
  console.log("   总分析工单量 (totalTickets):", json.data.stats.totalTickets);
  console.log("   多频识别量 (multiFrequencyTickets):", json.data.stats.multiFrequencyTickets);
  console.log("   聚合主题数 (themeCount):", json.data.stats.themeCount);
  console.log("   压缩率 (compressionRatio):", json.data.stats.compressionRatio + "%");
  console.log("   图谱节点数 (graphNodes):", json.data.graphData.nodes.length);
  console.log("\nTop 3 主题样例:");
  json.data.themes.slice(0, 3).forEach((t: any, i: number) => {
    console.log(`   [${i + 1}] 【${t.riskLevel}】${t.title} (${t.ticketCount}单)`);
  });
  console.log("==================================================\n");
  process.exit(0);
}

testClusterAPI().catch(console.error);
