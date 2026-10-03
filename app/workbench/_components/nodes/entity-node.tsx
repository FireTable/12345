"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Cpu, MapPin, Building2, Sparkles, CheckCircle2, ShieldCheck } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type EntityNodeData = {
  processed: number;
  total: number;
  extractedCount: number;
  currentTicketNo?: string;
  currentSubject?: string;
  currentLocation?: string;
  status: "idle" | "running" | "completed";
  percent: number;
};

export type EntityNodeType = Node<EntityNodeData, "entity">;

export function EntityNode({ data }: NodeProps<EntityNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || (data.total > 0 && data.processed >= data.total);

  return (
    <PipelineNodeShell
      stepNumber="03"
      title="微观地点与主体研判台"
      icon={<Cpu size={15} />}
      iconGradient="linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
      status={data.status}
      statusText={isActive ? "深度研判中" : isCompleted ? "抽取完毕" : "待命中"}
      hasTargetHandle={true}
      targetHandlePosition={Position.Top}
      targetHandleColor="#0958D9"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Right}
      sourceHandleColor="#7C3AED"
    >
      {/* 研判进度条 */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 mb-1">
          <span className="flex items-center gap-1.5">
            <span>实体与地点抽取进度</span>
            {data.currentTicketNo && (
              <span className="font-mono text-[9px] px-1.5 py-0.2 rounded bg-purple-50 text-purple-700 font-semibold border border-purple-200">
                {data.currentTicketNo}
              </span>
            )}
          </span>
          <span className="font-mono text-slate-800 font-bold">
            {data.processed} / {data.total} ({data.percent}%)
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-linear-to-r from-purple-500 via-indigo-500 to-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, data.percent))}%` }}
          />
        </div>
      </div>

      {/* 实时抽取结果微型面板 (520px 宽下充盈展示) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1.5 text-purple-700">
            <Sparkles size={11} className="shrink-0" />
            微观空间基底提炼 (AI消歧对齐)
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded font-mono font-medium border border-purple-100">
              置信度 98.4%
            </span>
            {isCompleted && (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-bold">
                <CheckCircle2 size={11} className="shrink-0" /> 全量对齐
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-[11px] mt-2">
          <div className="flex items-start gap-1 text-slate-600">
            <MapPin size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">微观道路点位：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentLocation || "大良街道新从路新兴横二街"}
            </span>
          </div>

          <div className="flex items-start gap-1 text-slate-600">
            <Building2 size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">责任/涉事主体：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentSubject || "沿街排档商户 / 物业责任方"}
            </span>
          </div>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
