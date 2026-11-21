import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { processAgentVoiceTurn } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-voice-turn",
      maxPerMinute: 20,
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => null)) as {
      taskId?: unknown;
      transcript?: unknown;
      turnIndex?: unknown;
      regionId?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, code: "BAD_REQUEST", error: "无效的请求体" },
        { status: 400 }
      );
    }

    const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";

    if (!taskId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "taskId 不能为空" },
        { status: 400 }
      );
    }
    if (!transcript) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "transcript 不能为空" },
        { status: 400 }
      );
    }

    const regionId = await resolveRequestRegionId(
      req,
      typeof body.regionId === "string" ? body.regionId : undefined
    );

    const result = await processAgentVoiceTurn({
      regionId,
      taskId,
      transcript,
      turnIndex: typeof body.turnIndex === "number" ? body.turnIndex : undefined,
      operatorName:
        guard.session.user.username ||
        guard.session.user.name ||
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
      reply: result.reply,
      completed: result.completed,
      extractedPatch: result.extractedPatch,
      triggeredFakeClosure: result.triggeredFakeClosure,
      reopenedThemeId: result.reopenedThemeId,
      task: result.task,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process voice turn";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
