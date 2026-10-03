"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Zap, ShieldAlert, AlertTriangle, Layers } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type TriageNodeData = {
  urgentCount: number;
  stabilityRiskCount: number;
  categoryStats: Array<{ category: string; count: number }>;
  status: "idle" | "running" | "completed";
  classifiedCount?: number;
};

export type TriageNodeType = Node<TriageNodeData, "triage">;

export function TriageNode({ data }: NodeProps<TriageNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed";
  const totalCat = data.categoryStats.reduce((sum, c) => sum + c.count, 0) || 1;

  return (
    <PipelineNodeShell
      stepNumber="02"
      title="要素初筛与涉稳分流站"
      icon={<Zap size={15} />}
      iconGradient="linear-gradient(135deg, #0958D9 0%, #003EB3 100%)"
      status={data.status}
      statusText={isActive ? "毫秒级定性中" : isCompleted ? "定性完成" : "待命中"}
      hasTargetHandle={true}
      targetHandlePosition={Position.Left}
      targetHandleColor="#1677FF"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Bottom}
      sourceHandleColor="#0958D9"
    >
      {/* 涉稳与急件看板 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-red-50/70 border border-red-100/80 rounded-lg p-2.5">
          <div className="text-[10px] text-red-700 flex items-center justify-between font-medium">
            <span className="flex items-center gap-1">
              <ShieldAlert size={12} className="text-red-500 shrink-0" />
              涉稳隐患排查
            </span>
            {data.stabilityRiskCount > 0 && (
              <span className="text-[9px] px-1 rounded bg-red-200 text-red-800 font-bold animate-pulse">
                重点监控
              </span>
            )}
          </div>
          <div className="text-lg font-bold font-mono text-red-900 mt-1">
            {data.stabilityRiskCount}
            <span className="text-[11px] font-normal text-slate-500 ml-1">件 (自动安保报送)</span>
          </div>
        </div>

        <div className="bg-amber-50/70 border border-amber-100/80 rounded-lg p-2.5">
          <div className="text-[10px] text-amber-800 flex items-center justify-between font-medium">
            <span className="flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-500 shrink-0" />
              特急诉求催办
            </span>
            <span className="text-[9px] px-1 rounded bg-amber-200/80 text-amber-800 font-bold">
              2h 催办响应
            </span>
          </div>
          <div className="text-lg font-bold font-mono text-amber-900 mt-1">
            {data.urgentCount}
            <span className="text-[11px] font-normal text-slate-500 ml-1">件</span>
          </div>
        </div>
      </div>

      {/* 诉求分类条形分布 */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1 text-slate-700">
            <Layers size={11} className="shrink-0 text-blue-500" />
            民生诉求分类分布
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {data.categoryStats.length} 类业务
          </span>
        </div>

        <div className="space-y-1.5 mt-2">
          {data.categoryStats.slice(0, 4).map((c, i) => {
            const pct = Math.round((c.count / totalCat) * 100);
            return (
              <div key={i} className="text-[11px]">
                <div className="flex justify-between text-slate-600 mb-0.5">
                  <span className="font-medium text-slate-700 truncate max-w-[170px]">{c.category}</span>
                  <span className="font-mono text-[10px] text-slate-400">
                    {c.count}件 ({pct}%)
                  </span>
                </div>
                <div className="w-full h-1 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${pct}%`,
                      background: i === 0 ? "#1677FF" : i === 1 ? "#52C41A" : i === 2 ? "#FA8C16" : "#722ED1",
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </PipelineNodeShell>
  );
}
