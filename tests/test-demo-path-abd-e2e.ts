/**
 * 组合演示路径（Path A 主干 + Path B 语音回访抓「假闭环」 + Path D 多租户切换与 /screen 指挥大屏）
 * 真实浏览器 + API + 数据库端到端自动化验收脚本（含全量基线快照还原与服务端缓存失效）。
 *
 * 运行方式：
 *   E2E_BASE_URL=http://localhost:3000 pnpm exec tsx tests/test-demo-path-abd-e2e.ts
 */

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // ignore if .env.local does not exist
  }
}

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { sql } from "../db/client";

const BASE_URL = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const PYTHON_BIN = process.env.E2E_PYTHON_BIN || "/Users/FireTable/.pyenv/shims/python3";
const PLAYWRIGHT_SCRIPT = path.resolve(process.cwd(), "tests/_playwright_demo_abd.py");

const CITIZEN_USERNAME = process.env.CITIZEN_USERNAME || "citizen";
const CITIZEN_PASSWORD = process.env.CITIZEN_PASSWORD || "citizen123";
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "admin";
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || "admin";

type BaselineCounts = {
  tickets: number;
  themes: number;
  ticketThemes: number;
  ticketEmbeddings: number;
  reviewQueue: number;
  agentTasks: number;
  agentReports: number;
  disposalLogs: number;
};

const EXPECTED_BASELINE: Record<"region_gz_tianhe" | "region_ecom_demo", BaselineCounts> = {
  region_gz_tianhe: {
    tickets: 103397,
    themes: 5748,
    ticketThemes: 89748,
    ticketEmbeddings: 97006,
    reviewQueue: 77553,
    agentTasks: 8,
    agentReports: 1,
    disposalLogs: 2,
  },
  region_ecom_demo: {
    tickets: 3240,
    themes: 40,
    ticketThemes: 624,
    ticketEmbeddings: 0,
    reviewQueue: 24,
    agentTasks: 8,
    agentReports: 1,
    disposalLogs: 8,
  },
};

type ThemeMutableSnapshot = {
  id: string;
  ticket_count: number;
  time_span_hours: number;
  first_at: Date | string | null;
  last_at: Date | string | null;
  risk_level: string;
  risk_reason: string | null;
  ai_summary: string | null;
  recommended_action: string | null;
  handling_status: string | null;
  handling_progress: number | null;
  handling_owner: string | null;
  handling_eta: Date | string | null;
};

type TicketMutableSnapshot = {
  id: string;
  status: string | null;
  closure_status: string | null;
  is_fake_closure: boolean | null;
  closed_at: Date | string | null;
  updated_at: Date | string | null;
  address: string | null;
  canonical_subject: string | null;
  subdistrict: string | null;
  confidence: number | null;
  primary_theme_id: string | null;
};

type AgentTaskMutableSnapshot = {
  id: string;
  status: string;
  result_summary: string | null;
  updated_at: Date | string;
};

type SchemaSnapshot = {
  schema: "region_gz_tianhe" | "region_ecom_demo";
  themesById: Map<string, ThemeMutableSnapshot>;
  ticketsById: Map<string, TicketMutableSnapshot>;
  agentTasksById: Map<string, AgentTaskMutableSnapshot>;
  agentReportIds: string[];
  disposalLogIds: string[];
};

let passed = 0;
let failed = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS ${message}`);
  }
}

function normVal(v: unknown): string {
  if (v === null || v === undefined) return "NULL";
  if (v instanceof Date) return v.toISOString();
  return String(v);
}

function extractCookies(res: Response): string {
  const getSetCookie = (res.headers as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const rawList =
    typeof getSetCookie === "function"
      ? getSetCookie.call(res.headers)
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];
  return rawList
    .map((entry) => entry.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

async function loginByHttp(username: string, password: string): Promise<string> {
  const res = await fetch(`${BASE_URL}/api/auth/sign-in/username`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: BASE_URL,
      Referer: `${BASE_URL}/login`,
    },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP login failed for ${username}: status=${res.status} ${detail}`);
  }
  const cookie = extractCookies(res);
  if (!cookie.includes("better-auth.session_token")) {
    throw new Error(`HTTP login for ${username} did not return session_token cookie`);
  }
  return cookie;
}

async function apiJson<T = any>(
  reqPath: string,
  cookie: string,
  regionId: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${reqPath}`, {
    method: init?.method ?? "GET",
    headers: {
      Cookie: cookie,
      Origin: BASE_URL,
      "x-region-id": regionId,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function getSchemaCounts(schema: string): Promise<BaselineCounts> {
  const rows = await sql.unsafe(`
    SELECT
      (SELECT count(*)::int FROM "${schema}".tickets) AS tickets,
      (SELECT count(*)::int FROM "${schema}".themes) AS themes,
      (SELECT count(*)::int FROM "${schema}".ticket_themes) AS ticket_themes,
      (SELECT count(*)::int FROM "${schema}".ticket_embeddings) AS ticket_embeddings,
      (SELECT count(*)::int FROM "${schema}".review_queue) AS review_queue,
      (SELECT count(*)::int FROM "${schema}".agent_tasks) AS agent_tasks,
      (SELECT count(*)::int FROM "${schema}".agent_reports) AS agent_reports,
      (SELECT count(*)::int FROM "${schema}".disposal_logs) AS disposal_logs
  `);
  const r = rows[0] || {};
  return {
    tickets: Number(r.tickets),
    themes: Number(r.themes),
    ticketThemes: Number(r.ticket_themes),
    ticketEmbeddings: Number(r.ticket_embeddings),
    reviewQueue: Number(r.review_queue),
    agentTasks: Number(r.agent_tasks),
    agentReports: Number(r.agent_reports),
    disposalLogs: Number(r.disposal_logs),
  };
}

async function checkAllBaselines(label: string): Promise<boolean> {
  let ok = true;
  for (const schema of ["region_gz_tianhe", "region_ecom_demo"] as const) {
    const actual = await getSchemaCounts(schema);
    const exp = EXPECTED_BASELINE[schema];
    const match =
      actual.tickets === exp.tickets &&
      actual.themes === exp.themes &&
      actual.ticketThemes === exp.ticketThemes &&
      actual.ticketEmbeddings === exp.ticketEmbeddings &&
      actual.reviewQueue === exp.reviewQueue &&
      actual.agentTasks === exp.agentTasks &&
      actual.agentReports === exp.agentReports &&
      actual.disposalLogs === exp.disposalLogs;
    if (!match) ok = false;
    assert(
      match,
      `[${label}] ${schema} counts=${actual.tickets}/${actual.themes}/${actual.ticketThemes}/${actual.ticketEmbeddings}/${actual.reviewQueue}/${actual.agentTasks}/${actual.agentReports}/${actual.disposalLogs} (expected ${exp.tickets}/${exp.themes}/${exp.ticketThemes}/${exp.ticketEmbeddings}/${exp.reviewQueue}/${exp.agentTasks}/${exp.agentReports}/${exp.disposalLogs})`
    );
  }

  const [shunde] = await sql.unsafe(`
    SELECT
      (SELECT count(*)::int FROM region_fs_shunde.tickets) AS tickets,
      (SELECT count(*)::int FROM region_fs_shunde.themes) AS themes
  `);
  const shundeOk = Number(shunde?.tickets) === 135666 && Number(shunde?.themes) === 9222;
  if (!shundeOk) ok = false;
  assert(shundeOk, `[${label}] region_fs_shunde=${shunde?.tickets}/${shunde?.themes} (expected 135666/9222)`);

  const [subs] = await sql.unsafe(`SELECT count(*)::int AS c FROM public.citizen_submissions`);
  const subsOk = Number(subs?.c) === 0;
  if (!subsOk) ok = false;
  assert(subsOk, `[${label}] public.citizen_submissions=${subs?.c} (expected 0)`);

  return ok;
}

async function captureSchemaSnapshot(schema: "region_gz_tianhe" | "region_ecom_demo"): Promise<SchemaSnapshot> {
  const themeRows = (await sql.unsafe(`
    SELECT id, ticket_count, time_span_hours, first_at, last_at, risk_level, risk_reason,
           ai_summary, recommended_action, handling_status, handling_progress, handling_owner, handling_eta
    FROM "${schema}".themes
  `)) as ThemeMutableSnapshot[];

  const themesById = new Map<string, ThemeMutableSnapshot>();
  for (const row of themeRows) {
    themesById.set(String(row.id), row);
  }

  const ticketRows = (await sql.unsafe(`
    SELECT DISTINCT t.id, t.status, t.closure_status, t.is_fake_closure, t.closed_at, t.updated_at,
           t.address, t.canonical_subject, t.subdistrict, t.confidence, t.primary_theme_id
    FROM "${schema}".tickets t
    WHERE t.id IN (
      SELECT target_id FROM "${schema}".agent_tasks WHERE target_type = 'TICKET'
      UNION
      SELECT tt.ticket_id FROM "${schema}".ticket_themes tt
      JOIN "${schema}".themes th ON th.id = tt.theme_id
      WHERE upper(coalesce(th.handling_status, '')) IN ('RESOLVED', '已办结')
      UNION
      SELECT t2.id FROM "${schema}".tickets t2
      JOIN "${schema}".themes th2 ON th2.id = t2.primary_theme_id
      WHERE upper(coalesce(th2.handling_status, '')) IN ('RESOLVED', '已办结')
    )
  `)) as TicketMutableSnapshot[];

  const ticketsById = new Map<string, TicketMutableSnapshot>();
  for (const row of ticketRows) {
    ticketsById.set(String(row.id), row);
  }

  const taskRows = (await sql.unsafe(`
    SELECT id, status, result_summary, updated_at FROM "${schema}".agent_tasks
  `)) as AgentTaskMutableSnapshot[];
  const agentTasksById = new Map<string, AgentTaskMutableSnapshot>();
  for (const row of taskRows) {
    agentTasksById.set(String(row.id), row);
  }

  const reportRows = await sql.unsafe(`SELECT id FROM "${schema}".agent_reports`);
  const logRows = await sql.unsafe(`SELECT id FROM "${schema}".disposal_logs`);

  return {
    schema,
    themesById,
    ticketsById,
    agentTasksById,
    agentReportIds: reportRows.map((r: any) => String(r.id)),
    disposalLogIds: logRows.map((r: any) => String(r.id)),
  };
}

async function restoreSchemaSnapshot(
  snap: SchemaSnapshot,
  runStartedAtIso: string,
  extraCreatedTicketIds: string[]
) {
  const { schema } = snap;

  // 1. Collect and delete newly created tickets (cascades ticket_embeddings, ticket_themes, review_queue)
  const newTicketRows = await sql.unsafe(
    `SELECT id FROM "${schema}".tickets WHERE created_at >= $1`,
    [runStartedAtIso]
  );
  const newTicketIdSet = new Set<string>(newTicketRows.map((r: any) => String(r.id)));
  for (const id of extraCreatedTicketIds) {
    if (id) newTicketIdSet.add(id);
  }
  const newTicketIds = [...newTicketIdSet];
  if (newTicketIds.length > 0) {
    await sql.unsafe(`DELETE FROM public.citizen_submissions WHERE ticket_id = ANY($1::text[])`, [newTicketIds]);
    await sql.unsafe(`DELETE FROM "${schema}".tickets WHERE id = ANY($1::text[])`, [newTicketIds]);
  }
  await sql.unsafe(`DELETE FROM "${schema}".review_queue WHERE created_at >= $1`, [runStartedAtIso]);

  // 2. Unlink baseline standalone tickets from any newly created themes, then delete new themes
  const baselineThemeIds = [...snap.themesById.keys()];
  const newThemeRows = await sql.unsafe(
    `SELECT id FROM "${schema}".themes WHERE id <> ALL($1::text[])`,
    [baselineThemeIds]
  );
  const newThemeIds = newThemeRows.map((r: any) => String(r.id));
  if (newThemeIds.length > 0) {
    await sql.unsafe(
      `UPDATE "${schema}".tickets SET primary_theme_id = NULL WHERE primary_theme_id = ANY($1::text[])`,
      [newThemeIds]
    );
    await sql.unsafe(`DELETE FROM "${schema}".themes WHERE id = ANY($1::text[])`, [newThemeIds]);
  }

  // 3. Restore any mutated baseline themes
  const currentThemes = (await sql.unsafe(`
    SELECT id, ticket_count, time_span_hours, first_at, last_at, risk_level, risk_reason,
           ai_summary, recommended_action, handling_status, handling_progress, handling_owner, handling_eta
    FROM "${schema}".themes
  `)) as ThemeMutableSnapshot[];

  let restoredThemes = 0;
  for (const cur of currentThemes) {
    const base = snap.themesById.get(String(cur.id));
    if (!base) continue;
    const changed =
      Number(cur.ticket_count) !== Number(base.ticket_count) ||
      Number(cur.time_span_hours) !== Number(base.time_span_hours) ||
      normVal(cur.first_at) !== normVal(base.first_at) ||
      normVal(cur.last_at) !== normVal(base.last_at) ||
      normVal(cur.risk_level) !== normVal(base.risk_level) ||
      normVal(cur.risk_reason) !== normVal(base.risk_reason) ||
      normVal(cur.ai_summary) !== normVal(base.ai_summary) ||
      normVal(cur.recommended_action) !== normVal(base.recommended_action) ||
      normVal(cur.handling_status) !== normVal(base.handling_status) ||
      Number(cur.handling_progress ?? -1) !== Number(base.handling_progress ?? -1) ||
      normVal(cur.handling_owner) !== normVal(base.handling_owner) ||
      normVal(cur.handling_eta) !== normVal(base.handling_eta);

    if (changed) {
      await sql.unsafe(
        `UPDATE "${schema}".themes SET
           ticket_count = $2,
           time_span_hours = $3,
           first_at = $4,
           last_at = $5,
           risk_level = $6,
           risk_reason = $7,
           ai_summary = $8,
           recommended_action = $9,
           handling_status = $10,
           handling_progress = $11,
           handling_owner = $12,
           handling_eta = $13
         WHERE id = $1`,
        [
          base.id,
          base.ticket_count,
          base.time_span_hours,
          base.first_at,
          base.last_at,
          base.risk_level,
          base.risk_reason,
          base.ai_summary,
          base.recommended_action,
          base.handling_status,
          base.handling_progress,
          base.handling_owner,
          base.handling_eta,
        ]
      );
      restoredThemes += 1;
    }
  }

  // 4. Restore snapshotted baseline tickets
  let restoredTickets = 0;
  const baseTicketIds = [...snap.ticketsById.keys()];
  if (baseTicketIds.length > 0) {
    const curTickets = (await sql.unsafe(
      `SELECT id, status, closure_status, is_fake_closure, closed_at, updated_at,
              address, canonical_subject, subdistrict, confidence, primary_theme_id
       FROM "${schema}".tickets WHERE id = ANY($1::text[])`,
      [baseTicketIds]
    )) as TicketMutableSnapshot[];

    for (const cur of curTickets) {
      const base = snap.ticketsById.get(String(cur.id));
      if (!base) continue;
      const changed =
        normVal(cur.status) !== normVal(base.status) ||
        normVal(cur.closure_status) !== normVal(base.closure_status) ||
        Boolean(cur.is_fake_closure) !== Boolean(base.is_fake_closure) ||
        normVal(cur.closed_at) !== normVal(base.closed_at) ||
        normVal(cur.updated_at) !== normVal(base.updated_at) ||
        normVal(cur.address) !== normVal(base.address) ||
        normVal(cur.canonical_subject) !== normVal(base.canonical_subject) ||
        normVal(cur.subdistrict) !== normVal(base.subdistrict) ||
        Number(cur.confidence ?? -1) !== Number(base.confidence ?? -1) ||
        normVal(cur.primary_theme_id) !== normVal(base.primary_theme_id);

      if (changed) {
        await sql.unsafe(
          `UPDATE "${schema}".tickets SET
             status = $2,
             closure_status = $3,
             is_fake_closure = $4,
             closed_at = $5,
             updated_at = $6,
             address = $7,
             canonical_subject = $8,
             subdistrict = $9,
             confidence = $10,
             primary_theme_id = $11
           WHERE id = $1`,
          [
            base.id,
            base.status,
            base.closure_status,
            base.is_fake_closure,
            base.closed_at,
            base.updated_at,
            base.address,
            base.canonical_subject,
            base.subdistrict,
            base.confidence,
            base.primary_theme_id,
          ]
        );
        restoredTickets += 1;
      }
    }
  }

  // 5. Delete newly added agent_tasks, agent_reports, disposal_logs & restore baseline agent_tasks
  const baseTaskIds = [...snap.agentTasksById.keys()];
  await sql.unsafe(`DELETE FROM "${schema}".agent_tasks WHERE id <> ALL($1::text[])`, [baseTaskIds]);
  for (const baseTask of snap.agentTasksById.values()) {
    await sql.unsafe(
      `UPDATE "${schema}".agent_tasks SET status = $2, result_summary = $3, updated_at = $4 WHERE id = $1`,
      [baseTask.id, baseTask.status, baseTask.result_summary, baseTask.updated_at]
    );
  }
  await sql.unsafe(`DELETE FROM "${schema}".agent_reports WHERE id <> ALL($1::text[])`, [snap.agentReportIds]);
  await sql.unsafe(`DELETE FROM "${schema}".disposal_logs WHERE id <> ALL($1::text[])`, [snap.disposalLogIds]);

  const leftoverUpdated = await sql.unsafe(
    `SELECT id FROM "${schema}".tickets WHERE updated_at >= $1`,
    [runStartedAtIso]
  );
  assert(
    leftoverUpdated.length === 0,
    `[Cleanup ${schema}] zero unexpected modified baseline tickets (leftover=${leftoverUpdated.length})`
  );
  console.log(
    `INFO [Cleanup ${schema}] deletedNewTickets=${newTicketIds.length}, deletedNewThemes=${newThemeIds.length}, restoredThemes=${restoredThemes}, restoredTickets=${restoredTickets}`
  );
}

function runPythonPlaywright(resultJsonPath: string): Promise<{ code: number }> {
  return new Promise((resolve, reject) => {
    const child = spawn(PYTHON_BIN, [PLAYWRIGHT_SCRIPT], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        E2E_BASE_URL: BASE_URL,
        E2E_RESULT_JSON: resultJsonPath,
        CITIZEN_USERNAME,
        CITIZEN_PASSWORD,
        ADMIN_USERNAME,
        ADMIN_PASSWORD,
        PYTHONUNBUFFERED: "1",
      },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Playwright runner exceeded 900s hard timeout"));
    }, 900_000);

    child.stdout.on("data", (chunk: Buffer) => {
      process.stdout.write(chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      process.stderr.write(chunk);
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1 });
    });
  });
}

async function main() {
  const runStartedAt = new Date();
  const runStartedAtIso = new Date(runStartedAt.getTime() - 2000).toISOString();
  const resultJsonPath = `/tmp/demo-abd-e2e-result-${Date.now()}.json`;

  let gzSnap: SchemaSnapshot | null = null;
  let ecomSnap: SchemaSnapshot | null = null;
  let baselineTaskProgressIds: string[] = [];
  let baselineCompletedTaskId = "";
  let snapshotCaptured = false;
  let adminCookie = "";
  let browserResult: any = null;

  try {
    // 0. Health checks: :3000 /api/regions, :8132, :8133
    const regRes = await fetch(`${BASE_URL}/api/regions`);
    const regJson = (await regRes.json().catch(() => ({}))) as any;
    const regionIds = Array.isArray(regJson?.regions) ? regJson.regions.map((r: any) => r.id) : [];
    assert(
      regRes.status === 200 &&
        regJson?.appDomain === "ALL" &&
        regionIds.includes("gz_tianhe") &&
        regionIds.includes("fs_shunde") &&
        regionIds.includes("ecom_demo"),
      `[Pre-check] /api/regions appDomain=ALL & includes gz_tianhe, fs_shunde, ecom_demo`
    );

    const llmRes = await fetch("http://127.0.0.1:8132/health").catch(() => null);
    const embRes = await fetch("http://127.0.0.1:8133/health").catch(() => null);
    assert(
      llmRes?.ok && embRes?.ok,
      `[Pre-check] Local LLM (:8132=${llmRes?.status}) and Embedding (:8133=${embRes?.status}) healthy`
    );

    // 1. Pre-run exact baseline guard
    const preBaselineOk = await checkAllBaselines("Pre-Run Baseline");
    if (!preBaselineOk) {
      throw new Error("Aborting E2E: database is not at exact expected baseline before run.");
    }

    // 2. Capture full pre-run DB snapshots
    gzSnap = await captureSchemaSnapshot("region_gz_tianhe");
    ecomSnap = await captureSchemaSnapshot("region_ecom_demo");
    const tpRows = await sql.unsafe(`SELECT task_id, region_id, status FROM public.task_progress ORDER BY updated_at DESC`);
    baselineTaskProgressIds = tpRows.map((r: any) => String(r.task_id));
    const latestCompleted = tpRows.find(
      (r: any) => r.region_id === "gz_tianhe" && (r.status === "COMPLETED" || r.status === "FAILED")
    );
    baselineCompletedTaskId = latestCompleted ? String(latestCompleted.task_id) : "";
    snapshotCaptured = true;
    console.log(
      `INFO [Snapshot] gz_tianhe(themes=${gzSnap.themesById.size}, tickets=${gzSnap.ticketsById.size}, tasks=${gzSnap.agentTasksById.size}), ecom_demo(themes=${ecomSnap.themesById.size}, tickets=${ecomSnap.ticketsById.size}, tasks=${ecomSnap.agentTasksById.size}), task_progress=${baselineTaskProgressIds.length}`
    );

    adminCookie = await loginByHttp(ADMIN_USERNAME, ADMIN_PASSWORD);

    // 3. Execute real-browser Playwright Path A + B + D suite
    const pyOutcome = await runPythonPlaywright(resultJsonPath);
    if (fs.existsSync(resultJsonPath)) {
      browserResult = JSON.parse(fs.readFileSync(resultJsonPath, "utf8"));
    }
    assert(
      pyOutcome.code === 0 && browserResult && Array.isArray(browserResult.failed) && browserResult.failed.length === 0,
      `[Browser Suite] exitCode=${pyOutcome.code}, passed=${browserResult?.passed?.length ?? 0}, failed=${browserResult?.failed?.length ?? -1}`
    );

    // 4. Supplementary DB & API assertions for Path A, Path B, Path D
    const createdTicketId = String(browserResult?.createdTicketId || "");
    const createdTicketNo = String(browserResult?.createdTicketNo || "");
    const reopenedThemeId = String(browserResult?.reopenedThemeId || "");

    if (createdTicketId) {
      const [ticketDb] = await sql.unsafe(
        `SELECT id, ticket_no, status, subdistrict, source_category, confidence, address, canonical_subject, masked_content, primary_theme_id
         FROM region_gz_tianhe.tickets WHERE id = $1 LIMIT 1`,
        [createdTicketId]
      );
      const logsDb = await sql.unsafe(
        `SELECT action, from_status, to_status FROM region_gz_tianhe.disposal_logs WHERE target_type = 'TICKET' AND target_id = $1 ORDER BY created_at ASC`,
        [createdTicketId]
      );
      const ttDb = await sql.unsafe(
        `SELECT theme_id FROM region_gz_tianhe.ticket_themes WHERE ticket_id = $1`,
        [createdTicketId]
      );
      const actions = logsDb.map((r: any) => String(r.action));
      const maskedDb = String(ticketDb?.masked_content || "");
      assert(
        Boolean(ticketDb) &&
          Number(ticketDb.confidence) > 0 &&
          ticketDb.subdistrict === "石牌街道" &&
          Boolean(ticketDb.source_category) &&
          maskedDb.includes("{{PHONE_NUMBER_") &&
          maskedDb.includes("{{EMAIL_") &&
          !maskedDb.includes("15976673363") &&
          !maskedDb.includes("test@example.com") &&
          (Boolean(ticketDb.address) || Boolean(ticketDb.canonical_subject)) &&
          actions.includes("CORRECT_ENTITY") &&
          actions.includes("RESOLVE"),
        `[Path A DB] ticket=${createdTicketNo} conf=${ticketDb?.confidence} sub=${ticketDb?.subdistrict} cat=${ticketDb?.source_category} theme=${ticketDb?.primary_theme_id || (ttDb[0]?.theme_id ?? "standalone")} actions=${JSON.stringify(actions)}`
      );
    } else {
      assert(false, "[Path A DB] createdTicketId missing from browser result");
    }

    if (reopenedThemeId) {
      const [themeDb] = await sql.unsafe(
        `SELECT id, handling_status, handling_progress, risk_level FROM region_gz_tianhe.themes WHERE id = $1 LIMIT 1`,
        [reopenedThemeId]
      );
      const themeReopenLogs = await sql.unsafe(
        `SELECT target_type, target_id, action, meta_json FROM region_gz_tianhe.disposal_logs WHERE action = 'REOPEN' AND created_at >= $1`,
        [runStartedAtIso]
      );
      const hasThemeReopen = themeReopenLogs.some(
        (r: any) => r.target_type === "THEME" && r.target_id === reopenedThemeId
      );
      const hasTicketReopen = themeReopenLogs.some((r: any) => r.target_type === "TICKET");
      assert(
        themeDb?.handling_status === "REOPENED" && hasThemeReopen && hasTicketReopen,
        `[Path B DB] reopenedTheme=${reopenedThemeId} status=${themeDb?.handling_status} risk=${themeDb?.risk_level} reopenLogs=${themeReopenLogs.length} (THEME=${hasThemeReopen}, TICKET=${hasTicketReopen})`
      );
    } else {
      assert(false, "[Path B DB] reopenedThemeId missing from browser result");
    }

    // Path D API: sandbox/xray (persist: false), cross-tenant 404, overview isolation
    const [ecomOverview, govOverview, crossTenant, xrayEcom, xrayGov] = await Promise.all([
      apiJson("/api/overview?region=ecom_demo", adminCookie, "ecom_demo"),
      apiJson("/api/overview?region=gz_tianhe", adminCookie, "gz_tianhe"),
      apiJson("/api/clusters/ECOM-TH-001?region=gz_tianhe", adminCookie, "gz_tianhe"),
      apiJson("/api/sandbox/xray", adminCookie, "ecom_demo", {
        method: "POST",
        body: {
          regionId: "ecom_demo",
          title: "天猫旗舰店生鲜冷链礼盒化冻变质",
          content: "订单 202611200081 的 SKU-GD2026-881 生鲜礼盒收到时完全化冻变质，联系电话 13800138000。",
          subdistrict: "天猫旗舰店",
          persist: false,
        },
      }),
      apiJson("/api/sandbox/xray", adminCookie, "gz_tianhe", {
        method: "POST",
        body: {
          regionId: "gz_tianhe",
          title: "天河南街道夜间施工噪音扰民",
          content: "天河南一路工地凌晨两点还在打桩施工，联系电话 13800138000。",
          subdistrict: "天河南街道",
          persist: false,
        },
      }),
    ]);

    assert(
      ecomOverview.status === 200 &&
        Number(ecomOverview.data?.totalWorkorders) === 3240 &&
        govOverview.status === 200 &&
        Number(govOverview.data?.totalWorkorders) >= 103397,
      `[Path D API] Overview schema isolation (ecom=${ecomOverview.data?.totalWorkorders}, gov=${govOverview.data?.totalWorkorders})`
    );
    assert(
      crossTenant.status === 404,
      `[Path D API] Cross-tenant cluster ECOM-TH-001 rejected under gz_tianhe (status=${crossTenant.status})`
    );
    assert(
      xrayEcom.status === 200 &&
        xrayEcom.data?.domainType === "ECOMMERCE_CS" &&
        xrayGov.status === 200 &&
        xrayGov.data?.domainType === "GOV_12345",
      `[Path D API] /api/sandbox/xray (persist=false) domainType switch (ecom=${xrayEcom.data?.domainType}, gov=${xrayGov.data?.domainType})`
    );
  } finally {
    try {
      // Wait for any in-flight background ingest/cluster job triggered during the run to finish
      // before restoring snapshots/deleting newly created tickets (prevents P4B async race).
      const waitDeadline = Date.now() + 45_000;
      let loggedActiveWait = false;
      let remainingActiveRows: Array<{ task_id: string; region_id: string; status: string }> = [];
      while (Date.now() < waitDeadline) {
        const activeRows = (await sql.unsafe(
          `SELECT task_id, region_id, status
           FROM public.task_progress
           WHERE region_id = ANY($1::text[])
             AND status IN ('PENDING', 'RUNNING')
             AND (created_at >= $2 OR task_id <> ALL($3::text[]))`,
          [["gz_tianhe", "ecom_demo"], runStartedAtIso, baselineTaskProgressIds]
        )) as unknown as Array<{ task_id: string; region_id: string; status: string }>;
        remainingActiveRows = activeRows;
        if (activeRows.length === 0) break;
        if (!loggedActiveWait) {
          loggedActiveWait = true;
          console.log(
            `INFO [Cleanup] Waiting for active background cluster job(s) before snapshot restore: ${activeRows
              .map((r) => `${r.task_id}(${r.status})`)
              .join(", ")}`
          );
        }
        await new Promise((r) => setTimeout(r, 1000));
      }
      if (remainingActiveRows.length > 0) {
        console.warn(
          `WARN [Cleanup] Timed out after 45s waiting for active task_progress row(s): ${remainingActiveRows
            .map((r) => `${r.task_id}(${r.region_id}:${r.status})`)
            .join(", ")}`
        );
      }

      const extraTickets = [
        String(browserResult?.createdTicketId || ""),
      ].filter(Boolean);

      if (gzSnap) {
        await restoreSchemaSnapshot(gzSnap, runStartedAtIso, extraTickets);
      }
      if (ecomSnap) {
        await restoreSchemaSnapshot(ecomSnap, runStartedAtIso, []);
      }

      // Clean public.citizen_submissions & public.task_progress (only after snapshotCaptured)
      if (snapshotCaptured) {
        await sql.unsafe(`DELETE FROM public.citizen_submissions WHERE created_at >= $1`, [runStartedAtIso]);
        await sql.unsafe(`DELETE FROM public.task_progress WHERE task_id <> ALL($1::text[])`, [
          baselineTaskProgressIds,
        ]);
      }

      // Invalidate live :3000 in-memory civic cache across all regions
      if (!adminCookie) {
        adminCookie = await loginByHttp(ADMIN_USERNAME, ADMIN_PASSWORD).catch(() => "");
      }
      if (adminCookie) {
        let syntheticTaskId = "";
        let targetTaskId = baselineCompletedTaskId;
        if (!targetTaskId) {
          syntheticTaskId = `e2e-cache-inv-${Date.now()}`;
          targetTaskId = syntheticTaskId;
          await sql.unsafe(
            `INSERT INTO public.task_progress (task_id, status, stage, stage_text, percent, total, processed, region_id)
             VALUES ($1, 'COMPLETED', 'COMPLETED', 'E2E cache invalidation', 100, 0, 0, 'gz_tianhe')`,
            [syntheticTaskId]
          );
        }
        try {
          const invRes = await apiJson(
            `/api/cluster/progress?region=gz_tianhe&taskId=${encodeURIComponent(targetTaskId)}`,
            adminCookie,
            "gz_tianhe"
          );
          const invStatus = invRes.data?.data?.status;
          assert(
            invRes.status === 200 && (invStatus === "COMPLETED" || invStatus === "FAILED"),
            `[Cache Invalidation] /api/cluster/progress?region=gz_tianhe&taskId=${targetTaskId} -> status=${invRes.status} (${invStatus})`
          );
        } finally {
          if (syntheticTaskId) {
            await sql.unsafe(`DELETE FROM public.task_progress WHERE task_id = $1`, [syntheticTaskId]);
          }
        }
      }

      // Post-cleanup exact DB baseline check
      await checkAllBaselines("Post-Cleanup Baseline");

      // Post-cleanup live API check
      if (adminCookie) {
        const [postGov, postEcom, postTasks] = await Promise.all([
          apiJson("/api/overview?region=gz_tianhe", adminCookie, "gz_tianhe"),
          apiJson("/api/overview?region=ecom_demo", adminCookie, "ecom_demo"),
          apiJson("/api/agent/tasks?region=gz_tianhe", adminCookie, "gz_tianhe"),
        ]);
        const tasksList: any[] = Array.isArray(postTasks.data?.tasks) ? postTasks.data.tasks : [];
        const allCallbacksPending = tasksList
          .filter((t) => t.taskType === "REOPEN_CALLBACK")
          .every((t) => t.status === "PENDING");
        assert(
          Number(postGov.data?.totalWorkorders) === 103397 &&
            Number(postEcom.data?.totalWorkorders) === 3240 &&
            tasksList.length === 8 &&
            allCallbacksPending,
          `[Post-Cleanup Live API] gov=${postGov.data?.totalWorkorders}, ecom=${postEcom.data?.totalWorkorders}, tasks=${tasksList.length}, callbacksPending=${allCallbacksPending}`
        );
      }
    } catch (cleanupErr) {
      failed += 1;
      console.error("FAIL [Cleanup Error]", cleanupErr);
      process.exitCode = 1;
    } finally {
      if (fs.existsSync(resultJsonPath)) {
        try {
          fs.unlinkSync(resultJsonPath);
        } catch {
          // ignore
        }
      }
      try {
        for (const name of fs.readdirSync("/tmp")) {
          if (name.startsWith("demo-abd-")) {
            const full = `/tmp/${name}`;
            const st = fs.statSync(full);
            if (st.mtimeMs >= runStartedAt.getTime() - 5000) {
              fs.unlinkSync(full);
            }
          }
        }
      } catch {
        // ignore
      }
      await sql.end();
    }
  }

  console.log(`\nCombined Path A+B+D E2E Result: ${passed} passed, ${failed} failed`);
  if (failed > 0 || process.exitCode) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("Combined E2E crashed:", err);
  process.exit(1);
});
