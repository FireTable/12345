/**
 * 驱动 packages/civic-embed 的公开入口。本地假 /v1/embeddings，不调 bge-m3，不调 edgefn。
 */
import http from "node:http";
import {
  CLOUD_RATE_LIMIT_BACKOFF_MS,
  EMBEDDING_DIMENSIONS,
  EMBEDDING_MODEL,
  createEmbedClient,
} from "@civic/embed";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

function unitVector(seed: number): number[] {
  const values = new Array<number>(EMBEDDING_DIMENSIONS);
  for (let i = 0; i < EMBEDDING_DIMENSIONS; i++) values[i] = ((seed + i) % 97) / 97;
  return values;
}

interface FakeEmbed {
  url: string;
  hits: number;
  bodies: Array<{ model?: string; input?: string[] }>;
  maxInFlight: number;
  close: () => Promise<void>;
}

async function startFake(opts: {
  onRequest?: (body: { model?: string; input?: string[] }, attempt: number) => { status: number; hold?: Promise<void> } | undefined;
}): Promise<FakeEmbed> {
  let hits = 0;
  let inFlight = 0;
  let maxInFlight = 0;
  const bodies: Array<{ model?: string; input?: string[] }> = [];
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || !req.url?.includes("/embeddings")) {
      res.statusCode = 404;
      res.end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { model?: string; input?: string[] };
    hits += 1;
    inFlight += 1;
    maxInFlight = Math.max(maxInFlight, inFlight);
    bodies.push(body);
    const decision = opts.onRequest?.(body, hits);
    if (decision?.hold) await decision.hold;
    const status = decision?.status ?? 200;
    if (status !== 200) {
      inFlight -= 1;
      res.statusCode = status;
      res.end(status === 429 ? "rate limit" : "upstream failed");
      return;
    }
    const input = body.input ?? [];
    const data = input.map((text, index) => ({
      index,
      embedding: unitVector(text.length + index + hits),
    }));
    inFlight -= 1;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    get hits() {
      return hits;
    },
    bodies,
    get maxInFlight() {
      return maxInFlight;
    },
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}

async function waitUntil(pred: () => boolean): Promise<void> {
  const started = Date.now();
  while (!pred()) {
    if (Date.now() - started > 2000) throw new Error("timed out waiting for fake embedding server");
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function main() {
  const sleeps: number[] = [];
  const sleep = async (ms: number) => {
    sleeps.push(ms);
  };

  const localA = await startFake({});
  const localB = await startFake({});
  try {
    const client = createEmbedClient({
      endpoints: `${localA.url},${localB.url}`,
      profile: "bulk",
      sleep,
    });
    const texts = Array.from({ length: 96 }, (_, index) => `工单${index}`);
    const started = Date.now();
    const vectors = await client.embed(texts);
    const elapsed = Date.now() - started;
    assert(vectors.length === 96, "96 条文本返回 96 条向量");
    assert(vectors.every((vector) => vector.length === EMBEDDING_DIMENSIONS), "每条向量 1024 维");
    assert(vectors.every((vector) => vector.every((value) => Number.isFinite(value))), "向量值都是有限数");
    assert(localA.bodies.concat(localB.bodies).every((body) => body.model === EMBEDDING_MODEL), "请求模型是 BAAI/bge-m3");
    assert(localA.hits + localB.hits === 3, `本地 bulk 96 条分成 3 批，实际 ${localA.hits + localB.hits}`);
    assert(
      localA.bodies.concat(localB.bodies).every((body) => (body.input?.length ?? 0) === 32),
      "bulk 每批 32 条"
    );
    assert(elapsed < 2000, "三批本地嵌入在 2 秒内完成");
    assert(Math.max(localA.maxInFlight, localB.maxInFlight) === 1, "单个 embed() 同时只有一个批次在飞");
    assert(localA.hits > 0 && localB.hits > 0, "连续批次在端点之间摊开");
    assert(sleeps.length === 0, "本地端点批次之间不休眠，也不做 429 退避");
  } finally {
    await localA.close();
    await localB.close();
  }

  let releaseHold: () => void = () => {};
  const hold = new Promise<void>((resolve) => {
    releaseHold = resolve;
  });
  let held = true;
  const slow = await startFake({
    onRequest: () => (held ? { status: 200, hold } : { status: 200 }),
  });
  const fast = await startFake({});
  try {
    const client = createEmbedClient({
      endpoints: [slow.url, fast.url],
      profile: "bulk",
      sleep,
    });
    const first = client.embed(["先占住慢端点"]);
    await waitUntil(() => slow.hits === 1);
    const second = client.embed(["第二条走空闲端点"]);
    await waitUntil(() => fast.hits === 1);
    held = false;
    releaseHold();
    const [left, right] = await Promise.all([first, second]);
    assert(left[0]?.length === EMBEDDING_DIMENSIONS && right[0]?.length === EMBEDDING_DIMENSIONS, "并发两条都返回 1024 维");
    assert(slow.hits === 1 && fast.hits === 1, "在途数更少的端点接到下一条");
  } finally {
    held = false;
    releaseHold();
    await slow.close();
    await fast.close();
  }

  const down = await startFake({ onRequest: () => ({ status: 500 }) });
  const up = await startFake({});
  try {
    const client = createEmbedClient({ endpoints: [down.url, up.url], profile: "bulk", sleep });
    const vectors = await client.embed(["故障转移"]);
    assert(vectors.length === 1 && vectors[0].length === EMBEDDING_DIMENSIONS, "首选端点失败后改走备用端点");
    assert(down.hits === 1 && up.hits === 1, "失败端点和备用端点都被打到");
  } finally {
    await down.close();
    await up.close();
  }

  const outA = await startFake({ onRequest: () => ({ status: 500 }) });
  const outB = await startFake({ onRequest: () => ({ status: 500 }) });
  try {
    const client = createEmbedClient({ endpoints: [outA.url, outB.url], profile: "bulk", sleep });
    let thrown: unknown;
    try {
      await client.embed(["全部宕机"]);
    } catch (error) {
      thrown = error;
    }
    assert(thrown instanceof Error, "全部端点宕机时抛错");
    assert(!(thrown instanceof Array), "宕机时不编造向量");
    assert(outA.hits > 0 && outB.hits > 0, "宕机前每个端点都试过");
  } finally {
    await outA.close();
    await outB.close();
  }

  const online = await startFake({});
  try {
    const client = createEmbedClient({ endpoints: online.url, profile: "online", sleep });
    const vectors = await client.embed(["a", "b", "c", "d", "e", "f", "g", "h", "i"]);
    assert(vectors.length === 9, "online 档 9 条都返回");
    assert(
      online.bodies.map((body) => body.input?.length).join(",") === "4,4,1",
      `online 档按 4 条一批，实际 ${online.bodies.map((body) => body.input?.length).join(",")}`
    );
  } finally {
    await online.close();
  }

  const local429 = await startFake({
    onRequest: (_body, attempt) => (attempt === 1 ? { status: 429 } : { status: 200 }),
  });
  const beforeLocal = sleeps.length;
  try {
    const client = createEmbedClient({ endpoints: local429.url, profile: "bulk", sleep });
    const started = Date.now();
    const vectors = await client.embed(["本地限流"]);
    assert(vectors[0]?.length === EMBEDDING_DIMENSIONS, "纯本地 429 重试后仍返回 1024 维");
    assert(Date.now() - started < 2000, "纯本地 429 不等待云端退避");
    assert(!sleeps.slice(beforeLocal).includes(CLOUD_RATE_LIMIT_BACKOFF_MS), "没有云端端点时不发生 429 等待");
  } finally {
    await local429.close();
  }

  const cloud429 = await startFake({
    onRequest: (_body, attempt) => (attempt === 1 ? { status: 429 } : { status: 200 }),
  });
  const beforeCloud = sleeps.length;
  try {
    const client = createEmbedClient({
      endpoints: `cloud:${cloud429.url}`,
      profile: "online",
      sleep,
    });
    const vectors = await client.embed(["云端限流"]);
    assert(vectors[0]?.length === EMBEDDING_DIMENSIONS, "配置了云端端点时 429 退避后返回向量");
    assert(
      sleeps.slice(beforeCloud).includes(CLOUD_RATE_LIMIT_BACKOFF_MS),
      `云端 429 等待 ${CLOUD_RATE_LIMIT_BACKOFF_MS}ms`
    );
  } finally {
    await cloud429.close();
  }

  if (process.exitCode) {
    console.error("embed package checks failed");
    process.exit(process.exitCode);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
