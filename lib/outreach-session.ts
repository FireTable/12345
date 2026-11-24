import { randomUUID } from "crypto";
import { sql, getRegionDb } from "@/db/client";
import { getAppDomainMode, resolveRegionDomainType, type AppDomainMode } from "@/lib/app-domain";
import type { DomainType } from "@/lib/domain-profile";
import {
  broadcastOutreachDismissed,
  broadcastOutreachToAdmins,
  broadcastOutreachToCitizen,
  countOnlineOutreachTargets,
} from "@/lib/sse-broadcaster";
import {
  ensureAgentGovernanceTables,
  ensureCitizenSubmissionsTable,
  processAgentVoiceTurn,
  type AgentTaskDto,
} from "@/lib/agent-governance";

export type OutreachSessionStatus =
  | "RINGING"
  | "IN_CALL"
  | "COMPLETED"
  | "REJECTED"
  | "CANCELLED";

export interface OutreachTurn {
  id: string;
  role: "agent" | "citizen";
  text: string;
  spokenText?: string;
  reasoning?: string;
  extractedPatch?: Record<string, string>;
  sentiment?: "NEGATIVE" | "POSITIVE" | "UNCLEAR";
  createdAt: string;
}

export interface OutreachSessionAdminDto {
  id: string;
  regionId: string;
  taskId: string;
  taskType: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  domainType: DomainType;
  targetUserId: string | null;
  targetUserName: string | null;
  initiatedBy: string;
  status: OutreachSessionStatus;
  missingSlots: string[];
  reason: string;
  turns: OutreachTurn[];
  extractedPatch: Record<string, string> | null;
  triggeredFakeClosure: boolean;
  reopenedThemeId: string | null;
  resultSummary: string | null;
  onlineTargetCount: number;
  processing: boolean;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

/** 用户端可见的外呼会话：不含内部推理、发起人、假闭环研判与任务处置摘要。 */
export interface OutreachSessionCitizenDto {
  id: string;
  regionId: string;
  taskId: string;
  taskType: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  domainType: DomainType;
  status: OutreachSessionStatus;
  missingSlots: string[];
  turns: Array<{
    id: string;
    role: "agent" | "citizen";
    text: string;
    spokenText?: string;
    createdAt: string;
  }>;
  completed: boolean;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __outreachSessionsReady: boolean | undefined;
  // eslint-disable-next-line no-var
  var __outreachSessionsPending: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var __outreachExpireLastRunAt: number | undefined;
}

/** 响铃超时：超过该时长未接听自动结束，防止离线用户数天后登录仍被弹窗。 */
export const OUTREACH_RINGING_TIMEOUT_SECONDS = 90;
/** 通话空闲超时：IN_CALL 状态长时间无任何应答自动挂断。 */
export const OUTREACH_IN_CALL_IDLE_TIMEOUT_SECONDS = 600;
/** 回答处理锁过期时间（覆盖 LLM 超时 + 写库），进程崩溃后可自动释放。 */
const OUTREACH_REPLY_LOCK_STALE_SECONDS = 90;
const EXPIRE_THROTTLE_MS = 3000;
const ACTIVE_STATUSES = ["RINGING", "IN_CALL"] as const;

/** 剥离气隙脱敏占位符，避免数字人播报与字幕念出 `{{PHONE_NUMBER_1}}`。 */
export function toSpokenOutreachText(raw: string): string {
  return raw
    .replace(/[（(]\s*(?:来电号码|联系方式|联系电话|手机号|号码)?\s*[:：]?\s*\{\{[A-Z0-9_]+\}\}\s*[）)]/g, "")
    .replace(/\{\{[A-Z0-9_]+\}\}/g, "")
    .replace(/\s*([，,。！？?!；;])\s*/g, "$1")
    .replace(/([，,]){2,}/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[,，、\s]+/, "")
    .trim();
}

/** 展示用外呼文本：将原始占位符（如 `(来电号码 {{PHONE_NUMBER_1}})`）替换为友好隐私提示。 */
export function toDisplayOutreachText(raw: string): string {
  return raw
    .replace(
      /[（(]\s*(?:来电号码|联系方式|联系电话|手机号|号码)?\s*[:：]?\s*\{\{[A-Z0-9_]+\}\}\s*[）)]/g,
      "（号码已隐私保护）"
    )
    .replace(/\{\{[A-Z0-9_]+\}\}/g, "（已隐私保护）")
    .trim();
}

export async function ensureOutreachSessionsTable(): Promise<void> {
  if (globalThis.__outreachSessionsReady) return;
  if (globalThis.__outreachSessionsPending) {
    await globalThis.__outreachSessionsPending;
    return;
  }

  const ddl = (async () => {
    await sql`
      CREATE TABLE IF NOT EXISTS public.outreach_sessions (
        id VARCHAR(64) PRIMARY KEY,
        region_id VARCHAR(64) NOT NULL,
        task_id VARCHAR(64) NOT NULL,
        task_type VARCHAR(32) NOT NULL,
        target_type VARCHAR(16) NOT NULL,
        target_id VARCHAR(64) NOT NULL,
        target_title TEXT NOT NULL,
        domain_type VARCHAR(32) NOT NULL DEFAULT 'GOV_12345',
        target_user_id TEXT,
        target_user_name TEXT,
        initiated_by TEXT NOT NULL,
        status VARCHAR(24) NOT NULL DEFAULT 'RINGING',
        missing_slots_json TEXT,
        reason TEXT,
        turns_json TEXT NOT NULL DEFAULT '[]',
        extracted_patch_json TEXT,
        triggered_fake_closure BOOLEAN NOT NULL DEFAULT false,
        reopened_theme_id VARCHAR(64),
        result_summary TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
        answered_at TIMESTAMPTZ,
        ended_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
    `;
    await sql`ALTER TABLE public.outreach_sessions ADD COLUMN IF NOT EXISTS reply_lock_token VARCHAR(64);`;
    await sql`ALTER TABLE public.outreach_sessions ADD COLUMN IF NOT EXISTS reply_lock_at TIMESTAMPTZ;`;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_outreach_sessions_user_status
      ON public.outreach_sessions (target_user_id, status, updated_at DESC);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_outreach_sessions_task
      ON public.outreach_sessions (region_id, task_id, updated_at DESC);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_outreach_sessions_active
      ON public.outreach_sessions (status, updated_at)
      WHERE status IN ('RINGING', 'IN_CALL');
    `;
    globalThis.__outreachSessionsReady = true;
  })();

  globalThis.__outreachSessionsPending = ddl;
  try {
    await ddl;
  } finally {
    globalThis.__outreachSessionsPending = undefined;
  }
}

function asIso(v: unknown): string {
  if (!v) return new Date().toISOString();
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? new Date().toISOString() : v.toISOString();
  const d = new Date(String(v));
  return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
}

function asIsoOrNull(v: unknown): string | null {
  if (!v) return null;
  const d = v instanceof Date ? v : new Date(String(v));
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function safeJsonParse<T>(raw: unknown, fallback: T): T {
  if (typeof raw !== "string" || !raw.trim()) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function isActiveStatus(status: string): boolean {
  return (ACTIVE_STATUSES as readonly string[]).includes(status);
}

function toAdminDto(row: Record<string, unknown>, processing = false): OutreachSessionAdminDto {
  const regionId = String(row.region_id || "");
  const targetUserId = row.target_user_id ? String(row.target_user_id) : null;
  const lockAt = row.reply_lock_at ? new Date(String(row.reply_lock_at)).getTime() : 0;
  const lockFresh =
    Boolean(row.reply_lock_token) &&
    lockAt > 0 &&
    Date.now() - lockAt < OUTREACH_REPLY_LOCK_STALE_SECONDS * 1000;
  return {
    id: String(row.id),
    regionId,
    taskId: String(row.task_id || ""),
    taskType: String(row.task_type || "MISSING_INFO"),
    targetType: String(row.target_type || "TICKET"),
    targetId: String(row.target_id || ""),
    targetTitle: String(row.target_title || ""),
    domainType: row.domain_type === "ECOMMERCE_CS" ? "ECOMMERCE_CS" : "GOV_12345",
    targetUserId,
    targetUserName: row.target_user_name ? String(row.target_user_name) : null,
    initiatedBy: String(row.initiated_by || "admin"),
    status: String(row.status || "RINGING") as OutreachSessionStatus,
    missingSlots: safeJsonParse<string[]>(row.missing_slots_json, []),
    reason: String(row.reason || ""),
    turns: safeJsonParse<OutreachTurn[]>(row.turns_json, []),
    extractedPatch: safeJsonParse<Record<string, string> | null>(row.extracted_patch_json, null),
    triggeredFakeClosure: Boolean(row.triggered_fake_closure),
    reopenedThemeId: row.reopened_theme_id ? String(row.reopened_theme_id) : null,
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    onlineTargetCount: countOnlineOutreachTargets(targetUserId),
    processing: processing || (isActiveStatus(String(row.status || "")) && lockFresh),
    createdAt: asIso(row.created_at),
    answeredAt: asIsoOrNull(row.answered_at),
    endedAt: asIsoOrNull(row.ended_at),
    updatedAt: asIso(row.updated_at),
  };
}

export function sanitizeOutreachForCitizen(
  admin: OutreachSessionAdminDto
): OutreachSessionCitizenDto {
  return {
    id: admin.id,
    regionId: admin.regionId,
    taskId: admin.taskId,
    taskType: admin.taskType,
    targetType: admin.targetType,
    targetId: admin.targetId,
    targetTitle: admin.targetTitle,
    domainType: admin.domainType,
    status: admin.status,
    missingSlots: admin.missingSlots,
    turns: admin.turns.map((t) => ({
      id: t.id,
      role: t.role,
      text: t.text,
      ...(t.spokenText ? { spokenText: t.spokenText } : {}),
      createdAt: t.createdAt,
    })),
    completed: admin.status === "COMPLETED",
    createdAt: admin.createdAt,
    answeredAt: admin.answeredAt,
    endedAt: admin.endedAt,
    updatedAt: admin.updatedAt,
  };
}

/** 生成原子追加单条通话记录所需的 JSON 参数（配合 SQL `turns_json::jsonb || $x::jsonb`）。 */
function turnAppendParam(turn: OutreachTurn): string {
  return JSON.stringify([turn]);
}

/** 通知管理端最新状态；会话结束时同步关闭目标用户端所有窗口的来电弹窗。 */
function broadcastSessionState(dto: OutreachSessionAdminDto, processing = false): void {
  broadcastOutreachToAdmins(dto.regionId, { session: dto, processing });
  if (dto.status === "REJECTED" || dto.status === "CANCELLED") {
    broadcastOutreachDismissed(dto.regionId, dto.id, dto.targetUserId);
  } else {
    broadcastOutreachToCitizen(
      dto.regionId,
      dto.targetUserId,
      "outreach-update",
      sanitizeOutreachForCitizen(dto)
    );
  }
}

async function fetchSessionRow(sessionId: string): Promise<Record<string, unknown> | null> {
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions WHERE id = ${sessionId} LIMIT 1
  `;
  return rows[0] ?? null;
}

/**
 * 自动结束超时会话：响铃超时未接听、通话长时间无应答（且没有正在处理的回答）。
 * 按进程节流执行，并向管理端与目标用户端广播结束状态。
 */
export async function expireStaleOutreachSessions(force = false): Promise<number> {
  await ensureOutreachSessionsTable();
  const now = Date.now();
  if (
    !force &&
    globalThis.__outreachExpireLastRunAt &&
    now - globalThis.__outreachExpireLastRunAt < EXPIRE_THROTTLE_MS
  ) {
    return 0;
  }
  globalThis.__outreachExpireLastRunAt = now;

  const nowIso = new Date(now).toISOString();
  const turnId = `sys-timeout-${now}`;
  const ringingText = "对方未接听，本次来电已超时结束。";
  const ringingReasoning = `【响铃超时】用户端超过 ${OUTREACH_RINGING_TIMEOUT_SECONDS} 秒未接听，系统自动结束本次外呼，可稍后重新发起。`;
  const idleText = "通话长时间无应答，已自动结束。";
  const idleReasoning = "【通话空闲超时】用户端长时间无应答，系统自动挂断本次外呼。";
  const expired = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'CANCELLED',
        turns_json = (
          COALESCE(NULLIF(turns_json, ''), '[]')::jsonb ||
          jsonb_build_array(jsonb_build_object(
            'id', ${turnId}::text,
            'role', 'agent'::text,
            'text', CASE WHEN status = 'RINGING' THEN ${ringingText}::text ELSE ${idleText}::text END,
            'reasoning', CASE WHEN status = 'RINGING' THEN ${ringingReasoning}::text ELSE ${idleReasoning}::text END,
            'createdAt', ${nowIso}::text
          ))
        )::text,
        ended_at = now(),
        updated_at = now(),
        reply_lock_token = NULL,
        reply_lock_at = NULL
    WHERE (
        status = 'RINGING'
        AND updated_at < now() - make_interval(secs => ${OUTREACH_RINGING_TIMEOUT_SECONDS}::int)
      ) OR (
        status = 'IN_CALL'
        AND updated_at < now() - make_interval(secs => ${OUTREACH_IN_CALL_IDLE_TIMEOUT_SECONDS}::int)
        AND (
          reply_lock_token IS NULL
          OR reply_lock_at < now() - make_interval(secs => ${OUTREACH_REPLY_LOCK_STALE_SECONDS}::int)
        )
      )
    RETURNING *
  `;

  for (const row of expired) {
    broadcastSessionState(toAdminDto(row, false));
  }
  return expired.length;
}

async function resolveUserDisplayName(userId: string): Promise<string | null> {
  try {
    const rows = await sql<Array<{ name: string | null; username: string | null }>>`
      SELECT name, username FROM public."user" WHERE id = ${userId} LIMIT 1
    `;
    const u = rows[0];
    return u ? (u.name || u.username || userId) : null;
  } catch {
    return null;
  }
}

export async function resolveTargetUserForTask(input: {
  regionId: string;
  schemaName: string;
  targetType: string;
  targetId: string;
}): Promise<{ userId: string | null; userName: string | null }> {
  await ensureCitizenSubmissionsTable();

  if (input.targetType === "TICKET") {
    const rows = await sql<Array<{ user_id: string }>>`
      SELECT user_id
      FROM public.citizen_submissions
      WHERE region_id = ${input.regionId}
        AND (ticket_id = ${input.targetId} OR ticket_no = ${input.targetId})
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const uid = rows[0]?.user_id || null;
    return {
      userId: uid,
      userName: uid ? await resolveUserDisplayName(uid) : null,
    };
  }

  // THEME 目标：查找所属工单在 citizen_submissions 中最近的关联提交人
  const memberRows = await sql.unsafe<Array<{ ticket_id: string }>>(
    `
    SELECT ticket_id FROM "${input.schemaName}".ticket_themes WHERE theme_id = $1
    UNION
    SELECT id AS ticket_id FROM "${input.schemaName}".tickets WHERE primary_theme_id = $1
    LIMIT 100
    `,
    [input.targetId]
  );
  const ticketIds = memberRows.map((r) => r.ticket_id).filter(Boolean);
  if (ticketIds.length > 0) {
    const subRows = await sql<Array<{ user_id: string }>>`
      SELECT user_id
      FROM public.citizen_submissions
      WHERE region_id = ${input.regionId}
        AND ticket_id = ANY(${ticketIds}::varchar[])
      ORDER BY created_at DESC
      LIMIT 1
    `;
    const uid = subRows[0]?.user_id || null;
    if (uid) {
      return {
        userId: uid,
        userName: await resolveUserDisplayName(uid),
      };
    }
  }

  return { userId: null, userName: null };
}

function buildInitialGreeting(task: {
  taskType: string;
  draftMessage: string;
  targetTitle: string;
  domainType: DomainType;
}): { display: string; spoken: string } {
  const isEcommerce = task.domainType === "ECOMMERCE_CS";
  const rawGreeting =
    task.draftMessage.trim() ||
    (task.taskType === "REOPEN_CALLBACK"
      ? `您好，这里是${isEcommerce ? "售后质检回访专席" : "12345 政务回访专席"}，请问您此前反映的「${task.targetTitle}」是否已妥善解决？`
      : `您好，这里是${isEcommerce ? "售后信息核实专席" : "12345 政务热线智能专席"}，为尽快为您派单处置「${task.targetTitle}」，请补充具体地点或关键要素。`);
  return {
    display: toDisplayOutreachText(rawGreeting),
    spoken: toSpokenOutreachText(rawGreeting),
  };
}

/** 结束同一任务下仍处于活跃状态的旧会话（重新发起外呼前调用，保证同一任务最多一个活跃会话）。 */
async function cancelActiveSessionsForTask(
  regionId: string,
  taskId: string,
  reasonText: string
): Promise<void> {
  const nowIso = new Date().toISOString();
  const turn: OutreachTurn = {
    id: `sys-superseded-${Date.now()}`,
    role: "agent",
    text: "本次来电已结束。",
    reasoning: reasonText,
    createdAt: nowIso,
  };
  const rows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'CANCELLED',
        turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(turn)}::jsonb)::text,
        ended_at = now(),
        updated_at = now(),
        reply_lock_token = NULL,
        reply_lock_at = NULL
    WHERE region_id = ${regionId}
      AND task_id = ${taskId}
      AND status IN ('RINGING', 'IN_CALL')
    RETURNING *
  `;
  for (const row of rows) {
    broadcastSessionState(toAdminDto(row, false));
  }
}

export async function createOrResumeOutreachSession(input: {
  regionId: string;
  taskId: string;
  initiatedBy: string;
  targetUserId?: string;
  forceNew?: boolean;
  /** 仅查看/恢复最近一次会话：已存在任何会话时直接返回，不再新建或重新响铃。 */
  resumeOnly?: boolean;
}): Promise<
  | { ok: true; session: OutreachSessionAdminDto; reused: boolean }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }
> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions(true);
  const schemaName = await ensureAgentGovernanceTables(input.regionId);
  const { region } = await getRegionDb(input.regionId);
  const appDomain = getAppDomainMode();
  const domainType: DomainType = region?.categoryConfigJson
    ? resolveRegionDomainType(region.categoryConfigJson)
    : appDomain === "ECOMMERCE_CS"
      ? "ECOMMERCE_CS"
      : "GOV_12345";

  const taskRows = await sql.unsafe<Array<Record<string, unknown>>>(
    `SELECT * FROM "${schemaName}".agent_tasks WHERE id = $1 LIMIT 1`,
    [input.taskId]
  );
  const rawTask = taskRows[0];
  if (!rawTask) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "未找到指定的 Agent 治理任务" };
  }

  const autonomyLevel = String(rawTask.autonomy_level || "");
  const taskType = String(rawTask.task_type || "MISSING_INFO");
  const taskStatus = String(rawTask.status || "PENDING");
  if (autonomyLevel === "L3_BLOCKED" || taskType === "REDLINE_BLOCK") {
    return {
      ok: false,
      status: 409,
      code: "REDLINE_BLOCKED",
      error: "命中涉稳/合规红线熔断（L3），禁止发起 AI 自动外呼，请转人工专班处置",
    };
  }

  const existingRows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions
    WHERE region_id = ${input.regionId} AND task_id = ${input.taskId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const existing = existingRows[0];

  if (existing && input.resumeOnly && !input.forceNew) {
    return { ok: true, session: toAdminDto(existing, false), reused: true };
  }

  if (existing && !input.forceNew && isActiveStatus(String(existing.status || ""))) {
    // 管理员显式再次呼叫：刷新响铃计时并重新推送给目标用户
    const refreshed =
      existing.status === "RINGING"
        ? (
            await sql<Array<Record<string, unknown>>>`
              UPDATE public.outreach_sessions
              SET updated_at = now()
              WHERE id = ${String(existing.id)} AND status = 'RINGING'
              RETURNING *
            `
          )[0] ?? existing
        : existing;
    const adminDto = toAdminDto(refreshed, false);
    if (adminDto.status === "RINGING") {
      broadcastOutreachToCitizen(
        adminDto.regionId,
        adminDto.targetUserId,
        "outreach-incoming",
        sanitizeOutreachForCitizen(adminDto)
      );
    }
    return { ok: true, session: adminDto, reused: true };
  }

  if (existing && taskStatus === "EXECUTED") {
    return { ok: true, session: toAdminDto(existing, false), reused: true };
  }

  const targetType = String(rawTask.target_type || "TICKET");
  const targetId = String(rawTask.target_id || "");
  const targetTitle = String(rawTask.target_title || "");
  const draftMessage = String(rawTask.draft_message || "");
  const reason = String(rawTask.reason || "");
  const missingSlots = safeJsonParse<string[]>(rawTask.missing_slots_json, []);

  let targetUserId: string | null = input.targetUserId?.trim() || null;
  let targetUserName: string | null = targetUserId
    ? await resolveUserDisplayName(targetUserId)
    : null;
  if (targetUserId && !targetUserName) {
    return { ok: false, status: 404, code: "TARGET_USER_NOT_FOUND", error: "指定的用户端账号不存在" };
  }
  if (!targetUserId) {
    const resolved = await resolveTargetUserForTask({
      regionId: input.regionId,
      schemaName,
      targetType,
      targetId,
    });
    targetUserId = resolved.userId;
    targetUserName = resolved.userName;
  }

  const initialStatus: OutreachSessionStatus =
    taskStatus === "EXECUTED" ? "COMPLETED" : "RINGING";

  // 严禁向无关市民广播：找不到对应提交账号时拒绝发起实时外呼
  if (!targetUserId && initialStatus === "RINGING") {
    return {
      ok: false,
      status: 409,
      code: "NO_TARGET_USER",
      error: "该工单未关联用户端提交账号（如存量导入工单），无法向用户端发起实时外呼，请改用人工电话回访",
    };
  }

  if (input.forceNew && initialStatus === "RINGING") {
    await cancelActiveSessionsForTask(
      input.regionId,
      input.taskId,
      "【重新发起】管理员重新发起外呼，旧会话自动结束。"
    );
  }

  const greeting = buildInitialGreeting({
    taskType,
    draftMessage,
    targetTitle,
    domainType,
  });
  const nowIso = new Date().toISOString();

  const initialTurns: OutreachTurn[] = [
    {
      id: `init-${Date.now()}`,
      role: "agent",
      text: greeting.display,
      spokenText: greeting.spoken,
      reasoning:
        initialStatus === "COMPLETED"
          ? `任务已执行闭环：${String(rawTask.result_summary || "已完成外呼核实")}`
          : `【外呼发起】已识别关联提交账号「${targetUserName || targetUserId}」，正通过实时通道向该用户端推送来电提醒（${OUTREACH_RINGING_TIMEOUT_SECONDS} 秒未接听自动结束）。`,
      createdAt: nowIso,
    },
  ];

  const id = `oc-${Date.now()}-${randomUUID().slice(0, 8)}`;
  const inserted = await sql<Array<Record<string, unknown>>>`
    INSERT INTO public.outreach_sessions (
      id, region_id, task_id, task_type, target_type, target_id, target_title,
      domain_type, target_user_id, target_user_name, initiated_by, status,
      missing_slots_json, reason, turns_json, result_summary,
      ended_at, created_at, updated_at
    ) VALUES (
      ${id}, ${input.regionId}, ${input.taskId}, ${taskType}, ${targetType}, ${targetId}, ${targetTitle},
      ${domainType}, ${targetUserId}, ${targetUserName}, ${input.initiatedBy}, ${initialStatus},
      ${JSON.stringify(missingSlots)}, ${reason}, ${JSON.stringify(initialTurns)},
      ${rawTask.result_summary ? String(rawTask.result_summary) : null},
      ${initialStatus === "COMPLETED" ? nowIso : null}, ${nowIso}, ${nowIso}
    )
    RETURNING *
  `;

  const adminDto = toAdminDto(inserted[0], false);
  if (adminDto.status === "RINGING") {
    broadcastOutreachToCitizen(
      adminDto.regionId,
      adminDto.targetUserId,
      "outreach-incoming",
      sanitizeOutreachForCitizen(adminDto)
    );
  }
  broadcastOutreachToAdmins(adminDto.regionId, { session: adminDto, processing: false });

  return { ok: true, session: adminDto, reused: false };
}

export async function getOutreachSessionById(
  sessionId: string
): Promise<OutreachSessionAdminDto | null> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions();
  const row = await fetchSessionRow(sessionId);
  return row ? toAdminDto(row, false) : null;
}

export async function getLatestOutreachForTask(
  regionId: string,
  taskId: string
): Promise<OutreachSessionAdminDto | null> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions();
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions
    WHERE region_id = ${regionId} AND task_id = ${taskId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ? toAdminDto(rows[0], false) : null;
}

/** 仅返回明确指派给该用户的活跃来电，绝不返回未绑定账号的会话。 */
export async function getActiveOutreachForUser(
  userId: string,
  appDomain: AppDomainMode = getAppDomainMode()
): Promise<OutreachSessionCitizenDto | null> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions();
  const rows =
    appDomain === "ALL"
      ? await sql<Array<Record<string, unknown>>>`
          SELECT * FROM public.outreach_sessions
          WHERE status IN ('RINGING', 'IN_CALL')
            AND target_user_id = ${userId}
          ORDER BY updated_at DESC
          LIMIT 1
        `
      : await sql<Array<Record<string, unknown>>>`
          SELECT * FROM public.outreach_sessions
          WHERE status IN ('RINGING', 'IN_CALL')
            AND domain_type = ${appDomain}
            AND target_user_id = ${userId}
          ORDER BY updated_at DESC
          LIMIT 1
        `;
  if (!rows[0]) return null;
  return sanitizeOutreachForCitizen(toAdminDto(rows[0], false));
}

type ActionResult =
  | { ok: true; session: OutreachSessionAdminDto }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string };

export async function handleOutreachAction(input: {
  sessionId: string;
  action: "ANSWER" | "REJECT" | "CANCEL" | "HANGUP";
  actorUserId: string;
  actorRole: "admin" | "user";
  actorName?: string | null;
}): Promise<ActionResult> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions();
  const row = await fetchSessionRow(input.sessionId);
  if (!row) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "外呼通话会话不存在" };
  }

  const current = toAdminDto(row, false);
  const nowIso = new Date().toISOString();

  /** 状态条件更新未命中时：已结束则幂等返回最新状态，否则视为并发冲突。 */
  const resolveMiss = async (): Promise<ActionResult> => {
    const latestRow = await fetchSessionRow(current.id);
    if (!latestRow) {
      return { ok: false, status: 404, code: "NOT_FOUND", error: "外呼通话会话不存在" };
    }
    const latest = toAdminDto(latestRow, false);
    if (!isActiveStatus(latest.status)) {
      return { ok: true, session: latest };
    }
    return { ok: false, status: 409, code: "CONFLICT", error: "通话状态已变化，请刷新后重试" };
  };

  if (input.action === "CANCEL") {
    if (input.actorRole !== "admin") {
      return { ok: false, status: 403, code: "FORBIDDEN", error: "仅管理员可取消外呼任务" };
    }
    const turn: OutreachTurn = {
      id: `sys-cancel-${Date.now()}`,
      role: "agent",
      text: "管理员已取消本次语音外呼。",
      reasoning: "【外呼中止】管理员主动取消/挂断本次外呼会话。",
      createdAt: nowIso,
    };
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'CANCELLED',
          turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(turn)}::jsonb)::text,
          ended_at = now(),
          updated_at = now()
      WHERE id = ${current.id} AND status IN ('RINGING', 'IN_CALL')
      RETURNING *
    `;
    if (!updated[0]) return resolveMiss();
    const dto = toAdminDto(updated[0], false);
    broadcastSessionState(dto);
    return { ok: true, session: dto };
  }

  // ANSWER / REJECT / HANGUP 必须由会话明确指派的目标用户本人操作
  if (input.actorRole !== "user") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      error: "接听/拒接/用户挂断仅限用户端操作，管理端只负责实时监听与AI推理展示",
    };
  }
  if (!current.targetUserId || current.targetUserId !== input.actorUserId) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "无权操作其他用户的外呼来电" };
  }
  const boundUserName =
    current.targetUserName ||
    input.actorName ||
    (await resolveUserDisplayName(input.actorUserId)) ||
    input.actorUserId;

  if (input.action === "ANSWER") {
    if (!isActiveStatus(current.status)) {
      return { ok: false, status: 400, code: "INVALID_STATE", error: "该通话已结束，无法接听" };
    }
    const answeredReasoning = `【已接听】用户「${boundUserName}」已接听 AI 来电，正在播放开场白并等待对方语音/文字应答。`;
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'IN_CALL',
          turns_json = CASE
            WHEN status = 'RINGING' AND jsonb_array_length(COALESCE(NULLIF(turns_json, ''), '[]')::jsonb) > 0
              THEN jsonb_set(turns_json::jsonb, '{0,reasoning}', to_jsonb(${answeredReasoning}::text))::text
            ELSE turns_json
          END,
          answered_at = COALESCE(answered_at, now()),
          updated_at = now()
      WHERE id = ${current.id}
        AND target_user_id = ${input.actorUserId}
        AND status IN ('RINGING', 'IN_CALL')
      RETURNING *
    `;
    if (!updated[0]) {
      const miss = await resolveMiss();
      return miss.ok
        ? { ok: false, status: 400, code: "INVALID_STATE", error: "该通话已结束，无法接听" }
        : miss;
    }
    const dto = toAdminDto(updated[0], false);
    broadcastSessionState(dto);
    return { ok: true, session: dto };
  }

  if (input.action === "REJECT") {
    const turn: OutreachTurn = {
      id: `sys-reject-${Date.now()}`,
      role: "agent",
      text: "对方暂未接听本次外呼。",
      reasoning: `【用户拒接】用户「${boundUserName}」选择暂不接听，可稍后在管理端重新发起外呼。`,
      createdAt: nowIso,
    };
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'REJECTED',
          turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(turn)}::jsonb)::text,
          ended_at = now(),
          updated_at = now()
      WHERE id = ${current.id}
        AND target_user_id = ${input.actorUserId}
        AND status = 'RINGING'
      RETURNING *
    `;
    if (!updated[0]) return resolveMiss();
    const dto = toAdminDto(updated[0], false);
    broadcastSessionState(dto);
    return { ok: true, session: dto };
  }

  // HANGUP：用户在通话中主动挂断
  const turn: OutreachTurn = {
    id: `sys-hangup-${Date.now()}`,
    role: "agent",
    text: "通话已结束，感谢您的配合。",
    reasoning: "【用户挂断】用户端结束通话，本次外呼会话关闭。",
    createdAt: nowIso,
  };
  const updated = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'CANCELLED',
        turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(turn)}::jsonb)::text,
        ended_at = now(),
        updated_at = now()
    WHERE id = ${current.id}
      AND target_user_id = ${input.actorUserId}
      AND status IN ('RINGING', 'IN_CALL')
    RETURNING *
  `;
  if (!updated[0]) return resolveMiss();
  const dto = toAdminDto(updated[0], false);
  broadcastSessionState(dto);
  return { ok: true, session: dto };
}

/** 回滚失败轮次的用户回答并释放处理锁，避免重试时同一句回答重复出现。 */
async function rollbackCitizenTurn(
  sessionId: string,
  lockToken: string,
  citizenTurnId: string
): Promise<Record<string, unknown> | null> {
  const rows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET turns_json = COALESCE(
          (
            SELECT jsonb_agg(e.v ORDER BY e.i)
            FROM jsonb_array_elements(COALESCE(NULLIF(turns_json, ''), '[]')::jsonb) WITH ORDINALITY AS e(v, i)
            WHERE e.v->>'id' IS DISTINCT FROM ${citizenTurnId}::text
          ),
          '[]'::jsonb
        )::text,
        reply_lock_token = NULL,
        reply_lock_at = NULL,
        updated_at = now()
    WHERE id = ${sessionId} AND reply_lock_token = ${lockToken}
    RETURNING *
  `;
  return rows[0] ?? null;
}

async function releaseReplyLock(
  sessionId: string,
  lockToken: string
): Promise<Record<string, unknown> | null> {
  const rows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET reply_lock_token = NULL, reply_lock_at = NULL
    WHERE id = ${sessionId} AND reply_lock_token = ${lockToken}
    RETURNING *
  `;
  return rows[0] ?? null;
}

export async function submitCitizenOutreachReply(input: {
  sessionId: string;
  transcript: string;
  userId: string;
  userName?: string | null;
}): Promise<
  | {
      ok: true;
      session: OutreachSessionCitizenDto;
      adminSession: OutreachSessionAdminDto;
      task: AgentTaskDto;
    }
  | { ok: false; status: 400 | 403 | 404 | 409; code: string; error: string }
> {
  await ensureOutreachSessionsTable();
  await expireStaleOutreachSessions();
  const row = await fetchSessionRow(input.sessionId);
  if (!row) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "未找到外呼通话会话" };
  }

  const current = toAdminDto(row, false);
  if (!current.targetUserId || current.targetUserId !== input.userId) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "无权回复其他用户的外呼来电" };
  }
  if (!isActiveStatus(current.status)) {
    return { ok: false, status: 400, code: "INVALID_STATE", error: "本次外呼通话已结束" };
  }

  const cleanTranscript = input.transcript.trim();
  if (!cleanTranscript) {
    return { ok: false, status: 400, code: "INVALID_PARAMS", error: "回复内容不能为空" };
  }

  const nowIso = new Date().toISOString();
  const lockToken = randomUUID();
  const citizenTurn: OutreachTurn = {
    id: `u-${Date.now()}-${lockToken.slice(0, 6)}`,
    role: "citizen",
    text: cleanTranscript,
    createdAt: nowIso,
  };

  // 原子追加用户回答 + 获取处理锁（同一会话同一时刻只处理一条回答）
  const midRows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'IN_CALL',
        answered_at = COALESCE(answered_at, now()),
        turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(citizenTurn)}::jsonb)::text,
        reply_lock_token = ${lockToken},
        reply_lock_at = now(),
        updated_at = now()
    WHERE id = ${current.id}
      AND target_user_id = ${input.userId}
      AND status IN ('RINGING', 'IN_CALL')
      AND (
        reply_lock_token IS NULL
        OR reply_lock_at < now() - make_interval(secs => ${OUTREACH_REPLY_LOCK_STALE_SECONDS}::int)
      )
    RETURNING *
  `;
  if (!midRows[0]) {
    const latestRow = await fetchSessionRow(current.id);
    const latest = latestRow ? toAdminDto(latestRow, false) : null;
    if (!latest || !isActiveStatus(latest.status)) {
      return { ok: false, status: 400, code: "INVALID_STATE", error: "本次外呼通话已结束" };
    }
    return {
      ok: false,
      status: 409,
      code: "REPLY_IN_PROGRESS",
      error: "上一条回答正在处理中，请稍候再发送",
    };
  }

  const midDto = toAdminDto(midRows[0], true);
  broadcastOutreachToAdmins(midDto.regionId, { session: midDto, processing: true });
  const turnIndex = midDto.turns.filter((t) => t.role === "citizen").length;

  // 处理期间若会话被管理员取消/超时结束，立即中止 LLM 与业务库写入
  const abortCtrl = new AbortController();
  const watcher = setInterval(() => {
    void (async () => {
      try {
        const st = await sql<Array<{ status: string }>>`
          SELECT status FROM public.outreach_sessions WHERE id = ${current.id} LIMIT 1
        `;
        if (!st[0] || !isActiveStatus(st[0].status)) {
          abortCtrl.abort(new Error("OUTREACH_SESSION_ENDED"));
        }
      } catch {
        /* ignore transient db errors */
      }
    })();
  }, 1000);
  watcher.unref?.();

  let voiceResult: Awaited<ReturnType<typeof processAgentVoiceTurn>>;
  try {
    voiceResult = await processAgentVoiceTurn({
      regionId: current.regionId,
      taskId: current.taskId,
      transcript: cleanTranscript,
      turnIndex,
      operatorName: midDto.targetUserName || input.userName || input.userId,
      signal: abortCtrl.signal,
    });
  } catch (err) {
    clearInterval(watcher);
    if (abortCtrl.signal.aborted) {
      const released = await releaseReplyLock(current.id, lockToken);
      const latestRow = released ?? (await fetchSessionRow(current.id));
      if (latestRow) broadcastOutreachToAdmins(midDto.regionId, { session: toAdminDto(latestRow, false), processing: false });
      return { ok: false, status: 400, code: "INVALID_STATE", error: "本次外呼通话已结束" };
    }
    const rolledBack = await rollbackCitizenTurn(current.id, lockToken, citizenTurn.id);
    if (rolledBack) {
      broadcastOutreachToAdmins(midDto.regionId, { session: toAdminDto(rolledBack, false), processing: false });
    }
    throw err;
  }
  clearInterval(watcher);

  if (!voiceResult.ok) {
    const rolledBack = await rollbackCitizenTurn(current.id, lockToken, citizenTurn.id);
    if (rolledBack) {
      broadcastOutreachToAdmins(midDto.regionId, { session: toAdminDto(rolledBack, false), processing: false });
    }
    return {
      ok: false,
      status: voiceResult.status,
      code: voiceResult.code,
      error: voiceResult.error,
    };
  }

  const endIso = new Date().toISOString();
  const aiTurn: OutreachTurn = {
    id: `a-${Date.now()}-${lockToken.slice(0, 6)}`,
    role: "agent",
    text: toDisplayOutreachText(voiceResult.reply),
    spokenText: toSpokenOutreachText(voiceResult.reply),
    reasoning: voiceResult.reasoning,
    ...(voiceResult.extractedPatch && Object.keys(voiceResult.extractedPatch).length > 0
      ? { extractedPatch: voiceResult.extractedPatch }
      : {}),
    ...(voiceResult.sentiment ? { sentiment: voiceResult.sentiment } : {}),
    createdAt: endIso,
  };

  const mergedPatch: Record<string, string> = {
    ...(midDto.extractedPatch || {}),
    ...(voiceResult.extractedPatch || {}),
  };
  const hasPatch = Object.keys(mergedPatch).length > 0;
  const finalStatus: OutreachSessionStatus = voiceResult.completed ? "COMPLETED" : "IN_CALL";

  // 仅在仍持有处理锁且会话未被结束时写入，避免覆盖管理员取消等并发状态
  const finalRows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = ${finalStatus},
        turns_json = (COALESCE(NULLIF(turns_json, ''), '[]')::jsonb || ${turnAppendParam(aiTurn)}::jsonb)::text,
        extracted_patch_json = ${hasPatch ? JSON.stringify(mergedPatch) : null},
        triggered_fake_closure = triggered_fake_closure OR ${Boolean(voiceResult.triggeredFakeClosure)},
        reopened_theme_id = COALESCE(${voiceResult.reopenedThemeId ?? null}, reopened_theme_id),
        result_summary = COALESCE(${voiceResult.task.resultSummary ?? null}, result_summary),
        ended_at = ${voiceResult.completed ? endIso : null},
        updated_at = now(),
        reply_lock_token = NULL,
        reply_lock_at = NULL
    WHERE id = ${current.id}
      AND reply_lock_token = ${lockToken}
      AND status IN ('RINGING', 'IN_CALL')
    RETURNING *
  `;

  if (!finalRows[0]) {
    const released = await releaseReplyLock(current.id, lockToken);
    const latestRow = released ?? (await fetchSessionRow(current.id));
    if (latestRow) broadcastOutreachToAdmins(midDto.regionId, { session: toAdminDto(latestRow, false), processing: false });
    return { ok: false, status: 400, code: "INVALID_STATE", error: "本次外呼通话已结束" };
  }

  const finalAdminDto = toAdminDto(finalRows[0], false);
  const finalCitizenDto = sanitizeOutreachForCitizen(finalAdminDto);
  broadcastSessionState(finalAdminDto);

  return {
    ok: true,
    session: finalCitizenDto,
    adminSession: finalAdminDto,
    task: voiceResult.task,
  };
}
