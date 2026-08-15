import { NextResponse } from "next/server";
import { getTaskProgress } from "@/lib/task-progress";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const taskId = searchParams.get("taskId");

  if (!taskId) {
    return NextResponse.json({ success: false, error: "Missing taskId parameter" }, { status: 400 });
  }

  const progress = getTaskProgress(taskId);
  if (!progress) {
    return NextResponse.json({
      success: true,
      data: {
        taskId,
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

  return NextResponse.json({
    success: true,
    data: progress,
  });
}
