import type { DB } from "@/db/client";
import { ticketsTable, ticketThemesTable } from "@/db/schema";
import { LOW_CONFIDENCE_THRESHOLD } from "@/lib/confidence";
import { eq, sql } from "drizzle-orm";

export { LOW_CONFIDENCE_THRESHOLD };

export type ThemeMemberStats = {
  totalCount: number;
  lowConfidenceUnverifiedCount: number;
  lowConfidenceTotalCount: number;
  verifiedCount: number;
  lowConfidenceThreshold: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __ticketThemesVerificationEnsured: Set<string> | undefined;
  // eslint-disable-next-line no-var
  var __ticketThemesVerificationPending: Map<string, Promise<void>> | undefined;
}

const ensuredRegions: Set<string> =
  globalThis.__ticketThemesVerificationEnsured ?? new Set<string>();
globalThis.__ticketThemesVerificationEnsured = ensuredRegions;

const pendingRegions: Map<string, Promise<void>> =
  globalThis.__ticketThemesVerificationPending ?? new Map<string, Promise<void>>();
globalThis.__ticketThemesVerificationPending = pendingRegions;

/**
 * 幂等确保目标租户 schema 下的 ticket_themes 表包含人工核验列（按 regionId 进程内去重）。
 */
export async function ensureTicketThemesVerificationColumns(
  db: DB,
  regionId: string
): Promise<void> {
  const key = (regionId || "default").trim() || "default";
  if (ensuredRegions.has(key)) return;

  const inflight = pendingRegions.get(key);
  if (inflight) {
    await inflight;
    return;
  }

  const ddlPromise = (async () => {
    await db.execute(
      sql`ALTER TABLE ticket_themes ADD COLUMN IF NOT EXISTS human_verified BOOLEAN NOT NULL DEFAULT false;`
    );
    await db.execute(
      sql`ALTER TABLE ticket_themes ADD COLUMN IF NOT EXISTS verified_by VARCHAR(64);`
    );
    await db.execute(
      sql`ALTER TABLE ticket_themes ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;`
    );
    ensuredRegions.add(key);
  })();

  pendingRegions.set(key, ddlPromise);
  try {
    await ddlPromise;
  } finally {
    pendingRegions.delete(key);
  }
}

/**
 * 统计指定专题群组成员工单的总数、低置信度总数、低置信度待核验数和已人工确认数。
 */
export async function loadThemeMemberStats(
  db: DB,
  themeId: string
): Promise<ThemeMemberStats> {
  const rows = await db
    .select({
      totalCount: sql<number>`count(*)::int`,
      lowConfidenceTotalCount: sql<number>`count(*) filter (where coalesce(${ticketsTable.confidence}, 0) < ${LOW_CONFIDENCE_THRESHOLD})::int`,
      lowConfidenceUnverifiedCount: sql<number>`count(*) filter (where coalesce(${ticketsTable.confidence}, 0) < ${LOW_CONFIDENCE_THRESHOLD} and ${ticketThemesTable.humanVerified} = false)::int`,
      verifiedCount: sql<number>`count(*) filter (where ${ticketThemesTable.humanVerified} = true)::int`,
    })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
    .where(eq(ticketThemesTable.themeId, themeId));

  const row = rows[0];
  return {
    totalCount: Number(row?.totalCount || 0),
    lowConfidenceUnverifiedCount: Number(row?.lowConfidenceUnverifiedCount || 0),
    lowConfidenceTotalCount: Number(row?.lowConfidenceTotalCount || 0),
    verifiedCount: Number(row?.verifiedCount || 0),
    lowConfidenceThreshold: LOW_CONFIDENCE_THRESHOLD,
  };
}
