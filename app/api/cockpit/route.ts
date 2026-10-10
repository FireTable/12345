import { NextResponse } from "next/server";
import { loadCockpitRead } from "@/lib/cockpit-read";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const payload = await loadCockpitRead(regionId);
    return NextResponse.json(payload);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "cockpit read failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
