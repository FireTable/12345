import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { and, eq, or, sql } from "drizzle-orm";
import { db, getRegionDb } from "@/db/client";
import { piiAuditLogsTable, ticketsTable } from "@/db/schema";
import { requireAdmin } from "@/lib/auth/rbac";
import { ApiCode } from "@/lib/api-codes";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const dynamic = "force-dynamic";

const ALLOWED_PII_FIELDS = ["callerName", "callerPhone", "address", "rawContent"] as const;
type AllowedPiiField = (typeof ALLOWED_PII_FIELDS)[number];
const ALLOWED_PII_FIELD_SET = new Set<string>(ALLOWED_PII_FIELDS);

const MIN_REASON_LEN = 4;
const MAX_REASON_LEN = 200;

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

function extractClientIp(req: NextRequest): string | null {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first.slice(0, 128);
  }
  const cfIp = req.headers.get("cf-connecting-ip")?.trim();
  if (cfIp) return cfIp.slice(0, 128);
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 128);
  return null;
}

function extractUserAgent(req: NextRequest): string | null {
  const ua = req.headers.get("user-agent")?.trim();
  return ua ? ua.slice(0, 512) : null;
}

type RevealPiiBody = {
  reason?: unknown;
  regionId?: unknown;
  fields?: unknown;
};

/**
 * POST /api/workorders/[id]/reveal-pii
 * 仅限管理员按需查验单张工单的原始 PII 明文（姓名/电话/地址/原始诉求正文）。
 * 先向 public.pii_audit_logs 写入不可绕过的审计留痕，再返回原始字段；全响应带 Cache-Control: no-store。
 * 绝不触碰或削弱出网 LLM 3 层 PII 脱敏防火墙。
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return withNoStore(auth.response);

    const { id } = await params;
    const ticketKey = typeof id === "string" ? id.trim() : "";
    if (!ticketKey) {
      return jsonNoStore(
        {
          success: false,
          code: ApiCode.INVALID_PARAMS,
          error: "工单标识不能为空",
        },
        400
      );
    }

    const body = (await req.json().catch(() => null)) as RevealPiiBody | null;
    const rawReason = typeof body?.reason === "string" ? body.reason.trim() : "";
    const reasonLength = Array.from(rawReason).length;
    if (reasonLength < MIN_REASON_LEN || reasonLength > MAX_REASON_LEN) {
      return jsonNoStore(
        {
          success: false,
          code: ApiCode.INVALID_PARAMS,
          error: `查验事由（reason）为必填项，长度须在 ${MIN_REASON_LEN} 至 ${MAX_REASON_LEN} 字之间`,
        },
        400
      );
    }

    let fieldsRevealed: AllowedPiiField[] = [...ALLOWED_PII_FIELDS];
    if (body?.fields !== undefined) {
      if (!Array.isArray(body.fields)) {
        return jsonNoStore(
          {
            success: false,
            code: ApiCode.INVALID_PARAMS,
            error: "fields 必须为字段名称数组",
          },
          400
        );
      }
      const deduped = Array.from(
        new Set(
          body.fields
            .filter((item): item is string => typeof item === "string")
            .map((item) => item.trim())
            .filter((item): item is AllowedPiiField => ALLOWED_PII_FIELD_SET.has(item))
        )
      );
      if (deduped.length === 0) {
        return jsonNoStore(
          {
            success: false,
            code: ApiCode.INVALID_PARAMS,
            error: `fields 需至少包含一个有效字段（${ALLOWED_PII_FIELDS.join(", ")}）`,
          },
          400
        );
      }
      fieldsRevealed = deduped;
    }

    const explicitRegionId = typeof body?.regionId === "string" ? body.regionId : undefined;
    const regionId = await resolveRequestRegionId(req, explicitRegionId);
    const { db: tenantDb } = await getRegionDb(regionId);

    const rows = await tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        citizenName: ticketsTable.citizenName,
        citizenPhone: ticketsTable.citizenPhone,
        address: ticketsTable.address,
        content: ticketsTable.content,
      })
      .from(ticketsTable)
      .where(or(eq(ticketsTable.id, ticketKey), eq(ticketsTable.ticketNo, ticketKey)))
      .limit(1);

    const ticket = rows[0];
    if (!ticket) {
      return jsonNoStore(
        {
          success: false,
          code: ApiCode.NOT_FOUND,
          error: "未找到对应工单",
        },
        404
      );
    }

    const actorUserId = auth.session.user.id;
    const actorName = (
      auth.session.user.name ||
      auth.session.user.username ||
      auth.session.user.email ||
      "admin"
    ).slice(0, 128);
    const actorRole = auth.session.user.role;
    const ipAddress = extractClientIp(req);
    const userAgent = extractUserAgent(req);
    const auditId = `PII-${Date.now()}-${randomUUID().slice(0, 8)}`;
    const now = new Date();

    // Fail-closed：必须先成功写入 public.pii_audit_logs 留痕，才允许返回明文 PII
    await db.insert(piiAuditLogsTable).values({
      id: auditId,
      regionId,
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo || null,
      actorUserId,
      actorName,
      actorRole,
      reason: rawReason,
      fieldsRevealed,
      ipAddress,
      userAgent,
      createdAt: now,
    });

    const [countRow] = await db
      .select({ count: sql<number>`count(*)::int` })
      .from(piiAuditLogsTable)
      .where(
        and(
          eq(piiAuditLogsTable.regionId, regionId),
          eq(piiAuditLogsTable.ticketId, ticket.id)
        )
      );

    const fieldSet = new Set<AllowedPiiField>(fieldsRevealed);
    const pii = {
      ...(fieldSet.has("callerName") ? { callerName: ticket.citizenName || "" } : {}),
      ...(fieldSet.has("callerPhone") ? { callerPhone: ticket.citizenPhone || "" } : {}),
      ...(fieldSet.has("address") ? { address: ticket.address || "" } : {}),
      ...(fieldSet.has("rawContent") ? { rawContent: ticket.content || "" } : {}),
    };

    const createdAtIso = now.toISOString();

    return jsonNoStore({
      success: true,
      auditId,
      createdAt: createdAtIso,
      regionId,
      ticketId: ticket.id,
      ticketNo: ticket.ticketNo || "",
      fieldsRevealed,
      auditCount: Number(countRow?.count ?? 1),
      audit: {
        id: auditId,
        regionId,
        ticketId: ticket.id,
        ticketNo: ticket.ticketNo || null,
        actorUserId,
        actorName,
        actorRole,
        reason: rawReason,
        fieldsRevealed,
        ipAddress,
        userAgent,
        createdAt: createdAtIso,
      },
      pii,
      ...pii,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to reveal PII";
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
