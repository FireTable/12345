import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { generateAgentReport, listAgentReports } from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-report-read",
    });
    if ("response" in guard) return guard.response;

    const regionId = await resolveRequestRegionId(req);
    const reports = await listAgentReports(regionId);

    return NextResponse.json({
      success: true,
      report: reports[0] ?? null,
      reports,
      webhookSent: false,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load agent reports";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-report-generate",
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => ({}))) as {
      regionId?: unknown;
    } | null;

    const regionId = await resolveRequestRegionId(
      req,
      body && typeof body.regionId === "string" ? body.regionId : undefined
    );

    const result = await generateAgentReport(regionId);

    return NextResponse.json({
      success: true,
      report: result.report,
      reports: result.reports,
      webhookSent: result.webhookSent,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to generate agent report";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
