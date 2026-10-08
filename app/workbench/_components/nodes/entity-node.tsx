"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Cpu, MapPin, Building2, Sparkles, CheckCircle2, Tag, Server, Clock } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

/** 兜底展示值：null / undefined / 空串 / 字符串 "null" / "undefined" / "无" / "未知" / "未指定" 一律收敛成 fallback。 */
function safeDisplay(
  value: string | number | null | undefined,
  fallback: string
): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (
    !text ||
    text === "null" ||
    text === "undefined" ||
    text === "无" ||
    text === "未知" ||
    text === "未指定"
  ) {
    return fallback;
  }
  return text;
}

export type ProcessedTicketPreview = {
  id?: string;
  ticketNo?: string;
  address?: string;
  canonicalSubject?: string;
  eventType?: string;
};

export type ClusterNodeDisplay = {
  id: string;
  name: string; // e.g. "研判节点一", "研判节点二"
  host?: string; // e.g. "127.0.0.1:8132"
  isLocal?: boolean;
  isOnline?: boolean;
  lastDurationMs?: number | null;
  recentTickets: ProcessedTicketPreview[];
};

export type EntityNodeData = {
  processed: number;
  total: number;
  extractedCount: number;
  status: "idle" | "running" | "completed";
  statusText?: string;
  percent: number;
  nodes?: ClusterNodeDisplay[];
  currentLocation?: string;
  currentSubject?: string;
  currentEventType?: string;
};

export type EntityNodeType = Node<EntityNodeData, "entity">;

export function EntityNode({ data }: NodeProps<EntityNodeType>) {
  const isActive = data.status === "running";
  const isCompleted = data.status === "completed" || (data.total > 0 && data.processed >= data.total);

  // 若父组件传入了集群节点列表，则按集群节点渲染多卡片；否则兜底单节点卡片
  const displayNodes: ClusterNodeDisplay[] =
    data.nodes && data.nodes.length > 0
      ? data.nodes
      : [
        {
          id: "node-1",
          name: "研判节点一",
          host: "127.0.0.1:8132",
          isLocal: true,
          recentTickets: [
            {
              address: data.currentLocation,
              canonicalSubject: data.currentSubject,
              eventType: data.currentEventType,
            },
          ].filter((t) => t.address || t.canonicalSubject || t.eventType),
        },
      ];

  return (
    <PipelineNodeShell
      stepNumber="03"
      title="地点与主体提取"
      icon={<Cpu size={15} />}
      iconGradient="linear-gradient(135deg, #7C3AED 0%, #6D28D9 100%)"
      themeColor="#7C3AED"
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
        <div className="flex items-center justify-between text-[11px] font-medium text-slate-600 mb-1 gap-2">
          <span className="text-slate-700 font-medium whitespace-nowrap">工单要素提取进度</span>
          <span className="font-mono text-slate-800 font-bold whitespace-nowrap">
            {data.processed.toLocaleString()} / {data.total.toLocaleString()} ({data.percent}%)
          </span>
        </div>
        <div className="w-full h-2 bg-slate-100 rounded-full overflow-hidden">
          <div
            className="h-full bg-linear-to-r from-purple-500 via-indigo-500 to-blue-600 rounded-full transition-all duration-500"
            style={{ width: `${Math.min(100, Math.max(0, data.percent))}%` }}
          />
        </div>
      </div>

      {/* 集群研判节点列表 (支持多个 SYSTEM_TWO_ENDPOINTS 分别展示独立卡片与最新研判工单) */}
      <div className="space-y-2.5">
        {displayNodes.map((node) => {
          const ticket = node.recentTickets?.[0];
          const isNodeOnline = node.isOnline !== false;

          return (
            <div
              key={node.id}
              className={`pipeline-snippet-box transition-all duration-300 ${!isNodeOnline
                ? "opacity-60 bg-slate-50/80 border-dashed border-slate-300 select-none"
                : ""
                }`}
            >
              {/* 卡片头部：研判节点名称 + 最新工单耗时 + 实时指示 (不展示 IP 地址) */}
              <div className="pipeline-snippet-title">
                <span className={`flex items-center gap-1.5 font-semibold whitespace-nowrap ${isNodeOnline ? "text-purple-700" : "text-slate-500"
                  }`}>
                  <Sparkles size={11} className={`shrink-0 ${isNodeOnline ? "text-purple-500" : "text-slate-400"}`} />
                  {node.name}
                  {isNodeOnline && node.lastDurationMs != null && node.lastDurationMs > 0 && (
                    <span className="ml-1 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono font-medium bg-purple-50 text-purple-700 border border-purple-200/70 shadow-2xs">
                      <Clock size={10} className="shrink-0 text-purple-500" />
                      {`${(node.lastDurationMs / 1000).toFixed(2)}s`}
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {!isNodeOnline ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-500 bg-slate-200/70 px-1.5 py-0.5 rounded font-medium border border-slate-300">
                      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
                      无法连接
                    </span>
                  ) : isActive ? (
                    <span className="inline-flex items-center gap-1 text-[10px] text-purple-700 bg-purple-100/80 px-1.5 py-0.5 rounded font-medium border border-purple-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse" />
                      实时研判
                    </span>
                  ) : isCompleted ? (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-bold whitespace-nowrap">
                      <CheckCircle2 size={11} className="shrink-0" /> 已就绪
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded font-medium border border-slate-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" /> 在线就绪
                    </span>
                  )}
                </div>
              </div>

              {/* 当节点无法连接时展示离线说明；在线时展示最新工单 */}
              {!isNodeOnline ? (
                <div className="py-2 px-1 text-[11px] text-slate-400 italic flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-slate-300 shrink-0" />
                  算力节点离线，请检查服务端口或网络状态
                </div>
              ) : ticket ? (
                <div className="space-y-1.5 text-[11px] mt-2 transition-all duration-300">
                  {/* 1. 微观空间实体 */}
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <MapPin size={12} className="text-purple-500 shrink-0 mt-0.5" />
                    <span className="text-slate-400 shrink-0">发生地点：</span>
                    <span className="font-medium text-slate-800 truncate" title={ticket.address || undefined}>
                      {safeDisplay(ticket.address, "未知")}
                    </span>
                  </div>

                  {/* 2. 涉事责任主体 */}
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <Building2 size={12} className="text-purple-500 shrink-0 mt-0.5" />
                    <span className="text-slate-400 shrink-0">责任主体：</span>
                    <span className="font-medium text-slate-800 truncate" title={ticket.canonicalSubject || undefined}>
                      {safeDisplay(ticket.canonicalSubject, "未知")}
                    </span>
                  </div>

                  {/* 3. 诉求事件定性 */}
                  <div className="flex items-start gap-1.5 text-slate-600">
                    <Tag size={12} className="text-purple-500 shrink-0 mt-0.5" />
                    <span className="text-slate-400 shrink-0">问题类型：</span>
                    <span className="font-medium text-slate-800 truncate" title={ticket.eventType || undefined}>
                      {safeDisplay(ticket.eventType, "未知")}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="py-2 text-center text-[11px] text-slate-400">
                  等待分配工单研判...
                </div>
              )}
            </div>
          );
        })}
      </div>
    </PipelineNodeShell>
  );
}
