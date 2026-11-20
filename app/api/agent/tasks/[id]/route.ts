import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { applyAgentTaskAction } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_ACTIONS = new Set(["APPROVE", "REJECT", "EXECUTE"]);

export async function PATCH(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-task-action",
    });
    if ("response" in guard) return guard.response;

    const { id } = await context.params;
    const taskId = decodeURIComponent(id || "").trim();
    if (!taskId) {
      return NextResponse.json(
        { success: false, code: "INVALID_PARAMS", error: "缺少任务 ID" },
        { status: 400 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      action?: unknown;
      note?: unknown;
      regionId?: unknown;
    } | null;

    const action =
      body && typeof body.action === "string" ? body.action.trim().toUpperCase() : "";
    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        {
          success: false,
          code: "INVALID_PARAMS",
          error: "action 必须是 APPROVE、REJECT 或 EXECUTE",
        },
        { status: 400 }
      );
    }

    const regionId = await resolveRequestRegionId(
      req,
      body && typeof body.regionId === "string" ? body.regionId : undefined
    );

    const result = await applyAgentTaskAction({
      regionId,
      taskId,
      action: action as "APPROVE" | "REJECT" | "EXECUTE",
      operatorName:
        guard.session.user.username ||
        guard.session.user.name ||
        guard.session.user.id,
      note: body && typeof body.note === "string" ? body.note : undefined,
    });

    if (!result.ok) {
      return NextResponse.json(
        { success: false, code: result.code, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      task: result.task,
      webhookSent: result.webhookSent,
      smtpLogged: result.smtpLogged,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to update agent task";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
