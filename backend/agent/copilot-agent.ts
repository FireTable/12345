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
  hasCloudFallback?: () => boolean;
  isLocalClusterBusy?: () => boolean;
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

const LOCAL_FAST_PROMPT_CHAR_LIMIT = (() => {
  const raw = Number(process.env.COPILOT_LOCAL_PROMPT_CHAR_LIMIT);
  return Number.isFinite(raw) && raw >= 1_000 ? Math.trunc(raw) : 24_000;
})();

export function isBriefingPrefetchPrompt(text: string): boolean {
  const clean = (text || "").trim();
  if (!clean) return false;
  if (/(?:THEME-|IN-|TK-|MC-|EC-|\{\{)/i.test(clean)) return false;
  return /(?:研判简报|态势简报|多频工单.*简报|客诉.*简报|今日.*简报|生成.*简报)/.test(clean);
}

function sanitizeMessagesForModel(
  messages: CivicChatCompletionParams["messages"],
  sessionKeymap?: Record<string, string>
): CivicChatCompletionParams["messages"] {
  return messages.map((msg) => {
    if (msg.role === "system" || !msg.content) return msg;
    const masked = anonymize(
      msg.content,
      sessionKeymap ? { seedKeymap: sessionKeymap } : undefined
    );
    if (sessionKeymap && masked.keymap && Object.keys(masked.keymap).length > 0) {
      Object.assign(sessionKeymap, masked.keymap);
    }
    return masked.text === msg.content ? msg : { ...msg, content: masked.text };
  });
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
  maxTokens?: number;
  preferCloudDirect?: boolean;
  sessionKeymap?: Record<string, string>;
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

  const startedAt = Date.now();
  const hardMaxMs = Math.max(input.timeoutMs * 3, 180_000);
  const idleChunkTimeoutMs = Math.max(input.timeoutMs, 45_000);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const armTimer = (delayMs: number) => {
    if (timer) clearTimeout(timer);
    const remainingHard = hardMaxMs - (Date.now() - startedAt);
    const effectiveDelay = Math.max(100, Math.min(delayMs, remainingHard));
    timer = setTimeout(() => {
      timedOut = true;
      const timeoutErr = new Error("模型响应超时");
      timeoutErr.name = "AbortError";
      controller.abort(timeoutErr);
    }, effectiveDelay);
  };
  armTimer(input.timeoutMs);

  const safeMessages = sanitizeMessagesForModel(input.messages, input.sessionKeymap);
  const promptChars = safeMessages.reduce(
    (sum, msg) => sum + (typeof msg.content === "string" ? msg.content.length : 0),
    0
  );
  const engineHasCloud = Boolean(input.engine.hasCloudFallback?.());
  const preferCloudDirect = Boolean(
    input.preferCloudDirect || (engineHasCloud && promptChars > LOCAL_FAST_PROMPT_CHAR_LIMIT)
  );

  const extractor = createCopilotStreamExtractor();
  let fullContent = "";
  let fullReasoning = "";
  let emittedText = "";

  const runStream = async (effectiveSignal: AbortSignal) => {
    const stream = input.engine.chat.completions.createStream({
      messages: safeMessages,
      enable_thinking: false,
      temperature: 0.2,
      max_tokens: input.maxTokens ?? 2048,
      localWaitTimeoutMs: 6_000,
      preferCloudWhenLocalBusy: true,
      ...(preferCloudDirect ? { preferCloudDirect: true } : {}),
      ...(input.allowTools ? { response_format: { type: "json_object" as const } } : {}),
      signal: effectiveSignal,
    });

    for await (const chunk of stream) {
      if (callerAborted || input.externalSignal?.aborted || input.configSignal?.aborted) {
        throw createAbortError(input.externalSignal?.aborted ? input.externalSignal : input.configSignal);
      }
      if (
        chunk.deltaContent ||
        chunk.deltaReasoning ||
        (chunk.finishReason !== undefined && chunk.finishReason !== null)
      ) {
        // 只要流在持续吐字，重置空闲超时，避免长回复在第 45s 被腰斩
        armTimer(idleChunkTimeoutMs);
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

    const raw = fullContent.trim();
    return { raw, emittedText };
  };

  try {
    const pool = getLlmPool();
    const poolStats = pool.getStats();
    const localBusyInPool =
      poolStats.activeBatch > 0 &&
      poolStats.activeBatch + poolStats.activeInteractive >= poolStats.concurrency;

    if (engineHasCloud && (preferCloudDirect || localBusyInPool || input.engine.isLocalClusterBusy?.())) {
      return await runStream(controller.signal);
    }

    return await pool.run(
      (slotSignal) => runStream(slotSignal ?? controller.signal),
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
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
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
    const hasToolResults = state.messages.some((m) => m.getType() === "tool");
    const externalSignal = options?.signal;
    const configSignal = config?.signal;

    try {
      if (externalSignal?.aborted) throw createAbortError(externalSignal);
      if (configSignal?.aborted) throw createAbortError(configSignal);
      const engine = options?.engine ?? (await getSystemTwoEngine());
      if (externalSignal?.aborted) throw createAbortError(externalSignal);
      if (configSignal?.aborted) throw createAbortError(configSignal);
      const transcript = toTranscript(state.messages);
      const convergenceMessage = {
        role: "user" as const,
        content:
          "工具检索已达上限，结果已在上方工具返回中。请勿再调用工具，也不要输出工具调用 JSON，请直接根据已有工具结果输出最终中文 Markdown 答复。",
      };
      const { raw, emittedText } = await streamModelTurn({
        engine,
        messages: [
          { role: "system", content: buildCopilotSystemPrompt(regionLabel, allowTools, domainType) },
          ...transcript,
          ...(!allowTools && hasToolResults ? [convergenceMessage] : []),
        ],
        allowTools,
        timeoutMs: allowTools ? 45_000 : 90_000,
        sessionKeymap: options?.sessionKeymap,
        externalSignal,
        configSignal,
        writer: config?.writer,
      });

      const parsed = parseCopilotTurn(raw);
      const rawCalls = getCopilotToolCalls(parsed);

      const runStrongConvergenceRetry = async (reasonInstruction: string) => {
        const { raw: retryRaw, emittedText: retryEmitted } = await streamModelTurn({
          engine,
          messages: [
            { role: "system", content: buildCopilotSystemPrompt(regionLabel, false, domainType) },
            ...transcript,
            { role: "user", content: reasonInstruction },
          ],
          allowTools: false,
          timeoutMs: 90_000,
          sessionKeymap: options?.sessionKeymap,
          externalSignal,
          configSignal,
          writer: config?.writer,
        });
        const retryParsed = parseCopilotTurn(retryRaw);
        return reconcileStreamedAnswer(
          retryParsed.type === "answer" ? retryParsed.text : "",
          retryEmitted,
          config?.writer
        );
      };

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
                content: `工具 ${dupNames} 使用相同参数已检索过，结果已在上方工具返回中。请勿重复调用工具，也不要输出工具调用 JSON，请直接根据已有工具结果输出最终中文 Markdown 答复。`,
              },
            ],
            allowTools: false,
            timeoutMs: 90_000,
            sessionKeymap: options?.sessionKeymap,
            externalSignal,
            configSignal,
            writer: config?.writer,
          });
          const converged = parseCopilotTurn(convergeRaw);
          const convergedParsedText = converged.type === "answer" ? converged.text.trim() : "";
          if (converged.type !== "answer" || (!convergedParsedText && !convergeEmitted.trim())) {
            const retriedText = await runStrongConvergenceRetry(
              "请停止调用任何工具，也不要输出 JSON（例如 {\"action\":\"tool\"}）。前面工具返回的数据已足够，请直接用中文 Markdown 格式整理并输出最终研判答复。"
            );
            return { messages: [new AIMessage(retriedText)] };
          }
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

      const parsedAnswerText = parsed.type === "answer" ? parsed.text.trim() : "";
      if ((hasToolResults || !allowTools) && (parsed.type !== "answer" || (!parsedAnswerText && !emittedText.trim()))) {
        const retriedText = await runStrongConvergenceRetry(
          "工具检索已经完成，禁止再调用任何工具或输出 {\"action\":\"tool\"} 等 JSON。请直接基于上方工具返回的数据，用中文 Markdown 格式整理并输出最终答复。"
        );
        return { messages: [new AIMessage(retriedText)] };
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
  prefetchBriefing?: boolean;
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

  const tools =
    input.tools ??
    createCopilotTools(input.regionId, domainType, {
      sessionKeymap,
      signal: input.signal,
    });

  const allowPrefetch = input.prefetchBriefing ?? input.tools === undefined;
  const lastUserTurn = [...input.turns].reverse().find((t) => t.role === "user");
  const overviewTool = tools.find((t) => t.name === "region_overview");
  const themesTool = tools.find((t) => t.name === "search_themes");
  const townshipsTool = tools.find((t) => t.name === "list_townships");

  if (
    allowPrefetch &&
    lastUserTurn &&
    isBriefingPrefetchPrompt(lastUserTurn.content) &&
    overviewTool &&
    themesTool &&
    townshipsTool
  ) {
    yield {
      type: "status",
      tool: "region_overview",
      tools: ["region_overview", "search_themes", "list_townships"],
      domainType,
    };

    const [ovRaw, highThemesRaw, townshipsRaw] = await Promise.all([
      (overviewTool as { invoke: (args: Record<string, unknown>, cfg?: unknown) => Promise<unknown> }).invoke(
        {},
        { signal: input.signal }
      ),
      (themesTool as { invoke: (args: Record<string, unknown>, cfg?: unknown) => Promise<unknown> }).invoke(
        { riskLevel: "HIGH", limit: 6 },
        { signal: input.signal }
      ),
      (townshipsTool as { invoke: (args: Record<string, unknown>, cfg?: unknown) => Promise<unknown> }).invoke(
        {},
        { signal: input.signal }
      ),
    ]);
    if (input.signal?.aborted) {
      throw createAbortError(input.signal);
    }

    let themesOut = typeof highThemesRaw === "string" ? highThemesRaw : JSON.stringify(highThemesRaw);
    try {
      const parsedThemes = JSON.parse(themesOut) as { themes?: unknown[] };
      if (Array.isArray(parsedThemes.themes) && parsedThemes.themes.length === 0) {
        const fallbackThemes = await (
          themesTool as { invoke: (args: Record<string, unknown>, cfg?: unknown) => Promise<unknown> }
        ).invoke({ limit: 6 }, { signal: input.signal });
        themesOut =
          typeof fallbackThemes === "string" ? fallbackThemes : JSON.stringify(fallbackThemes);
      }
    } catch {
      /* keep raw string */
    }
    if (input.signal?.aborted) {
      throw createAbortError(input.signal);
    }

    const ovOut = typeof ovRaw === "string" ? ovRaw : JSON.stringify(ovRaw);
    const townshipsOut =
      typeof townshipsRaw === "string" ? townshipsRaw : JSON.stringify(townshipsRaw);
    const isEcommerce = domainType === "ECOMMERCE_CS";
    const contextInstruction = isEcommerce
      ? [
          "已为您预取当前电商站点统计与高风险客诉案卷（已脱敏汇总）：",
          `- region_overview: ${ovOut}`,
          `- search_themes(HIGH,top6): ${themesOut}`,
          `- list_townships(top10): ${townshipsOut}`,
          "请直接基于以上数据用中文 Markdown 输出客诉研判简报，结构清晰简洁，依次包含：1) 总量概览；2) 渠道/仓网压力分布 Markdown 表格；3) 高风险案卷 Markdown 表格；4) 分优先级处置建议。",
        ].join("\n")
      : [
          "已为您预取本区最新统计与高风险主题（已脱敏汇总）：",
          `- region_overview: ${ovOut}`,
          `- search_themes(HIGH,top6): ${themesOut}`,
          `- list_townships(top10): ${townshipsOut}`,
          "请直接基于以上数据用中文 Markdown 输出多频工单研判简报，结构清晰简洁，依次包含：1) 总量概览；2) 重点镇街压力分布 Markdown 表格；3) 高危多频主题 Markdown 表格；4) 可落地的处置建议。",
        ].join("\n");

    const engine = input.engine ?? (await getSystemTwoEngine());
    if (input.signal?.aborted) {
      throw createAbortError(input.signal);
    }

    const transcript = toTranscript(messages);
    const pendingEvents: CopilotStreamEvent[] = [];
    let turnDone = false;
    let turnError: unknown = null;
    let notify: (() => void) | null = null;
    const wake = () => {
      const fn = notify;
      notify = null;
      fn?.();
    };

    const turnPromise = streamModelTurn({
      engine,
      messages: [
        { role: "system", content: buildCopilotSystemPrompt(input.regionLabel, false, domainType) },
        ...transcript,
        { role: "user", content: contextInstruction },
      ],
      allowTools: false,
      timeoutMs: 90_000,
      maxTokens: 2560,
      sessionKeymap,
      externalSignal: input.signal,
      writer: (chunk) => {
        const ev = chunk as CopilotStreamEvent;
        if (ev?.type === "answer" && ev.text) {
          pendingEvents.push(ev);
          wake();
        }
      },
    })
      .then(async (res) => {
        if (res.emittedText.trim()) return;
        const parsed = parseCopilotTurn(res.raw);
        if (parsed.type === "answer" && parsed.text.trim()) {
          pendingEvents.push({ type: "answer", text: parsed.text.trim() });
          return;
        }
        const retry = await streamModelTurn({
          engine,
          messages: [
            { role: "system", content: buildCopilotSystemPrompt(input.regionLabel, false, domainType) },
            ...transcript,
            {
              role: "user",
              content: `${contextInstruction}\n\n请勿再输出任何工具调用 JSON，直接以中文 Markdown 输出最终研判简报。`,
            },
          ],
          allowTools: false,
          timeoutMs: 90_000,
          maxTokens: 2560,
          sessionKeymap,
          externalSignal: input.signal,
          writer: (chunk) => {
            const ev = chunk as CopilotStreamEvent;
            if (ev?.type === "answer" && ev.text) {
              pendingEvents.push(ev);
              wake();
            }
          },
        });
        if (!retry.emittedText.trim() && retry.raw.trim()) {
          const retryParsed = parseCopilotTurn(retry.raw);
          const text =
            retryParsed.type === "answer" && retryParsed.text.trim()
              ? retryParsed.text.trim()
              : "统计数据已汇总完成，请重试或换个问法。";
          pendingEvents.push({ type: "answer", text });
        }
      })
      .catch((err) => {
        turnError = err;
      })
      .finally(() => {
        turnDone = true;
        wake();
      });

    while (!turnDone || pendingEvents.length > 0) {
      if (pendingEvents.length > 0) {
        const ev = pendingEvents.shift()!;
        yield ev;
        continue;
      }
      await new Promise<void>((resolve) => {
        notify = resolve;
      });
    }
    await turnPromise;

    if (input.signal?.aborted) {
      throw createAbortError(input.signal);
    }
    if (turnError) {
      if (isAbortError(turnError)) {
        throw turnError;
      }
      const message = turnError instanceof Error ? turnError.message : "研判失败";
      yield { type: "answer", text: `研判失败：${message}` };
    }
    return;
  }

  const graph = buildCopilotGraph(input.regionId, input.regionLabel, domainType, {
    sessionKeymap,
    signal: input.signal,
    engine: input.engine,
    tools,
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
