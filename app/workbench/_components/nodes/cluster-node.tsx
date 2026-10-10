"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Network, FolderKanban, Compass, TrendingUp, Tag } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type ClusterNodeData = {
  themeCount: number;
  totalTickets: number;
  recentClusters?: Array<{
    id: string;
    title: string;
    ticketCount: number;
    category?: string;
    subdistrict?: string;
  }>;
  status: "idle" | "running" | "completed";
  stageText?: string;
  statusText?: string;
  /** 工序 04 先嵌再聚类。嵌入中时用已完成/应嵌。 */
  embedding?: boolean;
  embedCompleted?: number;
  embedEligible?: number;
};

export type ClusterNodeType = Node<ClusterNodeData, "cluster">;

export function ClusterNode({ data }: NodeProps<ClusterNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || data.themeCount > 0;
  const embedLabel =
    data.embedding && typeof data.embedCompleted === "number" && typeof data.embedEligible === "number"
      ? `嵌入中（${data.embedCompleted}/${data.embedEligible}）`
      : null;

  // 聚类压缩率计算 (如 300 件工单压缩为 9 个群组)
  const compressionRatio =
    data.totalTickets > 0 && data.themeCount > 0
      ? Math.round((1 - data.themeCount / data.totalTickets) * 100)
      : 0;

  return (
    <PipelineNodeShell
      stepNumber="04"
      title="同类问题聚合分析"
      icon={<Network size={15} />}
      iconGradient="linear-gradient(135deg, #06B6D4 0%, #0E7490 100%)"
      themeColor="#0E7490"
      status={data.status}
      statusText={embedLabel || data.statusText || (isActive ? "正在聚合归类" : isCompleted ? "聚合完成" : "等待分析")}
      hasTargetHandle={true}
      targetHandlePosition={Position.Top}
      targetHandleColor="#7C3AED"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Left}
      sourceHandleColor="#0E7490"
    >
      {/* 聚类成果指标看板 */}
      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
        <div>
          <div className="pipeline-metric-label flex items-center gap-1 whitespace-nowrap">
            <FolderKanban size={11} className="text-blue-600 shrink-0" />
            专题数
          </div>
          <div className="pipeline-metric-value text-blue-600 mt-1 whitespace-nowrap inline-flex items-baseline">
            {data.themeCount.toLocaleString()}{" "}
            <span className="text-xs font-normal text-slate-500 ml-1 whitespace-nowrap">个专题</span>
          </div>
        </div>
        <div>
          <div className="pipeline-metric-label flex items-center gap-1 whitespace-nowrap">
            <TrendingUp size={11} className="text-emerald-600 shrink-0" />
            工单归集率
          </div>
          <div className="pipeline-metric-value text-emerald-600 mt-1 whitespace-nowrap inline-flex items-baseline">
            {compressionRatio}%{" "}
            <span className="text-[11px] font-normal text-slate-400 font-mono ml-1.5 whitespace-nowrap">
              ({data.totalTickets.toLocaleString()} ➔ {data.themeCount.toLocaleString()} 组)
            </span>
          </div>
        </div>
      </div>

      {/* 最新生成的多频主题展示 */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1.5 text-cyan-800 whitespace-nowrap">
            <Compass size={11} className="shrink-0 text-cyan-600" />
            最新聚合问题专题
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-100 text-cyan-800 font-bold shrink-0 whitespace-nowrap">
            自动相似归集
          </span>
        </div>

        {data.recentClusters && data.recentClusters.length > 0 ? (
          <div className="mt-2 space-y-1.5">
            {data.recentClusters.slice(0, 2).map((c, i) => (
              <div
                key={i}
                className="py-1 px-1 -mx-1 rounded-md hover:bg-slate-50/70 transition-colors"
              >
                {/* 1. subdistrict 角标：单独一行小字 */}
                {c.subdistrict && (
                  <div className="text-[10px] text-slate-500 mb-0.5 truncate" title={c.subdistrict}>
                    📍 {c.subdistrict}
                  </div>
                )}
                {/* 2. 标题 + 工单数：标题占满剩余宽度 */}
                <div className="flex items-center gap-2 min-w-0">
                  <span className="font-semibold text-slate-800 text-[11.5px] truncate flex-1 min-w-0" title={c.title}>
                    {c.title}
                  </span>
                  <span className="font-mono text-[10px] text-blue-600 font-bold shrink-0 whitespace-nowrap">
                    {c.ticketCount.toLocaleString()} 件
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : data.themeCount > 0 ? (
          <div className="text-[11px] text-slate-400 mt-2">
            已归并 {data.themeCount.toLocaleString()} 个专题，处置建议写入后才会出现在这里。
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 mt-2">
            暂无聚合专题，工单要素提取完成后将自动合并归类。
          </div>
        )}
      </div>
    </PipelineNodeShell>
  );
}
