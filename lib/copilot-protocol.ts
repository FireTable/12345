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
  "category_stats",
  "list_agent_tasks",
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

export function copilotGreeting(region: {
  city?: string | null;
  name?: string | null;
  domainProfile?: { domainType?: string | null } | null;
}): string {
  const isEcommerce = region.domainProfile?.domainType === "ECOMMERCE_CS";
  const place = [region.city, region.name].map((part) => (part || "").trim()).filter(Boolean).join(" · ");
  if (isEcommerce) {
    const label = place || "当前电商售后站点";
    return [
      "您好，我是 **民声智理 · 电商售后客诉智能研判副驾驶**。",
      "",
      `当前业务站点是 **${label}**。`,
      "售后客诉工单、客诉案卷、渠道/仓网及 SKU/店铺都在本站按需检索，遇到售后或客诉问题可以直接问我。",
    ].join("\n");
  }
  const label = place || "当前辖区";
  return [
    "您好，我是 **民声智理 12345 智能研判副驾驶**。",
    "",
    `当前辖区是 **${label}**。`,
    "工单、主题和镇街都在这个区里按需检索，遇到什么问题可以直接问我。",
  ].join("\n");
}

export function copilotToolStatus(name: string, domainType?: string | null): string {
  const isEcommerce = domainType === "ECOMMERCE_CS";
  if (isEcommerce) {
    switch (name) {
      case "search_tickets":
        return "正在检索售后客诉工单";
      case "search_themes":
        return "正在检索客诉案卷";
      case "get_ticket":
        return "正在读取客诉工单";
      case "get_theme":
        return "正在读取客诉案卷";
      case "region_overview":
        return "正在统计本站客诉指标";
      case "list_townships":
        return "正在统计渠道与仓网";
      case "category_stats":
        return "正在统计客诉分类";
      case "list_agent_tasks":
        return "正在读取主动治理待办";
      case "propose_theme_action":
        return "正在生成处置确认提案";
      default:
        return "正在检索当前站点";
    }
  }
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
    case "category_stats":
      return "正在统计业务分类";
    case "list_agent_tasks":
      return "正在读取主动待办任务";
    case "propose_theme_action":
      return "正在生成处置确认提案";
    default:
      return "正在检索本区";
  }
}

export function formatCopilotStatus(name: string, domainType?: string | null): string {
  return `[[status:${copilotToolStatus(name, domainType)}]]\n`;
}

export function splitCopilotStream(raw: string): { status?: string; text: string } {
  let status: string | undefined;
  const text = raw.replace(/\[\[status:([^\]]+)\]\]\n?/g, (_match, label: string) => {
    status = label;
    return "";
  });
  return { status, text };
}

export function buildCopilotSystemPrompt(
  regionLabel: string,
  allowTools: boolean,
  domainType?: string | null
): string {
  const isEcommerce = domainType === "ECOMMERCE_CS";
  if (isEcommerce) {
    const toolRule = allowTools
      ? "需要统计数字、客诉案卷、客诉工单、渠道/仓网、业务分类或主动待办时必须调用工具，不要凭记忆作答；禁止重复使用完全相同的工具和参数。"
      : "检索已经用过。这一轮禁止再调用工具，只根据已有工具结果回答。";
    return `你是电商售后客诉智能研判副驾驶。当前业务站点是 ${regionLabel}。你只能检索这个站点，不能切换站点；全程使用售后客诉、渠道/仓网、SKU/店铺、客诉案卷等电商售后术语。
${toolRule}
只输出一个 JSON 对象，不要代码围栏，不要思考过程。
调用工具：{"action":"tool","name":"search_tickets","args":{"query":"SKU-GD2026-881"}}
直接回答：{"action":"answer","text":"Markdown 中文答复"}
工具及参数：
- search_tickets：混合检索售后客诉工单（SQL 多列模糊+结构化过滤+可选向量）。args 可传 query、status(PENDING/IN_PROGRESS/RESOLVED/REOPENED)、urgency(NORMAL/MEDIUM/URGENT)、subdistrict(渠道/仓网)、category(客诉分类)、isFakeClosure(boolean)、stabilityRisk(boolean)、limit。至少提供 query 或一个筛选条件。
- search_themes：查多频客诉案卷。args 可省略或传 keyword、riskLevel(HIGH/MEDIUM/LOW)、handlingStatus(PENDING/IN_PROGRESS/RESOLVED/REOPENED)、category、limit。
- get_ticket：按客诉单号读一条。args.ticketNo。
- get_theme：按案卷编号读一条。args.themeId，例如 THEME-12。
- region_overview：统计本站客诉总量、待处置、处置中、已办结、假闭环、红线工单、客诉案卷数、高风险案卷数及主动治理待办数。args 用 {}。
- list_townships：统计各渠道/仓网客诉工单量、待处置数与紧急/红线数。args 用 {}。
- category_stats：统计各售后客诉分类工单量、待处置数与紧急/红线数。args 用 {}。
- list_agent_tasks：读取主动治理待办队列（L1自动/L2审批/L3红线熔断摘要与待办清单）。args 可传 status、autonomyLevel、limit。
- propose_theme_action：校验客诉案卷并生成待管理员确认的处置提案（不直接修改数据库）。args.themeId 必填，args.action 只能是 DISPATCH、ESCALATE 或 RESOLVE，可选 args.owner、args.eta、args.note。
当建议对客诉案卷执行派单、升级督办或办结时，必须先调用 propose_theme_action 校验，并在答复末尾附带如下代码块供前端渲染确认按钮（禁止声称已直接执行改库）：
\`\`\`civic-action
{"themeId":"THEME-1","themeTitle":"案卷标题","action":"DISPATCH","owner":"责任团队","eta":"YYYY-MM-DD","note":"处置说明"}
\`\`\`
引用工具返回的编号和数量。没有查到就说明没查到，不要编造。`;
  }

  const toolRule = allowTools
    ? "需要数字、主题、工单、镇街、业务分类或主动待办时必须调用工具，不要凭记忆作答；禁止重复使用完全相同的工具和参数。"
    : "检索已经用过。这一轮禁止再调用工具，只根据已有工具结果回答。";
  return `你是 12345 政务热线智能研判副驾驶。当前辖区是 ${regionLabel}。你只能检索这个区，不能切换区，也不要回答其他城市。
${toolRule}
只输出一个 JSON 对象，不要代码围栏，不要思考过程。
调用工具：{"action":"tool","name":"search_tickets","args":{"query":"检索短句"}}
直接回答：{"action":"answer","text":"Markdown 中文答复"}
工具及参数：
- search_tickets：混合检索本区工单（SQL 多列模糊+结构化过滤+可选向量语义）。args 可传 query、status(PENDING/IN_PROGRESS/RESOLVED/REOPENED)、urgency(NORMAL/MEDIUM/URGENT)、subdistrict(镇街)、category(分类)、isFakeClosure(boolean)、stabilityRisk(boolean)、limit。至少提供 query 或一个筛选条件。
- search_themes：查主题。args 可传 keyword、riskLevel(HIGH/MEDIUM/LOW)、handlingStatus(PENDING/IN_PROGRESS/RESOLVED/REOPENED)、category、limit；不传参数则返回工单量最高的主题。
- get_ticket：按工单号读一条。args.ticketNo。
- get_theme：按主题编号读一条。args.themeId，例如 THEME-12。
- region_overview：本区工单数、待处置/处置中/已办结、假闭环、涉稳风险、主题数、高风险主题数、已嵌入条数和主动待办数。args 用 {}。
- list_townships：各镇街工单量、待处置数与紧急/高危数。args 用 {}。
- category_stats：统计本区各业务分类工单量、待处置数与紧急/高危数。args 用 {}。
- list_agent_tasks：读取主动治理待办队列（L1自动/L2审批/L3红线熔断摘要与待办清单）。args 可传 status、autonomyLevel、limit。
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

function stripOuterJsonFence(text: string): string {
  const trimmed = text.trim();
  const closed = trimmed.match(/^```(?:json)?\s*(\{[\s\S]*\})\s*```$/i);
  if (closed) return closed[1].trim();
  const unclosed = trimmed.match(/^```(?:json)?\s*(\{[\s\S]*)$/i);
  if (unclosed) return unclosed[1].trim();
  return trimmed;
}

function extractBalancedJsonPrefix(text: string): { json: string; rest: string } | null {
  if (!text.startsWith("{")) return null;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === '"') {
        inString = false;
      }
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "{") {
      depth += 1;
    } else if (ch === "}") {
      depth -= 1;
      if (depth === 0) {
        return {
          json: text.slice(0, i + 1),
          rest: text.slice(i + 1).trim(),
        };
      }
    }
  }
  return null;
}

function extractJsonStringField(rawJson: string, keys: string[]): string | null {
  const keyPattern = new RegExp(`"(?:${keys.join("|")})"\\s*:\\s*"`, "g");
  let match: RegExpExecArray | null;
  while ((match = keyPattern.exec(rawJson)) !== null) {
    let i = match.index + match[0].length;
    let out = "";
    while (i < rawJson.length) {
      const ch = rawJson[i];
      if (ch === "\\") {
        if (i + 1 >= rawJson.length) {
          i += 1;
          break;
        }
        const next = rawJson[i + 1];
        if (next === "n") {
          out += "\n";
          i += 2;
        } else if (next === "r") {
          out += "\r";
          i += 2;
        } else if (next === "t") {
          out += "\t";
          i += 2;
        } else if (next === '"' || next === "\\" || next === "/") {
          out += next;
          i += 2;
        } else if (next === "u" && i + 5 < rawJson.length && /^[0-9a-fA-F]{4}$/.test(rawJson.slice(i + 2, i + 6))) {
          out += String.fromCharCode(parseInt(rawJson.slice(i + 2, i + 6), 16));
          i += 6;
        } else {
          out += next;
          i += 2;
        }
        continue;
      }
      if (ch === '"') {
        const after = rawJson.slice(i + 1);
        if (/^\s*(?:,\s*"[A-Za-z0-9_]+"\s*:|\}|\s*```|\s*$)/.test(after)) {
          return out;
        }
        // Tolerate unescaped inner quotation mark inside LLM answer prose
        out += ch;
        i += 1;
        continue;
      }
      out += ch;
      i += 1;
    }
    return out;
  }
  return null;
}

function looksLikeProtocolJson(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed.startsWith("{")) return false;
  return /"(?:action|name|fallback|text|answer|reply|content|response|data|result)"\s*:/.test(trimmed);
}

function appendTrailingCivicActions(answerText: string, trailing: string): string {
  if (!trailing) return answerText;
  const blocks = trailing.match(/```civic-action\s*\n[\s\S]*?```/gi);
  if (!blocks || blocks.length === 0) return answerText;
  const base = answerText.trim();
  const suffix = blocks.join("\n\n");
  return base ? `${base}\n\n${suffix}` : suffix;
}

function interpretParsedObject(value: Record<string, unknown>, depth: number): CopilotTurn | null {
  if (depth > 3) return null;
  if (value.fallback === true) {
    return { type: "answer", text: COPILOT_OFFLINE_TEXT };
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const action = typeof value.action === "string" ? value.action.trim().toLowerCase() : "";
  if ((action === "tool" || TOOL_NAME_SET.has(name)) && TOOL_NAME_SET.has(name)) {
    const args =
      value.args && typeof value.args === "object" && !Array.isArray(value.args)
        ? (value.args as Record<string, unknown>)
        : {};
    return { type: "tool", name: name as CopilotToolName, args };
  }
  if (action === "tool" && name && !TOOL_NAME_SET.has(name)) {
    return { type: "answer", text: "" };
  }

  for (const nestedKey of ["data", "response", "result"]) {
    const nested = value[nestedKey];
    if (nested && typeof nested === "object" && !Array.isArray(nested)) {
      const inner = interpretParsedObject(nested as Record<string, unknown>, depth + 1);
      if (inner) return inner;
    }
  }

  for (const textKey of ["text", "answer", "reply", "content", "message"]) {
    const candidate = value[textKey];
    if (typeof candidate === "string") {
      const trimmed = candidate.trim();
      if (!trimmed) {
        if (action === "answer") return { type: "answer", text: "" };
        continue;
      }
      const unwrapped = stripOuterJsonFence(trimmed);
      if (looksLikeProtocolJson(unwrapped) && depth < 3) {
        const inner = parseCopilotTurnInternal(trimmed, depth + 1);
        if (inner.type === "tool" || inner.text) return inner;
      }
      return { type: "answer", text: trimmed };
    }
    if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
      const inner = interpretParsedObject(candidate as Record<string, unknown>, depth + 1);
      if (inner) return inner;
    }
  }

  if (action === "answer") {
    return { type: "answer", text: "" };
  }
  return null;
}

function parseCopilotTurnInternal(raw: string, depth: number): CopilotTurn {
  const visible = stripThink(raw || "");
  if (!visible) return { type: "answer", text: "" };

  let candidate = stripOuterJsonFence(visible);
  let leadingProse = "";

  if (!candidate.startsWith("{")) {
    const embedded = candidate.match(/(?:^|\n)\s*(\{\s*"(?:action|name|fallback|text|answer|reply)"\s*:[\s\S]*)$/);
    if (!embedded || embedded.index === undefined) {
      return { type: "answer", text: visible };
    }
    leadingProse = candidate.slice(0, embedded.index).trim();
    candidate = embedded[1].trim();
  }

  const balanced = extractBalancedJsonPrefix(candidate);
  const jsonToParse = balanced ? balanced.json : candidate;
  const trailing = balanced ? balanced.rest : "";

  try {
    const value = JSON.parse(jsonToParse) as unknown;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      const interpreted = interpretParsedObject(value as Record<string, unknown>, depth);
      if (interpreted) {
        if (interpreted.type === "tool") return interpreted;
        const merged = leadingProse && interpreted.text
          ? `${leadingProse}\n\n${interpreted.text}`
          : interpreted.text || leadingProse;
        return { type: "answer", text: appendTrailingCivicActions(merged, trailing) };
      }
    }
  } catch {
    // Fall through to truncated/malformed JSON recovery below
  }

  if (/"fallback"\s*:\s*true/.test(candidate)) {
    return { type: "answer", text: COPILOT_OFFLINE_TEXT };
  }

  if (/"action"\s*:\s*"tool"/.test(candidate)) {
    const nameMatch = candidate.match(/"name"\s*:\s*"([^"]+)"/);
    const toolName = (nameMatch?.[1] || "").trim();
    if (TOOL_NAME_SET.has(toolName)) {
      const argsMatch = candidate.match(/"args"\s*:\s*(\{[\s\S]*)/);
      if (argsMatch?.[1]) {
        const balancedArgs = extractBalancedJsonPrefix(argsMatch[1]);
        const argsRaw = balancedArgs ? balancedArgs.json : argsMatch[1];
        for (const attempt of [argsRaw, `${argsRaw}}`, `${argsRaw}"}`]) {
          try {
            const parsedArgs = JSON.parse(attempt) as unknown;
            if (parsedArgs && typeof parsedArgs === "object" && !Array.isArray(parsedArgs)) {
              return {
                type: "tool",
                name: toolName as CopilotToolName,
                args: parsedArgs as Record<string, unknown>,
              };
            }
          } catch {
            // Try next repair
          }
        }
      }
    }
    return { type: "answer", text: leadingProse };
  }

  const extracted = extractJsonStringField(candidate, ["text", "answer", "reply", "content", "message"]);
  if (extracted !== null) {
    const clean = extracted.trim();
    const unwrapped = stripOuterJsonFence(clean);
    if (looksLikeProtocolJson(unwrapped) && depth < 3) {
      const inner = parseCopilotTurnInternal(clean, depth + 1);
      if (inner.type === "tool" || inner.text) return inner;
    }
    const merged = leadingProse && clean ? `${leadingProse}\n\n${clean}` : clean || leadingProse;
    return { type: "answer", text: appendTrailingCivicActions(merged, trailing) };
  }

  if (looksLikeProtocolJson(candidate)) {
    return { type: "answer", text: leadingProse };
  }

  return { type: "answer", text: visible };
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
  return parseCopilotTurnInternal(raw, 0);
}
