import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { handleOutreachAction, sanitizeOutreachForCitizen } from "@/lib/outreach-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED_ACTIONS = new Set(["ANSWER", "REJECT", "CANCEL", "HANGUP"]);

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "outreach-session-action",
      maxPerMinute: 60,
    });
    if ("response" in guard) return guard.response;

    const { id } = await context.params;
    const sessionId = (id || "").trim();
    if (!sessionId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "缺少 sessionId" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as { action?: unknown } | null;
    const action = typeof body?.action === "string" ? body.action.trim().toUpperCase() : "";
    if (!ALLOWED_ACTIONS.has(action)) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "无效的外呼通话操作" },
        { status: 400 }
      );
    }

    const actorRole = guard.session.user.role === "admin" ? "admin" : "user";
    const result = await handleOutreachAction({
      sessionId,
      action: action as "ANSWER" | "REJECT" | "CANCEL" | "HANGUP",
      actorUserId: guard.session.user.id,
      actorRole,
      actorName:
        guard.session.user.name ||
        guard.session.user.username ||
        guard.session.user.id,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      session:
        actorRole === "admin"
          ? result.session
          : sanitizeOutreachForCitizen(result.session),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "处理外呼通话动作失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
