"use client";

/**
 * 大屏右下卡片：研判节点实时节拍
 *
 * 数据：来自 /api/workbench/pipeline-state 的 taskProgress.endpointRecentTickets
 * （SystemTwoEngine 进程内每个 endpoint 最近处理的工单，max 8 条/endpoint）。
 */
import React from "react";
import { Cpu, MapPin, Tag, Building2 } from "lucide-react";
import type { DomainProfile } from "../civic/region-context";

export interface CockpitEndpointNode {
  id: string;
  name: string;
  host?: string;
  isLocal?: boolean;
  isOnline?: boolean;
  lastDurationMs?: number | null;
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
  domainProfile?: DomainProfile | null;
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
  domainProfile,
}: CockpitNodePulseProps) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

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
    <div className="cockpit-glass-card cockpit-glass-card--purple w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Cpu size={14} aria-hidden="true" className="text-violet-400 shrink-0" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            研判节点实时节拍
          </h3>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-md bg-violet-500/12 border border-violet-400/25 text-violet-200 whitespace-nowrap shrink-0">
          SYSTEM-2 调度
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-2 pr-1 custom-cockpit-scrollbar min-w-0">
        {displayNodes.map((node) => {
          const tickets = matchTickets(endpointRecentTickets, node.host).slice(0, 2);
          const isOnline = node.isOnline !== false;

          return (
            <div
              key={node.id}
              className={`p-2.5 rounded-xl border border-white/[0.08] bg-white/[0.03] transition-colors min-w-0 ${
                !isOnline ? "opacity-55" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-2 mb-1.5 min-w-0">
                <div className="flex items-center gap-1.5 min-w-0 flex-1">
                  <span className="text-[11px] font-semibold text-slate-100 cockpit-single-line">
                    {node.name}
                  </span>
                  {isOnline &&
                    node.lastDurationMs != null &&
                    node.lastDurationMs > 0 && (
                      <span className="text-[10px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-violet-500/15 border border-violet-400/25 text-violet-200 whitespace-nowrap shrink-0">
                        {(node.lastDurationMs / 1000).toFixed(2)}s
                      </span>
                    )}
                </div>
                <span className="text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                  {tickets.length > 0
                    ? isEcommerce
                      ? `${tickets.length} 条新客诉`
                      : `${tickets.length} 条新工单`
                    : "等待流入"}
                </span>
              </div>

              {!isOnline ? (
                <div className="py-1 text-[11px] text-slate-400">节点离线</div>
              ) : tickets.length === 0 ? (
                <div className="py-1 text-[11px] text-slate-400 font-mono">
                  {isEcommerce
                    ? "暂无客诉流入，节点在监听队列..."
                    : "暂无工单流入，节点在监听队列..."}
                </div>
              ) : (
                <div className="space-y-1.5 min-w-0">
                  {tickets.map((t, idx) => (
                    <div
                      key={`${t.id ?? t.ticketNo ?? idx}`}
                      className="text-[11px] space-y-0.5 px-2 py-1.5 rounded-lg bg-white/[0.03] border border-white/[0.06] min-w-0"
                    >
                      {t.ticketNo && (
                        <div className="font-mono tabular-nums text-[10px] text-violet-300/85 truncate">
                          {t.ticketNo}
                        </div>
                      )}
                      <div className="flex items-center gap-1.5 text-slate-300 min-w-0">
                        <MapPin size={10} aria-hidden="true" className="text-violet-400 shrink-0" />
                        <span
                          className="cockpit-single-line"
                          title={t.address ?? undefined}
                        >
                          {safeDisplay(
                            t.address,
                            isEcommerce ? "渠道/仓网未识别" : "地址未识别"
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300 min-w-0">
                        <Building2 size={10} aria-hidden="true" className="text-violet-400 shrink-0" />
                        <span
                          className="cockpit-single-line"
                          title={t.canonicalSubject ?? undefined}
                        >
                          {safeDisplay(
                            t.canonicalSubject,
                            isEcommerce ? "SKU/店铺待定" : "主体待定"
                          )}
                        </span>
                      </div>
                      <div className="flex items-center gap-1.5 text-slate-300 min-w-0">
                        <Tag size={10} aria-hidden="true" className="text-violet-400 shrink-0" />
                        <span
                          className="cockpit-single-line"
                          title={t.eventType ?? undefined}
                        >
                          {safeDisplay(
                            t.eventType,
                            isEcommerce ? "客诉类型待定" : "事件待定"
                          )}
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
