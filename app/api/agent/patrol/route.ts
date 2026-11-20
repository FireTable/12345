import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { runAgentPatrol } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-patrol",
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => ({}))) as {
      regionId?: unknown;
    } | null;

    const regionId = await resolveRequestRegionId(
      req,
      body && typeof body.regionId === "string" ? body.regionId : undefined
    );

    const result = await runAgentPatrol(regionId);

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to run agent patrol";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
