"use client";

import React, { useMemo } from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Zap, ShieldAlert, AlertTriangle, PieChart, MapPin } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";
import { CivicEChart, miniDonutOption } from "@/app/_components/civic/civic-charts";
import { categoryColor, getTownshipColor } from "@/lib/civic-cluster";

export type TriageNodeData = {
  urgentCount: number;
  stabilityRiskCount: number;
  categoryStats: Array<{ category: string; count: number }>;
  townshipStats?: Array<{ township: string; count: number }>;
  status: "idle" | "running" | "completed";
  classifiedCount?: number;
};

export type TriageNodeType = Node<TriageNodeData, "triage">;

const DEFAULT_TOWNSHIPS = [
  { township: "大良", count: 86 },
  { township: "容桂", count: 72 },
  { township: "北滘", count: 48 },
  { township: "伦教", count: 35 },
  { township: "陈村", count: 28 },
  { township: "乐从", count: 31 },
];

export function TriageNode({ data }: NodeProps<TriageNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed";
  const totalCat = data.categoryStats.reduce((sum, c) => sum + c.count, 0) || 1;
  const townships =
    data.townshipStats && data.townshipStats.length > 0 ? data.townshipStats : DEFAULT_TOWNSHIPS;

  // 与数据总览完全一致的环形饼图配置
  const donutOpt = useMemo(
    () => miniDonutOption(data.categoryStats || []),
    [data.categoryStats]
  );

  return (
    <PipelineNodeShell
      stepNumber="02"
      title="分类初筛与分流"
      icon={<Zap size={15} />}
      iconGradient="linear-gradient(135deg, #0958D9 0%, #003EB3 100%)"
      status={data.status}
      statusText={isActive ? "正在分流处理" : isCompleted ? "初筛完成" : "等待处理"}
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
              涉稳风险工单
            </span>
            {data.stabilityRiskCount > 0 && (
              <span className="text-[9px] px-1 rounded bg-red-200 text-red-800 font-bold animate-pulse">
                需重点关注
              </span>
            )}
          </div>
          <div className="text-lg font-bold font-mono text-red-900 mt-1">
            {data.stabilityRiskCount}
            <span className="text-[11px] font-normal text-slate-500 ml-1">件 (重点跟进)</span>
          </div>
        </div>

        <div className="bg-amber-50/70 border border-amber-100/80 rounded-lg p-2.5">
          <div className="text-[10px] text-amber-800 flex items-center justify-between font-medium">
            <span className="flex items-center gap-1">
              <AlertTriangle size={12} className="text-amber-500 shrink-0" />
              加急催办工单
            </span>
            <span className="text-[9px] px-1 rounded bg-amber-200/80 text-amber-800 font-bold">
              2小时内响应
            </span>
          </div>
          <div className="text-lg font-bold font-mono text-amber-900 mt-1">
            {data.urgentCount}
            <span className="text-[11px] font-normal text-slate-500 ml-1">件</span>
          </div>
        </div>
      </div>

      {/* 诉求分类全量饼图分布 (统一图表系统，带实时鼠标悬浮联动) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1 text-slate-700 font-semibold">
            <PieChart size={11} className="shrink-0 text-blue-500" />
            诉求业务分类分布
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            共 {data.categoryStats.length} 个分类
          </span>
        </div>

        {/* 迷你环形饼图与分类指标列表左右并排 (紧凑美观，留白适中) */}
        {data.categoryStats.length > 0 ? (
          <div className="flex items-center gap-2 mt-1">
            <div className="nodrag w-[105px] h-[95px] shrink-0 flex items-center justify-center">
              <CivicEChart option={donutOpt} height={95} />
            </div>
            <div className="flex-1 min-w-0 space-y-1 text-[10.5px]">
              {data.categoryStats.slice(0, 5).map((c, i) => {
                const color = categoryColor(c.category);
                const pct = Math.round((c.count / totalCat) * 100);
                return (
                  <div key={i} className="flex items-center justify-between text-slate-600">
                    <span className="flex items-center gap-1.5 truncate max-w-[90px]" title={c.category}>
                      <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                      <span className="truncate font-medium text-slate-700">{c.category}</span>
                    </span>
                    <span className="font-mono text-[10px] text-slate-400 shrink-0">
                      {c.count}件 <span className="font-semibold text-slate-600">{pct}%</span>
                    </span>
                  </div>
                );
              })}
              {data.categoryStats.length > 5 && (
                <div className="text-[9.5px] text-slate-400 font-mono text-right">
                  +{data.categoryStats.length - 5} 类更多诉求
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-slate-400">暂无诉求分类数据</div>
        )}

        {/* 所属镇街分布 */}
        <div className="mt-2.5 pt-2 border-t border-slate-200/70">
          <div className="flex items-center justify-between text-[10.5px] font-semibold text-slate-700 mb-1.5">
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-indigo-500 shrink-0" />
              所属镇街分布
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              覆盖 {townships.length} 个镇街
            </span>
          </div>
          <div className="flex flex-wrap gap-1">
            {townships.map((ts, i) => {
              const isUnknown = ts.township === "未知";
              const color = isUnknown ? "#86909C" : getTownshipColor(ts.township);
              return (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium transition-all"
                  style={{
                    backgroundColor: isUnknown ? "#F8FAFC" : `${color}0D`,
                    borderColor: isUnknown ? "#E2E8F0" : `${color}35`,
                    color: isUnknown ? "#64748B" : color,
                  }}
                >
                  <span
                    className="w-1.5 h-1.5 rounded-full shrink-0"
                    style={{ backgroundColor: isUnknown ? "#94A3B8" : color }}
                  />
                  <span className={isUnknown ? "text-slate-500 font-normal" : "text-slate-700 font-medium"}>
                    {ts.township}
                  </span>
                  <span
                    className="font-mono font-bold"
                    style={{ color: isUnknown ? "#64748B" : color }}
                  >
                    {ts.count}
                  </span>
                </span>
              );
            })}
          </div>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
