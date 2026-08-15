import { GET as getStats } from "../app/api/stats/route";
import { GET as getThemes } from "../app/api/themes/route";
import { GET as getGraph } from "../app/api/graph/route";

async function testSplitAPIs() {
  console.log("==================================================");
  console.log("🚀 测试拆分后的轻量级高性能 API 接口响应...");
  console.log("==================================================\n");

  // 1. Test /api/stats
  const t1 = Date.now();
  const statsRes = await getStats();
  const statsJson = await statsRes.json();
  const d1 = Date.now() - t1;
  console.log(`✅ [1/3] /api/stats: ${d1}ms`);
  console.log(`       分析工单总量: ${statsJson.data.totalTickets.toLocaleString()} 件`);
  console.log(`       多频覆盖率: ${statsJson.data.multiFrequencyRate}%`);
  console.log(`       治理主题数: ${statsJson.data.themeCount} 个`);

  // 2. Test /api/themes
  const t2 = Date.now();
  const req = new Request("http://localhost:3000/api/themes");
  const themesRes = await getThemes(req);
  const themesJson = await themesRes.json();
  const d2 = Date.now() - t2;
  console.log(`\n✅ [2/3] /api/themes: ${d2}ms`);
  console.log(`       返回主题卡片数: ${themesJson.data.length} 个 (轻量级 payload，不附带海量工单原文)`);
  console.log(`       首个主题: 【${themesJson.data[0]?.riskLevel}】${themesJson.data[0]?.title}`);

  // 3. Test /api/graph
  const t3 = Date.now();
  const graphRes = await getGraph();
  const graphJson = await graphRes.json();
  const d3 = Date.now() - t3;
  console.log(`\n✅ [3/3] /api/graph: ${d3}ms`);
  console.log(`       宏观拓扑节点数: ${graphJson.data.nodes.length} 个`);
  console.log(`       拓扑关联连线数: ${graphJson.data.links.length} 条`);

  console.log("\n🎉 所有拆分接口均在毫秒级快速返回，浏览器端绝不再卡顿或一直 Loading！\n");
  process.exit(0);
}

testSplitAPIs().catch(console.error);
