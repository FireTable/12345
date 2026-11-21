import { NextRequest, NextResponse } from "next/server";
import { clampDays } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadOverview } from "@/lib/civic-queries";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const dynamic = "force-dynamic";

// ponytail: 公开 KPI 端点,未登录也能用。Copilot 招呼语 / 首页 ticketStatus 走这里拿工单总数,
// 避开 /api/overview 的 401 网关。只回非敏感的统计数字。
export async function GET(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const days = clampDays(new URL(req.url).searchParams.get("days"), 0);
    const { value: full } = await cacheGetOrLoad(
      `overview:${regionId}:${days}`,
      () => loadOverview(days, regionId)
    );
    return NextResponse.json({
      success: true,
      regionId,
      totalWorkorders: full.totalWorkorders ?? 0,
      analyzedCount: full.analyzedCount ?? 0,
      multiFreqCount: full.multiFreqCount ?? 0,
      multiFreqClusters: full.multiFreqClusters ?? 0,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "overview failed" },
      { status: 500 }
    );
  }
}
