import { NextResponse } from "next/server";
import { clampDays } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadOverview } from "@/lib/civic-queries";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const days = clampDays(new URL(req.url).searchParams.get("days"), 0);
    const { value } = await cacheGetOrLoad(`overview:${regionId}:${days}`, () =>
      loadOverview(days, regionId)
    );
    return NextResponse.json(value);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "overview failed" },
      { status: 500 }
    );
  }
}
