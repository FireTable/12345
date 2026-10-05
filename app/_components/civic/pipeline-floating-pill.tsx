"use client";

import React, { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Cpu } from "lucide-react";
import { useRegion } from "./region-context";

export function PipelineFloatingPill() {
  const pathname = usePathname();
  const { activeRegion } = useRegion();
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

  useEffect(() => {
    fetchStatus();
    const isRunning = taskState?.status === "running";
    const timer = setInterval(fetchStatus, isRunning ? 3000 : 12000);
    const onRefresh = () => fetchStatus();
    window.addEventListener("civic-data-refresh", onRefresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener("civic-data-refresh", onRefresh);
    };
  }, [fetchStatus, taskState?.status]);

  // 如果当前已经在 workbench 页面，或者没有在运行的任务，则隐藏
  if (pathname === "/workbench" || !taskState || taskState.status !== "running") {
    return null;
  }

  const { processed, total, stageText } = taskState;
  const percent = total > 0 ? Math.round((processed / total) * 100) : 0;

  return (
    <Link href="/workbench" className="pipeline-floating-widget" title="点击进入全工序研判画布工作台">
      <div className="pipeline-floating-icon animate-spin" style={{ animationDuration: "3s" }}>
        <Cpu size={14} />
      </div>
      <div className="flex flex-col">
        <div className="text-[11px] font-bold tracking-tight text-white flex items-center gap-1.5 leading-none">
          <span>AI 流水线研判中</span>
          <span className="text-[10px] font-mono px-1 py-0.2 rounded bg-blue-500/30 text-blue-200 border border-blue-400/30">
            {processed.toLocaleString()}/{total.toLocaleString()} ({percent}%)
          </span>
        </div>
        <div className="text-[9.5px] text-slate-300 truncate max-w-[140px] leading-tight mt-0.5">
          {stageText || "时空实体研判中"}
        </div>
      </div>
    </Link>
  );
}
