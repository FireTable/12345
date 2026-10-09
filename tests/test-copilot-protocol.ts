/**
 * 副驾驶开场、工具协议和流式状态。不连数据库，也不调用模型。
 */
import {
  COPILOT_OFFLINE_TEXT,
  buildCopilotSystemPrompt,
  copilotGreeting,
  formatCopilotStatus,
  parseCopilotTurn,
  splitCopilotStream,
} from "../lib/copilot-protocol";

function assert(cond: unknown, message: string) {
  if (!cond) {
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

const greeting = copilotGreeting({ city: "广州市", name: "天河区" });
assert(greeting.includes("广州市 · 天河区"), "开场写明当前区");
assert(!greeting.includes("件工单") && !greeting.includes("个多频"), "开场不预告工单数和主题数");

const tool = parseCopilotTurn(
  '{"action":"tool","name":"search_tickets","args":{"query":"大良噪音"}}'
);
assert(tool.type === "tool" && tool.name === "search_tickets", "解析工单检索调用");
assert(tool.type === "tool" && tool.args.query === "大良噪音", "保留检索词");

const fenced = parseCopilotTurn('```json\n{"action":"tool","name":"get_theme","args":{"themeId":"THEME-12"}}\n```');
assert(fenced.type === "tool" && fenced.name === "get_theme", "代码围栏里的工具调用仍然能解析");

const prose = parseCopilotTurn("天河区今天的噪音投诉需要再核实。后面如果出现 { 也不当工具。");
assert(prose.type === "answer" && prose.text.includes("天河区"), "普通正文不误判成工具");

const unknown = parseCopilotTurn('{"action":"tool","name":"drop_database","args":{}}');
assert(unknown.type === "answer", "不认识的工具不会执行");

const offline = parseCopilotTurn('{"fallback":true,"message":"offline"}');
assert(offline.type === "answer" && offline.text === COPILOT_OFFLINE_TEXT, "模型离线时给固定说明，不把兜底 JSON 甩给用户");

const answer = parseCopilotTurn('{"action":"answer","text":"**大良**有 3 条相近工单。"}');
assert(answer.type === "answer" && answer.text === "**大良**有 3 条相近工单。", "回答 JSON 只取出正文");

const thought = parseCopilotTurn("<think>先查向量</think>");
assert(thought.type === "answer" && thought.text === "", "思考块不进答复");

const prompt = buildCopilotSystemPrompt("广州市 · 顺德区", true);
assert(prompt.includes("广州市 · 顺德区"), "系统提示锁定当前区");
assert(prompt.includes("search_tickets") && prompt.includes("list_townships"), "系统提示列出检索工具");
assert(!prompt.includes("重点主题摘要"), "系统提示不再塞入主题清单");

const locked = buildCopilotSystemPrompt("广州市 · 天河区", false);
assert(locked.includes("禁止再调用工具"), "检索次数用完后只许作答");

const status = formatCopilotStatus("search_tickets");
const split = splitCopilotStream(`${status}找到 2 条`);
assert(split.status === "正在按语义检索工单" && split.text === "找到 2 条", "状态行从正文里拆出去");
