"use client";

import React, { useState } from "react";
import { Activity, Clock, ShieldAlert, Sparkles, ChevronRight } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { CockpitTicket } from "./cockpit-types";

interface CockpitStreamProps {
  tickets: CockpitTicket[];
  selectedTownship?: string | null;
}

export function CockpitStream({ tickets, selectedTownship }: CockpitStreamProps) {
  const [selectedTicket, setSelectedTicket] = useState<CockpitTicket | null>(null);

  const filtered = selectedTownship
    ? tickets.filter((t) => t.subdistrict?.includes(selectedTownship) || selectedTownship.includes(t.subdistrict || ""))
    : tickets;

  const displayList = filtered.slice(0, 15);

  return (
    <div className="cockpit-glass-card relative w-full h-full flex flex-col rounded-2xl p-4">
      <div className="cockpit-glass-header flex items-center justify-between pb-2.5 shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={15} className="text-[#4096ff] animate-pulse" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            实时工单接入流水
          </h3>
          {selectedTownship && (
            <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-950 border border-[#1677FF] text-blue-300">
              仅看 {selectedTownship}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[10px] font-mono text-[#4096ff]">
          <span className="w-1.5 h-1.5 rounded-full bg-[#1677FF] animate-ping" />
          <span>LIVE STREAM</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-2 pr-1 custom-cockpit-scrollbar">
        {displayList.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            等待新工单接入...
          </div>
        ) : (
          displayList.map((ticket) => {
            const timeFormatted = ticket.createTime
              ? ticket.createTime.length > 16
                ? ticket.createTime.slice(11, 16)
                : ticket.createTime
              : "刚刚";

            const townColor = ticket.subdistrict ? getTownshipColor(ticket.subdistrict) : "#1677FF";

            return (
              <div
                key={ticket.id}
                onClick={() => setSelectedTicket(ticket)}
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  ticket.isUrgent
                    ? "bg-rose-950/30 border-rose-500/40 hover:border-rose-400"
                    : "cockpit-glass-subcard hover:bg-[#0c285e]/50"
                }`}
              >
                <div className="flex items-center justify-between text-[11px] mb-1">
                  <div className="flex items-center gap-1.5 font-medium">
                    {ticket.subdistrict && (
                      <span
                        className="px-2 py-0.5 rounded-full text-white font-mono text-[10px] font-semibold shadow-xs"
                        style={{ backgroundColor: townColor }}
                      >
                        {ticket.subdistrict}
                      </span>
                    )}
                    {ticket.isUrgent ? (
                      <span className="px-1.5 py-0.5 rounded-full bg-rose-950/80 border border-rose-500/40 text-rose-300 font-mono text-[10px] flex items-center gap-0.5">
                        <ShieldAlert size={10} />
                        紧急突发
                      </span>
                    ) : (
                      <span className="text-slate-400 font-mono text-[10px]">
                        {ticket.ticketNo}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400 flex items-center gap-1">
                    <Clock size={10} />
                    {timeFormatted}
                  </span>
                </div>

                <p className="text-xs text-slate-200 line-clamp-1 leading-relaxed">
                  {ticket.title || ticket.content}
                </p>
              </div>
            );
          })
        )}
      </div>

      {selectedTicket && (
        <div className="absolute inset-0 bg-[#051433]/95 backdrop-blur-md p-4 flex flex-col justify-between z-30 animate-in fade-in zoom-in-95 duration-150">
          <div>
            <div className="flex items-center justify-between border-b border-[#1677FF]/20 pb-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="text-xs font-mono font-bold text-blue-300">
                  {selectedTicket.ticketNo}
                </span>
                {selectedTicket.isUrgent && (
                  <span className="px-2 py-0.5 rounded-full bg-rose-950 text-rose-300 text-[10px] border border-rose-500/30">
                    高危预警
                  </span>
                )}
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="text-xs text-slate-400 hover:text-white px-2 py-0.5 rounded bg-slate-800"
              >
                关闭
              </button>
            </div>
            <div className="space-y-2 text-xs text-slate-300">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">诉求地点：</span>
                <span className="text-blue-200 font-medium">
                  {selectedTicket.district || ""} {selectedTicket.subdistrict || "未归属"}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-slate-400">受理时间：</span>
                <span className="font-mono text-slate-300">{selectedTicket.createTime}</span>
              </div>
              <div className="pt-2">
                <span className="text-slate-400 block mb-1">市民诉求原貌：</span>
                <div className="p-2.5 rounded-xl bg-black/40 border border-[#1677FF]/25 text-slate-200 text-xs leading-relaxed max-h-36 overflow-y-auto">
                  {selectedTicket.content}
                </div>
              </div>
            </div>
          </div>
          <div className="pt-3 border-t border-[#1677FF]/20 flex justify-end">
            <button
              type="button"
              onClick={() => setSelectedTicket(null)}
              className="px-3 py-1.5 rounded-lg bg-[#1677FF]/30 border border-[#1677FF] text-blue-100 hover:bg-[#1677FF]/50 text-xs font-medium cursor-pointer"
            >
              已阅返回
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
