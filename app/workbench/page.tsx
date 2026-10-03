"use client";

import React, { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Play,
  RotateCw,
  LayoutDashboard,
  Cpu,
  CheckCircle2,
  AlertCircle,
  HelpCircle,
} from "lucide-react";
import { PipelineCanvas, type PipelineStateResponse } from "./_components/pipeline-canvas";
import { useRegion } from "@/app/_components/civic/region-context";
import "./workbench.css";

export default function WorkbenchPage() {
  const { activeRegion } = useRegion();
  const [loading, setLoading] = useState(true);
  const [triggering, setTriggering] = useState(false);
  const [pipelineData, setPipelineData] = useState<PipelineStateResponse | null>(null);

  const fetchState = useCallback(async () => {
    try {
      const regParam = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/workbench/pipeline-state${regParam}`, {
        cache: "no-store",
      });
      const data = await res.json();
      if (data.success && data.data) {
        setPipelineData(data.data);
      }
    } catch (e) {
      console.error("Failed to fetch workbench pipeline state:", e);
    } finally {
      setLoading(false);
    }
  }, [activeRegion?.id]);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // 轮询：若任务在 running 则每 2.5 秒刷新，否则每 10 秒微弱拉取
  useEffect(() => {
    const isRunning = pipelineData?.taskProgress?.status === "running";
    const intervalMs = isRunning ? 2500 : 10000;
    const timer = setInterval(() => {
      fetchState();
    }, intervalMs);

    const onDataRefresh = () => fetchState();
    window.addEventListener("civic-data-refresh", onDataRefresh);

    return () => {
      clearInterval(timer);
      window.removeEventListener("civic-data-refresh", onDataRefresh);
    };
  }, [fetchState, pipelineData?.taskProgress?.status]);

  // 触发启动 AI 研判
  const handleStartAnalysis = async () => {
    if (triggering) return;
    setTriggering(true);
    try {
      const regParam = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/cluster${regParam}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: `pipeline-${Date.now()}` }),
      });
      const json = await res.json();
      if (json.success) {
        if (json.data?.alreadyRunning) {
          toast.info("研判任务正在队列执行中");
        } else {
          toast.success("流水线研判任务已启动入队");
        }
        fetchState();
      } else {
        toast.error(json.error || "启动失败");
      }
    } catch (e: any) {
      toast.error(e.message || "请求异常");
    } finally {
      setTriggering(false);
    }
  };

  const isRunning = pipelineData?.taskProgress?.status === "running";
  const processed = pipelineData?.taskProgress?.processed ?? 0;
  const total = pipelineData?.taskProgress?.total ?? (pipelineData?.metrics.totalTickets || 0);
  const unprocessed = pipelineData?.metrics.unprocessedTickets ?? 0;
  const isAllAnalyzed =
    (pipelineData?.metrics.totalTickets || 0) > 0 &&
    (pipelineData?.metrics.analyzedTickets || 0) >= (pipelineData?.metrics.totalTickets || 0) &&
    !isRunning;

  return (
    <div className="workbench-wrapper">
      {/* 顶部流水线工厂调度控制栏 */}
      <header className="workbench-header">
        <div className="workbench-title-group">
          <div className="flex items-center gap-2">
            <span className="p-1.5 rounded-lg bg-blue-600 text-white shadow-sm flex items-center justify-center">
              <Cpu size={18} />
            </span>
            <div>
              <h1 className="text-sm font-bold text-slate-900 leading-tight">
                {activeRegion ? `${activeRegion.name} · ` : ""}全流程 AI 研判流水线工厂
              </h1>
              <p className="text-[11px] text-slate-500 leading-tight mt-0.5">
                端到端自动化工序：诉求接入 ➔ 要素初筛 ➔ 微观主体研判 ➔ 空间聚类 ➔ 案卷生成
              </p>
            </div>
          </div>

          <div className="h-5 w-px bg-slate-200 mx-2" />

          {/* 实时工序运行徽标 */}
          {isRunning ? (
            <div className="workbench-badge workbench-badge--running flex items-center gap-1.5 animate-pulse">
              <span className="w-2 h-2 rounded-full bg-blue-600 animate-ping" />
              <span>研判中：第 {processed}/{total} 件 · {pipelineData?.taskProgress?.stageText || "时空主体抽取"}</span>
            </div>
          ) : isAllAnalyzed ? (
            <div className="workbench-badge workbench-badge--idle flex items-center gap-1.5">
              <CheckCircle2 size={13} className="text-emerald-600" />
              <span>全部工单已完成研判 ({pipelineData?.metrics.totalTickets} 件)</span>
            </div>
          ) : unprocessed > 0 ? (
            <div className="workbench-badge workbench-badge--busy flex items-center gap-1.5">
              <AlertCircle size={13} className="text-amber-600" />
              <span>待研判积压：{unprocessed} 件工单</span>
            </div>
          ) : (
            <div className="workbench-badge workbench-badge--idle flex items-center gap-1.5">
              <span>系统就绪，暂无积压</span>
            </div>
          )}
        </div>

        {/* 顶部控制操作区 */}
        <div className="flex items-center gap-2.5">
          <button
            type="button"
            onClick={fetchState}
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs"
            title="刷新流水线状态"
          >
            <RotateCw size={13} className={loading ? "animate-spin" : ""} />
            刷新
          </button>

          <button
            type="button"
            onClick={handleStartAnalysis}
            disabled={isRunning || isAllAnalyzed || triggering || (pipelineData?.metrics.totalTickets || 0) === 0}
            className={`flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg shadow-sm transition-all ${
              isRunning
                ? "bg-blue-100 text-blue-700 cursor-not-allowed border border-blue-200"
                : isAllAnalyzed
                ? "bg-slate-100 text-slate-400 cursor-not-allowed border border-slate-200"
                : "bg-blue-600 hover:bg-blue-700 text-white active:scale-98 shadow-blue-500/20"
            }`}
          >
            <Play size={13} fill={isRunning || isAllAnalyzed ? "none" : "currentColor"} />
            {isRunning ? "流水线正在运行" : isAllAnalyzed ? "已全部研判就绪" : "启动全工序流水线"}
          </button>

          <div className="h-5 w-px bg-slate-200 mx-1" />

          <Link
            href="/"
            className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-700 hover:text-blue-600 bg-white border border-slate-200 rounded-lg hover:border-blue-400 transition-colors shadow-2xs"
          >
            <LayoutDashboard size={13} />
            返回总览大屏
          </Link>
        </div>
      </header>

      {/* 画布核心工作区 */}
      <PipelineCanvas stateData={pipelineData} onRefresh={fetchState} />
    </div>
  );
}
