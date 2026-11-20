/**
 * 副驾驶图：decide → tools → decide。
 * 研判流水线仍是 ticket-agent.ts，不要把聊天工具接到那张图上。
 */
import { AIMessage, BaseMessage, HumanMessage, isAIMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { getSystemTwoEngine } from "@/backend/model";
import { desensitizeContent } from "@/backend/anonymizer";
import { getRegionDomainProfile, type DomainType } from "@/lib/domain-profile";
import {
  buildCopilotSystemPrompt,
  parseCopilotTurn,
  type CopilotTurn,
} from "@/lib/copilot-protocol";
import { createCopilotTools } from "./copilot-tools";

const MAX_TOOL_ROUNDS = 3;

export interface CopilotTurnInput {
  role: "user" | "assistant";
  content: string;
}

export type CopilotStreamEvent =
  | { type: "status"; tool: string; domainType?: DomainType }
  | { type: "answer"; text: string };

function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("模型响应超时")), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
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

function isDuplicateToolCall(
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
      const prevCall = msg.tool_calls?.[0];
      if (prevCall?.name) {
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

function toTranscript(messages: BaseMessage[]): Array<{ role: "user" | "assistant"; content: string }> {
  const transcript: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const message of messages) {
    const kind = message.getType();
    if (kind === "human") {
      const content = textOf(message).trim();
      if (content) transcript.push({ role: "user", content });
      continue;
    }
    if (kind === "ai" && isAIMessage(message)) {
      const call = message.tool_calls?.[0];
      if (call?.name) {
        transcript.push({
          role: "assistant",
          content: JSON.stringify({ action: "tool", name: call.name, args: call.args || {} }),
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

function fillToolArgs(
  turn: Extract<CopilotTurn, { type: "tool" }>,
  messages: BaseMessage[],
  domainType: DomainType
): CopilotTurn {
  if (turn.name !== "search_tickets") return turn;
  const query = String(turn.args.query || "").trim();
  if (query || hasStructuredTicketFilter(turn.args)) return turn;
  const fallback = latestUserText(messages);
  if (!fallback) {
    return {
      type: "answer",
      text:
        domainType === "ECOMMERCE_CS"
          ? "请说明要在当前站点检索的客诉或商品问题。"
          : "请说明要在本区检索的事情。",
    };
  }
  return { type: "tool", name: turn.name, args: { ...turn.args, query: fallback } };
}

function routeCopilot(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && isAIMessage(last) && (last.tool_calls?.length || 0) > 0) return "tools";
  return END;
}

export function buildCopilotGraph(
  regionId: string,
  regionLabel: string,
  domainType: DomainType = "GOV_12345"
) {
  const toolNode = new ToolNode(createCopilotTools(regionId, domainType));
  const emptyFallbackText =
    domainType === "ECOMMERCE_CS"
      ? "当前站点检索已完成，但暂未整理出答复。请把问题再说具体一点。"
      : "本区检索已经做完，但没有整理出答复。请把问题再说具体一点。";

  const decide = async (state: typeof MessagesAnnotation.State) => {
    const used = state.messages.filter((message) => message.getType() === "tool").length;
    const allowTools = used < MAX_TOOL_ROUNDS;
    try {
      const engine = await getSystemTwoEngine();
      const transcript = toTranscript(state.messages);
      const completion = await withTimeout(
        engine.chat.completions.create({
          messages: [
            { role: "system", content: buildCopilotSystemPrompt(regionLabel, allowTools, domainType) },
            ...transcript,
          ],
          enable_thinking: false,
          temperature: 0.2,
          max_tokens: 2048,
          response_format: { type: "json_object" },
        }),
        allowTools ? 45_000 : 90_000
      );
      const choice = completion.choices?.[0]?.message;
      const raw = (choice?.content || "").trim() || (choice?.reasoning_content || "").trim();
      let parsed = parseCopilotTurn(raw);
      if (parsed.type === "tool") parsed = fillToolArgs(parsed, state.messages, domainType);

      if (parsed.type === "tool" && allowTools) {
        if (isDuplicateToolCall(state.messages, parsed)) {
          const convergeCompletion = await withTimeout(
            engine.chat.completions.create({
              messages: [
                { role: "system", content: buildCopilotSystemPrompt(regionLabel, false, domainType) },
                ...transcript,
                {
                  role: "user",
                  content: `工具 ${parsed.name} 使用相同参数已检索过，结果已在上方工具返回中。请勿重复调用工具，请直接根据已有工具结果输出最终中文答复（{"action":"answer","text":"..."}）。`,
                },
              ],
              enable_thinking: false,
              temperature: 0.2,
              max_tokens: 2048,
              response_format: { type: "json_object" },
            }),
            90_000
          );
          const convergeChoice = convergeCompletion.choices?.[0]?.message;
          const convergeRaw =
            (convergeChoice?.content || "").trim() ||
            (convergeChoice?.reasoning_content || "").trim();
          const converged = parseCopilotTurn(convergeRaw);
          const convergedText =
            converged.type === "answer" && converged.text
              ? converged.text
              : emptyFallbackText;
          return { messages: [new AIMessage(convergedText)] };
        }

        return {
          messages: [
            new AIMessage({
              content: "",
              tool_calls: [
                {
                  id: `call_${used}_${parsed.name}`,
                  name: parsed.name,
                  args: parsed.args,
                  type: "tool_call",
                },
              ],
            }),
          ],
        };
      }

      const text = parsed.type === "answer" && parsed.text ? parsed.text : emptyFallbackText;
      return { messages: [new AIMessage(text)] };
    } catch (error) {
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
}): AsyncGenerator<CopilotStreamEvent> {
  const domainType = input.domainType ?? (await getRegionDomainProfile(input.regionId)).domainType;
  const graph = buildCopilotGraph(input.regionId, input.regionLabel, domainType);
  const messages = input.turns.slice(-8).map((turn) => {
    const content = turn.content.trim().slice(0, turn.role === "user" ? 1000 : 2000);
    return turn.role === "user" ? new HumanMessage(desensitizeContent(content)) : new AIMessage(content);
  });
  const stream = await graph.stream(
    { messages },
    { streamMode: "updates", recursionLimit: 12 }
  );
  let answer = "";
  for await (const update of stream) {
    const produced = (update as { decide?: { messages?: BaseMessage[] } }).decide?.messages || [];
    for (const message of produced) {
      if (!isAIMessage(message)) continue;
      const call = message.tool_calls?.[0];
      if (call?.name) {
        yield { type: "status", tool: call.name, domainType };
        continue;
      }
      const text = textOf(message).trim();
      if (text) answer = text;
    }
  }
  yield { type: "answer", text: answer || "（空回复）" };
}
