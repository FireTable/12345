import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { createOrReuseMissingInfoTask, listAgentTasks } from "@/lib/agent-governance";

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

    return NextResponse.json(
      {
        success: true,
        ...result,
      },
      {
        headers: {
          "cache-control": "private, max-age=5, stale-while-revalidate=15",
          vary: "Cookie, x-region-id",
        },
      }
    );
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to load agent tasks";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "admin",
      scope: "agent-tasks-create",
      maxPerMinute: 60,
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => null)) as {
      ticketId?: unknown;
      regionId?: unknown;
    } | null;
    const ticketId = typeof body?.ticketId === "string" ? body.ticketId.trim() : "";
    if (!ticketId) {
      return NextResponse.json(
        { success: false, error: "缺少必填参数 ticketId" },
        { status: 400 }
      );
    }

    const explicitRegionId = typeof body?.regionId === "string" ? body.regionId.trim() : undefined;
    const regionId = await resolveRequestRegionId(req, explicitRegionId || null);

    const result = await createOrReuseMissingInfoTask({ regionId, ticketId });
    if (!result.ok) {
      return NextResponse.json(
        { success: false, error: result.error },
        { status: result.status }
      );
    }

    return NextResponse.json({
      success: true,
      task: result.task,
      reused: result.reused,
      domainType: result.domainType,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to create agent task";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
