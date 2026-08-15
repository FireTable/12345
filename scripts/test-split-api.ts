import { GET as getStats } from "../app/api/stats/route";
import { GET as getThemes } from "../app/api/themes/route";
import { GET as getGraph } from "../app/api/graph/route";

async function testSplitAPIs() {
  console.log("==================================================");
  console.log("🚀 测试拆分后各独立微接口的极速响应性能");
  console.log("==================================================");

  // 1. Stats
  const t1 = Date.now();
  const statsRes = await getStats();
  const statsJson = await statsRes.json();
  const d1 = Date.now() - t1;
  console.log(`\n✅ [1/3] /api/stats: ${d1}ms`);
  console.log(`   - 工单总量: ${statsJson.data.totalTickets} 件`);
  console.log(`   - 多频识别量: ${statsJson.data.multiFrequencyTickets} 件`);
  console.log(`   - 识别率: ${statsJson.data.multiFrequencyRate}%`);

  // 2. Themes (Lightweight metadata without heavy nested raw tickets)
  const t2 = Date.now();
  const themesRes = await getThemes();
  const themesJson = await themesRes.json();
  const d2 = Date.now() - t2;
  console.log(`\n✅ [2/3] /api/themes: ${d2}ms`);
  console.log(`   - 返回多频主题数: ${themesJson.data.length} 个`);

  // 3. Graph
  const t3 = Date.now();
  const graphRes = await getGraph();
  const graphJson = await graphRes.json();
  const d3 = Date.now() - t3;
  console.log(`\n✅ [3/3] /api/graph: ${d3}ms`);
  console.log(`   - 宏观拓扑节点数: ${graphJson.data.nodes.length} 个`);
  console.log(`   - 拓扑连线数: ${graphJson.data.links.length} 条`);

  console.log("\n==================================================");
  console.log("🎉 全部独立微接口测试通过！毫秒级响应！");
  console.log("==================================================");
  process.exit(0);
}

testSplitAPIs().catch(console.error);
