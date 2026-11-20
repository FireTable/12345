/**
 * 副驾驶协议。纯函数，不读库、不调模型。
 * 本机 27B 没有稳定的原生 tool call，LangGraph 的工具节点吃这里解析出的调用。
 */

export const COPILOT_TOOL_NAMES = [
  "search_tickets",
  "search_themes",
  "get_ticket",
  "get_theme",
  "region_overview",
  "list_townships",
  "propose_theme_action",
] as const;

export type CopilotToolName = (typeof COPILOT_TOOL_NAMES)[number];

const TOOL_NAME_SET = new Set<string>(COPILOT_TOOL_NAMES);

export const COPILOT_OFFLINE_TEXT = "本区研判模型暂时不可用，请稍后再问。";

export type CopilotActionName = "DISPATCH" | "ESCALATE" | "RESOLVE";

export interface CivicActionProposal {
  themeId: string;
  themeTitle?: string;
  action: CopilotActionName;
  owner?: string;
  eta?: string;
  note?: string;
}

export type CopilotTurn =
  | { type: "tool"; name: CopilotToolName; args: Record<string, unknown> }
  | { type: "answer"; text: string };

export function copilotGreeting(region: { city?: string | null; name?: string | null }): string {
  const place = [region.city, region.name].map((part) => (part || "").trim()).filter(Boolean).join(" · ");
  const label = place || "当前辖区";
  return [
    "您好，我是 **民声智理 12345 智能研判副驾驶**。",
    "",
    `当前辖区是 **${label}**。`,
    "工单、主题和镇街都在这个区里按需检索，遇到什么问题可以直接问我。",
  ].join("\n");
}

export function copilotToolStatus(name: string): string {
  switch (name) {
    case "search_tickets":
      return "正在按语义检索工单";
    case "search_themes":
      return "正在检索主题";
    case "get_ticket":
      return "正在读取工单";
    case "get_theme":
      return "正在读取主题";
    case "region_overview":
      return "正在统计本区";
    case "list_townships":
      return "正在统计镇街";
    case "propose_theme_action":
      return "正在生成处置确认提案";
    default:
      return "正在检索本区";
  }
}

export function formatCopilotStatus(name: string): string {
  return `[[status:${copilotToolStatus(name)}]]\n`;
}

export function splitCopilotStream(raw: string): { status?: string; text: string } {
  let status: string | undefined;
  const text = raw.replace(/\[\[status:([^\]]+)\]\]\n?/g, (_match, label: string) => {
    status = label;
    return "";
  });
  return { status, text };
}

export function buildCopilotSystemPrompt(regionLabel: string, allowTools: boolean): string {
  const toolRule = allowTools
    ? "需要数字、主题、工单或镇街时必须调用工具，不要凭记忆作答。"
    : "检索已经用过。这一轮禁止再调用工具，只根据已有工具结果回答。";
  return `你是 12345 政务热线智能研判副驾驶。当前辖区是 ${regionLabel}。你只能检索这个区，不能切换区，也不要回答其他城市。
${toolRule}
只输出一个 JSON 对象，不要代码围栏，不要思考过程。
调用工具：{"action":"tool","name":"search_tickets","args":{"query":"检索短句"}}
直接回答：{"action":"answer","text":"Markdown 中文答复"}
工具及参数：
- search_tickets：用本区工单向量做语义检索。args.query 必填。
- search_themes：查主题。args.keyword 可省略，args.riskLevel 只能是 HIGH、MEDIUM 或 LOW。
- get_ticket：按工单号读一条。args.ticketNo。
- get_theme：按主题编号读一条。args.themeId，例如 THEME-12。
- region_overview：本区工单数、主题数、高风险主题数、已嵌入条数。args 用 {}。
- list_townships：各镇街工单量。args 用 {}。
- propose_theme_action：校验主题并生成待管理员确认的处置提案（不直接修改数据库）。args.themeId 必填，args.action 只能是 DISPATCH、ESCALATE 或 RESOLVE，可选 args.owner、args.eta、args.note。
当建议对主题执行派单、升级督办或办结时，必须先调用 propose_theme_action 校验，并在答复末尾附带如下代码块供前端渲染确认按钮（禁止声称已直接执行改库）：
\`\`\`civic-action
{"themeId":"THEME-1","themeTitle":"主题标题","action":"DISPATCH","owner":"牵头部门","eta":"YYYY-MM-DD","note":"处置说明"}
\`\`\`
引用工具返回的编号和数量。没有查到就说明没查到，不要编造。`;
}

function stripThink(raw: string): string {
  const closed = raw.replace(/<think>[\s\S]*?<\/think>/gi, "");
  const unclosed = closed.search(/<think>/i);
  return (unclosed === -1 ? closed : closed.slice(0, unclosed)).trim();
}

function jsonPayload(text: string): string | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*)\s*```$/i);
  const body = (fenced ? fenced[1] : trimmed).trim();
  if (!body.startsWith("{")) return null;
  const end = body.lastIndexOf("}");
  if (end <= 0) return null;
  return body.slice(0, end + 1);
}

const VALID_CIVIC_ACTIONS = new Set<CopilotActionName>(["DISPATCH", "ESCALATE", "RESOLVE"]);

/**
 * 从助手答复 Markdown 中剥离并解析 ```civic-action {...} ``` 行动提案块。
 */
export function parseCivicActionBlocks(markdown: string): {
  cleanText: string;
  actions: CivicActionProposal[];
} {
  const actions: CivicActionProposal[] = [];
  const cleanText = (markdown || "")
    .replace(/```civic-action\s*\n([\s\S]*?)\n?```/gi, (full, jsonBody: string) => {
      try {
        const parsed = JSON.parse(jsonBody.trim()) as Record<string, unknown>;
        const themeId = typeof parsed.themeId === "string" ? parsed.themeId.trim() : "";
        const actionRaw = typeof parsed.action === "string" ? parsed.action.trim().toUpperCase() : "";
        if (!themeId || !VALID_CIVIC_ACTIONS.has(actionRaw as CopilotActionName)) {
          return full;
        }
        actions.push({
          themeId,
          themeTitle: typeof parsed.themeTitle === "string" ? parsed.themeTitle.trim() : undefined,
          action: actionRaw as CopilotActionName,
          owner: typeof parsed.owner === "string" ? parsed.owner.trim() : undefined,
          eta: typeof parsed.eta === "string" ? parsed.eta.trim() : undefined,
          note: typeof parsed.note === "string" ? parsed.note.trim() : undefined,
        });
        return "";
      } catch {
        return full;
      }
    })
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { cleanText, actions };
}

export function parseCopilotTurn(raw: string): CopilotTurn {
  const visible = stripThink(raw || "");
  if (!visible) return { type: "answer", text: "" };
  const payload = jsonPayload(visible);
  if (!payload) return { type: "answer", text: visible };
  try {
    const value = JSON.parse(payload) as Record<string, unknown>;
    if (value.fallback === true) return { type: "answer", text: COPILOT_OFFLINE_TEXT };
    const name = typeof value.name === "string" ? value.name : "";
    const action = typeof value.action === "string" ? value.action : "";
    if ((action === "tool" || TOOL_NAME_SET.has(name)) && TOOL_NAME_SET.has(name)) {
      const args =
        value.args && typeof value.args === "object" && !Array.isArray(value.args)
          ? (value.args as Record<string, unknown>)
          : {};
      return { type: "tool", name: name as CopilotToolName, args };
    }
    if (action === "answer" || typeof value.text === "string") {
      return { type: "answer", text: typeof value.text === "string" ? value.text.trim() : "" };
    }
  } catch {
    return { type: "answer", text: visible };
  }
  return { type: "answer", text: visible };
}
