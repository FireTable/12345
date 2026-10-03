"use client";

import React, { useMemo, useState } from "react";
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
  const [hoveredCategory, setHoveredCategory] = useState<string | null>(null);
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
        <div className="bg-red-50/70 border border-red-100/80 rounded-lg p-2.5 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-red-700 whitespace-nowrap">
            <ShieldAlert size={12} className="text-red-500 shrink-0" />
            <span>涉稳风险工单</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold font-mono text-red-900 leading-none">
              {data.stabilityRiskCount}
              <span className="text-[11px] font-normal text-slate-500 ml-1">件</span>
            </div>
            {data.stabilityRiskCount > 0 ? (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-200 text-red-800 font-bold whitespace-nowrap animate-pulse">
                重点跟进
              </span>
            ) : (
              <span className="text-[9px] px-1.5 py-0.5 rounded bg-red-100/80 text-red-600 font-medium whitespace-nowrap">
                平稳正常
              </span>
            )}
          </div>
        </div>

        <div className="bg-amber-50/70 border border-amber-100/80 rounded-lg p-2.5 flex flex-col justify-between">
          <div className="flex items-center gap-1 text-[11px] font-semibold text-amber-800 whitespace-nowrap">
            <AlertTriangle size={12} className="text-amber-500 shrink-0" />
            <span>加急催办工单</span>
          </div>
          <div className="mt-1.5 flex items-baseline justify-between">
            <div className="text-lg font-bold font-mono text-amber-900 leading-none">
              {data.urgentCount}
              <span className="text-[11px] font-normal text-slate-500 ml-1">件</span>
            </div>
            <span className="text-[9px] px-1.5 py-0.5 rounded bg-amber-200/90 text-amber-900 font-semibold whitespace-nowrap">
              2小时响应
            </span>
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

        {/* 迷你环形饼图与全量分类指标列表左右并排 (更大环形图，支持双向分类聚焦) */}
        {data.categoryStats.length > 0 ? (
          <div className="flex items-center gap-2 mt-1">
            <div className="nodrag w-[130px] h-[134px] shrink-0">
              <CivicEChart
                option={donutOpt}
                height={134}
                onHover={setHoveredCategory}
                hoveredName={hoveredCategory}
              />
            </div>
            <div className="flex-1 min-w-0 space-y-0.5">
              {data.categoryStats.map((c, i) => {
                const color = categoryColor(c.category);
                const pct = Math.round((c.count / totalCat) * 100);
                const isHovered = hoveredCategory === c.category;
                const isAnyHovered = Boolean(hoveredCategory);
                return (
                  <div
                    key={i}
                    onMouseEnter={() => setHoveredCategory(c.category)}
                    onMouseLeave={() => setHoveredCategory(null)}
                    style={
                      isHovered
                        ? {
                            backgroundColor: `${color}14`,
                            boxShadow: `0 0 0 1px ${color}50, 0 1px 4px ${color}20`,
                          }
                        : undefined
                    }
                    className={`flex items-center justify-between leading-tight py-[2.5px] px-1.5 -mx-1 rounded transition-all duration-150 cursor-pointer ${
                      isHovered
                        ? "font-semibold shadow-2xs"
                        : isAnyHovered
                        ? "text-slate-400 opacity-40"
                        : "text-slate-600 hover:bg-slate-50/80"
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate max-w-[85px]" title={c.category}>
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 transition-transform ${
                          isHovered ? "scale-125" : ""
                        }`}
                        style={{
                          backgroundColor: color,
                          boxShadow: isHovered ? `0 0 6px ${color}` : undefined,
                        }}
                      />
                      <span
                        className={`truncate text-[10px] whitespace-nowrap transition-colors ${
                          isHovered ? "font-bold" : "font-medium text-slate-700"
                        }`}
                        style={isHovered ? { color } : undefined}
                      >
                        {c.category}
                      </span>
                    </span>
                    <span
                      className={`font-mono text-[9.5px] shrink-0 whitespace-nowrap ${
                        isHovered ? "font-bold" : "text-slate-400"
                      }`}
                      style={isHovered ? { color } : undefined}
                    >
                      {c.count}件{" "}
                      <span
                        className={isHovered ? "font-bold" : "font-semibold text-slate-600"}
                        style={isHovered ? { color } : undefined}
                      >
                        {pct}%
                      </span>
                    </span>
                  </div>
                );
              })}
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
