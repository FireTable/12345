"use client";

/**
 * 大屏右下卡片：研判节点实时节拍
 *
 * 替代之前的「AI 慢思考共性诉求穿透研判」（名字怪、insights 字段基本为空）。
 *
 * 数据：来自 /api/workbench/pipeline-state 的 taskProgress.endpointRecentTickets
 * （SystemTwoEngine 进程内每个 endpoint 最近处理的工单，max 8 条/endpoint）。
 * SSE 推送 task-progress 时携带 metrics + taskProgress（含 endpointRecentTickets），
 * cockpit 监听 civic-data-refresh / pipeline-state-refresh 触发 refetch。
 *
 * 设计：
 * - 按 systemTwoNodes 顺序展示每个 endpoint 子卡片
 * - 找不到 endpoint 命中时显示「等待工单流入」
 * - 最多取最近 2 条工单展示，避免占满视区
 */
import React from "react";
import { Cpu, MapPin, Tag, Building2 } from "lucide-react";

export interface CockpitEndpointNode {
  id: string;
  name: string;
  host?: string;
  isOnline?: boolean;
}

export interface CockpitEndpointTicket {
  id?: string;
  ticketNo?: string;
  address?: string | null;
  canonicalSubject?: string | null;
  eventType?: string | null;
  durationMs?: number;
  processedAt?: number;
}

interface CockpitNodePulseProps {
  nodes: CockpitEndpointNode[];
  endpointRecentTickets?: Record<string, CockpitEndpointTicket[]>;
}

const normalizeEndpoint = (s: string) =>
  s.replace(/^https?:\/\//i, "").replace(/\/v1\/?$/, "").toLowerCase();

function safeDisplay(
  value: string | null | undefined,
  fallback: string
): string {
  if (value === null || value === undefined) return fallback;
  const text = String(value).trim();
  if (!text || text === "null" || text === "未指定") return fallback;
  return text;
}

function matchTickets(
  endpointRecentTickets: Record<string, CockpitEndpointTicket[]> | undefined,
  host: string | undefined
): CockpitEndpointTicket[] {
  if (!endpointRecentTickets || !host) return [];
  const targetNorm = normalizeEndpoint(host);
  return (
    endpointRecentTickets[host] ||
    Object.entries(endpointRecentTickets).find(
      ([k]) => normalizeEndpoint(k) === targetNorm
    )?.[1] ||
    []
  );
}

export function CockpitNodePulse({
  nodes,
  endpointRecentTickets,
}: CockpitNodePulseProps) {
  const displayNodes =
    nodes && nodes.length > 0
      ? nodes
      : [
          {
            id: "node-default",
            name: "研判节点",
            host: "127.0.0.1:8132",
            isOnline: true,
          },
        ];

  return (
    <div className="cockpit-glass-card cockpit-glass-card--purple w-full h-full flex flex-col rounded-2xl p-4">
      <div className="cockpit-glass-header flex items-center justify-between pb-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Cpu size={15} className="text-purple-400 animate-pulse" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            研判节点实时节拍
          </h3>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-500/40 text-purple-300">
          SYSTEM-2 调度
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-2 pr-1 custom-cockpit-scrollbar">
        {displayNodes.map((node) => {
          const tickets = matchTickets(endpointRecentTickets, node.host).slice(0, 2);
          const isOnline = node.isOnline !== false;

          return (
            <div
              key={node.id}
              className={`p-2.5 rounded-xl border border-purple-500/20 bg-purple-950/20 transition-all ${
                !isOnline ? "opacity-50" : ""
              }`}
            >
              <div className="flex items-center justify-between mb-1.5">
                <div className="flex items-center gap-1.5">
                  <span className="text-[11px] font-semibold text-purple-300">
                    {node.name}
                  </span>
                  {isOnline && (
                    <span className="w-1.5 h-1.5 rounded-full bg-purple-400 animate-pulse" />
                  )}
                </div>
                <span className="text-[10px] font-mono text-slate-500">
                  {tickets.length > 0 ? `${tickets.length} 条新工单` : "等待流入"}
                </span>
              </div>

              {!isOnline ? (
                <div className="py-1 text-[11px] text-slate-400 italic">节点离线</div>
              ) : tickets.length === 0 ? (
                <div className="py-1 text-[11px] text-slate-500 font-mono">
                  暂无工单流入，节点在监听队列...
                </div>
              ) : (
                <div className="space-y-1.5">
                  {tickets.map((t, idx) => (
                    <div
                      key={`${t.id ?? t.ticketNo ?? idx}`}
                      className="text-[11px] space-y-0.5 px-2 py-1.5 rounded-lg bg-black/30 border border-purple-500/10"
                    >
                      {t.ticketNo && (
                        <div className="font-mono text-[10px] text-purple-300/70 truncate">
                          {t.ticketNo}
                        </div>
                      )}
                      <div className="flex items-start gap-1 text-slate-300">
                        <MapPin size={10} className="text-purple-400 shrink-0 mt-0.5" />
                        <span className="truncate" title={t.address ?? undefined}>
                          {safeDisplay(t.address, "地址未识别")}
                        </span>
                      </div>
                      <div className="flex items-start gap-1 text-slate-300">
                        <Building2 size={10} className="text-purple-400 shrink-0 mt-0.5" />
                        <span className="truncate" title={t.canonicalSubject ?? undefined}>
                          {safeDisplay(t.canonicalSubject, "主体待定")}
                        </span>
                      </div>
                      <div className="flex items-start gap-1 text-slate-300">
                        <Tag size={10} className="text-purple-400 shrink-0 mt-0.5" />
                        <span className="truncate" title={t.eventType ?? undefined}>
                          {safeDisplay(t.eventType, "事件待定")}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
