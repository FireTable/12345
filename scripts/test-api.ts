import { GET } from "../app/api/cluster/route";

async function testClusterAPI() {
  console.log("==================================================");
  console.log("🌐 正在测试 /api/cluster 接口返回数据...");
  console.log("==================================================\n");

  const res = await GET();
  const json = await res.json();

  console.log("✅ 接口响应成功:", json.success);
  console.log("==================================================\n");
  process.exit(0);
}

testClusterAPI().catch(console.error);
