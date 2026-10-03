"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { ShieldCheck, FileSpreadsheet, MapPin, AlertTriangle, CheckCircle2, ArrowRight } from "lucide-react";
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
      status={data.status}
      statusText={data.statusText || (isActive ? "正在生成案卷" : isCompleted ? "案卷已就绪" : "等待生成")}
      hasTargetHandle={true}
      targetHandlePosition={Position.Right}
      targetHandleColor="#0891B2"
      hasSourceHandle={false}
    >
      {/* 核心指标卡片看板 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-emerald-50/80 border border-emerald-100/90 rounded-lg p-2.5">
          <div className="text-[10px] text-emerald-800 flex items-center gap-1 font-medium">
            <CheckCircle2 size={12} className="text-emerald-600 shrink-0" />
            已生成案卷
          </div>
          <div className="text-lg font-bold font-mono text-emerald-950 mt-1">
            {data.dossierCount}
            <span className="text-[11px] font-normal text-emerald-700 ml-1">份</span>
          </div>
        </div>

        <div className="bg-amber-50/80 border border-amber-100/90 rounded-lg p-2.5">
          <div className="text-[10px] text-amber-800 flex items-center gap-1 font-medium">
            <AlertTriangle size={12} className="text-amber-600 shrink-0" />
            假闭环与推诿风险
          </div>
          <div className="text-lg font-bold font-mono text-amber-950 mt-1">
            {pseudoLoop}
            <span className="text-[11px] font-normal text-amber-700 ml-1">起</span>
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
            href="/multifreq"
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-emerald-500 hover:text-emerald-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <FileSpreadsheet size={12} className="text-emerald-600" />
            查看诉求案卷
          </Link>
          <Link
            href="/spatial"
            className="flex items-center justify-center gap-1.5 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-blue-500 hover:text-blue-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <MapPin size={12} className="text-blue-600" />
            查看分布热力图
          </Link>
        </div>

        <div className="text-[10px] text-slate-400 text-center pt-2">
          全流程贯通：诉求接入 ➔ 要素提取 ➔ 问题归集 ➔ 协同处置
        </div>
      </div>
    </PipelineNodeShell>
  );
}
