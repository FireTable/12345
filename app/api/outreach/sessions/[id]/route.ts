import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { getOutreachSessionById, sanitizeOutreachForCitizen } from "@/lib/outreach-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "outreach-session-detail",
      maxPerMinute: 120,
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

    const session = await getOutreachSessionById(sessionId);
    if (!session) {
      return NextResponse.json(
        { success: false, code: "NOT_FOUND", error: "外呼通话会话不存在" },
        { status: 404 }
      );
    }

    if (guard.session.user.role === "admin") {
      return NextResponse.json({ success: true, session });
    }

    if (session.targetUserId && session.targetUserId !== guard.session.user.id) {
      return NextResponse.json(
        { success: false, code: "FORBIDDEN", error: "无权查看其他用户的外呼通话" },
        { status: 403 }
      );
    }

    return NextResponse.json({
      success: true,
      session: sanitizeOutreachForCitizen(session),
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "获取外呼通话详情失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
