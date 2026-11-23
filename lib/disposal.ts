import { randomUUID } from "crypto";
import { and, desc, eq } from "drizzle-orm";
import { headers } from "next/headers";
import { getRegionDb, sql } from "@/db/client";
import { disposalLogsTable } from "@/db/schema";
import { auth } from "@/lib/auth/config";

export type DisposalTargetType = "THEME" | "TICKET";

export type DisposalAction =
  | "DISPATCH"
  | "ADVANCE"
  | "ESCALATE"
  | "RESOLVE"
  | "REOPEN"
  | "CORRECT_ENTITY"
  | "DETACH_TICKET"
  | "DETACH_THEME"
  | "UPDATE_STATUS"
  | "REVIEW_APPROVE"
  | "REVIEW_DISMISS";

export interface DisposalLogDto {
  id: string;
  targetType: string;
  targetId: string;
  action: string;
  fromStatus: string | null;
  toStatus: string | null;
  owner: string | null;
  operator: string | null;
  note: string | null;
  metaJson: string | null;
  createdAt: string;
}

export interface RecordDisposalLogInput {
  regionId?: string;
  targetType: DisposalTargetType;
  targetId: string;
  action: DisposalAction | string;
  fromStatus?: string | null;
  toStatus?: string | null;
  owner?: string | null;
  operator?: string | null;
  note?: string | null;
  meta?: Record<string, unknown> | string | null;
}

declare global {
  // eslint-disable-next-line no-var
  var __disposalLogsEnsuredSchemas: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __disposalLogsPendingSchemas: Map<string, Promise<void>> | undefined;
}

const ensuredSchemas: Set<string> =
  globalThis.__disposalLogsEnsuredSchemas ?? new Set<string>();
globalThis.__disposalLogsEnsuredSchemas = ensuredSchemas;

const pendingSchemas: Map<string, Promise<void>> =
  globalThis.__disposalLogsPendingSchemas ?? new Map<string, Promise<void>>();
globalThis.__disposalLogsPendingSchemas = pendingSchemas;

function clampStr(value: string | null | undefined, max: number): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.length <= max ? trimmed : trimmed.slice(0, max);
}

export function invalidateDisposalTableCache(schemaName?: string): void {
  if (schemaName) {
    ensuredSchemas.delete(schemaName);
    pendingSchemas.delete(schemaName);
  } else {
    ensuredSchemas.clear();
    pendingSchemas.clear();
  }
}

/**
 * 幂等确保目标租户 schema 下存在 disposal_logs 表与索引，按 schema 进程内缓存一次。
 */
export async function ensureDisposalLogsTable(regionId?: string): Promise<string> {
  const { schemaName } = await getRegionDb(regionId);
  if (!/^[a-zA-Z0-9_]+$/.test(schemaName)) {
    throw new Error(`Invalid schema name for disposal_logs: ${schemaName}`);
  }
  if (ensuredSchemas.has(schemaName)) {
    return schemaName;
  }

  const inflight = pendingSchemas.get(schemaName);
  if (inflight) {
    await inflight;
    return schemaName;
  }

  const ddlPromise = (async () => {
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS "${schemaName}".disposal_logs (
        id VARCHAR(64) PRIMARY KEY,
        target_type VARCHAR(16) NOT NULL,
        target_id VARCHAR(64) NOT NULL,
        action VARCHAR(32) NOT NULL,
        from_status VARCHAR(32),
        to_status VARCHAR(32),
        owner VARCHAR(128),
        operator VARCHAR(64),
        note TEXT,
        meta_json TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL
      );
    `);
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_disposal_logs_target ON "${schemaName}".disposal_logs (target_type, target_id);`
    );
    await sql.unsafe(
      `CREATE INDEX IF NOT EXISTS idx_disposal_logs_created_at ON "${schemaName}".disposal_logs (created_at);`
    );
    ensuredSchemas.add(schemaName);
  })();

  pendingSchemas.set(schemaName, ddlPromise);
  try {
    await ddlPromise;
  } finally {
    pendingSchemas.delete(schemaName);
  }
  return schemaName;
}

/**
 * 通过 Better Auth session 解析当前操作管理员名称，无登录态时兜底 "admin"。
 */
export async function resolveOperatorName(req?: Request | null): Promise<string> {
  try {
    const hdrs = req?.headers ?? (await headers());
    const session = await auth.api.getSession({ headers: hdrs });
    const user = session?.user as
      | { name?: string | null; username?: string | null; displayUsername?: string | null; email?: string | null }
      | undefined;
    const candidate = user?.name || user?.displayUsername || user?.username || user?.email;
    const normalized = clampStr(candidate, 64);
    if (normalized) return normalized;
  } catch {
    // 非 Next 请求上下文或未登录态时安全兜底
  }
  return "admin";
}

function toDto(row: typeof disposalLogsTable.$inferSelect): DisposalLogDto {
  return {
    id: row.id,
    targetType: row.targetType,
    targetId: row.targetId,
    action: row.action,
    fromStatus: row.fromStatus ?? null,
    toStatus: row.toStatus ?? null,
    owner: row.owner ?? null,
    operator: row.operator ?? null,
    note: row.note ?? null,
    metaJson: row.metaJson ?? null,
    createdAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt),
  };
}

/**
 * 写入一条处置/纠偏/复核审计日志。
 */
export async function recordDisposalLog(input: RecordDisposalLogInput): Promise<DisposalLogDto> {
  await ensureDisposalLogsTable(input.regionId);
  const { db } = await getRegionDb(input.regionId);

  const id = `dl-${Date.now()}-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
  const metaJson =
    typeof input.meta === "string"
      ? input.meta
      : input.meta && typeof input.meta === "object"
        ? JSON.stringify(input.meta)
        : null;

  const [inserted] = await db
    .insert(disposalLogsTable)
    .values({
      id,
      targetType: clampStr(input.targetType, 16) || "TICKET",
      targetId: clampStr(input.targetId, 64) || "",
      action: clampStr(input.action, 32) || "UPDATE_STATUS",
      fromStatus: clampStr(input.fromStatus, 32),
      toStatus: clampStr(input.toStatus, 32),
      owner: clampStr(input.owner, 128),
      operator: clampStr(input.operator, 64) || "admin",
      note: input.note ? String(input.note).trim() : null,
      metaJson,
      createdAt: new Date(),
    })
    .returning();

  return toDto(inserted);
}

/**
 * 按创建时间倒序查询目标对象（THEME 或 TICKET）的处置日志。
 */
export async function listDisposalLogs(
  regionId: string | undefined,
  targetType: DisposalTargetType,
  targetId: string,
  limit = 100
): Promise<DisposalLogDto[]> {
  await ensureDisposalLogsTable(regionId);
  const { db } = await getRegionDb(regionId);
  const rows = await db
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.targetType, targetType),
        eq(disposalLogsTable.targetId, targetId)
      )
    )
    .orderBy(desc(disposalLogsTable.createdAt), desc(disposalLogsTable.id))
    .limit(Math.max(1, Math.min(500, limit)));

  return rows.map(toDto);
}
