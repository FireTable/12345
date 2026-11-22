"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { ShieldCheck, FileSpreadsheet, MonitorPlay, Sparkles, AlertTriangle, CheckCircle2 } from "lucide-react";
import Link from "next/link";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type DossierNodeData = {
  dossierCount: number;
  totalTickets: number;
  pseudoLoopCount?: number;
  status: "idle" | "running" | "completed";
  stageText?: string;
  statusText?: string;
};

export type DossierNodeType = Node<DossierNodeData, "dossier">;

export function DossierNode({ data }: NodeProps<DossierNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || data.dossierCount > 0;
  const pseudoLoop = data.pseudoLoopCount ?? 0;

  return (
    <PipelineNodeShell
      stepNumber="05"
      title="处置建议与案卷归档"
      icon={<ShieldCheck size={15} />}
      iconGradient="linear-gradient(135deg, #059669 0%, #10B981 100%)"
      themeColor="#059669"
      status={data.status}
      statusText={data.statusText || (isActive ? "正在生成案卷" : isCompleted ? "案卷已就绪" : "等待生成")}
      hasTargetHandle={true}
      targetHandlePosition={Position.Right}
      targetHandleColor="#0891B2"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Left}
      sourceHandleColor="#059669"
    >
      {/* 核心指标卡片看板 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-50/80 border border-emerald-100/90 rounded-lg p-2.5">
          <div className="text-[10px] text-emerald-800 flex items-center gap-1 font-medium whitespace-nowrap">
            <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
            已生成案卷
          </div>
          <div className="text-lg font-bold font-mono text-emerald-950 mt-1 whitespace-nowrap inline-flex items-baseline">
            {data.dossierCount.toLocaleString()}
            <span className="text-[11px] font-normal text-emerald-700 ml-1 whitespace-nowrap">份</span>
          </div>
        </div>

        <div className="bg-amber-50/80 border border-amber-100/90 rounded-lg p-2.5">
          <div className="text-[10px] text-amber-800 flex items-center gap-1 font-medium whitespace-nowrap">
            <AlertTriangle size={12} className="text-amber-600 shrink-0" />
            假闭环与推诿风险
          </div>
          <div className="text-lg font-bold font-mono tabular-nums text-amber-950 mt-1 whitespace-nowrap inline-flex items-baseline">
            {pseudoLoop.toLocaleString()}
            <span className="text-[11px] font-normal text-amber-800 ml-1 whitespace-nowrap">起</span>
          </div>
        </div>
      </div>

      {/* 治理应用出口面板 */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1 text-slate-800 font-semibold">
            快速流转与协同
          </span>
          <span className="text-[9px] px-1 py-0.2 rounded bg-emerald-100 text-emerald-800 font-bold">
            闭环流转
          </span>
        </div>

        <div className="grid grid-cols-2 gap-2 mt-2">
          <Link
            href="/screen"
            className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-blue-500 hover:text-blue-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <MonitorPlay size={12} className="text-blue-600" aria-hidden="true" />
            指挥驾驶舱
          </Link>
          <Link
            href="/sandbox"
            className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <Sparkles size={12} className="text-emerald-600" aria-hidden="true" />
            X-Ray 实时演练
          </Link>
        </div>
        <Link
          href="/multifreq"
          className="mt-1.5 flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-slate-400 text-[11px] font-medium text-slate-600 transition-colors shadow-2xs"
        >
          <FileSpreadsheet size={12} className="text-slate-500" aria-hidden="true" />
          查看多频工单透势
        </Link>

        <div className="text-[10px] text-slate-500 text-center pt-2">
          全流程贯通：诉求接入 ➔ 要素提取 ➔ 问题归集 ➔ 协同处置
        </div>
      </div>
    </PipelineNodeShell>
  );
}
