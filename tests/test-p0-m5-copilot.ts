/**
 * M5 P0 #8 + P0 #7 (Copilot) 单元测试：
 * - 多工具并行 (tools / calls[]) & 轮次计数 (countToolRounds) & 全量重复校验
 * - 真 Token 流式输出 (allowTools=true JSON 增量抽取 + allowTools=false 纯 Markdown) 且无重复末尾发射
 * - sessionKeymap 跨轮次脱敏与工具查库参数还原，对外模型与流式输出零明文 PII 泄露
 * - AbortSignal 干净中止且不产生 "研判失败：..."
 */
import { AIMessage, HumanMessage, ToolMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import {
  createAbortError,
  isAbortError,
  type CivicChatCompletionParams,
  type CivicChatStreamChunk,
} from "@civic/system-two";
import { anonymize } from "../backend/anonymizer";
import { deanonymizeArgs } from "../backend/agent/copilot-tools";
import {
  countToolRounds,
  isDuplicateToolCall,
  streamCopilot,
  toTranscript,
  type CopilotEngineLike,
} from "../backend/agent/copilot-agent";

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

function makeMockEngine(
  onCall: (params: CivicChatCompletionParams, callIdx: number) => AsyncGenerator<CivicChatStreamChunk>
): CopilotEngineLike {
  let callIdx = 0;
  return {
    chat: {
      completions: {
        createStream(params: CivicChatCompletionParams) {
          callIdx += 1;
          return onCall(params, callIdx);
        },
      },
    },
  };
}

async function main() {
  // 1. countToolRounds / isDuplicateToolCall / toTranscript 多工具验证
  {
    const msgs = [
      new HumanMessage("请查本区概览和噪音工单"),
      new AIMessage({
        content: "",
        tool_calls: [
          { id: "c1", name: "region_overview", args: {}, type: "tool_call" },
          { id: "c2", name: "search_tickets", args: { query: "噪音", limit: 5 }, type: "tool_call" },
        ],
      }),
      new ToolMessage({ content: '{"tickets":10}', tool_call_id: "c1", name: "region_overview" }),
      new ToolMessage({ content: '{"hits":[]}', tool_call_id: "c2", name: "search_tickets" }),
    ];

    assert(countToolRounds(msgs) === 1, "单轮并行 2 个工具仅计为 1 轮 (usedRounds === 1)");
    assert(
      isDuplicateToolCall(msgs, { name: "search_tickets", args: { limit: 5, query: "噪音" } }),
      "isDuplicateToolCall 能识别第 2 个并行工具调用重复"
    );
    assert(
      !isDuplicateToolCall(msgs, { name: "search_tickets", args: { query: "违停" } }),
      "不同参数的同名工具不误判为重复"
    );

    const transcript = toTranscript(msgs);
    assert(
      transcript[1]?.role === "assistant" &&
        transcript[1].content.includes('"action":"tools"') &&
        transcript[1].content.includes('"region_overview"') &&
        transcript[1].content.includes('"search_tickets"'),
      "toTranscript 完整序列化全部并行 tool_calls"
    );
  }

  // 2. streamCopilot: sessionKeymap + 并行工具 + allowTools=true JSON 真流式增量输出
  {
    const seenModelPayloads: string[] = [];
    const seenRestoredQueries: string[] = [];
    const sessionKeymapShadow: Record<string, string> = {};

    const engine = makeMockEngine(async function* (params, callIdx) {
      seenModelPayloads.push(JSON.stringify(params.messages));
      if (callIdx === 1) {
        assert(
          params.response_format?.type === "json_object",
          "Round 1 (allowTools=true) 使用 json_object"
        );
        const toolJson = JSON.stringify({
          action: "tools",
          calls: [
            { name: "region_overview", args: {} },
            { name: "search_tickets", args: { query: "{{LICENSE_PLATE_1}}" } },
          ],
        });
        for (let i = 0; i < toolJson.length; i += 12) {
          yield { deltaContent: toolJson.slice(i, i + 12) };
        }
        return;
      }

      assert(
        params.response_format?.type === "json_object",
        "Round 2 (仅使用 1 轮 < MAX_TOOL_ROUNDS=3) 仍处于 allowTools=true"
      );
      const answerJson =
        '{"action":"answer","text":"已检索到 {{LICENSE_PLATE_1}} 与联系人 {{PHONE_NUMBER_1}} 相关工单，处理完成。"}';
      for (let i = 0; i < answerJson.length; i += 6) {
        yield { deltaContent: answerJson.slice(i, i + 6) };
        await new Promise((r) => setTimeout(r, 2));
      }
    });

    const mockTools = [
      tool(
        async () => JSON.stringify({ tickets: 12 }),
        { name: "region_overview", description: "overview", schema: z.object({}).passthrough() }
      ),
      tool(
        async (rawInput) => {
          const restored = deanonymizeArgs(rawInput, sessionKeymapShadow);
          seenRestoredQueries.push(String(restored.query || ""));
          const rawOut = {
            hits: [
              {
                ticketNo: "TK-9001",
                title: "粤A12345 违停投诉",
                body: "联系手机号 13800138000，张先生反映占道。",
              },
            ],
          };
          const maskStr = (s: string) => {
            const res = anonymize(s, { seedKeymap: sessionKeymapShadow });
            Object.assign(sessionKeymapShadow, res.keymap);
            return res.text;
          };
          return JSON.stringify({
            hits: rawOut.hits.map((h) => ({
              ticketNo: h.ticketNo,
              title: maskStr(h.title),
              body: maskStr(h.body),
            })),
          });
        },
        {
          name: "search_tickets",
          description: "search",
          schema: z.object({ query: z.string().optional() }).passthrough(),
        }
      ),
    ];

    // Seed shadow keymap the same way streamCopilot does for verification
    const userPrompt = "请查粤A12345和张先生(13800138000)的工单并给概览";
    Object.assign(sessionKeymapShadow, anonymize(userPrompt).keymap);

    const events: Array<{ type: string; text?: string; tool?: string; tools?: string[] }> = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: userPrompt }],
      engine,
      tools: mockTools as any,
    })) {
      events.push(ev);
    }

    const statusEv = events.find((e) => e.type === "status");
    const answerDeltas = events.filter((e) => e.type === "answer").map((e) => e.text || "");
    const fullAnswer = answerDeltas.join("");

    assert(
      statusEv?.tools?.join(",") === "region_overview,search_tickets",
      "并行工具触发包含全部工具名的 status 事件"
    );
    assert(
      seenRestoredQueries[0] === "粤A12345",
      `工具查库参数从占位符还原为真实车牌 (got: ${seenRestoredQueries[0]})`
    );
    assert(
      seenModelPayloads.every(
        (p) => !p.includes("粤A12345") && !p.includes("13800138000") && !p.includes("张先生")
      ),
      "发送给外部 LLM 的全部上下文和工具历史绝不包含明文 PII"
    );
    assert(answerDeltas.length > 3, `Round 2 真实增量流式输出 (>3 deltas, actual=${answerDeltas.length})`);
    assert(
      fullAnswer === "已检索到 {{LICENSE_PLATE_1}} 与联系人 {{PHONE_NUMBER_1}} 相关工单，处理完成。",
      "流式增量拼接完整且未发生末尾重复发射"
    );
    assert(
      !fullAnswer.includes("粤A12345") && !fullAnswer.includes("13800138000"),
      "流式最终输出保持脱敏占位符，不泄露明文 PII"
    );
  }

  // 3. Forced final round (3 rounds used -> allowTools=false) 直接输出纯 Markdown + civic-action
  {
    let finalRoundHasResponseFormat = true;
    const engine = makeMockEngine(async function* (params, callIdx) {
      if (callIdx <= 3) {
        const calls = [
          { action: "tool", name: "region_overview", args: {} },
          { action: "tool", name: "list_townships", args: {} },
          { action: "tool", name: "category_stats", args: {} },
        ];
        yield { deltaContent: JSON.stringify(calls[callIdx - 1]) };
        return;
      }
      finalRoundHasResponseFormat = Boolean(params.response_format);
      const mdChunks = [
        "## 研判结论\n\n",
        "已核查完毕，建议派单。\n\n",
        '```civic-action\n{"themeId":"TH-1","action":"DISPATCH"}\n```',
      ];
      for (const ch of mdChunks) {
        yield { deltaContent: ch };
      }
    });

    const mockTools = [
      tool(async () => '{"ok":1}', { name: "region_overview", description: "r", schema: z.object({}).passthrough() }),
      tool(async () => '{"ok":2}', { name: "list_townships", description: "t", schema: z.object({}).passthrough() }),
      tool(async () => '{"ok":3}', { name: "category_stats", description: "c", schema: z.object({}).passthrough() }),
    ];

    const answerDeltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "全面汇总" }],
      engine,
      tools: mockTools as any,
    })) {
      if (ev.type === "answer") answerDeltas.push(ev.text);
    }

    assert(!finalRoundHasResponseFormat, "达到 MAX_TOOL_ROUNDS 后第 4 轮省略 response_format");
    assert(
      answerDeltas.length === 3 && answerDeltas.join("").includes("```civic-action"),
      "第 4 轮直接流式输出纯 Markdown 与 civic-action 代码块"
    );
  }

  // 4. AbortSignal 中止 streamCopilot，绝不返回 "研判失败：..."
  {
    const ac = new AbortController();
    const engine = makeMockEngine(async function* (params) {
      yield { deltaContent: '{"action":"answer","text":"先吐一半' };
      await new Promise<void>((resolve, reject) => {
        if (params.signal?.aborted) {
          reject(createAbortError(params.signal));
          return;
        }
        params.signal?.addEventListener(
          "abort",
          () => reject(createAbortError(params.signal)),
          { once: true }
        );
      });
    });

    const received: string[] = [];
    let caught: unknown = null;
    try {
      for await (const ev of streamCopilot({
        regionId: "test_region",
        regionLabel: "测试区",
        domainType: "GOV_12345",
        turns: [{ role: "user", content: "测试中止" }],
        signal: ac.signal,
        engine,
        tools: [],
      })) {
        if (ev.type === "answer") {
          received.push(ev.text);
          ac.abort("client disconnect");
        }
      }
    } catch (err) {
      caught = err;
    }
    assert(isAbortError(caught), "streamCopilot 中止后抛出 AbortError");
    assert(
      !received.join("").includes("研判失败"),
      "AbortSignal 中止时不输出 '研判失败：...' 错误文本"
    );
  }

  // 5. M5 Iteration 2 regressions: unescaped inner quotes & bare fence in streamCopilot
  {
    const engine = makeMockEngine(async function* () {
      const payload = '{"action":"answer","text":"市民反映"噪音很大"请处理"}';
      for (const ch of payload) {
        yield { deltaContent: ch };
      }
    });
    const deltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "核查" }],
      engine,
      tools: [],
    })) {
      if (ev.type === "answer") deltas.push(ev.text);
    }
    const full = deltas.join("");
    assert(
      full === '市民反映"噪音很大"请处理',
      `streamCopilot 完整流式输出含未转义引号的正文 (got: ${full})`
    );
  }
  {
    const engine = makeMockEngine(async function* () {
      const payload = '```\n{"action":"answer","text":"裸围栏测试完成"}\n```';
      for (const ch of payload) {
        yield { deltaContent: ch };
      }
    });
    const deltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "核查" }],
      engine,
      tools: [],
    })) {
      if (ev.type === "answer") deltas.push(ev.text);
    }
    const full = deltas.join("");
    assert(full === "裸围栏测试完成", `streamCopilot 剥离裸围栏 JSON 包装 (got: ${full})`);
  }

  // 6. M5 Iteration 3 regression: trailing JSON key with space before colon (Case 2g)
  {
    const engine = makeMockEngine(async function* () {
      const payload = '{"action":"answer","text":"你好", "extra" : "secret_leak"}';
      for (const ch of payload) {
        yield { deltaContent: ch };
      }
    });
    const deltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "核查" }],
      engine,
      tools: [],
    })) {
      if (ev.type === "answer") deltas.push(ev.text);
    }
    const full = deltas.join("");
    assert(
      full === "你好" && !full.includes("extra") && !full.includes("secret_leak"),
      `streamCopilot 逐字符流式不泄露冒号前带空格的后续 JSON 字段 (got: ${JSON.stringify(full)})`
    );
  }

  // 7. M5 Iteration 4 regression: truncated Case 2g tail end-to-end 1-char-at-a-time streamCopilot
  {
    const engine = makeMockEngine(async function* () {
      const payload = '{"action":"answer","text":"你好", "extra" ';
      for (const ch of payload) {
        yield { deltaContent: ch };
      }
    });
    const deltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "核查截断尾部" }],
      engine,
      tools: [],
    })) {
      if (ev.type === "answer") deltas.push(ev.text);
    }
    const full = deltas.join("");
    assert(
      full === "你好" && !full.includes("extra") && !full.includes('",'),
      `streamCopilot 逐字符流式在截断 Case 2g 尾部时不拼回残余 JSON 键名 (got: ${JSON.stringify(full)})`
    );
  }

  // 8. Challenger 1 regression: MAX_TOOL_ROUNDS 耗尽且第 4 轮仍输出工具 JSON 时强制无工具收敛，绝不回退空兜底文案
  {
    let round4SawConvergencePrompt = false;
    let round5ResponseFormat: unknown = "unset";
    let round5SawStrongPrompt = false;
    let totalCalls = 0;

    const engine = makeMockEngine(async function* (params, callIdx) {
      totalCalls = callIdx;
      if (callIdx <= 3) {
        const calls = [
          { action: "tool", name: "region_overview", args: {} },
          { action: "tool", name: "list_townships", args: {} },
          { action: "tool", name: "category_stats", args: {} },
        ];
        yield { deltaContent: JSON.stringify(calls[callIdx - 1]) };
        return;
      }
      if (callIdx === 4) {
        const lastMsg = params.messages[params.messages.length - 1];
        round4SawConvergencePrompt =
          lastMsg?.role === "user" &&
          String(lastMsg.content).includes("工具检索已达上限") &&
          !params.response_format;
        // 模拟模型在 allowTools=false 仍固执吐出工具调用 JSON
        yield { deltaContent: '{"action":"tool","name":"search_themes","args":{}}' };
        return;
      }
      round5ResponseFormat = params.response_format;
      const lastMsg = params.messages[params.messages.length - 1];
      round5SawStrongPrompt =
        lastMsg?.role === "user" && String(lastMsg.content).includes("禁止再调用任何工具");
      yield { deltaContent: "# 测试区研判简报\n\n已根据三轮检索结果完成汇总分析。" };
    });

    const mockTools = [
      tool(async () => '{"tickets":100}', { name: "region_overview", description: "r", schema: z.object({}).passthrough() }),
      tool(async () => '{"towns":5}', { name: "list_townships", description: "t", schema: z.object({}).passthrough() }),
      tool(async () => '{"cats":4}', { name: "category_stats", description: "c", schema: z.object({}).passthrough() }),
      tool(async () => '{"themes":2}', { name: "search_themes", description: "s", schema: z.object({}).passthrough() }),
    ];

    const answerDeltas: string[] = [];
    for await (const ev of streamCopilot({
      regionId: "test_region",
      regionLabel: "测试区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "生成研判简报" }],
      engine,
      tools: mockTools as any,
    })) {
      if (ev.type === "answer") answerDeltas.push(ev.text);
    }

    const full = answerDeltas.join("");
    assert(round4SawConvergencePrompt, "达到 MAX_TOOL_ROUNDS 后第 4 轮注入收敛指令且禁用 response_format");
    assert(
      totalCalls === 5 && !round5ResponseFormat && round5SawStrongPrompt,
      "第 4 轮在 allowTools=false 仍输出工具 JSON 时触发第 5 轮显式无工具重试"
    );
    assert(
      full.includes("# 测试区研判简报") && !full.includes("没有整理出答复"),
      `MAX_TOOL_ROUNDS 耗尽后收敛到非空 Markdown 简报而非空兜底文案 (got: ${JSON.stringify(full)})`
    );
  }

  if (failures > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
