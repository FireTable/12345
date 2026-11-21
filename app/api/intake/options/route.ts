import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { loadIntakeOptions } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "intake-options",
      maxPerMinute: 25,
    });
    if ("response" in guard) return guard.response;

    const regionId = await resolveRequestRegionId(req);
    const options = await loadIntakeOptions(regionId);

    return NextResponse.json({
      success: true,
      ...options,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load intake options";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
