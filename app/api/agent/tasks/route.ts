import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { listAgentTasks } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-tasks",
      maxPerMinute: 120,
    });
    if ("response" in guard) return guard.response;

    const regionId = await resolveRequestRegionId(req);
    const url = new URL(req.url);
    const status = url.searchParams.get("status");
    const autonomyLevel = url.searchParams.get("autonomyLevel");

    const result = await listAgentTasks(regionId, { status, autonomyLevel });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load agent tasks";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
