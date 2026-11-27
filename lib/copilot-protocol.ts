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

export interface CopilotToolCall {
  name: CopilotToolName;
  args: Record<string, unknown>;
}

export type CopilotTurn =
  | { type: "tool"; name: CopilotToolName; args: Record<string, unknown> }
  | { type: "tools"; calls: CopilotToolCall[] }
  | { type: "answer"; text: string };

export function getCopilotToolCalls(turn: CopilotTurn): CopilotToolCall[] {
  if (turn.type === "tool") return [{ name: turn.name, args: turn.args }];
  if (turn.type === "tools") return turn.calls;
  return [];
}

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

export function formatCopilotStatuses(names: string[], domainType?: string | null): string {
  const labels: string[] = [];
  for (const name of names) {
    const label = copilotToolStatus(name, domainType);
    if (label && !labels.includes(label)) {
      labels.push(label);
    }
  }
  if (labels.length === 0) {
    return formatCopilotStatus("", domainType);
  }
  return `[[status:${labels.join(" · ")}]]\n`;
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
      ? "需要统计数字、客诉案卷、客诉工单、渠道/仓网、业务分类或主动待办时必须调用工具，不要凭记忆作答；禁止重复使用完全相同的工具和参数。首轮尽量一次并行调用所需工具；一旦已获取总览与主要案卷数据，下一轮请直接输出最终中文 Markdown 答复，不要为补充次要细节重复追调工具。"
      : "检索已经用过。这一轮禁止再调用工具，只根据已有工具结果回答。";
    const formatRule = allowTools
      ? `只输出一个 JSON 对象，不要代码围栏，不要思考过程。
调用单个工具：{"action":"tool","name":"search_tickets","args":{"query":"SKU-GD2026-881"}}
并行调用多个工具（最多 4 个）：{"action":"tools","calls":[{"name":"region_overview","args":{}},{"name":"list_townships","args":{}}]}
直接回答：{"action":"answer","text":"Markdown 中文答复"}`
      : `请不要输出 JSON 对象或外层包装，也不要输出思考过程，直接输出 Markdown 中文答复（如需附带待确认处置建议，请在文末附带 \`\`\`civic-action 代码块）。`;
    return `你是电商售后客诉智能研判副驾驶。当前业务站点是 ${regionLabel}。你只能检索这个站点，不能切换站点；全程使用售后客诉、渠道/仓网、SKU/店铺、客诉案卷等电商售后术语。
${toolRule}
${formatRule}
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
引用工具返回的编号和数量。没有查到就说明没查到，不要编造。
输出规范：正文与 Markdown 表格中禁止直接暴露内部英文枚举（如 PENDING、DISPATCHED、IN_PROGRESS、RESOLVED、REOPENED、HIGH、MEDIUM、LOW、URGENT、NORMAL），一律使用中文业务名称（待派单/待处置、已派单、处理中、已办结、重开核查中、高风险、中风险、低风险、紧急、常规）。`;
  }

  const toolRule = allowTools
    ? "需要数字、主题、工单、镇街、业务分类或主动待办时必须调用工具，不要凭记忆作答；禁止重复使用完全相同的工具和参数。首轮尽量一次并行调用所需工具；一旦已获取总览与主要主题数据，下一轮请直接输出最终中文 Markdown 答复，不要为补充次要细节重复追调工具。"
    : "检索已经用过。这一轮禁止再调用工具，只根据已有工具结果回答。";
  const formatRule = allowTools
    ? `只输出一个 JSON 对象，不要代码围栏，不要思考过程。
调用单个工具：{"action":"tool","name":"search_tickets","args":{"query":"检索短句"}}
并行调用多个工具（最多 4 个）：{"action":"tools","calls":[{"name":"region_overview","args":{}},{"name":"list_townships","args":{}}]}
直接回答：{"action":"answer","text":"Markdown 中文答复"}`
    : `请不要输出 JSON 对象或外层包装，也不要输出思考过程，直接输出 Markdown 中文答复（如需附带待确认处置建议，请在文末附带 \`\`\`civic-action 代码块）。`;
  return `你是 12345 政务热线智能研判副驾驶。当前辖区是 ${regionLabel}。你只能检索这个区，不能切换区，也不要回答其他城市。
${toolRule}
${formatRule}
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
引用工具返回的编号和数量。没有查到就说明没查到，不要编造。
输出规范：正文与 Markdown 表格中禁止直接暴露内部英文枚举（如 PENDING、DISPATCHED、IN_PROGRESS、RESOLVED、REOPENED、HIGH、MEDIUM、LOW、URGENT、NORMAL），一律使用中文业务名称（待派单/待处置、已派单、处理中、已办结、重开核查中、高风险、中风险、低风险、紧急、常规）。`;
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
        if (/^\s*(?:,\s*"[A-Za-z0-9_]+"\s*:|\}|\s*```|\s*$|,\s*(?:"[A-Za-z0-9_]*"?\s*)?$)/.test(after)) {
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

const MAX_CALLS_PER_ROUND = 4;

function canonicalArgsValue(val: unknown): unknown {
  if (Array.isArray(val)) return val.map(canonicalArgsValue);
  if (val && typeof val === "object") {
    const obj = val as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(obj).sort()) {
      if (obj[key] !== undefined) sorted[key] = canonicalArgsValue(obj[key]);
    }
    return sorted;
  }
  return val;
}

function normalizeToolCallsList(rawCalls: unknown[]): CopilotToolCall[] {
  const deduped: CopilotToolCall[] = [];
  const seen = new Set<string>();
  for (const item of rawCalls) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec.name === "string" ? rec.name.trim() : "";
    if (!TOOL_NAME_SET.has(name)) continue;
    const args =
      rec.args && typeof rec.args === "object" && !Array.isArray(rec.args)
        ? (rec.args as Record<string, unknown>)
        : {};
    const sig = `${name}:${JSON.stringify(canonicalArgsValue(args))}`;
    if (seen.has(sig)) continue;
    seen.add(sig);
    deduped.push({ name: name as CopilotToolName, args });
    if (deduped.length >= MAX_CALLS_PER_ROUND) break;
  }
  return deduped;
}

function interpretParsedObject(value: Record<string, unknown>, depth: number): CopilotTurn | null {
  if (depth > 3) return null;
  if (value.fallback === true) {
    return { type: "answer", text: COPILOT_OFFLINE_TEXT };
  }
  const name = typeof value.name === "string" ? value.name.trim() : "";
  const action = typeof value.action === "string" ? value.action.trim().toLowerCase() : "";

  const rawCalls = Array.isArray(value.calls)
    ? value.calls
    : Array.isArray(value.tool_calls)
      ? value.tool_calls
      : null;
  if (action === "tools" || rawCalls !== null) {
    const calls = normalizeToolCallsList(rawCalls || []);
    if (calls.length === 1) {
      return { type: "tool", name: calls[0].name, args: calls[0].args };
    }
    if (calls.length >= 2) {
      return { type: "tools", calls };
    }
    if (action === "tools") {
      return { type: "answer", text: "" };
    }
  }

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
        if (inner.type === "tool" || inner.type === "tools" || inner.text) return inner;
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

function recoverTruncatedMultiToolCalls(candidate: string): CopilotToolCall[] {
  const arrMatch = candidate.match(/"(?:calls|tool_calls)"\s*:\s*\[([\s\S]*)/);
  if (!arrMatch?.[1]) return [];
  const body = arrMatch[1];
  const rawObjs: unknown[] = [];
  let inString = false;
  let escaped = false;
  for (let i = 0; i < body.length; i += 1) {
    const ch = body[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') {
      inString = true;
      continue;
    }
    if (ch === "]") break;
    if (ch === "{") {
      const balanced = extractBalancedJsonPrefix(body.slice(i));
      if (!balanced) break;
      try {
        rawObjs.push(JSON.parse(balanced.json));
      } catch {
        // ignore malformed item
      }
      i += balanced.json.length - 1;
    }
  }
  return normalizeToolCallsList(rawObjs);
}

function parseCopilotTurnInternal(raw: string, depth: number): CopilotTurn {
  const visible = stripThink(raw || "");
  if (!visible) return { type: "answer", text: "" };

  let candidate = stripOuterJsonFence(visible);
  let leadingProse = "";

  if (!candidate.startsWith("{")) {
    const embedded = candidate.match(/(?:^|\n)\s*(\{\s*"(?:action|name|calls|tool_calls|fallback|text|answer|reply)"\s*:[\s\S]*)$/);
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
        if (interpreted.type === "tool" || interpreted.type === "tools") return interpreted;
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

  if (/"action"\s*:\s*"tools"/.test(candidate)) {
    const calls = recoverTruncatedMultiToolCalls(candidate);
    if (calls.length === 1) return { type: "tool", name: calls[0].name, args: calls[0].args };
    if (calls.length >= 2) return { type: "tools", calls };
    return { type: "answer", text: leadingProse };
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
      if (inner.type === "tool" || inner.type === "tools" || inner.text) return inner;
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

export interface CopilotStreamExtractor {
  push(delta: string): string;
  flush(): { emitted: string; raw: string };
}

function trailingTagPrefix(lowerText: string, tag: string): number {
  const maxCheck = Math.min(lowerText.length, tag.length - 1);
  for (let len = maxCheck; len >= 1; len -= 1) {
    if (lowerText.endsWith(tag.slice(0, len))) return len;
  }
  return 0;
}

const STREAM_ANSWER_KEYS = new Set(["text", "answer", "reply"]);
const STREAM_TOOL_KEYS = new Set(["name", "calls", "tool_calls"]);

/**
 * 渐进式流式正文抽取器：
 * 1) 自动剥离跨 chunk 的 <think>...</think> 思维链；
 * 2) 若输出为直接 Markdown（如 allowTools === false），零延迟透传每个 token；
 * 3) 若输出为 {"action":"answer","text":"..."}（如 json_object 模式），逐字符实时反转义输出 "text"/"answer"/"reply"；
 * 4) 若输出为 tool/tools/fallback JSON，抑制流式正文吐出，交由完整回合解析处理。
 */
export function createCopilotStreamExtractor(): CopilotStreamExtractor {
  let raw = "";
  let thinkMode: "TEXT" | "THINK" = "TEXT";
  let thinkPending = "";
  let emittedVisible = false;
  let stripLeadingNewlines = false;

  let mode: "pending" | "raw" | "json" | "suppressed" = "pending";
  let pendingClassifier = "";

  // JSON scanner state (used once mode === "json")
  let depth = 0;
  let subState: "SEEK" | "READ_KEY" | "READ_ACTION" | "SKIP_STRING" | "STREAM_VALUE" = "SEEK";
  let expectingKeyAtDepth1 = false;
  let currentKey = "";
  let awaitingValueForKey = "";
  let keyBuf = "";
  let actionBuf = "";
  let escaped = false;
  let streamEscape: "none" | "slash" | "unicode" = "none";
  let unicodeBuf = "";
  let awaitingCloseQuote = false;
  let quoteCheckBuf = "";
  let checkingFallbackBool = "";

  const stripThinkPush = (chunk: string): string => {
    if (!chunk) return "";
    thinkPending += chunk;
    let visible = "";
    while (thinkPending.length > 0) {
      if (thinkMode === "TEXT") {
        if (stripLeadingNewlines) {
          thinkPending = thinkPending.replace(/^[\r\n]+/, "");
          if (!thinkPending) break;
          stripLeadingNewlines = false;
        }
        const lower = thinkPending.toLowerCase();
        const openIdx = lower.indexOf("<think>");
        if (openIdx !== -1) {
          const before = thinkPending.slice(0, openIdx);
          if (before) {
            visible += before;
            emittedVisible = true;
          }
          thinkPending = thinkPending.slice(openIdx + 7);
          thinkMode = "THINK";
          continue;
        }
        const holdLen = trailingTagPrefix(lower, "<think>");
        const safeEnd = thinkPending.length - holdLen;
        if (safeEnd > 0) {
          visible += thinkPending.slice(0, safeEnd);
          emittedVisible = true;
          thinkPending = thinkPending.slice(safeEnd);
        }
        break;
      }
      const lower = thinkPending.toLowerCase();
      const closeIdx = lower.indexOf("</think>");
      if (closeIdx !== -1) {
        thinkPending = thinkPending.slice(closeIdx + 8);
        thinkMode = "TEXT";
        if (!emittedVisible) stripLeadingNewlines = true;
        continue;
      }
      const holdLen = trailingTagPrefix(lower, "</think>");
      const safeEnd = thinkPending.length - holdLen;
      if (safeEnd > 0) {
        thinkPending = thinkPending.slice(safeEnd);
      }
      break;
    }
    return visible;
  };

  const feedJsonChars = (text: string): string => {
    let out = "";
    for (let i = 0; i < text.length; i += 1) {
      if (mode === "suppressed") return out;
      const ch = text[i];

      if (subState === "STREAM_VALUE") {
        if (awaitingCloseQuote) {
          quoteCheckBuf += ch;
          const after = quoteCheckBuf;
          if (/^\s*\}/.test(after) || /^\s*,\s*"[A-Za-z0-9_]+"\s*:/.test(after)) {
            awaitingCloseQuote = false;
            quoteCheckBuf = "";
            awaitingValueForKey = "";
            subState = "SEEK";
            out += feedJsonChars(after);
            continue;
          }
          if (
            after.length < 64 &&
            (/^\s*$/.test(after) ||
              /^\s*,\s*(?:"[A-Za-z0-9_]*"?\s*)?$/.test(after) ||
              /^\s*`{1,3}$/.test(after))
          ) {
            continue;
          }
          // Tolerate unescaped inner quotation mark inside LLM answer prose
          awaitingCloseQuote = false;
          quoteCheckBuf = "";
          out += '"';
          out += feedJsonChars(after);
          continue;
        }
        if (streamEscape === "unicode") {
          unicodeBuf += ch;
          if (unicodeBuf.length === 4) {
            if (/^[0-9a-fA-F]{4}$/.test(unicodeBuf)) {
              out += String.fromCharCode(parseInt(unicodeBuf, 16));
            } else {
              out += `\\u${unicodeBuf}`;
            }
            unicodeBuf = "";
            streamEscape = "none";
          }
          continue;
        }
        if (streamEscape === "slash") {
          streamEscape = "none";
          if (ch === "n") out += "\n";
          else if (ch === "r") out += "\r";
          else if (ch === "t") out += "\t";
          else if (ch === "b") out += "\b";
          else if (ch === "f") out += "\f";
          else if (ch === "u") {
            streamEscape = "unicode";
            unicodeBuf = "";
          } else {
            out += ch;
          }
          continue;
        }
        if (ch === "\\") {
          streamEscape = "slash";
          continue;
        }
        if (ch === '"') {
          awaitingCloseQuote = true;
          quoteCheckBuf = "";
          continue;
        }
        out += ch;
        continue;
      }

      if (subState === "READ_KEY") {
        if (escaped) {
          escaped = false;
          keyBuf += ch;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          currentKey = keyBuf;
          keyBuf = "";
          expectingKeyAtDepth1 = false;
          subState = "SEEK";
          if (STREAM_TOOL_KEYS.has(currentKey)) {
            mode = "suppressed";
            return out;
          }
          continue;
        }
        keyBuf += ch;
        continue;
      }

      if (subState === "READ_ACTION") {
        if (escaped) {
          escaped = false;
          actionBuf += ch;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          const act = actionBuf.trim().toLowerCase();
          actionBuf = "";
          awaitingValueForKey = "";
          subState = "SEEK";
          if (act === "tool" || act === "tools") {
            mode = "suppressed";
            return out;
          }
          continue;
        }
        actionBuf += ch;
        continue;
      }

      if (subState === "SKIP_STRING") {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === '"') {
          awaitingValueForKey = "";
          subState = "SEEK";
        }
        continue;
      }

      // subState === "SEEK"
      if (checkingFallbackBool) {
        if (/[a-zA-Z]/.test(ch)) {
          checkingFallbackBool += ch.toLowerCase();
          if (checkingFallbackBool === "true") {
            mode = "suppressed";
            return out;
          }
          continue;
        }
        checkingFallbackBool = "";
        awaitingValueForKey = "";
      }

      if (ch === "{") {
        depth += 1;
        if (depth === 1) expectingKeyAtDepth1 = true;
        continue;
      }
      if (ch === "}") {
        depth -= 1;
        if (depth <= 0) {
          awaitingValueForKey = "";
          currentKey = "";
        }
        continue;
      }
      if (ch === "[") {
        depth += 1;
        continue;
      }
      if (ch === "]") {
        depth -= 1;
        continue;
      }
      if (ch === ":") {
        if (depth === 1 && currentKey) {
          awaitingValueForKey = currentKey;
          currentKey = "";
          expectingKeyAtDepth1 = false;
        }
        continue;
      }
      if (ch === ",") {
        if (depth === 1) {
          expectingKeyAtDepth1 = true;
          awaitingValueForKey = "";
          currentKey = "";
        }
        continue;
      }
      if (ch === '"') {
        if (depth === 1 && expectingKeyAtDepth1) {
          subState = "READ_KEY";
          keyBuf = "";
          escaped = false;
        } else if (depth === 1 && STREAM_ANSWER_KEYS.has(awaitingValueForKey)) {
          subState = "STREAM_VALUE";
          streamEscape = "none";
          unicodeBuf = "";
        } else if (depth === 1 && awaitingValueForKey === "action") {
          subState = "READ_ACTION";
          actionBuf = "";
          escaped = false;
        } else {
          subState = "SKIP_STRING";
          escaped = false;
        }
        continue;
      }
      if (depth === 1 && awaitingValueForKey === "fallback" && (ch === "t" || ch === "T")) {
        checkingFallbackBool = "t";
      }
    }
    return out;
  };

  const processVisible = (visible: string): string => {
    if (!visible) return "";
    if (mode === "suppressed") return "";
    if (mode === "raw") return visible;
    if (mode === "json") return feedJsonChars(visible);

    // mode === "pending"
    pendingClassifier += visible;
    const trimmed = pendingClassifier.trimStart();
    if (!trimmed) return "";

    if (trimmed.startsWith("{")) {
      mode = "json";
      pendingClassifier = "";
      return feedJsonChars(trimmed);
    }

    if (trimmed.startsWith("`")) {
      if (trimmed.length < 3 && "```".startsWith(trimmed)) {
        return "";
      }
      if (trimmed.startsWith("```")) {
        const afterBackticks = trimmed.slice(3);
        if (/^\s*$/.test(afterBackticks)) {
          return "";
        }
        const lowerAfter = afterBackticks.toLowerCase();
        if (lowerAfter.length < 4 && "json".startsWith(lowerAfter)) {
          return "";
        }
        if (/^json(?:\s|$|\{)/i.test(afterBackticks)) {
          const afterFence = afterBackticks.slice(4).trimStart();
          if (!afterFence) {
            return "";
          }
          if (afterFence.startsWith("{")) {
            mode = "json";
            pendingClassifier = "";
            return feedJsonChars(afterFence);
          }
          mode = "raw";
          const out = pendingClassifier;
          pendingClassifier = "";
          return out;
        }
        if (/^(?:\s|\{)/.test(afterBackticks)) {
          const afterFence = afterBackticks.trimStart();
          if (!afterFence) {
            return "";
          }
          if (afterFence.startsWith("{")) {
            mode = "json";
            pendingClassifier = "";
            return feedJsonChars(afterFence);
          }
          mode = "raw";
          const out = pendingClassifier;
          pendingClassifier = "";
          return out;
        }
      }
      // Some other fence or inline backtick (e.g. ```civic-action) -> raw Markdown
      mode = "raw";
      const out = pendingClassifier;
      pendingClassifier = "";
      return out;
    }

    mode = "raw";
    const out = pendingClassifier;
    pendingClassifier = "";
    return out;
  };

  return {
    push(delta: string): string {
      if (!delta) return "";
      raw += delta;
      const visible = stripThinkPush(delta);
      return processVisible(visible);
    },
    flush(): { emitted: string; raw: string } {
      let emitted = "";
      if (thinkMode === "TEXT" && thinkPending) {
        if (stripLeadingNewlines) {
          thinkPending = thinkPending.replace(/^[\r\n]+/, "");
          stripLeadingNewlines = false;
        }
        const rem = thinkPending;
        thinkPending = "";
        emitted += processVisible(rem);
      } else {
        thinkPending = "";
      }

      if (mode === "json" && subState === "STREAM_VALUE" && awaitingCloseQuote) {
        if (
          !/^\s*(?:```[\s\S]*)?$/.test(quoteCheckBuf) &&
          !/^\s*,\s*(?:"[A-Za-z0-9_]*"?\s*)?$/.test(quoteCheckBuf)
        ) {
          emitted += `"${quoteCheckBuf}`;
        }
        awaitingCloseQuote = false;
        quoteCheckBuf = "";
        awaitingValueForKey = "";
        subState = "SEEK";
      }

      if (mode === "pending" && pendingClassifier) {
        const trimmed = pendingClassifier.trimStart();
        if (trimmed && !trimmed.startsWith("{") && !/^```(?:json)?(?:\s|$|\{)/i.test(trimmed)) {
          emitted += pendingClassifier;
        }
        pendingClassifier = "";
        mode = "raw";
      }

      return { emitted, raw };
    },
  };
}
