/**
 * M5 P0 #8 单元测试：@civic/embed AbortSignal 透传、冷却恢复、
 * 以及 backend/embed-products.ts 进程级健康感知单例。
 */
import http from "node:http";
import {
  EMBEDDING_DIMENSIONS,
  createEmbedClient,
} from "@civic/embed";
import { getSharedEmbedClient } from "../backend/embed-products";

let failures = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failures += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function unitVector(seed: number): number[] {
  const arr = new Array<number>(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) arr[i] = ((seed + i) % 89) / 89;
  return arr;
}

interface MockEmbedServer {
  url: string;
  hits: number;
  close: () => Promise<void>;
}

async function startMockEmbed(
  onPost: (req: http.IncomingMessage, res: http.ServerResponse, attempt: number) => void | Promise<void>
): Promise<MockEmbedServer> {
  let hits = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.includes("/embeddings")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    hits += 1;
    for await (const _ of req) {
      // drain
    }
    await onPost(req, res, hits);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    get hits() {
      return hits;
    },
    close: () =>
      new Promise((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

async function main() {
  // 1. AbortSignal 中止 429 退避且不标不健康、不重试
  const rateLimitServer = await startMockEmbed(async (_req, res) => {
    res.statusCode = 429;
    res.end("rate limit");
  });
  const backupServer = await startMockEmbed(async (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ index: 0, embedding: unitVector(1) }] }));
  });

  try {
    const client = createEmbedClient({
      endpoints: [`cloud:${rateLimitServer.url}`, backupServer.url],
      profile: "online",
      sleep: (_ms, signal) =>
        new Promise((resolve, reject) => {
          if (signal?.aborted) {
            const e = new Error("aborted");
            e.name = "AbortError";
            reject(e);
            return;
          }
          const t = setTimeout(resolve, 5000);
          signal?.addEventListener(
            "abort",
            () => {
              clearTimeout(t);
              const e = new Error("aborted during sleep");
              e.name = "AbortError";
              reject(e);
            },
            { once: true }
          );
        }),
    });

    const ac = new AbortController();
    setTimeout(() => ac.abort("caller cancelled"), 25);
    let abortedErr: unknown = null;
    try {
      await client.embed(["测试文本"], { signal: ac.signal });
    } catch (err) {
      abortedErr = err;
    }
    assert(
      abortedErr instanceof Error && abortedErr.name === "AbortError",
      "AbortSignal 中止 429 退避抛出 AbortError"
    );
    assert(
      rateLimitServer.hits === 1 && backupServer.hits === 0,
      "AbortSignal 中止后不重试同一节点也不切换备用节点"
    );
    assert(
      client.getNodeHealth().every((n) => n.healthy),
      "AbortSignal 中止不将节点标记为不健康"
    );
  } finally {
    await rateLimitServer.close();
    await backupServer.close();
  }

  // 2. timeoutMs 超时记不健康 + 冷却期内跳过 + 冷却期满恢复
  let nowMs = 1_000_000;
  let slowMode = true;
  const nodeA = await startMockEmbed(async (_req, res) => {
    if (slowMode) {
      await new Promise((r) => setTimeout(r, 150));
    }
    if (!res.writableEnded) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ index: 0, embedding: unitVector(2) }] }));
    }
  });
  const nodeB = await startMockEmbed(async (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ index: 0, embedding: unitVector(3) }] }));
  });

  try {
    const client = createEmbedClient({
      endpoints: [nodeA.url, nodeB.url],
      profile: "online",
      unhealthyCooldownMs: 30_000,
      now: () => nowMs,
    });

    const v1 = await client.embed(["q1"], { timeoutMs: 40 });
    assert(v1[0]?.length === EMBEDDING_DIMENSIONS, "nodeA 超时后转移到 nodeB 返回向量");
    assert(nodeA.hits === 1 && nodeB.hits === 1, "首次探测 nodeA 并切换 nodeB");
    assert(!client.getNodeHealth()[0].healthy, "超时后 nodeA 记为 healthy=false");

    // 冷却期内再次请求 -> 跳过 nodeA
    await client.embed(["q2"], { timeoutMs: 40 });
    assert(nodeA.hits === 1 && nodeB.hits === 2, "冷却期内直接跳过不健康的 nodeA");

    // 冷却期满后恢复探测
    slowMode = false;
    nowMs += 35_000;
    await client.embed(["q3"], { timeoutMs: 200 });
    await client.embed(["q4"], { timeoutMs: 200 });
    assert(nodeA.hits >= 2, "冷却期满后 nodeA 恢复健康并重新参与调度");
    assert(client.getNodeHealth()[0].healthy === true, "nodeA 成功后重置 healthy=true");
  } finally {
    await nodeA.close();
    await nodeB.close();
  }

  // 3. getSharedEmbedClient 单例与健康记忆持久化
  const s1 = await startMockEmbed(async (_req, res) => {
    res.statusCode = 500;
    res.end("down");
  });
  const s2 = await startMockEmbed(async (_req, res) => {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ index: 0, embedding: unitVector(4) }] }));
  });
  try {
    const c1 = getSharedEmbedClient({
      endpoints: [s1.url, s2.url],
      profile: "online",
      apiKey: "secret-a",
    });
    const c2 = getSharedEmbedClient({
      endpoints: [s1.url, s2.url],
      profile: "online",
      apiKey: "secret-a",
    });
    const c3 = getSharedEmbedClient({
      endpoints: [s1.url, s2.url],
      profile: "bulk",
      apiKey: "secret-a",
    });
    assert(c1 === c2, "相同配置的 getSharedEmbedClient 返回同一单例实例");
    assert(c1 !== c3, "不同 profile 返回独立实例");

    await c1.embed(["first"]);
    await c2.embed(["second"]);
    assert(s1.hits === 1 && s2.hits === 2, "单例跨请求保留 s1 不健康记忆，第二次跳过 s1");
  } finally {
    await s1.close();
    await s2.close();
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
