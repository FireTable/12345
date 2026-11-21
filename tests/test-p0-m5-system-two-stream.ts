/**
 * M5 P0 #8 单元测试：@civic/system-two 流式输出、跨 chunk <think> 剥离、
 * 首包前/首包后故障转移、以及 AbortSignal 隔离（绝不误标节点不健康）。
 */
import http from "node:http";
import {
  LocalMetalAdapter,
  SystemTwoEngine,
  ThinkStreamSplitter,
  isAbortError,
} from "@civic/system-two";

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

interface MockServer {
  url: string;
  hits: number;
  close: () => Promise<void>;
}

async function startMockSseServer(
  handler: (req: http.IncomingMessage, res: http.ServerResponse, attempt: number) => void | Promise<void>
): Promise<MockServer> {
  let hits = 0;
  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && (req.url?.includes("/models") || req.url?.includes("/health"))) {
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: "bonsai-2-27b" }] }));
      return;
    }
    if (req.method === "POST" && req.url?.includes("/chat/completions")) {
      hits += 1;
      for await (const _ of req) {
        // drain body
      }
      await handler(req, res, hits);
      return;
    }
    res.statusCode = 404;
    res.end();
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

function sseData(payload: unknown): string {
  return `data: ${JSON.stringify(payload)}\n\n`;
}

async function main() {
  // 1. ThinkStreamSplitter 单元测试
  {
    const splitter = new ThinkStreamSplitter();
    const parts = ["<thi", "nk>先想", "一下</thi", "nk>\n\n你好", "，1 <", " 2"];
    let content = "";
    let reasoning = "";
    for (const p of parts) {
      const out = splitter.push(p);
      content += out.content;
      reasoning += out.reasoning;
    }
    const fl = splitter.flush();
    content += fl.content;
    reasoning += fl.reasoning;
    assert(reasoning === "先想一下", "ThinkStreamSplitter 正确提取跨 chunk 思维链");
    assert(content === "你好，1 < 2", "ThinkStreamSplitter 剥离前导空行且不误伤 '1 < 2'");
  }
  {
    const splitter = new ThinkStreamSplitter();
    const out1 = splitter.push("<think>截断的思考");
    const out2 = splitter.flush();
    assert(
      out1.content + out2.content === "" && out1.reasoning + out2.reasoning === "截断的思考",
      "ThinkStreamSplitter 未闭合 <think> 在 EOF 归入 reasoning"
    );
  }

  // 2. LocalMetalAdapter.chatCompletionsStream & SystemTwoEngine.createStream
  const sseServer = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream; charset=utf-8");
    res.write(sseData({ choices: [{ delta: { reasoning_content: "步骤1" } }] }));
    res.write(sseData({ choices: [{ delta: { content: "<thi" } }] }));
    res.write(sseData({ choices: [{ delta: { content: "nk>内部</think>\n第一" } }] }));
    res.write(sseData({ choices: [{ delta: { content: "段话" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });

  try {
    const adapter = new LocalMetalAdapter({ endpoint: sseServer.url, timeoutMs: 5000 });
    let content = "";
    let reasoning = "";
    for await (const chunk of adapter.chatCompletionsStream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (chunk.deltaContent) content += chunk.deltaContent;
      if (chunk.deltaReasoning) reasoning += chunk.deltaReasoning;
    }
    assert(content === "第一段话", "LocalMetalAdapter.chatCompletionsStream 流式提取纯正文");
    assert(reasoning === "步骤1内部", "LocalMetalAdapter.chatCompletionsStream 合并推理与 inline think");
  } finally {
    await sseServer.close();
  }

  // 3. 首包前故障转移: Node A 返回 500 -> Node B 接管；全部本地失败 -> Cloud 接管
  const nodeA500 = await startMockSseServer(async (_req, res) => {
    res.statusCode = 500;
    res.end("server down");
  });
  const nodeB = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "来自备用节点" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const engine = await SystemTwoEngine.create({
      endpoints: [nodeA500.url, nodeB.url],
      timeoutMs: 5000,
    });
    let text = "";
    for await (const chunk of engine.chat.completions.createStream({
      messages: [{ role: "user", content: "test" }],
    })) {
      if (chunk.deltaContent) text += chunk.deltaContent;
    }
    assert(text === "来自备用节点", "首包前 Node A 500 自动无缝故障转移至 Node B");
    assert(
      !engine.getHealthyEndpoints().includes(nodeA500.url) &&
        engine.getHealthyEndpoints().includes(nodeB.url),
      "Node A 500 被标记为不健康，Node B 保持健康"
    );
  } finally {
    await nodeA500.close();
    await nodeB.close();
  }

  // 3b. 本地全失败 -> CloudOpenAIAdapter 故障转移
  const deadLocal = await startMockSseServer(async (_req, res) => {
    res.statusCode = 502;
    res.end("bad gateway");
  });
  const cloudOk = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "云端兜底流" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const engine = await SystemTwoEngine.create({
      endpoints: [deadLocal.url],
      cloudFallback: { endpoint: cloudOk.url, apiKey: "k", model: "m" },
      timeoutMs: 5000,
    });
    let text = "";
    for await (const chunk of engine.chat.completions.createStream({
      messages: [{ role: "user", content: "test" }],
    })) {
      if (chunk.deltaContent) text += chunk.deltaContent;
    }
    assert(text === "云端兜底流", "本地集群首包前全失败后降级至 CloudOpenAIAdapter 流式输出");
  } finally {
    await deadLocal.close();
    await cloudOk.close();
  }

  // 4. 首包后失败不拼接、不切换节点
  const midDrop = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "前半句" } }] }));
    await new Promise((r) => setTimeout(r, 20));
    res.socket?.destroy();
  });
  const backupUnused = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "绝不应该拼接" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const engine = await SystemTwoEngine.create({
      endpoints: [midDrop.url, backupUnused.url],
      timeoutMs: 5000,
    });
    let collected = "";
    let caught: unknown = null;
    try {
      for await (const chunk of engine.chat.completions.createStream({
        messages: [{ role: "user", content: "test" }],
      })) {
        if (chunk.deltaContent) collected += chunk.deltaContent;
      }
    } catch (err) {
      caught = err;
    }
    assert(Boolean(caught) && collected === "前半句", "首包后断流立即抛错且不拼接后续内容");
    assert(backupUnused.hits === 0, "首包后断流不切换到备用节点");
  } finally {
    await midDrop.close();
    await backupUnused.close();
  }

  // 5. Caller AbortSignal vs 内部超时隔离
  const abortableServer = await startMockSseServer(async (req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "首字" } }] }));
    // hold stream open until client aborts
    await new Promise<void>((resolve) => {
      req.on("close", () => resolve());
      setTimeout(resolve, 2000);
    });
  });
  const idleBackup = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "unused" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });

  try {
    const engine = await SystemTwoEngine.create({
      endpoints: [abortableServer.url, idleBackup.url],
      cloudFallback: { endpoint: idleBackup.url, apiKey: "k", model: "m" },
      timeoutMs: 5000,
    });

    // 5a. Pre-aborted signal -> 0 HTTP requests
    const preAc = new AbortController();
    preAc.abort("already aborted");
    let preErr: unknown = null;
    try {
      for await (const _ of engine.chat.completions.createStream({
        messages: [{ role: "user", content: "hi" }],
        signal: preAc.signal,
      })) {
        // noop
      }
    } catch (err) {
      preErr = err;
    }
    assert(isAbortError(preErr) && abortableServer.hits === 0, "预中止 AbortSignal 直接抛出且 0 HTTP 请求");

    // 5b. Mid-stream caller abort -> rethrow, NO unhealthy mark, NO failover
    const midAc = new AbortController();
    let midErr: unknown = null;
    try {
      for await (const chunk of engine.chat.completions.createStream({
        messages: [{ role: "user", content: "hi" }],
        signal: midAc.signal,
      })) {
        if (chunk.deltaContent) {
          midAc.abort("client-gone");
        }
      }
    } catch (err) {
      midErr = err;
    }
    assert(isAbortError(midErr), "调用方流式 AbortSignal 触发 AbortError 透传");
    assert(
      engine.getHealthyEndpoints().includes(abortableServer.url) && idleBackup.hits === 0,
      "调用方 Abort 不标节点不健康且不故障转移到备用节点或云端"
    );
  } finally {
    await abortableServer.close();
    await idleBackup.close();
  }

  // 5c. 内部 timeoutMs 超时（无 caller abort）-> 确实标节点不健康并转移
  const hungServer = await startMockSseServer(async (_req, res) => {
    await new Promise((r) => setTimeout(r, 400));
    if (!res.writableEnded) {
      res.setHeader("content-type", "text/event-stream");
      res.write("data: [DONE]\n\n");
      res.end();
    }
  });
  const fastFallback = await startMockSseServer(async (_req, res) => {
    res.setHeader("content-type", "text/event-stream");
    res.write(sseData({ choices: [{ delta: { content: "超时切换成功" }, finish_reason: "stop" }] }));
    res.write("data: [DONE]\n\n");
    res.end();
  });
  try {
    const engine = await SystemTwoEngine.create({
      endpoints: [hungServer.url, fastFallback.url],
      timeoutMs: 80,
    });
    let text = "";
    for await (const chunk of engine.chat.completions.createStream({
      messages: [{ role: "user", content: "test" }],
    })) {
      if (chunk.deltaContent) text += chunk.deltaContent;
    }
    assert(text === "超时切换成功", "内部 timeoutMs 超时自动转移至备用节点");
    assert(!engine.getHealthyEndpoints().includes(hungServer.url), "内部 timeoutMs 超时确实将卡死节点标为不健康");
  } finally {
    await hungServer.close();
    await fastFallback.close();
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
