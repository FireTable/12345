/**
 * 包测试之外的调用方。只从 @civic/embed 引入，嵌一条字符串。
 */
import http from "node:http";
import { EMBEDDING_DIMENSIONS, createEmbedClient } from "@civic/embed";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

async function main() {
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(chunk as Buffer);
    const body = JSON.parse(Buffer.concat(chunks).toString("utf8")) as { input?: string[] };
    const embedding = new Array<number>(EMBEDDING_DIMENSIONS).fill(0).map((_, index) => (index + (body.input?.[0]?.length ?? 0)) / 1000);
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ data: [{ index: 0, embedding }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  try {
    const client = createEmbedClient({ endpoints: `http://127.0.0.1:${port}/v1`, profile: "online" });
    const [vector] = await client.embed(["金榜上街45号供水故障"]);
    assert(vector?.length === 1024, "调用方拿到 1024 维向量");
    assert(Boolean(vector?.every((value) => Number.isFinite(value))), "调用方拿到的向量值都是有限数");
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
  if (process.exitCode) process.exit(process.exitCode);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
