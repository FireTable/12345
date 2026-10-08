"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Cpu } from "lucide-react";
import { useRegion } from "./region-context";
import { useCivicWorkflow } from "./civic-workflow";

export function PipelineFloatingPill() {
  const { activeRegion } = useRegion();
  const { setPipelineDrawerOpen, pipelineDrawerOpen } = useCivicWorkflow();
  const [taskState, setTaskState] = useState<{
    status: "idle" | "running" | "completed" | "error";
    processed: number;
    total: number;
    stageText?: string;
  } | null>(null);

  const fetchStatus = useCallback(async () => {
    try {
      const regParam = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/workbench/pipeline-state${regParam}`);
      const json = await res.json();
      if (json.success && json.data) {
        setTaskState(json.data.taskProgress);
      }
    } catch {
      // 容错忽略
    }
  }, [activeRegion?.id]);

  const rawStatus = (taskState?.status || "").toUpperCase();
  const isRunning = rawStatus === "RUNNING" || rawStatus === "PENDING";

  useEffect(() => {
    fetchStatus();
    const timer = setInterval(fetchStatus, 5000);
    const onRefresh = () => fetchStatus();
    window.addEventListener("civic-data-refresh", onRefresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener("civic-data-refresh", onRefresh);
    };
  }, [fetchStatus, isRunning]);

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
