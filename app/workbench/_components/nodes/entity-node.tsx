"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Cpu, MapPin, Building2, Sparkles, CheckCircle2, Tag } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type EntityNodeData = {
  processed: number;
  total: number;
  extractedCount: number;
  currentLocation?: string;
  currentSubject?: string;
  currentEventType?: string;
  status: "idle" | "running" | "completed";
  statusText?: string;
  percent: number;
};

export type EntityNodeType = Node<EntityNodeData, "entity">;

export function EntityNode({ data }: NodeProps<EntityNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || (data.total > 0 && data.processed >= data.total);

  return (
    <PipelineNodeShell
      stepNumber="03"
      title="地点与主体提取"
      icon={<Cpu size={15} />}
      iconGradient="linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
      status={data.status}
      statusText={data.statusText || (isActive ? "正在提取要素" : isCompleted ? "提取完成" : "等待处理")}
      hasTargetHandle={true}
      targetHandlePosition={Position.Left}
      targetHandleColor="#0958D9"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Bottom}
      sourceHandleColor="#7C3AED"
    >
      {/* 研判进度条 (纯净进度，不列出具体工单号) */}
      <div>
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 mb-1">
          <span className="text-slate-700 font-medium">工单要素提取进度</span>
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

      {/* 实时抽取结果微型面板 (专注地点空间与责任主体) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1.5 text-purple-700 font-semibold">
            <Sparkles size={11} className="shrink-0" />
            核心要素提取结果
          </span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-purple-600 bg-purple-50 px-1.5 py-0.2 rounded font-mono font-medium border border-purple-100">
              准确率 98%
            </span>
            {isCompleted && (
              <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-bold">
                <CheckCircle2 size={11} className="shrink-0" /> 已匹配标准库
              </span>
            )}
          </div>
        </div>

        <div className="space-y-1.5 text-[11px] mt-2">
          {/* 1. 微观空间实体 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <MapPin size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">发生地点：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentLocation || (data.total > 0 ? "要素提取中..." : "暂无提取数据")}
            </span>
          </div>

          {/* 2. 涉事责任主体 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <Building2 size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">责任主体：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentSubject || (data.total > 0 ? "责任主体研判中..." : "暂无数据")}
            </span>
          </div>

          {/* 3. 诉求事件定性 */}
          <div className="flex items-start gap-1.5 text-slate-600">
            <Tag size={12} className="text-purple-500 shrink-0 mt-0.5" />
            <span className="text-slate-400 shrink-0">问题类型：</span>
            <span className="font-medium text-slate-800 truncate">
              {data.currentEventType || (data.total > 0 ? "诉求类型定性中..." : "暂无数据")}
            </span>
          </div>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
