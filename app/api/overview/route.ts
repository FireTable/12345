import { NextResponse } from "next/server";
import { clampDays } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadOverview } from "@/lib/civic-queries";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { requireAdmin } from "@/lib/auth/rbac";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const days = clampDays(new URL(req.url).searchParams.get("days"), 0);
    const { value } = await cacheGetOrLoad(`overview:${regionId}:${days}`, () =>
      loadOverview(days, regionId)
    );
    return NextResponse.json(value, {
      headers: {
        "cache-control": "private, max-age=15, stale-while-revalidate=60",
        vary: "Cookie, x-region-id",
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "overview failed" },
      { status: 500 }
    );
  }
}
