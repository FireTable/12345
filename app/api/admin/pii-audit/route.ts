import { NextRequest, NextResponse } from "next/server";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { db } from "@/db/client";
import { piiAuditLogsTable } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/rbac";
import { ApiCode } from "@/lib/api-codes";

export const dynamic = "force-dynamic";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

const NO_STORE_HEADERS = {
  "Cache-Control": "no-store",
} as const;

function withNoStore(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.set("Cache-Control", "no-store");
  return new Response(res.body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

function jsonNoStore(body: unknown, status = 200): NextResponse {
  return NextResponse.json(body, { status, headers: NO_STORE_HEADERS });
}

function parseLimit(raw: string | null): number {
  if (!raw) return DEFAULT_LIMIT;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_LIMIT;
  return Math.min(MAX_LIMIT, Math.max(1, parsed));
}

/**
 * GET /api/admin/pii-audit
 * 仅限管理员查询 public.pii_audit_logs 最近 PII 明文查看留痕记录。
 * 支持按 regionId（或 region）、ticketId（匹配 ticket_id 或 ticket_no）、actorUserId 与 limit 筛选。
 */
export async function GET(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return withNoStore(auth.response);

    const url = new URL(req.url);
    const regionId = (
      url.searchParams.get("regionId") ??
      url.searchParams.get("region") ??
      ""
    ).trim();
    const ticketId = (url.searchParams.get("ticketId") ?? "").trim();
    const actorUserId = (url.searchParams.get("actorUserId") ?? "").trim();
    const limit = parseLimit(url.searchParams.get("limit"));

    const conditions: SQL[] = [];
    if (regionId) {
      conditions.push(eq(piiAuditLogsTable.regionId, regionId));
    }
    if (ticketId) {
      const ticketCond = or(
        eq(piiAuditLogsTable.ticketId, ticketId),
        eq(piiAuditLogsTable.ticketNo, ticketId)
      );
      if (ticketCond) conditions.push(ticketCond);
    }
    if (actorUserId) {
      conditions.push(eq(piiAuditLogsTable.actorUserId, actorUserId));
    }

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, [countRow]] = await Promise.all([
      db
        .select()
        .from(piiAuditLogsTable)
        .where(whereClause)
        .orderBy(desc(piiAuditLogsTable.createdAt), desc(piiAuditLogsTable.id))
        .limit(limit),
      db
        .select({ count: sql<number>`count(*)::int` })
        .from(piiAuditLogsTable)
        .where(whereClause),
    ]);

    const items = rows.map((r) => ({
      id: r.id,
      regionId: r.regionId,
      ticketId: r.ticketId,
      ticketNo: r.ticketNo,
      actorUserId: r.actorUserId,
      actorName: r.actorName,
      actorRole: r.actorRole,
      reason: r.reason,
      fieldsRevealed: Array.isArray(r.fieldsRevealed) ? r.fieldsRevealed : [],
      ipAddress: r.ipAddress,
      userAgent: r.userAgent,
      createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
    }));

    return jsonNoStore({
      success: true,
      total: Number(countRow?.count ?? items.length),
      limit,
      items,
      data: items,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to list PII audit logs";
    return jsonNoStore(
      {
        success: false,
        code: ApiCode.INTERNAL_ERROR,
        error: msg,
      },
      500
    );
  }
}
