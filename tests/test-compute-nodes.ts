/**
 * 阶段 3 Colab 算力节点动态挂载与探活端到端验收测试（Verifier 独立编写）
 *
 * 红线守卫：
 * 1. 所有测验均使用本地模拟 Colab HTTP Server 与临时记录，严禁写入任何真实密钥；
 * 2. try/finally 保证测试结束后清理 public.compute_nodes 临时测试记录、关闭 Mock HTTP Server 并 reloadSystemTwoPool()；
 * 3. 全程严禁触碰 region_gz_tianhe (103397 / 5748) 与 region_fs_shunde (135666 / 9222)。
 */

import http from "node:http";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { sql, db } from "../db/client";
import { computeNodesTable } from "../db/schema";
import { GET as computeNodesGet, POST as computeNodesPost } from "../app/api/admin/compute-nodes/route";
import { PATCH as computeNodePatch, DELETE as computeNodeDelete } from "../app/api/admin/compute-nodes/[id]/route";
import { POST as computeNodeProbe } from "../app/api/admin/compute-nodes/probe/route";
import { getSystemTwoEngine, reloadSystemTwoPool } from "../backend/model";
import { resolveActiveEmbedEndpoints } from "../backend/embed-products";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
} as const;

let failedAssertions = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failedAssertions += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

async function readRegionCounts(schemaName: string): Promise<{ tickets: number; themes: number }> {
  const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".tickets`);
  const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".themes`);
  return {
    tickets: Number(tRow?.c ?? 0),
    themes: Number(thRow?.c ?? 0),
  };
}

async function assertBaselineUnchanged(stage: string) {
  const tianhe = await readRegionCounts(BASELINE.gz_tianhe.schema);
  const shunde = await readRegionCounts(BASELINE.fs_shunde.schema);
  assert(
    tianhe.tickets === BASELINE.gz_tianhe.tickets && tianhe.themes === BASELINE.gz_tianhe.themes,
    `[${stage}] gz_tianhe 基线零变动 (tickets=${tianhe.tickets}/${BASELINE.gz_tianhe.tickets}, themes=${tianhe.themes}/${BASELINE.gz_tianhe.themes})`
  );
  assert(
    shunde.tickets === BASELINE.fs_shunde.tickets && shunde.themes === BASELINE.fs_shunde.themes,
    `[${stage}] fs_shunde 基线零变动 (tickets=${shunde.tickets}/${BASELINE.fs_shunde.tickets}, themes=${shunde.themes}/${BASELINE.fs_shunde.themes})`
  );
}

function makeRequest(
  pathWithQuery: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string> }
) {
  const url = `http://civic.test${pathWithQuery}`;
  const headers = new Headers({
    ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(init?.headers ?? {}),
  });
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function main() {
  await assertBaselineUnchanged("前置");

  const mockToken = `colab-verify-token-${Date.now()}`;
  let chatHits = 0;
  let unauthHits = 0;

  const server = http.createServer((req, res) => {
    setTimeout(() => {
      const auth = req.headers.authorization || "";
      if (auth !== `Bearer ${mockToken}`) {
        unauthHits += 1;
        res.writeHead(401, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: { message: "Unauthorized" } }));
        return;
      }
      if (req.method === "GET" && req.url === "/v1/models") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ object: "list", data: [{ id: "Qwen2.5-14B-Instruct", object: "model" }] }));
        return;
      }
      if (req.method === "POST" && req.url === "/v1/chat/completions") {
        chatHits += 1;
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            id: "chatcmpl-mock-colab",
            object: "chat.completion",
            created: Math.floor(Date.now() / 1000),
            model: "Qwen2.5-14B-Instruct",
            choices: [
              {
                index: 0,
                message: { role: "assistant", content: JSON.stringify({ status: "colab-ok" }) },
                finish_reason: "stop",
              },
            ],
            usage: { prompt_tokens: 12, completion_tokens: 6, total_tokens: 18 },
            timings: { predicted_per_second: 24.5, predicted_ms: 250, predicted_n: 6 },
          })
        );
        return;
      }
      if (req.method === "POST" && req.url === "/v1/embeddings") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(
          JSON.stringify({
            object: "list",
            data: [{ object: "embedding", index: 0, embedding: new Array(1024).fill(0.01) }],
            model: "BAAI/bge-m3",
          })
        );
        return;
      }
      res.writeHead(404);
      res.end();
    }, 600);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  const mockEndpoint = `http://127.0.0.1:${port}/v1`;
  const createdIds: string[] = [];

  try {
    assert(port > 0, `Mock Colab OpenAI 服务监听于 ${mockEndpoint} (模拟 600ms 延迟)`);

    // 1. 错误 Token 探活拦截 (401)
    const badProbeRes = await computeNodeProbe(
      makeRequest("/api/admin/compute-nodes/probe", {
        method: "POST",
        body: { endpoint: mockEndpoint, apiKey: "wrong-token", role: "SYSTEM_TWO", provider: "COLAB" },
      })
    );
    const badProbeJson = await badProbeRes.json();
    assert(
      badProbeRes.status === 200 &&
        badProbeJson.data?.status === "OFFLINE" &&
        badProbeJson.data?.httpStatus === 401 &&
        unauthHits >= 1,
      "错 Token 探活返回 OFFLINE 且 Mock 服务拦截 401"
    );

    // 2. 正确 Token 探活（验证 600ms 延迟下仍判 ONLINE 且 >= 500ms）
    const goodProbeRes = await computeNodeProbe(
      makeRequest("/api/admin/compute-nodes/probe", {
        method: "POST",
        body: { endpoint: mockEndpoint, apiKey: mockToken, role: "SYSTEM_TWO", provider: "COLAB" },
      })
    );
    const goodProbeJson = await goodProbeRes.json();
    assert(
      goodProbeRes.status === 200 &&
        goodProbeJson.data?.status === "ONLINE" &&
        Number(goodProbeJson.data?.latencyMs) >= 500 &&
        Array.isArray(goodProbeJson.data?.models) &&
        goodProbeJson.data.models.includes("Qwen2.5-14B-Instruct"),
      `600ms 延迟下探活成功 ONLINE (${goodProbeJson.data?.latencyMs}ms, models=${JSON.stringify(goodProbeJson.data?.models)})`
    );

    // 3. POST /api/admin/compute-nodes 新增 COLAB SYSTEM_TWO 节点
    const createRes = await computeNodesPost(
      makeRequest("/api/admin/compute-nodes", {
        method: "POST",
        body: {
          name: "Colab L4 测试节点",
          role: "SYSTEM_TWO",
          provider: "COLAB",
          endpoint: mockEndpoint,
          apiKey: mockToken,
          model: "Qwen2.5-14B-Instruct",
          probeNow: true,
        },
      })
    );
    const createJson = await createRes.json();
    const createdId = String(createJson.data?.id || "");
    if (createdId) createdIds.push(createdId);
    assert(
      createRes.status === 200 &&
        createJson.success === true &&
        Boolean(createdId) &&
        createJson.data?.provider === "COLAB" &&
        createJson.data?.lastStatus === "ONLINE" &&
        Number(createJson.data?.lastLatencyMs) >= 500 &&
        !JSON.stringify(createJson).includes(mockToken),
      `POST /api/admin/compute-nodes 创建 COLAB 节点成功且不回显明文 Token (id=${createdId})`
    );

    // 4. GET /api/admin/compute-nodes 严禁包含明文 apiKey
    const listRes = await computeNodesGet();
    const listJson = await listRes.json();
    const listText = JSON.stringify(listJson);
    const foundNode = (listJson.data?.nodes || []).find((n: { id: string }) => n.id === createdId);
    assert(
      listRes.status === 200 &&
        Boolean(foundNode) &&
        foundNode.hasApiKey === true &&
        foundNode.apiKeyHint === `****${mockToken.slice(-4)}` &&
        !("apiKey" in foundNode) &&
        !listText.includes(mockToken),
      `GET /api/admin/compute-nodes 仅返回 hasApiKey=true 与脱敏 hint (${foundNode?.apiKeyHint})，无明文密钥`
    );

    // 5. reloadSystemTwoPool() + SystemTwoEngine 真实路由并通过 Bearer 鉴权请求 Mock Colab
    const reloaded = await reloadSystemTwoPool();
    assert(
      reloaded.endpoints.includes(mockEndpoint) && reloaded.activeNodes >= 1,
      `reloadSystemTwoPool() 热重载包含 Mock Colab 节点 (${reloaded.endpoints.join(", ")})`
    );

    const engine = await getSystemTwoEngine();
    assert(
      engine.getHealthyEndpoints().includes(mockEndpoint),
      "SystemTwoEngine.getHealthyEndpoints() 包含 Mock Colab 节点"
    );

    const TestSchema = z.object({ status: z.string() });
    const jsonRes = await engine.createJSON(TestSchema, {
      messages: [{ role: "user", content: "ping colab" }],
      enableThinking: false,
    });
    assert(
      jsonRes.data?.status === "colab-ok" && chatHits >= 1,
      `SystemTwoEngine 成功把推理请求路由并鉴权通过 Mock Colab 节点 (chatHits=${chatHits}, endpoint=${jsonRes.endpoint})`
    );

    // 6. PATCH 禁用后再启用，验证热重载隔离
    const disableRes = await computeNodePatch(
      makeRequest(`/api/admin/compute-nodes/${createdId}`, {
        method: "PATCH",
        body: { enabled: false },
      }),
      { params: Promise.resolve({ id: createdId }) }
    );
    const disableJson = await disableRes.json();
    const afterDisable = await reloadSystemTwoPool();
    assert(
      disableRes.status === 200 &&
        disableJson.data?.enabled === false &&
        !afterDisable.endpoints.includes(mockEndpoint),
      "PATCH enabled=false 后节点从 System-2 集群热移除"
    );

    // 7. 测试 EMBEDDING 角色节点合并到 resolveActiveEmbedEndpoints()
    const embCreateRes = await computeNodesPost(
      makeRequest("/api/admin/compute-nodes", {
        method: "POST",
        body: {
          name: "Colab BGE-M3 向量节点",
          role: "EMBEDDING",
          provider: "COLAB",
          endpoint: mockEndpoint,
          apiKey: mockToken,
          model: "BAAI/bge-m3",
        },
      })
    );
    const embCreateJson = await embCreateRes.json();
    const embId = String(embCreateJson.data?.id || "");
    if (embId) createdIds.push(embId);
    const activeEmbeds = await resolveActiveEmbedEndpoints();
    const matchedEmbed = activeEmbeds.find((e) => e.endpoint === mockEndpoint);
    assert(
      Boolean(matchedEmbed) && matchedEmbed?.provider === "COLAB" && matchedEmbed?.apiKey === mockToken,
      "resolveActiveEmbedEndpoints() 成功合并启用中的 COLAB EMBEDDING 节点"
    );

    // 8. DELETE 删除测试节点并再次 reloadSystemTwoPool()
    for (const delId of [...createdIds]) {
      const delRes = await computeNodeDelete(
        makeRequest(`/api/admin/compute-nodes/${delId}`, { method: "DELETE" }),
        { params: Promise.resolve({ id: delId }) }
      );
      assert(delRes.status === 200, `DELETE /api/admin/compute-nodes/${delId} 成功`);
    }
    const afterDelete = await reloadSystemTwoPool();
    assert(
      !afterDelete.endpoints.includes(mockEndpoint),
      "删除节点并 reloadSystemTwoPool() 后，Mock Colab 节点已彻底移除"
    );
  } finally {
    // 兜底清理任何残留测试记录并重载算力池
    try {
      await db.delete(computeNodesTable).where(eq(computeNodesTable.endpoint, mockEndpoint));
      for (const id of createdIds) {
        await db.delete(computeNodesTable).where(eq(computeNodesTable.id, id));
      }
      await reloadSystemTwoPool().catch(() => {});
    } catch {
      // ignore cleanup errors if table didn't exist
    }
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await assertBaselineUnchanged("清理后");
  }

  if (failedAssertions > 0) {
    console.error(`\n❌ 阶段 3 验收失败: ${failedAssertions} 项断言未通过`);
    process.exit(1);
  }
  console.log("\n✅ tests/test-compute-nodes.ts 全项端到端验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
