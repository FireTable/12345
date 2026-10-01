/**
 * 用 Jev 给顺德工单打 System 1 训练标签。
 * 一次请求问五项：意图、七大类、紧急度、涉稳、镇街。正文不截断。
 * 成功一行写一行。中断后重跑会跳过已经写入的工单编号。
 *
 * 走 classifier.dev 的 TypeSafe System One 兼容接口。
 * 匿名免费不需要密钥；有 classifier_agent_ 开头的 CLASSIFIER_API_KEY 时改用工作区额度。
 * 不要把 TypeSafe 的密钥发给这个地址。
 *
 *   npx tsx packages/civic-system-one/scripts/label-with-jev.ts
 *   试跑 1 条：加上 --limit 1 --concurrency 1
 */
import fs from "node:fs";
import path from "node:path";
import nextEnvPkg from "@next/env";
import * as xlsxModule from "xlsx";
import { buildCivicQuestions } from "../src/presets/criteria.ts";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

const xlsx = (xlsxModule as any).default || xlsxModule;
const civic = buildCivicQuestions();

const ENDPOINT = "https://classifier.dev/v1/systemone";
const MODEL = "jev-1.13.0";
const PROVIDER = "classifier.dev";
const DEFAULT_INPUT = "/Users/FireTable/Downloads/政数局资料-顺德区12345热线工单 simple.xlsx";
const DEFAULT_OUTPUT = path.resolve("packages/civic-system-one/data/civic_jev.jsonl");
const INTENT_LABELS = new Set(["INQUIRY", "COMPLAINT", "SUGGESTION", "REMINDER", "COMMENDATION"]);
const CATEGORY_LABELS = new Set([
  "urban_management",
  "traffic",
  "market_reg",
  "environment",
  "labor_social",
  "public_safety",
  "social_governance",
]);

const QUESTIONS = {
  intent: civic.intent,
  category: civic.category,
  urgency: {
    type: "score" as const,
    instructions: civic.urgency.instructions,
    criteria: civic.urgency.levels,
  },
  stability: {
    type: "noul" as const,
    instructions: civic.stability_risk.instructions,
  },
  township: {
    type: "choice",
    instructions: "这张工单发生在顺德哪个镇街？正文写了哪个镇街就选哪个。看不出来就选 UNKNOWN，不要猜测。",
    criteria: townshipCriteria(),
  },
};

function townshipCriteria(): Record<string, string> {
  const presetPath = path.resolve(process.cwd(), "lib/presets/foshan_shunde.json");
  const preset = JSON.parse(fs.readFileSync(presetPath, "utf8"));
  const criteria: Record<string, string> = {};
  for (const town of preset.townships || []) {
    const name = String(town.fullName || "").trim();
    if (!name || name === "顺德区" || name === "UNKNOWN") {
      throw new Error(`非法镇街类: ${name}`);
    }
    criteria[name] = name;
  }
  if (Object.keys(criteria).length !== 10) {
    throw new Error(`镇街字典应为 10 个法定全称，实际 ${Object.keys(criteria).length}`);
  }
  criteria.UNKNOWN = "正文没有写明镇街";
  return criteria;
}

type Ticket = { ticketNo: string; title: string; content: string };

function arg(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function loadDone(file: string): Set<string> {
  const done = new Set<string>();
  if (!fs.existsSync(file)) return done;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row.ticketNo) done.add(String(row.ticketNo));
    } catch {
      // 半行留到下次重跑，不把它算成完成。
    }
  }
  return done;
}

function readTickets(file: string): Ticket[] {
  const book = xlsx.readFile(file, { cellDates: false });
  const sheet = book.Sheets[book.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" }) as Record<string, unknown>[];
  const tickets: Ticket[] = [];
  for (const row of rows) {
    const ticketNo = String(row["工单编号"] || "").trim();
    const title = String(row["标题"] || "").trim();
    const content = String(row["内容"] || "").trim();
    if (!ticketNo || !content) continue;
    tickets.push({ ticketNo, title, content });
  }
  return tickets;
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveApiKey(): { key: string; anonymous: boolean } {
  const workspace = process.env.CLASSIFIER_API_KEY || process.env.CLASSIFY_API_KEY || "";
  if (workspace.startsWith("classifier_agent_")) return { key: workspace, anonymous: false };
  return { key: "unused", anonymous: true };
}

type FailureKind = "day" | "minute" | "transient" | "auth" | "skip" | "fatal";

let dailyBudgetHit = false;

function classifyFailure(status: number, body: string): FailureKind {
  let code = "";
  let retryable: boolean | undefined;
  try {
    const parsed = JSON.parse(body);
    const error = parsed?.error;
    code = String(parsed?.code || error?.code || (typeof error === "string" ? error : "") || "");
    if (typeof parsed?.retryable === "boolean") retryable = parsed.retryable;
    if (typeof error?.retryable === "boolean") retryable = error.retryable;
  } catch {
    // 非 JSON 错误页，下面用状态码判断。
  }
  const blob = `${code} ${body}`.toLowerCase();
  if (status === 401 || status === 403) return "auth";
  if (blob.includes("free_ip_daily_budget") || blob.includes("rate_limit_day")) {
    dailyBudgetHit = true;
    return "day";
  }
  if (blob.includes("request_spending_limit")) return dailyBudgetHit ? "day" : "skip";
  if (status === 429 && blob.includes("daily")) return "day";
  if (status === 402 && (blob.includes("daily") || blob.includes("utc") || blob.includes("per ip"))) return "day";
  if (status === 402 && retryable === true) return "day";
  if (status === 429 && blob.includes("rate_limit_minute")) return "minute";
  if (status === 429 || status === 529 || status >= 500) return "transient";
  return "fatal";
}

function waitMs(response: Response, kind: FailureKind, fallback: number): number {
  const header = response.headers.get("retry-after");
  if (header) {
    const seconds = Number(header);
    if (Number.isFinite(seconds) && seconds > 0) return seconds * 1000;
    const at = Date.parse(header);
    if (Number.isFinite(at)) return Math.max(1000, at - Date.now());
  }
  const headerMs = Number(response.headers.get("retry-after-ms"));
  if (Number.isFinite(headerMs) && headerMs > 0) return headerMs;
  if (kind === "day") {
    const now = new Date();
    const nextUtcMidnight = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 30);
    return Math.max(60_000, nextUtcMidnight - now.getTime());
  }
  return fallback;
}

let nextQuotaLogAt = 0;
let quotaUntil = 0;

async function honorQuota() {
  while (Date.now() < quotaUntil) {
    await sleep(Math.min(quotaUntil - Date.now(), 60_000));
  }
}

function logQuotaPause(ms: number, detail: string) {
  const now = Date.now();
  if (now < nextQuotaLogAt) return;
  nextQuotaLogAt = now + 60_000;
  console.log(`免费额度用尽，暂停 ${Math.ceil(ms / 1000)} 秒后继续。${detail.slice(0, 160)}`);
}

async function labelOne(apiKey: string, ticket: Ticket): Promise<any> {
  const state = ticket.title ? `${ticket.title}\n${ticket.content}` : ticket.content;
  let wait = 1000;
  let transient = 0;
  while (true) {
    await honorQuota();
    let response: Response;
    try {
      response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ model: MODEL, state, questions: QUESTIONS }),
      });
    } catch (error: any) {
      transient++;
      if (transient >= 6) throw new Error(error?.message || String(error));
      await sleep(wait);
      wait = Math.min(wait * 2, 30_000);
      continue;
    }
    if (response.ok) return response.json();
    const detail = await response.text();
    const kind = classifyFailure(response.status, detail);
    const message = `HTTP ${response.status} ${detail.slice(0, 300)}`;
    if (kind === "auth") throw new Error(`AUTH ${message}`);
    if (kind === "skip") throw new Error(`SKIP ${message}`);
    if (kind === "day") {
      const pause = waitMs(response, kind, 60_000);
      quotaUntil = Math.max(quotaUntil, Date.now() + pause);
      logQuotaPause(pause, detail);
      await honorQuota();
      continue;
    }
    const retry = kind === "minute" || kind === "transient";
    transient++;
    if (!retry || transient >= 6) throw new Error(message);
    await sleep(waitMs(response, kind, wait));
    wait = Math.min(wait * 2, 30_000);
  }
}

function urgencyLevel(answer: any): string {
  const probs = answer?.probabilities || {};
  let best = -1;
  let bestP = -1;
  for (const [level, probability] of Object.entries(probs)) {
    const value = Number(probability);
    if (value > bestP) {
      bestP = value;
      best = Number(level);
    }
  }
  if (best < 0) best = Math.round(Number(answer?.score) || 0);
  best = Math.min(3, Math.max(0, best));
  return `Level ${best}`;
}

function toRecord(ticket: Ticket, payload: any) {
  const answers = payload.answers || {};
  const stability = Number(answers.stability?.noul) >= 0.5 ? "YES" : "NO";
  return {
    ticketNo: ticket.ticketNo,
    title: ticket.title,
    content: ticket.content,
    model: payload.model || MODEL,
    provider: PROVIDER,
    answers: [
      answers.intent?.choice || "",
      answers.category?.choice || "",
      urgencyLevel(answers.urgency),
      stability,
      answers.township?.choice || "",
    ],
    confidence: {
      intent: answers.intent?.confidence ?? null,
      category: answers.category?.confidence ?? null,
      urgency: answers.urgency?.confidence ?? null,
      stability: answers.stability?.noul ?? null,
      township: answers.township?.confidence ?? null,
    },
  };
}

function assertRecord(record: ReturnType<typeof toRecord>, towns: Set<string>) {
  const [intent, category, urgency, stability, township] = record.answers;
  if (!INTENT_LABELS.has(intent)) throw new Error(`意图非法: ${intent}`);
  if (!CATEGORY_LABELS.has(category)) throw new Error(`分类非法: ${category}`);
  if (!/^Level [0-3]$/.test(urgency)) throw new Error(`紧急度非法: ${urgency}`);
  if (stability !== "YES" && stability !== "NO") throw new Error(`涉稳非法: ${stability}`);
  if (!towns.has(township)) throw new Error(`镇街非法: ${township}`);
  if (typeof record.confidence.stability !== "number") throw new Error("涉稳分数缺失");
}

async function main() {
  const { key: apiKey, anonymous } = resolveApiKey();
  const input = arg("--input") || DEFAULT_INPUT;
  const output = arg("--output") || DEFAULT_OUTPUT;
  const limit = Number(arg("--limit") || "0");
  let concurrency = Math.max(1, Number(arg("--concurrency") || "4"));
  if (anonymous && concurrency > 4) {
    console.log(`匿名免费最多同时 4 个请求，并发从 ${concurrency} 降到 4`);
    concurrency = 4;
  }
  const towns = new Set(Object.keys(QUESTIONS.township.criteria));

  fs.mkdirSync(path.dirname(output), { recursive: true });
  const done = loadDone(output);
  let tickets = readTickets(input).filter((ticket) => !done.has(ticket.ticketNo));
  if (limit > 0) tickets = tickets.slice(0, limit);
  console.log(
    `端点 ${ENDPOINT}，模型 ${MODEL}，${anonymous ? "匿名免费额度" : "工作区密钥"}。待标注 ${tickets.length} 条，已完成 ${done.size} 条，并发 ${concurrency}`,
  );

  let cursor = 0;
  let ok = 0;
  let failed = 0;
  let halt = "";
  const failedFile = output.replace(/\.jsonl$/, "") + ".failed.jsonl";
  let writing: Promise<void> = Promise.resolve();
  const append = (file: string, row: unknown) => {
    const line = JSON.stringify(row) + "\n";
    writing = writing.then(() => fs.promises.appendFile(file, line));
    return writing;
  };

  async function worker() {
    while (!halt) {
      const index = cursor++;
      if (index >= tickets.length) return;
      const ticket = tickets[index];
      try {
        const payload = await labelOne(apiKey, ticket);
        const urgency = payload?.answers?.urgency;
        if (typeof urgency?.score !== "number" && urgency?.probabilities == null) {
          throw new Error("紧急度缺失");
        }
        const record = toRecord(ticket, payload);
        assertRecord(record, towns);
        await append(output, record);
        ok++;
      } catch (error: any) {
        const message = error?.message || String(error);
        if (message.startsWith("AUTH ") || halt) {
          halt = halt || message;
          console.error(message);
          return;
        }
        await append(failedFile, { ticketNo: ticket.ticketNo, error: message });
        if (message.startsWith("SKIP ")) continue;
        failed++;
        if (failed >= 30) {
          halt = `失败已到 ${failed}，停止以免把额度错误写成失败清单`;
          console.error(halt);
          return;
        }
      }
      if ((ok + failed) % 100 === 0) {
        console.log(`进度 ${ok + failed}/${tickets.length}，成功 ${ok}，失败 ${failed}`);
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, tickets.length) }, () => worker()));
  await writing;
  console.log(`完成。成功 ${ok}，失败 ${failed}。结果 ${output}`);
  if (halt) {
    console.error(halt);
    process.exit(1);
  }
  if (failed > 0) console.log(`失败清单 ${failedFile}。重跑同一命令会补这些工单。`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
