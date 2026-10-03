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

      {/* 诉求分类全量饼图分布 (统一图表系统，带实时鼠标悬浮联动) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1 text-slate-700 font-semibold">
            <PieChart size={11} className="shrink-0 text-blue-500" />
            民生诉求分类分布 (饼图总览)
          </span>
          <span className="text-[10px] text-slate-400 font-mono">
            {data.categoryStats.length} 类业务
          </span>
        </div>

        {/* 迷你环形饼图 (nodrag 保证图表内部 hover tooltip 与交互顺畅) */}
        {data.categoryStats.length > 0 ? (
          <div className="nodrag my-1 w-full flex justify-center">
            <CivicEChart option={donutOpt} height={125} />
          </div>
        ) : (
          <div className="py-4 text-center text-xs text-slate-400">暂无诉求分类数据</div>
        )}

        {/* 分类色标微型指标网格 (与数据总览及全局 Filter 颜色保持 100% 统一) */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-1 mt-1 pt-1.5 border-t border-slate-100 text-[10.5px]">
          {data.categoryStats.map((c, i) => {
            const color = categoryColor(c.category);
            const pct = Math.round((c.count / totalCat) * 100);
            return (
              <div key={i} className="flex items-center justify-between text-slate-600">
                <span className="flex items-center gap-1.5 truncate max-w-[85px]" title={c.category}>
                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
                  <span className="truncate font-medium text-slate-700">{c.category}</span>
                </span>
                <span className="font-mono text-[10px] text-slate-400 shrink-0">
                  {c.count}件 <span className="font-medium text-slate-600">{pct}%</span>
                </span>
              </div>
            );
          })}
        </div>

        {/* 属地镇街初筛选 (统一获取与着色，未知统一用"未知") */}
        <div className="mt-2.5 pt-2 border-t border-slate-200/70">
          <div className="flex items-center justify-between text-[10.5px] font-semibold text-slate-700 mb-1.5">
            <span className="flex items-center gap-1">
              <MapPin size={11} className="text-indigo-500 shrink-0" />
              属地镇街初筛选 (System-One)
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {townships.length} 镇街覆盖
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
