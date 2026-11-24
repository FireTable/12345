"use client";

import React, { useEffect, useState, useCallback, useRef } from "react";
import dynamic from "next/dynamic";
import { Cpu, X, CheckCircle2, AlertCircle, ChevronUp } from "lucide-react";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useAuthRole } from "@/lib/auth/use-role";
import { useCivicWorkflow } from "./civic-workflow";
import { useRegion } from "./region-context";
import "@/app/workbench/workbench.css";
import type { PipelineStateResponse } from "@/app/workbench/_components/pipeline-canvas";

const PipelineCanvas = dynamic(
  () => import("@/app/workbench/_components/pipeline-canvas").then((m) => m.PipelineCanvas),
  {
    ssr: false,
    loading: () => (
      <div className="workbench-canvas-container" aria-busy="true">
        <div className="workbench-canvas-pending">
          <span className="workbench-canvas-spinner" aria-hidden="true" />
          <p className="workbench-canvas-pending__title">正在读取流水线画布</p>
        </div>
      </div>
    ),
  }
);

export function PipelineDrawer() {
  const { isAdmin } = useAuthRole();
  const { pipelineDrawerOpen, setPipelineDrawerOpen } = useCivicWorkflow();
  const { activeRegion } = useRegion();
  const [pipelineData, setPipelineData] = useState<PipelineStateResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const pressedOutsideRef = useRef(false);

  const fetchState = useCallback(async () => {
    if (!isAdmin) return;
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
  }, [isAdmin, activeRegion?.id]);

  // SSE 推送：每帧 task-progress 携带 taskProgress + metrics，合并进 pipelineData
  // 让 PipelineCanvas 进度条 / 主题数实时更新，不必额外 fetchState。
  // pipeline-state-refresh 信号（系统二节点健康等重量级数据）才走完整 fetch。
  useCivicSse(isAdmin ? activeRegion?.id : undefined, (msg) => {
    if (!isAdmin) return;
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
    if (isAdmin && pipelineDrawerOpen) {
      fetchState();
    }
  }, [isAdmin, pipelineDrawerOpen, activeRegion?.id, fetchState]);

  const isRunning = (pipelineData?.taskProgress?.status || "").toUpperCase() === "RUNNING";

  // 原生 <dialog>.showModal() 提供顶层、inert、焦点围栏、Esc 退出与焦点回返；
  // 背景滚动隔离交给 tokens.css / components.css 中的 overscroll-behavior: contain，不修改 body.style.overflow。
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog || !isAdmin) return;
    if (pipelineDrawerOpen) {
      if (!dialog.open) {
        dialog.showModal();
      }
    } else if (dialog.open) {
      dialog.close();
    }
  }, [isAdmin, pipelineDrawerOpen]);

  // Safari 等尚未支持 <dialog closedby="any"> 的浏览器降级为坐标点外点击关闭（按压与抬起均在面板外）
  const isPointerOutsideDialog = (e: React.PointerEvent<HTMLDialogElement>, dialog: HTMLDialogElement) => {
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };

  const unprocessed = pipelineData?.metrics.unprocessedTickets ?? 0;
  const isAllAnalyzed =
    (pipelineData?.metrics.totalTickets || 0) > 0 &&
    (pipelineData?.metrics.analyzedTickets || 0) >= (pipelineData?.metrics.totalTickets || 0) &&
    !isRunning;

  if (!isAdmin) return null;

  return (
    <dialog
      ref={dialogRef}
      className={`pipeline-drawer${pipelineDrawerOpen ? " is-open" : ""}`}
      aria-labelledby="pipeline-drawer-title"
      {...({ closedby: "any" } as Record<string, string>)}
      onClose={() => {
        if (pipelineDrawerOpen) setPipelineDrawerOpen(false);
      }}
      onPointerDown={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        pressedOutsideRef.current = isPointerOutsideDialog(e, dialog);
      }}
      onPointerUp={(e) => {
        const dialog = dialogRef.current;
        if (!dialog || "closedBy" in HTMLDialogElement.prototype) return;
        const shouldClose = pressedOutsideRef.current && isPointerOutsideDialog(e, dialog);
        pressedOutsideRef.current = false;
        if (shouldClose) dialog.close();
      }}
    >
      {/* 顶部流水线工厂调度控制栏 (无手动开启按钮，系统自动研判) */}
      <header className="workbench-header">
        <div className="workbench-title-group">
          <span className="p-1.5 rounded-lg bg-blue-600 text-white shadow-sm flex items-center justify-center shrink-0" aria-hidden="true">
            <Cpu size={18} />
          </span>
          <div className="workbench-heading">
            <h2 id="pipeline-drawer-title" className="text-sm font-bold text-slate-900 leading-tight">
              {activeRegion ? `${activeRegion.name} · ` : ""}全流程 AI 研判流水线工厂
            </h2>
            <p className="workbench-heading__sub text-[11px] text-slate-500 leading-tight mt-0.5">
              端到端自动化工序：诉求接入 ➔ 要素初筛 ➔ 微观主体研判 ➔ 空间聚类 ➔ 案卷生成
            </p>
          </div>
        </div>

        <div className="workbench-header__status">
          {!pipelineData && loading ? (
            <div className="workbench-badge workbench-badge--idle">
              <span className="workbench-badge__text">正在读取流水线</span>
            </div>
          ) : isAllAnalyzed ? (
            <div className="workbench-badge workbench-badge--idle">
              <CheckCircle2 size={13} className="text-emerald-600 shrink-0" aria-hidden="true" />
              <span className="workbench-badge__text">全部工单已完成研判 ({pipelineData?.metrics.totalTickets?.toLocaleString()} 件)</span>
            </div>
          ) : !isRunning && unprocessed > 0 ? (
            <div className="workbench-badge workbench-badge--busy">
              <AlertCircle size={13} className="text-amber-600 shrink-0" aria-hidden="true" />
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
            autoFocus
            onClick={() => setPipelineDrawerOpen(false)}
            className="workbench-close-btn relative flex items-center justify-center w-8 h-8 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors cursor-pointer after:content-[''] after:absolute after:-inset-[6px]"
            title="收起控制台 (ESC)"
            aria-label="关闭控制台"
          >
            <X size={18} aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="pipeline-drawer__body">
        {pipelineDrawerOpen && (
          <PipelineCanvas stateData={pipelineData} onRefresh={fetchState} pending={loading && !pipelineData} />
        )}
      </div>

      <button
        type="button"
        onClick={() => setPipelineDrawerOpen(false)}
        className="pipeline-drawer__handle group"
        title="点击向上收起控制台 (ESC)"
      >
        <div className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 group-hover:text-blue-600 transition-colors">
          <ChevronUp size={13} className="group-hover:-translate-y-0.5 motion-reduce:group-hover:translate-y-0 transition-transform" aria-hidden="true" />
          <span>收起控制台</span>
          <span className="text-[10px] text-slate-400 font-mono font-normal">ESC</span>
        </div>
      </button>
    </dialog>
  );
}
