/**
 * 副驾驶图：decide → tools → decide。
 * 研判流水线仍是 ticket-agent.ts，不要把聊天工具接到那张图上。
 */
import { AIMessage, BaseMessage, HumanMessage, isAIMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import {
  createAbortError,
  isAbortError,
  type CivicChatCompletionParams,
  type CivicChatStreamChunk,
} from "@civic/system-two";
import { getSystemTwoEngine } from "@/backend/model";
import { getLlmPool } from "@/backend/llm-pool";
import { anonymize } from "@/backend/anonymizer";
import { getRegionDomainProfile, type DomainType } from "@/lib/domain-profile";
import {
  buildCopilotSystemPrompt,
  createCopilotStreamExtractor,
  getCopilotToolCalls,
  parseCopilotTurn,
  type CopilotToolCall,
} from "@/lib/copilot-protocol";
import { createCopilotTools } from "./copilot-tools";

const MAX_TOOL_ROUNDS = 3;

export interface CopilotTurnInput {
  role: "user" | "assistant";
  content: string;
}

export type CopilotStreamEvent =
  | { type: "status"; tool: string; tools?: string[]; domainType?: DomainType }
  | { type: "answer"; text: string };

export interface CopilotEngineLike {
  chat: {
    completions: {
      createStream: (params: CivicChatCompletionParams) => AsyncGenerator<CivicChatStreamChunk>;
    };
  };
}

export interface CopilotGraphOptions {
  sessionKeymap?: Record<string, string>;
  signal?: AbortSignal;
  engine?: CopilotEngineLike;
  tools?: ReturnType<typeof createCopilotTools>;
}

function textOf(message: BaseMessage): string {
  return typeof message.content === "string" ? message.content : "";
}

function latestUserText(messages: BaseMessage[]): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index].getType() === "human") return textOf(messages[index]).trim();
  }
  return "";
}

function canonicalValue(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(canonicalValue);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) {
        sorted[key] = canonicalValue(obj[key]);
      }
    }
    return sorted;
  }
  return val;
}

function canonicalToolSignature(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(canonicalValue(args || {}))}`;
}

export function countToolRounds(messages: BaseMessage[]): number {
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }
  let rounds = 0;
  for (let i = lastHumanIdx + 1; i < messages.length; i += 1) {
    const msg = messages[i];
    if (msg.getType() === "ai" && isAIMessage(msg) && (msg.tool_calls?.length || 0) > 0) {
      rounds += 1;
    }
  }
  return rounds;
}

export function isDuplicateToolCall(
  messages: BaseMessage[],
  nextCall: { name: string; args: Record<string, unknown> }
): boolean {
  const nextSig = canonicalToolSignature(nextCall.name, nextCall.args);
  let lastHumanIdx = -1;
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].getType() === "human") {
      lastHumanIdx = i;
      break;
    }
  }
  for (let i = messages.length - 1; i > lastHumanIdx; i -= 1) {
    const msg = messages[i];
    if (msg.getType() === "ai" && isAIMessage(msg)) {
      for (const prevCall of msg.tool_calls || []) {
        if (!prevCall?.name) continue;
        const prevSig = canonicalToolSignature(
          prevCall.name,
          (prevCall.args as Record<string, unknown>) || {}
        );
        if (prevSig === nextSig) return true;
      }
    }
  }
  return false;
}

export function toTranscript(messages: BaseMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const kind = message.getType();
    if (kind === "human") {
      const content = textOf(message).trim();
      if (content) transcript.push({ role: "user", content });
      continue;
    }
    if (kind === "ai" && isAIMessage(message)) {
      const calls = (message.tool_calls || []).filter((c) => Boolean(c?.name));
      if (calls.length === 1) {
        transcript.push({
          role: "assistant",
          content: JSON.stringify({ action: "tool", name: calls[0].name, args: calls[0].args || {} }),
        });
        continue;
      }
      if (calls.length > 1) {
        transcript.push({
          role: "assistant",
          content: JSON.stringify({
            action: "tools",
            calls: calls.map((c) => ({ name: c.name, args: c.args || {} })),
          }),
        });
        continue;
      }
      const content = textOf(message).trim();
      if (content) transcript.push({ role: "assistant", content });
      continue;
    }
    if (kind === "tool") {
      transcript.push({
        role: "user",
        content: `工具 ${message.name || "tool"} 的返回：\n${textOf(message).slice(0, 4000)}`,
      });
    }
  }
  return transcript;
}

function hasStructuredTicketFilter(args: Record<string, unknown>): boolean {
  return Boolean(
    String(args.status || "").trim() ||
      String(args.urgency || "").trim() ||
      String(args.subdistrict || "").trim() ||
      String(args.category || "").trim() ||
      args.isFakeClosure !== undefined ||
      args.stabilityRisk !== undefined
  );
}

function prepareToolCalls(
  calls: CopilotToolCall[],
  messages: BaseMessage[],
  domainType: DomainType
):
  | { kind: "clarify"; text: string }
  | { kind: "calls"; calls: CopilotToolCall[] } {
  const prepared: CopilotToolCall[] = [];
  const fallback = latestUserText(messages);

  for (const call of calls) {
    if (call.name !== "search_tickets") {
      prepared.push(call);
      continue;
    }
    const query = String(call.args.query || "").trim();
    if (query || hasStructuredTicketFilter(call.args)) {
      prepared.push(call);
      continue;
    }
    if (fallback) {
      prepared.push({ name: call.name, args: { ...call.args, query: fallback } });
    }
  }

  if (prepared.length === 0) {
    return {
      kind: "clarify",
      text:
        domainType === "ECOMMERCE_CS"
          ? "请说明要在当前站点检索的客诉或商品问题。"
          : "请说明要在本区检索的事情。",
    };
  }

  return { kind: "calls", calls: prepared };
}

function routeCopilot(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && isAIMessage(last) && (last.tool_calls?.length || 0) > 0) return "tools";
  return END;
}

interface CopilotNodeConfig {
  signal?: AbortSignal;
  writer?: (chunk: unknown) => void;
}

async function streamModelTurn(input: {
  engine: CopilotEngineLike;
  messages: CivicChatCompletionParams["messages"];
  allowTools: boolean;
  timeoutMs: number;
  externalSignal?: AbortSignal;
  configSignal?: AbortSignal;
  writer?: (chunk: unknown) => void;
}): Promise<{ raw: string; emittedText: string }> {
  if (input.externalSignal?.aborted) {
    throw createAbortError(input.externalSignal);
  }
  if (input.configSignal?.aborted) {
    throw createAbortError(input.configSignal);
  }

  const controller = new AbortController();
  let callerAborted = false;
  let timedOut = false;

  const onExternalAbort = () => {
    callerAborted = true;
    controller.abort(createAbortError(input.externalSignal));
  };
  const onConfigAbort = () => {
    callerAborted = true;
    controller.abort(createAbortError(input.configSignal));
  };

  input.externalSignal?.addEventListener("abort", onExternalAbort, { once: true });
  if (input.configSignal && input.configSignal !== input.externalSignal) {
    input.configSignal.addEventListener("abort", onConfigAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    const timeoutErr = new Error("模型响应超时");
    timeoutErr.name = "AbortError";
    controller.abort(timeoutErr);
  }, input.timeoutMs);

  const extractor = createCopilotStreamExtractor();
  let fullContent = "";
  let fullReasoning = "";
  let emittedText = "";

  try {
    return await getLlmPool().run(
      async (slotSignal) => {
        const stream = input.engine.chat.completions.createStream({
          messages: input.messages,
          enable_thinking: false,
          temperature: 0.2,
          max_tokens: 2048,
          ...(input.allowTools ? { response_format: { type: "json_object" as const } } : {}),
          signal: slotSignal ?? controller.signal,
        });

        for await (const chunk of stream) {
          if (callerAborted || input.externalSignal?.aborted || input.configSignal?.aborted) {
            throw createAbortError(input.externalSignal?.aborted ? input.externalSignal : input.configSignal);
          }
          if (chunk.deltaContent) {
            fullContent += chunk.deltaContent;
            const delta = extractor.push(chunk.deltaContent);
            if (delta) {
              emittedText += delta;
              input.writer?.({ type: "answer", text: delta });
            }
          }
          if (chunk.deltaReasoning) {
            fullReasoning += chunk.deltaReasoning;
          }
        }

        const flushed = extractor.flush();
        if (flushed.emitted) {
          emittedText += flushed.emitted;
          input.writer?.({ type: "answer", text: flushed.emitted });
        }

        const raw = fullContent.trim() || fullReasoning.trim();
        return { raw, emittedText };
      },
      { lane: "interactive", signal: controller.signal }
    );
  } catch (err) {
    if (callerAborted || input.externalSignal?.aborted || input.configSignal?.aborted) {
      throw createAbortError(input.externalSignal?.aborted ? input.externalSignal : input.configSignal);
    }
    if (timedOut) {
      throw new Error("模型响应超时");
    }
    throw err;
  } finally {
    clearTimeout(timer);
    input.externalSignal?.removeEventListener("abort", onExternalAbort);
    if (input.configSignal && input.configSignal !== input.externalSignal) {
      input.configSignal.removeEventListener("abort", onConfigAbort);
    }
  }
}

export function buildCopilotGraph(
  regionId: string,
  regionLabel: string,
  domainType: DomainType = "GOV_12345",
  options?: CopilotGraphOptions
) {
  const tools =
    options?.tools ??
    createCopilotTools(regionId, domainType, {
      sessionKeymap: options?.sessionKeymap,
      signal: options?.signal,
    });
  const toolNode = new ToolNode(tools);
  const emptyFallbackText =
    domainType === "ECOMMERCE_CS"
      ? "当前站点检索已完成，但暂未整理出答复。请把问题再说具体一点。"
      : "本区检索已经做完，但没有整理出答复。请把问题再说具体一点。";

  const reconcileStreamedAnswer = (
    parsedText: string,
    emittedText: string,
    writer?: (chunk: unknown) => void
  ): string => {
    const cleanParsed = parsedText.trim();
    if (cleanParsed) {
      if (!emittedText) {
        writer?.({ type: "answer", text: cleanParsed });
      } else {
        const trimmedEmitted = emittedText.trimStart();
        if (cleanParsed.startsWith(emittedText) && cleanParsed.length > emittedText.length) {
          writer?.({ type: "answer", text: cleanParsed.slice(emittedText.length) });
        } else if (
          trimmedEmitted &&
          cleanParsed.startsWith(trimmedEmitted) &&
          cleanParsed.length > trimmedEmitted.length
        ) {
          writer?.({ type: "answer", text: cleanParsed.slice(trimmedEmitted.length) });
        } else if (cleanParsed.includes("```civic-action") && !emittedText.includes("```civic-action")) {
          const blocks = cleanParsed.match(/```civic-action\s*\n[\s\S]*?```/gi);
          if (blocks && blocks.length > 0) {
            writer?.({ type: "answer", text: `\n\n${blocks.join("\n\n")}` });
          }
        }
      }
      return cleanParsed;
    }
    if (emittedText.trim()) {
      return emittedText.trim();
    }
    writer?.({ type: "answer", text: emptyFallbackText });
    return emptyFallbackText;
  };

  const decide = async (
    state: typeof MessagesAnnotation.State,
    config?: CopilotNodeConfig
  ) => {
    const usedRounds = countToolRounds(state.messages);
    const allowTools = usedRounds < MAX_TOOL_ROUNDS;
    const externalSignal = options?.signal;
    const configSignal = config?.signal;

    try {
      if (externalSignal?.aborted) throw createAbortError(externalSignal);
      if (configSignal?.aborted) throw createAbortError(configSignal);
      const engine = options?.engine ?? (await getSystemTwoEngine());
      if (externalSignal?.aborted) throw createAbortError(externalSignal);
      if (configSignal?.aborted) throw createAbortError(configSignal);
      const transcript = toTranscript(state.messages);
      const { raw, emittedText } = await streamModelTurn({
        engine,
        messages: [
          { role: "system", content: buildCopilotSystemPrompt(regionLabel, allowTools, domainType) },
          ...transcript,
        ],
        allowTools,
        timeoutMs: allowTools ? 45_000 : 90_000,
        externalSignal,
        configSignal,
        writer: config?.writer,
      });

      const parsed = parseCopilotTurn(raw);
      const rawCalls = getCopilotToolCalls(parsed);

      if (rawCalls.length > 0 && allowTools) {
        const prepared = prepareToolCalls(rawCalls, state.messages, domainType);
        if (prepared.kind === "clarify") {
          config?.writer?.({ type: "answer", text: prepared.text });
          return { messages: [new AIMessage(prepared.text)] };
        }

        const nonDuplicateCalls = prepared.calls.filter(
          (call) => !isDuplicateToolCall(state.messages, call)
        );

        if (nonDuplicateCalls.length === 0) {
          const dupNames = prepared.calls.map((c) => c.name).join("、");
          const { raw: convergeRaw, emittedText: convergeEmitted } = await streamModelTurn({
            engine,
            messages: [
              { role: "system", content: buildCopilotSystemPrompt(regionLabel, false, domainType) },
              ...transcript,
              {
                role: "user",
                content: `工具 ${dupNames} 使用相同参数已检索过，结果已在上方工具返回中。请勿重复调用工具，请直接根据已有工具结果输出最终中文 Markdown 答复。`,
              },
            ],
            allowTools: false,
            timeoutMs: 90_000,
            externalSignal,
            configSignal,
            writer: config?.writer,
          });
          const converged = parseCopilotTurn(convergeRaw);
          const convergedText = reconcileStreamedAnswer(
            converged.type === "answer" ? converged.text : "",
            convergeEmitted,
            config?.writer
          );
          return { messages: [new AIMessage(convergedText)] };
        }

        return {
          messages: [
            new AIMessage({
              content: "",
              tool_calls: nonDuplicateCalls.map((call, idx) => ({
                id: `call_${usedRounds}_${idx}_${call.name}`,
                name: call.name,
                args: call.args,
                type: "tool_call" as const,
              })),
            }),
          ],
        };
      }

      const finalText = reconcileStreamedAnswer(
        parsed.type === "answer" ? parsed.text : "",
        emittedText,
        config?.writer
      );
      return { messages: [new AIMessage(finalText)] };
    } catch (error) {
      if (externalSignal?.aborted || configSignal?.aborted || isAbortError(error)) {
        throw error;
      }
      const message = error instanceof Error ? error.message : "研判失败";
      return { messages: [new AIMessage(`研判失败：${message}`)] };
    }
  };

  return new StateGraph(MessagesAnnotation)
    .addNode("decide", decide)
    .addNode("tools", toolNode)
    .addEdge(START, "decide")
    .addConditionalEdges("decide", routeCopilot)
    .addEdge("tools", "decide")
    .compile();
}

export async function* streamCopilot(input: {
  regionId: string;
  regionLabel: string;
  domainType?: DomainType;
  turns: CopilotTurnInput[];
  signal?: AbortSignal;
  engine?: CopilotEngineLike;
  tools?: ReturnType<typeof createCopilotTools>;
}): AsyncGenerator<CopilotStreamEvent> {
  if (input.signal?.aborted) {
    throw createAbortError(input.signal);
  }
  const domainType = input.domainType ?? (await getRegionDomainProfile(input.regionId)).domainType;
  const sessionKeymap: Record<string, string> = {};
  const messages = input.turns.slice(-8).map((turn) => {
    const content = turn.content.trim().slice(0, turn.role === "user" ? 1000 : 2000);
    const masked = anonymize(content, { seedKeymap: sessionKeymap });
    if (masked.keymap && Object.keys(masked.keymap).length > 0) {
      Object.assign(sessionKeymap, masked.keymap);
    }
    return turn.role === "user" ? new HumanMessage(masked.text) : new AIMessage(masked.text);
  });

  const graph = buildCopilotGraph(input.regionId, input.regionLabel, domainType, {
    sessionKeymap,
    signal: input.signal,
    engine: input.engine,
    tools: input.tools,
  });

  const stream = await graph.stream(
    { messages },
    {
      streamMode: ["custom", "updates"],
      recursionLimit: 12,
      signal: input.signal,
    }
  );

  let streamedAnswer = false;
  let fallbackAnswer = "";

  try {
    for await (const [mode, chunk] of stream) {
      if (input.signal?.aborted) {
        throw createAbortError(input.signal);
      }
      if (mode === "custom") {
        const event = chunk as CopilotStreamEvent;
        if (event?.type === "answer" && event.text) {
          streamedAnswer = true;
          yield event;
        }
        continue;
      }
      if (mode === "updates") {
        const produced = (chunk as { decide?: { messages?: BaseMessage[] } }).decide?.messages || [];
        for (const message of produced) {
          if (!isAIMessage(message)) continue;
          const calls = (message.tool_calls || []).filter((c) => Boolean(c?.name));
          if (calls.length > 0) {
            const toolNames = calls.map((c) => c.name);
            yield { type: "status", tool: toolNames[0], tools: toolNames, domainType };
            continue;
          }
          const text = textOf(message).trim();
          if (text) fallbackAnswer = text;
        }
      }
    }
  } catch (err) {
    if (input.signal?.aborted) {
      throw createAbortError(input.signal);
    }
    throw err;
  }

  if (input.signal?.aborted) {
    throw createAbortError(input.signal);
  }
  if (!streamedAnswer) {
    yield { type: "answer", text: fallbackAnswer || "（空回复）" };
  }
}
