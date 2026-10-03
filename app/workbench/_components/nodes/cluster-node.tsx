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
};

export type ClusterNodeType = Node<ClusterNodeData, "cluster">;

export function ClusterNode({ data }: NodeProps<ClusterNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || data.themeCount > 0;

  // 聚类压缩率计算 (如 300 件工单压缩为 9 个群组)
  const compressionRatio =
    data.totalTickets > 0 && data.themeCount > 0
      ? Math.round((1 - data.themeCount / data.totalTickets) * 100)
      : 0;

  return (
    <PipelineNodeShell
      stepNumber="04"
      title="同类事件与网格聚类"
      icon={<Network size={15} />}
      iconGradient="linear-gradient(135deg, #2563EB 0%, #0891B2 100%)"
      status={data.status}
      statusText={isActive ? "时空吸附中" : isCompleted ? "聚类成组" : "待命中"}
      hasTargetHandle={true}
      targetHandlePosition={Position.Left}
      targetHandleColor="#7C3AED"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Bottom}
      sourceHandleColor="#0891B2"
    >
      {/* 聚类成果指标看板 */}
      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
        <div>
          <div className="pipeline-metric-label flex items-center gap-1">
            <FolderKanban size={11} className="text-blue-600 shrink-0" />
            已归集多频群组
          </div>
          <div className="pipeline-metric-value text-blue-600 mt-1">
            {data.themeCount} <span className="text-xs font-normal text-slate-500">组专题</span>
          </div>
        </div>
        <div>
          <div className="pipeline-metric-label flex items-center gap-1">
            <TrendingUp size={11} className="text-emerald-600 shrink-0" />
            时空矛盾收敛率
          </div>
          <div className="pipeline-metric-value text-emerald-600 mt-1">
            {compressionRatio}% <span className="text-xs font-normal text-slate-400">({data.totalTickets} ➔ {data.themeCount})</span>
          </div>
        </div>
      </div>

      {/* 最新生成的多频主题展示 (520px 下宽裕平铺) */}
      <div className="pipeline-snippet-box">
        <div className="pipeline-snippet-title">
          <span className="flex items-center gap-1.5 text-cyan-800">
            <Compass size={11} className="shrink-0 text-cyan-600" />
            最新聚合民生矛盾专题
          </span>
          <span className="text-[9px] px-1.5 py-0.2 rounded bg-cyan-100 text-cyan-800 font-bold">
            多维时空拓扑绑定
          </span>
        </div>

        {data.recentClusters && data.recentClusters.length > 0 ? (
          <div className="space-y-1.5 mt-2">
            {data.recentClusters.slice(0, 2).map((c, i) => (
              <div key={i} className="flex items-center justify-between text-[11px] py-1 border-b border-slate-100 last:border-0">
                <div className="flex items-center gap-1.5 min-w-0 pr-2">
                  {c.subdistrict && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600 shrink-0 font-medium">
                      {c.subdistrict}
                    </span>
                  )}
                  <span className="font-semibold text-slate-800 truncate max-w-[170px]">
                    {c.title}
                  </span>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-bold">
                    {c.ticketCount} 件聚合
                  </span>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-[11px] text-slate-400 mt-2">
            暂未聚合成组，待工单抽取完毕后自动交叉合并。
          </div>
        )}
      </div>
    </PipelineNodeShell>
  );
}
