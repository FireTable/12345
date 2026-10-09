/**
 * 副驾驶图：decide → tools → decide。
 * 研判流水线仍是 ticket-agent.ts，不要把聊天工具接到那张图上。
 */
import { AIMessage, BaseMessage, HumanMessage, isAIMessage } from "@langchain/core/messages";
import { END, MessagesAnnotation, START, StateGraph } from "@langchain/langgraph";
import { ToolNode } from "@langchain/langgraph/prebuilt";
import { getSystemTwoEngine } from "@/backend/model";
import { desensitizeContent } from "@/backend/anonymizer";
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
  | { type: "status"; tool: string }
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

function fillToolArgs(turn: Extract<CopilotTurn, { type: "tool" }>, messages: BaseMessage[]): CopilotTurn {
  if (turn.name !== "search_tickets") return turn;
  const query = String(turn.args.query || "").trim();
  if (query) return turn;
  const fallback = latestUserText(messages);
  if (!fallback) return { type: "answer", text: "请说明要在本区检索的事情。" };
  return { type: "tool", name: turn.name, args: { ...turn.args, query: fallback } };
}

function routeCopilot(state: typeof MessagesAnnotation.State): "tools" | typeof END {
  const last = state.messages[state.messages.length - 1];
  if (last && isAIMessage(last) && (last.tool_calls?.length || 0) > 0) return "tools";
  return END;
}

export function buildCopilotGraph(regionId: string, regionLabel: string) {
  const toolNode = new ToolNode(createCopilotTools(regionId));

  const decide = async (state: typeof MessagesAnnotation.State) => {
    const used = state.messages.filter((message) => message.getType() === "tool").length;
    const allowTools = used < MAX_TOOL_ROUNDS;
    try {
      const engine = await getSystemTwoEngine();
      const completion = await withTimeout(
        engine.chat.completions.create({
          messages: [
            { role: "system", content: buildCopilotSystemPrompt(regionLabel, allowTools) },
            ...toTranscript(state.messages),
          ],
          enable_thinking: false,
          temperature: 0.2,
          max_tokens: allowTools ? 384 : 2048,
          response_format: { type: "json_object" },
        }),
        allowTools ? 30_000 : 90_000
      );
      const choice = completion.choices?.[0]?.message;
      const raw = (choice?.content || "").trim() || (choice?.reasoning_content || "").trim();
      let parsed = parseCopilotTurn(raw);
      if (parsed.type === "tool") parsed = fillToolArgs(parsed, state.messages);
      if (parsed.type === "tool" && allowTools) {
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
      const text =
        parsed.type === "answer" && parsed.text
          ? parsed.text
          : "本区检索已经做完，但没有整理出答复。请把问题再说具体一点。";
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
  turns: CopilotTurnInput[];
}): AsyncGenerator<CopilotStreamEvent> {
  const graph = buildCopilotGraph(input.regionId, input.regionLabel);
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
        yield { type: "status", tool: call.name };
        continue;
      }
      const text = textOf(message).trim();
      if (text) answer = text;
    }
  }
  yield { type: "answer", text: answer || "（空回复）" };
}
