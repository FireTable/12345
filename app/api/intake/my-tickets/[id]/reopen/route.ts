import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { reopenCitizenTicket } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "intake-reopen",
    });
    if ("response" in guard) return guard.response;

    const { id } = await context.params;
    const rawId = decodeURIComponent(id || "").trim();
    if (!rawId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "缺少工单编号" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      reason?: unknown;
      note?: unknown;
      regionId?: unknown;
    } | null;

    const regionId = await resolveRequestRegionId(
      req,
      body && typeof body.regionId === "string" ? body.regionId : undefined
    );

    const reason =
      body && typeof body.reason === "string" && body.reason.trim()
        ? body.reason.trim()
        : body && typeof body.note === "string" && body.note.trim()
          ? body.note.trim()
          : undefined;

    const result = await reopenCitizenTicket({
      idOrNo: rawId,
      userId: guard.session.user.id,
      operatorName:
        guard.session.user.username ||
        guard.session.user.name ||
        guard.session.user.id,
      regionId,
      reason,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          success: false,
          code: result.status === 403 ? "FORBIDDEN" : "NOT_FOUND",
          error: result.error,
        },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      ticketId: result.ticketId,
      ticketNo: result.ticketNo,
      themeId: result.themeId,
      reopened: result.reopened,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to reopen ticket";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
