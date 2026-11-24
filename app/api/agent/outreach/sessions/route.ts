import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { createOrResumeOutreachSession } from "@/lib/outreach-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-outreach-start",
      maxPerMinute: 30,
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => null)) as {
      taskId?: unknown;
      regionId?: unknown;
      targetUserId?: unknown;
      forceNew?: unknown;
      resumeOnly?: unknown;
    } | null;

    const taskId = typeof body?.taskId === "string" ? body.taskId.trim() : "";
    if (!taskId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "taskId 不能为空" },
        { status: 400 }
      );
    }

    const regionId = await resolveRequestRegionId(
      req,
      typeof body?.regionId === "string" ? body.regionId : undefined
    );

    const initiatedBy =
      guard.session.user.username ||
      guard.session.user.name ||
      guard.session.user.id;

    const result = await createOrResumeOutreachSession({
      regionId,
      taskId,
      initiatedBy,
      targetUserId: typeof body?.targetUserId === "string" ? body.targetUserId : undefined,
      forceNew: body?.forceNew === true,
      resumeOnly: body?.resumeOnly === true,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      reused: result.reused,
      session: result.session,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "发起外呼会话失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
