"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Zap, ShieldAlert, AlertTriangle, Layers, MapPin } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type TriageNodeData = {
  urgentCount: number;
  stabilityRiskCount: number;
  categoryStats: Array<{ category: string; count: number }>;
  townshipStats?: Array<{ township: string; count: number }>;
  status: "idle" | "running" | "completed";
  classifiedCount?: number;
};

export type TriageNodeType = Node<TriageNodeData, "triage">;

const CATEGORY_COLORS = [
  "#1677FF",
  "#52C41A",
  "#FA8C16",
  "#722ED1",
  "#13C2C2",
  "#EB2F96",
  "#FAAD14",
  "#2F54EB",
];

const DEFAULT_TOWNSHIPS = [
  { township: "大良街道", count: 86 },
  { township: "容桂街道", count: 72 },
  { township: "北滘镇", count: 48 },
  { township: "伦教街道", count: 35 },
  { township: "陈村镇", count: 28 },
  { township: "乐从镇", count: 31 },
];

export function TriageNode({ data }: NodeProps<TriageNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed";
  const totalCat = data.categoryStats.reduce((sum, c) => sum + c.count, 0) || 1;
  const townships = data.townshipStats && data.townshipStats.length > 0 ? data.townshipStats : DEFAULT_TOWNSHIPS;

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
      sourceHandlePosition={Position.Right}
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

      {/* 诉求分类全量条形分布 (全量显示全部业务分类) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1 text-slate-700 font-semibold">
            <Layers size={11} className="shrink-0 text-blue-500" />
            民生诉求分类分布 (全量呈现)
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {data.categoryStats.length} 类业务全览
          </span>
        </div>

        <div className="space-y-1.5 mt-2">
          {data.categoryStats.map((c, i) => {
            const pct = Math.round((c.count / totalCat) * 100);
            const color = CATEGORY_COLORS[i % CATEGORY_COLORS.length];
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
                      background: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>

        {/* 属地镇街流向分布 (System-One 镇街全量分流) */}
        <div className="mt-2.5 pt-2 border-t border-slate-200/70">
          <div className="flex items-center justify-between text-[10.5px] font-semibold text-slate-700 mb-1.5">
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-indigo-500 shrink-0" />
              属地镇街初筛流向 (System-One)
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {townships.length} 镇街覆盖
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {townships.map((ts, i) => (
              <span
                key={i}
                className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-700 border border-slate-200/60 font-medium"
              >
                <span>{ts.township}</span>
                <span className="font-mono text-indigo-600 font-bold">{ts.count}</span>
              </span>
            ))}
          </div>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
