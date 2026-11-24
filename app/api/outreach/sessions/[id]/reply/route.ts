import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { submitCitizenOutreachReply } from "@/lib/outreach-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "outreach-citizen-reply",
      maxPerMinute: 30,
    });
    if ("response" in guard) return guard.response;

    if (guard.session.user.role !== "user") {
      return NextResponse.json(
        {
          success: false,
          code: "FORBIDDEN",
          error: "仅用户端可提交通话应答，管理端仅展示对方内容与AI推理过程",
        },
        { status: 403 }
      );
    }

    const { id } = await context.params;
    const sessionId = (id || "").trim();
    if (!sessionId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "缺少 sessionId" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as { transcript?: unknown } | null;
    const transcript = typeof body?.transcript === "string" ? body.transcript.trim() : "";
    if (!transcript) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "应答内容不能为空" },
        { status: 400 }
      );
    }

    const result = await submitCitizenOutreachReply({
      sessionId,
      transcript,
      userId: guard.session.user.id,
      userName:
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
      session: result.session,
      task: result.task,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "提交外呼应答失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
