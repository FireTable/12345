"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Cpu, MapPin, Building2, Sparkles, CheckCircle2, Tag, Server } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

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

      {/* 集群研判节点列表 (支持多个 SYSTEM_TWO_ENDPOINTS 分别展示独立卡片与各自近两条工单) */}
      <div className="space-y-2.5">
        {displayNodes.map((node) => {
          const tickets = (node.recentTickets || []).slice(0, 2);

          return (
            <div key={node.id} className="pipeline-snippet-box">
              {/* 卡片头部：研判节点名称 + 端口标识 + 实时指示 */}
              <div className="pipeline-snippet-title">
                <span className="flex items-center gap-1.5 text-purple-700 font-semibold whitespace-nowrap">
                  <Sparkles size={11} className="shrink-0" />
                  {node.name}
                  {node.host && (
                    <span className="text-[10px] text-slate-400 font-mono font-normal ml-0.5">
                      ({node.host})
                    </span>
                  )}
                </span>
                <div className="flex items-center gap-2 shrink-0">
                  {isActive && (
                    <span className="inline-flex items-center gap-1 text-[10px] text-purple-700 bg-purple-100/80 px-1.5 py-0.5 rounded font-medium border border-purple-200">
                      <span className="w-1.5 h-1.5 rounded-full bg-purple-600 animate-pulse" />
                      实时研判中
                    </span>
                  )}
                  {isCompleted && (
                    <span className="flex items-center gap-0.5 text-[10px] text-emerald-600 font-bold whitespace-nowrap">
                      <CheckCircle2 size={11} className="shrink-0" /> 已就绪
                    </span>
                  )}
                </div>
              </div>

              {/* 实时处理好的近两条工单展示 */}
              <div className="space-y-2 mt-2">
                {tickets.length > 0 ? (
                  tickets.map((t, tIdx) => (
                    <div
                      key={t.id || t.ticketNo || `item-${tIdx}`}
                      className="p-2 rounded bg-slate-50/90 border border-slate-100/80 space-y-1 transition-all duration-300"
                    >
                      <div className="flex items-center justify-between text-[10px] font-medium">
                        <span className="flex items-center gap-1 text-purple-600">
                          <span
                            className={`w-1.5 h-1.5 rounded-full ${
                              tIdx === 0 ? "bg-purple-600 animate-pulse" : "bg-slate-400"
                            }`}
                          />
                          {tIdx === 0 ? "最新研判工单" : "前序研判工单"}
                        </span>
                        {t.ticketNo && (
                          <span className="font-mono text-slate-400 text-[10px]">{t.ticketNo}</span>
                        )}
                      </div>

                      {/* 1. 微观空间实体 */}
                      <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                        <MapPin size={11} className="text-purple-500 shrink-0 mt-0.5" />
                        <span className="text-slate-400 shrink-0">发生地点：</span>
                        <span className="font-medium text-slate-800 truncate" title={t.address}>
                          {t.address || "未指定地点"}
                        </span>
                      </div>

                      {/* 2. 涉事责任主体 */}
                      <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                        <Building2 size={11} className="text-purple-500 shrink-0 mt-0.5" />
                        <span className="text-slate-400 shrink-0">责任主体：</span>
                        <span className="font-medium text-slate-800 truncate" title={t.canonicalSubject}>
                          {t.canonicalSubject || "正在研判主体..."}
                        </span>
                      </div>

                      {/* 3. 诉求事件定性 */}
                      <div className="flex items-start gap-1.5 text-[11px] text-slate-600">
                        <Tag size={11} className="text-purple-500 shrink-0 mt-0.5" />
                        <span className="text-slate-400 shrink-0">问题类型：</span>
                        <span className="font-medium text-slate-800 truncate" title={t.eventType}>
                          {t.eventType || "待定性诉求"}
                        </span>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="p-3 text-center text-[11px] text-slate-400 bg-slate-50 rounded border border-dashed border-slate-200">
                    等待分配工单研判...
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </PipelineNodeShell>
  );
}
