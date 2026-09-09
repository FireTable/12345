import { NextResponse } from "next/server";
import { loadOverview } from "@/lib/civic-queries";

// ponytail: 公开 KPI 端点,未登录也能用。Copilot 招呼语 / 首页 ticketStatus 走这里拿工单总数,
// 避开 /api/overview 的 401 网关。只回非敏感的统计数字。
export async function GET() {
  try {
    const full = await loadOverview(0);
    return NextResponse.json({
      success: true,
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
