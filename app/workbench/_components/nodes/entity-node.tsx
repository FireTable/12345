"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Cpu, MapPin, Building2, Sparkles, CheckCircle2, Clock, Tag } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type EntityNodeData = {
  processed: number;
  total: number;
  extractedCount: number;
  currentTicketNo?: string;
  currentTime?: string;
  currentLocation?: string;
  currentSubject?: string;
  currentEventType?: string;
  status: "idle" | "running" | "completed";
  percent: number;
};

export type EntityNodeType = Node<EntityNodeData, "entity">;

function formatDisplayTime(rawTime?: string): string {
  if (!rawTime) return "2025-01-01 09:57:04";
  try {
    const d = new Date(rawTime);
    if (isNaN(d.getTime())) return rawTime;
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    const hh = String(d.getHours()).padStart(2, "0");
    const min = String(d.getMinutes()).padStart(2, "0");
    const ss = String(d.getSeconds()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd} ${hh}:${min}:${ss}`;
  } catch {
    return rawTime;
  }
}

export function EntityNode({ data }: NodeProps<EntityNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || (data.total > 0 && data.processed >= data.total);
  const displayTime = formatDisplayTime(data.currentTime);

  return (
    <PipelineNodeShell
      stepNumber="03"
      title="实体要素与发生时间抽取台"
      icon={<Cpu size={15} />}
      iconGradient="linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
      status={data.status}
      statusText={isActive ? "时空实体抽取中" : isCompleted ? "抽取对齐完毕" : "待命中"}
      hasTargetHandle={true}
      targetHandlePosition={Position.Left}
      targetHandleColor="#0958D9"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Bottom}
      sourceHandleColor="#7C3AED"
    >
      {/* 研判进度条 */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 mb-1">
          <span className="flex items-center gap-1.5">
            <span>实体要素与时间抽取进度</span>
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

      {/* 实时抽取结果微型面板 (突出时空实体与时间抽取双核) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1.5 text-purple-700 font-semibold">
            <Sparkles size={11} className="shrink-0" />
            时空实体与时间结构化提炼
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

        <div className="space-y-2 text-[11px] mt-2">
          {/* 1. 发生时间抽取 */}
          <div className="flex items-center justify-between text-slate-600 bg-purple-50/50 px-2 py-1 rounded border border-purple-100/60">
            <div className="flex items-center gap-1.5">
              <Clock size={12} className="text-purple-600 shrink-0" />
              <span className="text-slate-500 font-medium shrink-0">诉求发生时间：</span>
              <span className="font-mono font-semibold text-purple-900 truncate">
                {displayTime}
              </span>
            </div>
            <span className="text-[9px] px-1 rounded bg-purple-100 text-purple-700 font-medium">
              精确时钟
            </span>
          </div>

          {/* 2. 微观空间实体 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <MapPin size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">微观空间实体：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentLocation || "伦教街道南苑中路一号润汉幸福汇小区"}
            </span>
          </div>

          {/* 3. 涉事责任主体 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <Building2 size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">涉事责任主体：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentSubject || "沿街排档商户 / 物业责任方"}
            </span>
          </div>

          {/* 4. 诉求事件实体 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <Tag size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">诉求事件类型：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentEventType || "噪声扰民 / 物业失管"}
            </span>
          </div>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
