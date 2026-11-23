/**
 * R3 端到端闭环验收脚本（6 步 Happy Path + Feedback #8 真实 HTTP 全链路校验 + 自动 DB 基线还原）
 *
 * 覆盖流程：
 *   Step 1: 市民登录 -> 多轮 /api/intake/chat（缺要素追问 + 口语中文手机号/邮箱脱敏 + 数字邮箱防误提）
 *           -> /api/intake/submit（缺要素 400 拦截 + +86/全角手机号归一化 200 入库）
 *   Step 2: 管理员登录 -> /api/workorders 与 /api/tickets 立即检索到新推入工单
 *   Step 3: 后台增量抽取/研判自动完成（confidence > 0、保留市民所选镇街、无 125 主题失控回填）
 *   Step 4: /api/agent/patrol 巡检生成 MISSING_INFO 任务 -> 审批并执行 /api/agent/outreach/voice-turn 一键补全
 *   Step 5: /api/workorders/[id] 状态流转（PENDING -> IN_PROGRESS -> RESOLVED -> 市民重开 REOPENED -> PENDING）
 *           + 验证 tab=pending 包含 REOPENED 工单及 disposal_logs 审计轨迹
 *   Step 6: /api/copilot 流式研判（无「模型响应超时」）+ /api/agent/report 日报生成与读取 + CSV 导出校验
 *   Finally: 自动清理本次运行产生的所有库表数据，确保 gz_tianhe (103,397/5,748) 与 citizen_submissions (0) 零残留
 *
 * 用法：
 *   E2E_BASE_URL=http://localhost:3000 pnpm exec tsx tests/test-happy-path-e2e.ts
 */

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // ignore if .env.local does not exist
  }
}

import { sql } from "../db/client";
import { buildSafeCsv } from "../lib/export-csv";

const BASE_URL = (process.env.E2E_BASE_URL || "http://localhost:3000").replace(/\/+$/, "");
const REGION_ID = "gz_tianhe";

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
  path: string,
  cookie: string,
  init?: { method?: string; body?: unknown }
): Promise<{ status: number; data: T }> {
  const res = await fetch(`${BASE_URL}${path}`, {
    method: init?.method ?? "GET",
    headers: {
      Cookie: cookie,
      Origin: BASE_URL,
      "x-region-id": REGION_ID,
      ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
  const data = (await res.json().catch(() => ({}))) as T;
  return { status: res.status, data };
}

async function sleep(ms: number) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const runStartedAt = new Date();
  let createdTicketId = "";
  let createdTicketNo = "";
  const createdTaskIds = new Set<string>();
  const createdReportIds = new Set<string>();

  try {
    // 前置基线检查
    const [preTickets] = await sql.unsafe("SELECT count(*)::int AS c FROM region_gz_tianhe.tickets");
    const [preThemes] = await sql.unsafe("SELECT count(*)::int AS c FROM region_gz_tianhe.themes");
    const [preSubs] = await sql.unsafe("SELECT count(*)::int AS c FROM public.citizen_submissions");
    assert(
      Number(preTickets?.c) === 103397 &&
        Number(preThemes?.c) === 5748 &&
        Number(preSubs?.c) === 0,
      `[前置基线] gz_tianhe=(${preTickets?.c}/${preThemes?.c}), citizen_submissions=${preSubs?.c}`
    );

    const citizenCookie = await loginByHttp(
      process.env.CITIZEN_USERNAME || "citizen",
      process.env.CITIZEN_PASSWORD || "citizen123"
    );
    const adminCookie = await loginByHttp(
      process.env.ADMIN_USERNAME || "admin",
      process.env.ADMIN_PASSWORD || "admin"
    );

    // =========================================================================
    // Step 1: 市民对话受理 + Feedback #8 边界检验 + 校验拦截 & 提交入库
    // =========================================================================
    const turn1 = await apiJson("/api/intake/chat", citizenCookie, {
      method: "POST",
      body: {
        regionId: REGION_ID,
        messages: [
          {
            role: "user",
            content: "石牌街道附近晚上噪声和烧烤油烟特别大，影响居民休息",
          },
        ],
      },
    });
    assert(
      turn1.status === 200 &&
        turn1.data?.success === true &&
        turn1.data?.readyToSubmit === false &&
        Array.isArray(turn1.data?.missingFields) &&
        turn1.data.missingFields.length > 0 &&
        turn1.data?.draft?.subdistrict === "石牌街道",
      `[Step 1a] 首轮缺要素追问成功 (sub=${turn1.data?.draft?.subdistrict}, ready=${turn1.data?.readyToSubmit}, missing=${JSON.stringify(turn1.data?.missingFields)})`
    );

    const turn2 = await apiJson("/api/intake/chat", citizenCookie, {
      method: "POST",
      body: {
        regionId: REGION_ID,
        draft: turn1.data.draft,
        messages: [
          { role: "user", content: "石牌街道附近晚上噪声和烧烤油烟特别大，影响居民休息" },
          { role: "assistant", content: turn1.data.reply },
          { role: "user", content: "我的电话是+86一三八，零零一三，八零零零，邮箱 13800138000@163.com" },
        ],
      },
    });
    assert(
      turn2.status === 200 &&
        turn2.data?.draft?.contactPhone === "13800138000" &&
        turn2.data?.draft?.contactEmail === "13800138000@163.com" &&
        !/\{\{[A-Z0-9_]+_\d+\}\}/.test(String(turn2.data?.draft?.content || "")),
      `[Step 1b] Feedback #8 口语中文+逗号/+86 电话与邮箱还原成功 (phone=${turn2.data?.draft?.contactPhone}, email=${turn2.data?.draft?.contactEmail})`
    );

    const emailOnlyTurn = await apiJson("/api/intake/chat", citizenCookie, {
      method: "POST",
      body: {
        regionId: REGION_ID,
        messages: [{ role: "user", content: "我邮箱是 13800138000@163.com" }],
      },
    });
    assert(
      emailOnlyTurn.status === 200 &&
        emailOnlyTurn.data?.draft?.contactEmail === "13800138000@163.com" &&
        emailOnlyTurn.data?.draft?.contactPhone === "",
      `[Step 1c] 数字邮箱不误提为手机号 (phone=${JSON.stringify(emailOnlyTurn.data?.draft?.contactPhone)}, email=${emailOnlyTurn.data?.draft?.contactEmail})`
    );

    const badSubmit = await apiJson("/api/intake/submit", citizenCookie, {
      method: "POST",
      body: {
        regionId: REGION_ID,
        content: "石牌街道附近晚上噪声和烧烤油烟特别大",
        subdistrict: "石牌街道",
        category: "生态环境",
      },
    });
    assert(
      badSubmit.status === 400,
      `[Step 1d] 缺少联系方式提交被服务端严格拦截 (status=${badSubmit.status})`
    );

    const uniqueMarker = `E2E${Date.now().toString().slice(-6)}`;
    const submitRes = await apiJson("/api/intake/submit", citizenCookie, {
      method: "POST",
      body: {
        regionId: REGION_ID,
        title: `石牌街道夜间噪声投诉-${uniqueMarker}`,
        content: `石牌街道附近每晚凌晨仍有严重噪声和烧烤油烟扰民，请尽快核查整改（标记 ${uniqueMarker}），联系电话 15976673363。`,
        subdistrict: "石牌街道",
        category: "生态环境",
        // 故意不传 address/subject，留给 Step 4 一键巡检外呼补全
        contactPhone: "＋86 １５９－７６６７－３３６３",
        source: "AGENT_VOICE",
      },
    });
    createdTicketId = String(submitRes.data?.ticketId || "");
    createdTicketNo = String(submitRes.data?.ticketNo || "");
    assert(
      submitRes.status === 200 &&
        submitRes.data?.success === true &&
        Boolean(createdTicketId) &&
        Boolean(createdTicketNo) &&
        !String(submitRes.data?.maskedPreview || "").includes("15976673363"),
      `[Step 1e] +86 全角手机号归一化提交成功且 PII 脱敏 (${createdTicketNo})`
    );

    // =========================================================================
    // Step 2 & Step 3: 管理员工作台立即检索到工单 & 后台增量研判完成
    // =========================================================================
    const woList = await apiJson(`/api/workorders?region=${REGION_ID}&keyword=${encodeURIComponent(createdTicketNo)}`, adminCookie);
    const tkList = await apiJson(`/api/tickets?region=${REGION_ID}&keyword=${encodeURIComponent(createdTicketNo)}`, adminCookie);
    assert(
      woList.status === 200 &&
        Array.isArray(woList.data?.data) &&
        woList.data.data.some((row: any) => (row.ticketNo || row.id) === createdTicketNo) &&
        tkList.status === 200 &&
        Array.isArray(tkList.data?.data) &&
        tkList.data.data.some((row: any) => row.ticketNo === createdTicketNo),
      `[Step 2] 管理端 /api/workorders 与 /api/tickets 立即查到新工单 ${createdTicketNo}`
    );

    let processedRow: any = null;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const rows = await sql.unsafe(
        `SELECT id, subdistrict, confidence, primary_theme_id, address, canonical_subject
         FROM region_gz_tianhe.tickets WHERE id = $1 LIMIT 1`,
        [createdTicketId]
      );
      const row = rows[0];
      if (row && row.confidence != null && Number(row.confidence) > 0) {
        processedRow = row;
        break;
      }
      await sleep(1500);
    }
    assert(
      Boolean(processedRow) &&
        Number(processedRow?.confidence) > 0 &&
        processedRow?.subdistrict === "石牌街道",
      `[Step 3] 后台增量处理与抽取完成且保留市民镇街 (confidence=${processedRow?.confidence}, subdistrict=${processedRow?.subdistrict})`
    );

    const recentProgress = await sql.unsafe(
      `SELECT task_id, status, stage, total, processed
       FROM public.task_progress
       WHERE region_id = $1 AND created_at >= $2
       ORDER BY created_at DESC LIMIT 5`,
      [REGION_ID, runStartedAt.toISOString()]
    );
    const stuckBackfill = recentProgress.some(
      (r: any) => r.stage === "SYNTHESIZING" && Number(r.total || 0) >= 50
    );
    assert(
      !stuckBackfill,
      `[Step 3b] 增量入库未触发全区 125 主题历史回填阻塞 (progress=${JSON.stringify(recentProgress)})`
    );

    // =========================================================================
    // Step 4: 缺失要素巡检 + 一键外呼补全
    // =========================================================================
    const patrolRes = await apiJson("/api/agent/patrol", adminCookie, {
      method: "POST",
      body: { regionId: REGION_ID },
    });
    const patrolTasks: any[] = Array.isArray(patrolRes.data?.tasks) ? patrolRes.data.tasks : [];
    for (const t of patrolTasks) {
      if (t?.id && new Date(t.createdAt || 0).getTime() >= runStartedAt.getTime() - 5000) {
        createdTaskIds.add(String(t.id));
      }
    }
    const targetTask = patrolTasks.find(
      (t) => t.targetId === createdTicketId && t.taskType === "MISSING_INFO"
    );
    assert(
      patrolRes.status === 200 && Boolean(targetTask),
      `[Step 4a] /api/agent/patrol 为缺要素测试工单生成 MISSING_INFO 任务 (taskId=${targetTask?.id || "missing"})`
    );

    if (targetTask?.id) {
      if (targetTask.status === "PENDING") {
        const approveRes = await apiJson(`/api/agent/tasks/${encodeURIComponent(targetTask.id)}`, adminCookie, {
          method: "PATCH",
          body: { regionId: REGION_ID, action: "APPROVE" },
        });
        assert(approveRes.status === 200, `[Step 4b] 审批 MISSING_INFO 外呼任务 (${approveRes.status})`);
      }

      const voiceRes = await apiJson("/api/agent/outreach/voice-turn", adminCookie, {
        method: "POST",
        body: {
          regionId: REGION_ID,
          taskId: targetTask.id,
          transcript: "具体地址在石牌西路88号楼下老广烧烤档",
        },
      });
      assert(
        voiceRes.status === 200 &&
          voiceRes.data?.success === true &&
          (Boolean(voiceRes.data?.extractedPatch?.address) ||
            Boolean(voiceRes.data?.extractedPatch?.canonicalSubject)),
        `[Step 4c] /api/agent/outreach/voice-turn 一键补全缺失要素成功 (patch=${JSON.stringify(voiceRes.data?.extractedPatch)})`
      );
    }

    // =========================================================================
    // Step 5: 工单状态流转 + REOPENED 在 tab=pending 可见性 + disposal_logs
    // =========================================================================
    const toProgress = await apiJson(`/api/workorders/${encodeURIComponent(createdTicketId)}`, adminCookie, {
      method: "PATCH",
      body: { action: "UPDATE_STATUS", status: "IN_PROGRESS", note: "E2E 派单处置" },
    });
    const toResolved = await apiJson(`/api/workorders/${encodeURIComponent(createdTicketId)}`, adminCookie, {
      method: "PATCH",
      body: { action: "UPDATE_STATUS", status: "RESOLVED", note: "E2E 办结归档" },
    });
    const reopenRes = await apiJson(
      `/api/intake/my-tickets/${encodeURIComponent(createdTicketNo)}/reopen`,
      citizenCookie,
      {
        method: "POST",
        body: { regionId: REGION_ID, reason: "E2E 验证重开回流" },
      }
    );
    const reopenedTicketRes = await apiJson(
      `/api/tickets?region=${REGION_ID}&keyword=${encodeURIComponent(createdTicketNo)}`,
      adminCookie
    );
    const pendingTabRes = await apiJson(
      `/api/workorders?region=${REGION_ID}&tab=pending&keyword=${encodeURIComponent(createdTicketNo)}`,
      adminCookie
    );
    const toPending = await apiJson(`/api/workorders/${encodeURIComponent(createdTicketId)}`, adminCookie, {
      method: "PATCH",
      body: { action: "UPDATE_STATUS", status: "PENDING", note: "E2E 重开后转待处理" },
    });
    const detailAfter = await apiJson(`/api/workorders/${encodeURIComponent(createdTicketId)}?region=${REGION_ID}`, adminCookie);
    assert(
      toProgress.status === 200 &&
        toResolved.status === 200 &&
        reopenRes.status === 200 &&
        reopenedTicketRes.status === 200 &&
        Array.isArray(reopenedTicketRes.data?.data) &&
        reopenedTicketRes.data.data.some((r: any) => r.ticketNo === createdTicketNo && r.status === "REOPENED") &&
        pendingTabRes.status === 200 &&
        Array.isArray(pendingTabRes.data?.data) &&
        pendingTabRes.data.data.some((r: any) => (r.ticketNo || r.id) === createdTicketNo) &&
        toPending.status === 200 &&
        Array.isArray(detailAfter.data?.disposalLogs) &&
        detailAfter.data.disposalLogs.length >= 4,
      `[Step 5] 状态流转与 REOPENED 待办页签可见性及处置日志完整 (logs=${detailAfter.data?.disposalLogs?.length})`
    );

    // =========================================================================
    // Step 6: Admin Copilot 流式响应 + 当日简报生成/读取 + CSV 导出校验
    // =========================================================================
    const copilotRes = await fetch(`${BASE_URL}/api/copilot?region=${REGION_ID}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: adminCookie,
        Origin: BASE_URL,
        "x-region-id": REGION_ID,
      },
      body: JSON.stringify({
        prompt: "请用两句话概括本区当前待办工单情况。",
        messages: [{ role: "user", content: "请用两句话概括本区当前待办工单情况。" }],
      }),
    });
    const copilotText = await copilotRes.text();
    assert(
      copilotRes.status === 200 &&
        copilotText.trim().length > 10 &&
        !copilotText.includes("模型响应超时"),
      `[Step 6a] POST /api/copilot 流式输出成功且无超时 (len=${copilotText.trim().length})`
    );

    const reportPost = await apiJson("/api/agent/report", adminCookie, {
      method: "POST",
      body: { regionId: REGION_ID },
    });
    if (reportPost.data?.report?.id) {
      createdReportIds.add(String(reportPost.data.report.id));
    }
    const reportGet = await apiJson(`/api/agent/report?region=${REGION_ID}`, adminCookie);
    assert(
      reportPost.status === 200 &&
        reportGet.status === 200 &&
        String(reportGet.data?.report?.markdown || "").trim().length > 20,
      `[Step 6b] /api/agent/report 生成并读取当日研判简报成功 (id=${reportPost.data?.report?.id})`
    );

    const exportRows = (woList.data?.data || []).slice(0, 5).map((r: any) => [
      r.ticketNo || r.id,
      r.title,
      r.subdistrict || r.region,
      r.status,
    ]);
    const csvOutput = buildSafeCsv(["工单编号", "标题", "所属镇街", "状态"], exportRows);
    assert(
      csvOutput.includes(createdTicketNo),
      `[Step 6c] CSV 导出函数生成含新工单的合法 CSV (bytes=${csvOutput.length})`
    );
  } finally {
    // 清理本次 E2E 运行写入的所有 DB 记录，保障基线零污染
    try {
      const startIso = new Date(runStartedAt.getTime() - 2000).toISOString();
      if (createdTicketId || createdTicketNo) {
        await sql.unsafe(
          `DELETE FROM public.citizen_submissions WHERE ticket_id = $1 OR ticket_no = $2`,
          [createdTicketId, createdTicketNo]
        );
        if (createdTicketId) {
          await sql.unsafe(`DELETE FROM region_gz_tianhe.ticket_embeddings WHERE ticket_id = $1`, [
            createdTicketId,
          ]);
          await sql.unsafe(`DELETE FROM region_gz_tianhe.ticket_themes WHERE ticket_id = $1`, [
            createdTicketId,
          ]);
          await sql.unsafe(`DELETE FROM region_gz_tianhe.disposal_logs WHERE target_id = $1`, [
            createdTicketId,
          ]);
          await sql.unsafe(`DELETE FROM region_gz_tianhe.tickets WHERE id = $1`, [
            createdTicketId,
          ]);
        }
      }
      await sql.unsafe(
        `DELETE FROM region_gz_tianhe.agent_tasks WHERE created_at >= $1`,
        [startIso]
      );
      if (createdReportIds.size > 0) {
        const ids = [...createdReportIds];
        await sql.unsafe(
          `DELETE FROM region_gz_tianhe.agent_reports WHERE id = ANY($1::text[])`,
          [ids]
        );
      }
      await sql.unsafe(
        `DELETE FROM region_gz_tianhe.disposal_logs WHERE created_at >= $1`,
        [startIso]
      );
      await sql.unsafe(
        `DELETE FROM public.task_progress WHERE region_id = $1 AND created_at >= $2`,
        [REGION_ID, startIso]
      );

      const [postTickets] = await sql.unsafe("SELECT count(*)::int AS c FROM region_gz_tianhe.tickets");
      const [postThemes] = await sql.unsafe("SELECT count(*)::int AS c FROM region_gz_tianhe.themes");
      const [postSubs] = await sql.unsafe("SELECT count(*)::int AS c FROM public.citizen_submissions");
      assert(
        Number(postTickets?.c) === 103397 &&
          Number(postThemes?.c) === 5748 &&
          Number(postSubs?.c) === 0,
        `[清理后基线] gz_tianhe=(${postTickets?.c}/${postThemes?.c}), citizen_submissions=${postSubs?.c}`
      );
    } finally {
      await sql.end();
    }
  }

  console.log(`\nE2E 结果：${passed} passed, ${failed} failed`);
  if (failed > 0 || process.exitCode) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("E2E crashed:", err);
  process.exit(1);
});
