import { NextResponse } from "next/server";
import { getTaskProgress, getLatestTaskProgress, type TaskProgress } from "@/lib/task-progress";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const dynamic = "force-dynamic";

function jsonProgress(data: TaskProgress) {
  if (data.status === "COMPLETED" || data.status === "FAILED") {
    invalidateCivicAggregates();
  }
  return NextResponse.json({ success: true, data });
}

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");
  const regionId = await resolveRequestRegionId(req as any);

  if (!taskId || taskId === "latest") {
    // 按辖区取最新一条；多辖区并发时不再把别人的进度抖到这个页面
    const latest = await getLatestTaskProgress(regionId);
    if (latest) return jsonProgress(latest);
    // 没有任务时不要编一条 PENDING。页面会把任意 PENDING 当成正在跑，按钮就停在研判中。
    return NextResponse.json({ success: true, data: null });
  }

  const progress = await getTaskProgress(taskId!);
  if (!progress) {
    return NextResponse.json({
      success: true,
      data: {
        taskId,
        regionId,
        status: "PENDING",
        stage: "EXTRACTING",
        stageText: "准备就绪，等待处理...",
        percent: 0,
        total: 0,
        processed: 0,
        extractedCount: 0,
        themeCount: 0,
        reviewCount: 0,
        failedCount: 0,
        updatedAt: Date.now(),
      },
    });
  }

  return jsonProgress(progress);
}
