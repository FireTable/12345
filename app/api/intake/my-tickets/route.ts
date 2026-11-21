import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { listCitizenTickets } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "intake-my-tickets",
      maxPerMinute: 120,
    });
    if ("response" in guard) return guard.response;

    const regionId = await resolveRequestRegionId(req);
    const tickets = await listCitizenTickets(guard.session.user.id, regionId);

    return NextResponse.json({
      success: true,
      tickets,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load my tickets";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
