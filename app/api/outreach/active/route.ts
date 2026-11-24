import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { getAppDomainMode } from "@/lib/app-domain";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getActiveOutreachForUser, getLatestOutreachForTask } from "@/lib/outreach-session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "outreach-active",
      maxPerMinute: 120,
    });
    if ("response" in guard) return guard.response;

    if (guard.session.user.role === "admin") {
      const { searchParams } = new URL(req.url);
      const taskId = searchParams.get("taskId")?.trim() || "";
      if (!taskId) {
        return NextResponse.json({ success: true, session: null });
      }
      const regionId = await resolveRequestRegionId(req);
      const session = await getLatestOutreachForTask(regionId, taskId);
      return NextResponse.json({ success: true, session });
    }

    const session = await getActiveOutreachForUser(guard.session.user.id, getAppDomainMode());
    return NextResponse.json({ success: true, session });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "查询外呼会话失败";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
