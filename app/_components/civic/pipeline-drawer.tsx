"use client";

import React, { useEffect, useState, useCallback } from "react";
import { Cpu, X, CheckCircle2, AlertCircle, ChevronUp } from "lucide-react";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
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

  // SSE 推送：每帧 task-progress 携带 taskProgress + metrics，合并进 pipelineData
  // 让 PipelineCanvas 进度条 / 主题数实时更新，不必额外 fetchState。
  // pipeline-state-refresh 信号（系统二节点健康等重量级数据）才走完整 fetch。
  useCivicSse(activeRegion?.id, (msg) => {
    if (msg.type === "task-progress") {
      setPipelineData((prev) => {
        const tp = msg.taskProgress as PipelineStateResponse["taskProgress"];
        if (!prev) return prev;
        // 合并 taskProgress + metrics（metrics 缺省保留旧值，避免后端报错导致进度条回退）
        return {
          ...prev,
          taskProgress: tp,
          metrics: msg.metrics
            ? {
                ...prev.metrics,
                totalTickets: msg.metrics.totalTickets,
                analyzedTickets: msg.metrics.analyzedTickets,
                unprocessedTickets: msg.metrics.unprocessedTickets,
                urgentTickets: msg.metrics.urgentTickets,
                stabilityRiskTickets: msg.metrics.stabilityRiskTickets,
                totalThemes: msg.metrics.totalThemes,
                highRiskThemes: msg.metrics.highRiskThemes,
              }
            : prev.metrics,
        };
      });
    } else if (msg.type === "pipeline-state-refresh") {
      // 收到全量刷新信号（来自 cluster-queue 终态 / cockpit 数据变更等）
      fetchState();
    } else if (msg.type === "civic-data-refresh") {
      fetchState();
    }
  });

  // 抽屉首次打开 / 切区时拉一次 pipeline-state 拿全量快照
  // 不再 setPipelineData(null) —— 之前会丢 SSE 帧（prev=null 时 if (!prev) return prev 直接丢弃）。
  // 切区时让 useCivicSse 内部自然重建 ES（regionId 切换时 close 旧 + open 新），
  // 同时 SSE 帧的 taskProgress 来自 updateTaskProgress 实时合并，比 API 第一次响应
  // 更完整（含 endpointRecentTickets / currentLocation 等内存字段）。
  // fetchState 用来补 systemTwoNodes 等 SSE 不便携带的重量级字段。
  useEffect(() => {
    if (pipelineDrawerOpen) {
      fetchState();
    }
  }, [pipelineDrawerOpen, activeRegion?.id, fetchState]);

  const isRunning = (pipelineData?.taskProgress?.status || "").toUpperCase() === "RUNNING";

  // 抽屉打开时锁住背后页面滚动，避免手机上抽屉和页面一起滑
  useEffect(() => {
    if (!pipelineDrawerOpen) return;
    const prevBody = document.body.style.overflow;
    const prevHtml = document.documentElement.style.overflow;
    document.body.style.overflow = "hidden";
    document.documentElement.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prevBody;
      document.documentElement.style.overflow = prevHtml;
    };
  }, [pipelineDrawerOpen]);

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
            <span className="p-1.5 rounded-lg bg-blue-600 text-white shadow-sm flex items-center justify-center shrink-0">
              <Cpu size={18} />
            </span>
            <div className="workbench-heading">
              <h2 className="text-sm font-bold text-slate-900 leading-tight">
                {activeRegion ? `${activeRegion.name} · ` : ""}全流程 AI 研判流水线工厂
              </h2>
              <p className="workbench-heading__sub text-[11px] text-slate-500 leading-tight mt-0.5">
                端到端自动化工序：诉求接入 ➔ 要素初筛 ➔ 微观主体研判 ➔ 空间聚类 ➔ 案卷生成
              </p>
            </div>
          </div>

          <div className="workbench-header__status">
            {isAllAnalyzed ? (
              <div className="workbench-badge workbench-badge--idle">
                <CheckCircle2 size={13} className="text-emerald-600 shrink-0" />
                <span className="workbench-badge__text">全部工单已完成研判 ({pipelineData?.metrics.totalTickets?.toLocaleString()} 件)</span>
              </div>
            ) : !isRunning && unprocessed > 0 ? (
              <div className="workbench-badge workbench-badge--busy">
                <AlertCircle size={13} className="text-amber-600 shrink-0" />
                <span className="workbench-badge__text">待研判积压：{unprocessed.toLocaleString()} 件工单</span>
              </div>
            ) : !isRunning ? (
              <div className="workbench-badge workbench-badge--idle">
                <span className="workbench-badge__text">系统就绪，暂无积压</span>
              </div>
            ) : null}
          </div>

          <div className="workbench-header__actions">
            <button
              type="button"
              onClick={() => setPipelineDrawerOpen(false)}
              className="workbench-close-btn flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer"
              title="收起控制台 (ESC)"
              aria-label="关闭控制台"
            >
              <X size={18} />
            </button>
          </div>
        </header>

        <div className="pipeline-drawer__body">
          {pipelineDrawerOpen && (
            <PipelineCanvas stateData={pipelineData} onRefresh={fetchState} />
          )}
        </div>

        <button
          type="button"
          onClick={() => setPipelineDrawerOpen(false)}
          className="pipeline-drawer__handle group"
          title="点击向上收起控制台 (ESC)"
        >
          <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 group-hover:text-blue-600 transition-colors">
            <ChevronUp size={13} className="group-hover:-translate-y-0.5 transition-transform" />
            <span>收起控制台</span>
            <span className="text-[10px] text-slate-400 font-mono font-normal">ESC</span>
          </div>
        </button>
      </aside>
    </>
  );
}
