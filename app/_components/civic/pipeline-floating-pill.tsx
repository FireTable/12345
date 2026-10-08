"use client";

import React, { useEffect, useState } from "react";
import { Cpu } from "lucide-react";
import { useCivicWs } from "@/app/_hooks/use-civic-ws";
import type { TaskProgress } from "@/lib/task-progress";
import { useRegion } from "./region-context";
import { useCivicWorkflow } from "./civic-workflow";

export function PipelineFloatingPill() {
  const { activeRegion } = useRegion();
  const { setPipelineDrawerOpen, pipelineDrawerOpen } = useCivicWorkflow();
  const [taskState, setTaskState] = useState<TaskProgress | null>(null);

  // WS 推送：每帧 task-progress 直接驱动底部胶囊
  useCivicWs(activeRegion?.id, (msg) => {
    if (msg.type === "task-progress" && msg.data) {
      setTaskState(msg.data as TaskProgress);
    }
    // pipeline-state-refresh 由 pipeline-drawer 处理（需要更全的快照）
  });

  // 切区时清掉旧 taskState，等 WS 推新区第一帧
  useEffect(() => {
    setTaskState(null);
  }, [activeRegion?.id]);

  const rawStatus = (taskState?.status || "").toUpperCase();
  const isRunning = rawStatus === "RUNNING" || rawStatus === "PENDING";

  // 抽屉打开时或任务未运行时隐藏浮动胶囊
  if (pipelineDrawerOpen || !taskState || !isRunning) {
    return null;
  }

  const { processed, total, stageText } = taskState;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <button
      type="button"
      onClick={() => setPipelineDrawerOpen(true)}
      className="pipeline-floating-widget"
      title="点击唤醒全工序研判控制台"
    >
      <div className="pipeline-floating-icon animate-spin" style={{ animationDuration: "3s" }}>
        <Cpu size={14} />
      </div>
      <div className="flex flex-col min-w-0 flex-1 text-left">
        <div className="text-[11px] font-bold tracking-tight text-white flex items-center gap-1.5 leading-none min-w-0">
          <span className="truncate">AI 流水线研判中</span>
          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/30 text-blue-200 border border-blue-400/30 shrink-0">
            {processed.toLocaleString()}/{total.toLocaleString()} ({percent}%)
          </span>
        </div>
        <div className="text-[9.5px] text-slate-300 truncate leading-tight mt-0.5">
          {stageText || "时空实体研判中"}
        </div>
      </div>
    </button>
  );
}
