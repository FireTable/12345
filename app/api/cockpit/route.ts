import { NextResponse } from "next/server";
import { loadCockpitRead } from "@/lib/cockpit-read";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { requireAdmin } from "@/lib/auth/rbac";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const payload = await loadCockpitRead(regionId);
    return NextResponse.json(payload, {
      headers: {
        "cache-control": "private, max-age=10, stale-while-revalidate=30",
        vary: "Cookie, x-region-id",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "cockpit read failed";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
