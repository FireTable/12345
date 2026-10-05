"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Cpu, RotateCw, X, CheckCircle2, AlertCircle, ChevronUp } from "lucide-react";
import { useCivicWorkflow } from "./civic-workflow";
import { useRegion } from "./region-context";
import { PipelineCanvas, type PipelineStateResponse } from "@/app/workbench/_components/pipeline-canvas";

export function PipelineDrawer() {
  const { pipelineDrawerOpen, setPipelineDrawerOpen } = useCivicWorkflow();
  const { activeRegion } = useRegion();
  const [pipelineData, setPipelineData] = useState<PipelineStateResponse | null>(null);
  const [loading, setLoading] = useState(false);

  const fetchState = useCallback(async () => {
    try {
      setLoading(true);
      const regParam = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/workbench/pipeline-state${regParam}`, { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.data) {
        setPipelineData(json.data);
      }
    } catch {
      // 容错处理
    } finally {
      setLoading(false);
    }
  }, [activeRegion?.id]);

  useEffect(() => {
    if (pipelineDrawerOpen) {
      fetchState();
    }
  }, [pipelineDrawerOpen, fetchState]);

  // 轮询：抽屉打开时如果处于 running 状态，每 3s 刷新一次；空闲时每 15s
  useEffect(() => {
    if (!pipelineDrawerOpen) return;
    const isRunning = pipelineData?.taskProgress?.status === "running";
    const timer = setInterval(fetchState, isRunning ? 3000 : 15000);
    return () => clearInterval(timer);
  }, [pipelineDrawerOpen, pipelineData?.taskProgress?.status, fetchState]);

  // ESC 键关闭抽屉
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && pipelineDrawerOpen) {
        setPipelineDrawerOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pipelineDrawerOpen, setPipelineDrawerOpen]);

  const isRunning = pipelineData?.taskProgress?.status === "running";
  const processed = pipelineData?.taskProgress?.processed ?? 0;
  const total = pipelineData?.taskProgress?.total ?? (pipelineData?.metrics.totalTickets || 0);
  const unprocessed = pipelineData?.metrics.unprocessedTickets ?? 0;
  const isAllAnalyzed =
    (pipelineData?.metrics.totalTickets || 0) > 0 &&
    (pipelineData?.metrics.analyzedTickets || 0) >= (pipelineData?.metrics.totalTickets || 0) &&
    !isRunning;

  return (
    <>
      {/* 遮罩背景 (点击关闭) */}
      <div
        className={`pipeline-drawer-overlay${pipelineDrawerOpen ? " is-open" : ""}`}
        onClick={() => setPipelineDrawerOpen(false)}
        aria-hidden="true"
      />

      {/* 侧拉抽屉面板 */}
      <aside
        className={`pipeline-drawer${pipelineDrawerOpen ? " is-open" : ""}`}
        aria-label="研判流水线工厂抽屉"
        role="dialog"
        aria-modal="true"
      >
        {/* 顶部流水线工厂调度控制栏 (无手动开启按钮，系统自动研判) */}
        <header className="workbench-header">
          <div className="workbench-title-group">
            <div className="flex items-center gap-2">
              <span className="p-1.5 rounded-lg bg-blue-600 text-white shadow-sm flex items-center justify-center">
                <Cpu size={18} />
              </span>
              <div>
                <h2 className="text-sm font-bold text-slate-900 leading-tight">
                  {activeRegion ? `${activeRegion.name} · ` : ""}全流程 AI 研判流水线工厂
                </h2>
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
                <span>研判中：第 {processed.toLocaleString()}/{total.toLocaleString()} 件 · {pipelineData?.taskProgress?.stageText || "要素提取与归类"}</span>
              </div>
            ) : isAllAnalyzed ? (
              <div className="workbench-badge workbench-badge--idle flex items-center gap-1.5">
                <CheckCircle2 size={13} className="text-emerald-600" />
                <span>全部工单已完成研判 ({pipelineData?.metrics.totalTickets?.toLocaleString()} 件)</span>
              </div>
            ) : unprocessed > 0 ? (
              <div className="workbench-badge workbench-badge--busy flex items-center gap-1.5">
                <AlertCircle size={13} className="text-amber-600" />
                <span>待研判积压：{unprocessed.toLocaleString()} 件工单</span>
              </div>
            ) : (
              <div className="workbench-badge workbench-badge--idle flex items-center gap-1.5">
                <span>系统就绪，暂无积压</span>
              </div>
            )}
          </div>

          {/* 右侧操作区：刷新 + 关闭抽屉 (完全移除多余的启动研判按钮) */}
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={fetchState}
              className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium text-slate-600 hover:text-slate-900 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors shadow-2xs cursor-pointer"
              title="刷新流水线状态"
            >
              <RotateCw size={13} className={loading ? "animate-spin" : ""} />
              刷新
            </button>

            <button
              type="button"
              onClick={() => setPipelineDrawerOpen(false)}
              className="flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="收起控制台 (ESC)"
              aria-label="关闭控制台"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        {/* 画布核心工作区 */}
        <div className="flex-1 w-full min-h-0 relative">
          {pipelineDrawerOpen && (
            <PipelineCanvas stateData={pipelineData} onRefresh={fetchState} />
          )}
        </div>

        {/* 控制台底边收起把手条 */}
        <div
          onClick={() => setPipelineDrawerOpen(false)}
          className="group w-full py-1 flex items-center justify-center bg-slate-100/90 hover:bg-slate-200/90 border-t border-slate-200 cursor-pointer select-none transition-colors shrink-0"
          title="点击向上收起控制台 (ESC)"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 group-hover:text-blue-600 transition-colors">
            <ChevronUp size={13} className="group-hover:-translate-y-0.5 transition-transform" />
            <span>收起控制台</span>
            <span className="text-[10px] text-slate-400 font-mono font-normal">ESC</span>
          </div>
        </div>
      </aside>
    </>
  );
}
