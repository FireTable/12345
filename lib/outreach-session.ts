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
  triggeredFakeClosure: boolean;
  resultSummary: string | null;
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
}

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
    await sql`
      CREATE INDEX IF NOT EXISTS idx_outreach_sessions_user_status
      ON public.outreach_sessions (target_user_id, status, updated_at DESC);
    `;
    await sql`
      CREATE INDEX IF NOT EXISTS idx_outreach_sessions_task
      ON public.outreach_sessions (region_id, task_id, updated_at DESC);
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

function toAdminDto(row: Record<string, unknown>, processing = false): OutreachSessionAdminDto {
  const regionId = String(row.region_id || "");
  const targetUserId = row.target_user_id ? String(row.target_user_id) : null;
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
    status: (String(row.status || "RINGING") as OutreachSessionStatus),
    missingSlots: safeJsonParse<string[]>(row.missing_slots_json, []),
    reason: String(row.reason || ""),
    turns: safeJsonParse<OutreachTurn[]>(row.turns_json, []),
    extractedPatch: safeJsonParse<Record<string, string> | null>(row.extracted_patch_json, null),
    triggeredFakeClosure: Boolean(row.triggered_fake_closure),
    reopenedThemeId: row.reopened_theme_id ? String(row.reopened_theme_id) : null,
    resultSummary: row.result_summary ? String(row.result_summary) : null,
    onlineTargetCount: countOnlineOutreachTargets(regionId, targetUserId),
    processing,
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
    triggeredFakeClosure: admin.triggeredFakeClosure,
    resultSummary: admin.resultSummary,
    createdAt: admin.createdAt,
    answeredAt: admin.answeredAt,
    endedAt: admin.endedAt,
    updatedAt: admin.updatedAt,
  };
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

export async function createOrResumeOutreachSession(input: {
  regionId: string;
  taskId: string;
  initiatedBy: string;
  targetUserId?: string;
  forceNew?: boolean;
}): Promise<
  | { ok: true; session: OutreachSessionAdminDto; reused: boolean }
  | { ok: false; status: 400 | 404 | 409; code: string; error: string }
> {
  await ensureOutreachSessionsTable();
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

  // 检查是否已有活跃（RINGING / IN_CALL）或已完结的历史会话
  const existingRows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions
    WHERE region_id = ${input.regionId} AND task_id = ${input.taskId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  const existing = existingRows[0];
  if (
    existing &&
    !input.forceNew &&
    (existing.status === "RINGING" || existing.status === "IN_CALL")
  ) {
    const adminDto = toAdminDto(existing, false);
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

  const greeting = buildInitialGreeting({
    taskType,
    draftMessage,
    targetTitle,
    domainType,
  });
  const nowIso = new Date().toISOString();
  const initialStatus: OutreachSessionStatus =
    taskStatus === "EXECUTED" ? "COMPLETED" : "RINGING";

  const initialTurns: OutreachTurn[] = [
    {
      id: `init-${Date.now()}`,
      role: "agent",
      text: greeting.display,
      spokenText: greeting.spoken,
      reasoning:
        initialStatus === "COMPLETED"
          ? `任务已执行闭环：${String(rawTask.result_summary || "已完成外呼核实")}`
          : targetUserId
            ? `【外呼发起】已识别关联提交账号「${targetUserName || targetUserId}」，正通过实时通道向用户端推送来电提醒。`
            : "【外呼发起】当前为存量工单演示外呼，已向在线用户端推送来电提醒，等待用户端接听应答。",
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
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions WHERE id = ${sessionId} LIMIT 1
  `;
  return rows[0] ? toAdminDto(rows[0], false) : null;
}

export async function getLatestOutreachForTask(
  regionId: string,
  taskId: string
): Promise<OutreachSessionAdminDto | null> {
  await ensureOutreachSessionsTable();
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions
    WHERE region_id = ${regionId} AND task_id = ${taskId}
    ORDER BY created_at DESC
    LIMIT 1
  `;
  return rows[0] ? toAdminDto(rows[0], false) : null;
}

export async function getActiveOutreachForUser(
  userId: string,
  appDomain: AppDomainMode = getAppDomainMode()
): Promise<OutreachSessionCitizenDto | null> {
  await ensureOutreachSessionsTable();
  const rows =
    appDomain === "ALL"
      ? await sql<Array<Record<string, unknown>>>`
          SELECT * FROM public.outreach_sessions
          WHERE status IN ('RINGING', 'IN_CALL')
            AND (target_user_id = ${userId} OR target_user_id IS NULL)
          ORDER BY
            CASE WHEN target_user_id = ${userId} THEN 0 ELSE 1 END ASC,
            updated_at DESC
          LIMIT 1
        `
      : await sql<Array<Record<string, unknown>>>`
          SELECT * FROM public.outreach_sessions
          WHERE status IN ('RINGING', 'IN_CALL')
            AND domain_type = ${appDomain}
            AND (target_user_id = ${userId} OR target_user_id IS NULL)
          ORDER BY
            CASE WHEN target_user_id = ${userId} THEN 0 ELSE 1 END ASC,
            updated_at DESC
          LIMIT 1
        `;
  if (!rows[0]) return null;
  return sanitizeOutreachForCitizen(toAdminDto(rows[0], false));
}

export async function handleOutreachAction(input: {
  sessionId: string;
  action: "ANSWER" | "REJECT" | "CANCEL" | "HANGUP";
  actorUserId: string;
  actorRole: "admin" | "user";
  actorName?: string | null;
}): Promise<
  | { ok: true; session: OutreachSessionAdminDto }
  | { ok: false; status: 400 | 403 | 404; code: string; error: string }
> {
  await ensureOutreachSessionsTable();
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions WHERE id = ${input.sessionId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "外呼通话会话不存在" };
  }

  const current = toAdminDto(row, false);
  const nowIso = new Date().toISOString();

  if (input.action === "CANCEL") {
    if (input.actorRole !== "admin") {
      return { ok: false, status: 403, code: "FORBIDDEN", error: "仅管理员可取消外呼任务" };
    }
    if (current.status === "COMPLETED" || current.status === "CANCELLED" || current.status === "REJECTED") {
      return { ok: true, session: current };
    }
    const turns = [...current.turns];
    turns.push({
      id: `sys-cancel-${Date.now()}`,
      role: "agent",
      text: "管理员已取消本次语音外呼。",
      reasoning: "【外呼中止】管理员主动取消/挂断本次外呼会话。",
      createdAt: nowIso,
    });
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'CANCELLED', turns_json = ${JSON.stringify(turns)}, ended_at = ${nowIso}, updated_at = ${nowIso}
      WHERE id = ${current.id}
      RETURNING *
    `;
    const dto = toAdminDto(updated[0], false);
    broadcastOutreachDismissed(dto.regionId, dto.id);
    broadcastOutreachToCitizen(dto.regionId, dto.targetUserId, "outreach-update", sanitizeOutreachForCitizen(dto));
    broadcastOutreachToAdmins(dto.regionId, { session: dto, processing: false });
    return { ok: true, session: dto };
  }

  // ANSWER / REJECT / HANGUP 必须由目标用户（或普通用户认领）操作
  if (input.actorRole !== "user") {
    return {
      ok: false,
      status: 403,
      code: "FORBIDDEN",
      error: "接听/拒接/用户挂断仅限用户端操作，管理端只负责实时监听与AI推理展示",
    };
  }
  if (current.targetUserId && current.targetUserId !== input.actorUserId) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "无权操作其他用户的外呼来电" };
  }

  if (input.action === "ANSWER") {
    if (current.status !== "RINGING" && current.status !== "IN_CALL") {
      return { ok: false, status: 400, code: "INVALID_STATE", error: "该通话已结束，无法接听" };
    }
    const boundUserName =
      current.targetUserName || input.actorName || (await resolveUserDisplayName(input.actorUserId)) || input.actorUserId;
    const turns = [...current.turns];
    if (current.status === "RINGING") {
      turns[0] = {
        ...turns[0],
        reasoning: `【已接听】用户「${boundUserName}」已接听 AI 来电，正在播放开场白并等待对方语音/文字应答。`,
      };
    }
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'IN_CALL',
          target_user_id = ${input.actorUserId},
          target_user_name = ${boundUserName},
          turns_json = ${JSON.stringify(turns)},
          answered_at = COALESCE(answered_at, ${nowIso}),
          updated_at = ${nowIso}
      WHERE id = ${current.id}
      RETURNING *
    `;
    const dto = toAdminDto(updated[0], false);
    broadcastOutreachDismissed(dto.regionId, dto.id, input.actorUserId);
    broadcastOutreachToCitizen(dto.regionId, dto.targetUserId, "outreach-update", sanitizeOutreachForCitizen(dto));
    broadcastOutreachToAdmins(dto.regionId, { session: dto, processing: false });
    return { ok: true, session: dto };
  }

  if (input.action === "REJECT") {
    if (current.status === "COMPLETED" || current.status === "CANCELLED" || current.status === "REJECTED") {
      return { ok: true, session: current };
    }
    const boundUserName =
      current.targetUserName || input.actorName || (await resolveUserDisplayName(input.actorUserId)) || input.actorUserId;
    const turns = [...current.turns];
    turns.push({
      id: `sys-reject-${Date.now()}`,
      role: "agent",
      text: "对方暂未接听本次外呼。",
      reasoning: `【用户拒接】用户「${boundUserName}」选择暂不接听，可稍后在管理端重新发起外呼。`,
      createdAt: nowIso,
    });
    const updated = await sql<Array<Record<string, unknown>>>`
      UPDATE public.outreach_sessions
      SET status = 'REJECTED',
          target_user_id = COALESCE(target_user_id, ${input.actorUserId}),
          target_user_name = COALESCE(target_user_name, ${boundUserName}),
          turns_json = ${JSON.stringify(turns)},
          ended_at = ${nowIso},
          updated_at = ${nowIso}
      WHERE id = ${current.id}
      RETURNING *
    `;
    const dto = toAdminDto(updated[0], false);
    broadcastOutreachDismissed(dto.regionId, dto.id);
    broadcastOutreachToAdmins(dto.regionId, { session: dto, processing: false });
    return { ok: true, session: dto };
  }

  // HANGUP by user during IN_CALL
  if (current.status === "COMPLETED" || current.status === "CANCELLED" || current.status === "REJECTED") {
    return { ok: true, session: current };
  }
  const turns = [...current.turns];
  turns.push({
    id: `sys-hangup-${Date.now()}`,
    role: "agent",
    text: "通话已结束，感谢您的配合。",
    reasoning: "【用户挂断】用户端结束通话，本次外呼会话关闭。",
    createdAt: nowIso,
  });
  const updated = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'CANCELLED', turns_json = ${JSON.stringify(turns)}, ended_at = ${nowIso}, updated_at = ${nowIso}
    WHERE id = ${current.id}
    RETURNING *
  `;
  const dto = toAdminDto(updated[0], false);
  broadcastOutreachToCitizen(dto.regionId, dto.targetUserId, "outreach-update", sanitizeOutreachForCitizen(dto));
  broadcastOutreachToAdmins(dto.regionId, { session: dto, processing: false });
  return { ok: true, session: dto };
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
  | { ok: false; status: 400 | 403 | 404; code: string; error: string }
> {
  await ensureOutreachSessionsTable();
  const rows = await sql<Array<Record<string, unknown>>>`
    SELECT * FROM public.outreach_sessions WHERE id = ${input.sessionId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    return { ok: false, status: 404, code: "NOT_FOUND", error: "未找到外呼通话会话" };
  }

  const current = toAdminDto(row, false);
  if (current.targetUserId && current.targetUserId !== input.userId) {
    return { ok: false, status: 403, code: "FORBIDDEN", error: "无权回复其他用户的外呼来电" };
  }
  if (current.status !== "RINGING" && current.status !== "IN_CALL") {
    return { ok: false, status: 400, code: "INVALID_STATE", error: "本次外呼通话已结束" };
  }

  const cleanTranscript = input.transcript.trim();
  if (!cleanTranscript) {
    return { ok: false, status: 400, code: "INVALID_PARAMS", error: "回复内容不能为空" };
  }

  const nowIso = new Date().toISOString();
  const boundUserName =
    current.targetUserName || input.userName || (await resolveUserDisplayName(input.userId)) || input.userId;

  const citizenTurn: OutreachTurn = {
    id: `u-${Date.now()}`,
    role: "citizen",
    text: cleanTranscript,
    createdAt: nowIso,
  };
  const turnsAfterCitizen = [...current.turns, citizenTurn];
  const turnIndex = turnsAfterCitizen.filter((t) => t.role === "citizen").length;

  const midRows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = 'IN_CALL',
        target_user_id = ${input.userId},
        target_user_name = ${boundUserName},
        answered_at = COALESCE(answered_at, ${nowIso}),
        turns_json = ${JSON.stringify(turnsAfterCitizen)},
        updated_at = ${nowIso}
    WHERE id = ${current.id}
    RETURNING *
  `;
  const midDto = toAdminDto(midRows[0], true);
  if (!current.targetUserId) {
    broadcastOutreachDismissed(midDto.regionId, midDto.id, input.userId);
  }
  broadcastOutreachToAdmins(midDto.regionId, { session: midDto, processing: true });

  const voiceResult = await processAgentVoiceTurn({
    regionId: current.regionId,
    taskId: current.taskId,
    transcript: cleanTranscript,
    turnIndex,
    operatorName: boundUserName,
  });

  if (!voiceResult.ok) {
    const errDto = toAdminDto(midRows[0], false);
    broadcastOutreachToAdmins(errDto.regionId, { session: errDto, processing: false });
    return {
      ok: false,
      status: voiceResult.status,
      code: voiceResult.code,
      error: voiceResult.error,
    };
  }

  const endIso = new Date().toISOString();
  const aiTurn: OutreachTurn = {
    id: `a-${Date.now()}`,
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
    ...(current.extractedPatch || {}),
    ...(voiceResult.extractedPatch || {}),
  };
  const hasPatch = Object.keys(mergedPatch).length > 0;
  const finalStatus: OutreachSessionStatus = voiceResult.completed ? "COMPLETED" : "IN_CALL";
  const finalTurns = [...turnsAfterCitizen, aiTurn];

  const finalRows = await sql<Array<Record<string, unknown>>>`
    UPDATE public.outreach_sessions
    SET status = ${finalStatus},
        turns_json = ${JSON.stringify(finalTurns)},
        extracted_patch_json = ${hasPatch ? JSON.stringify(mergedPatch) : null},
        triggered_fake_closure = ${Boolean(current.triggeredFakeClosure || voiceResult.triggeredFakeClosure)},
        reopened_theme_id = COALESCE(${voiceResult.reopenedThemeId ?? null}, reopened_theme_id),
        result_summary = ${voiceResult.task.resultSummary ?? current.resultSummary},
        ended_at = ${voiceResult.completed ? endIso : null},
        updated_at = ${endIso}
    WHERE id = ${current.id}
    RETURNING *
  `;

  const finalAdminDto = toAdminDto(finalRows[0], false);
  const finalCitizenDto = sanitizeOutreachForCitizen(finalAdminDto);

  broadcastOutreachToAdmins(finalAdminDto.regionId, {
    session: finalAdminDto,
    processing: false,
  });
  broadcastOutreachToCitizen(
    finalAdminDto.regionId,
    finalAdminDto.targetUserId,
    "outreach-update",
    finalCitizenDto
  );

  return {
    ok: true,
    session: finalCitizenDto,
    adminSession: finalAdminDto,
    task: voiceResult.task,
  };
}
