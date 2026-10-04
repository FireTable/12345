"use client";

import React from "react";
import { Flame, CheckCircle } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { CockpitAlertItem } from "./cockpit-types";

interface CockpitAlertPanelProps {
  alerts: CockpitAlertItem[];
  selectedTownship?: string | null;
}

export function CockpitAlertPanel({ alerts, selectedTownship }: CockpitAlertPanelProps) {
  const filtered = selectedTownship
    ? alerts.filter(
        (a) =>
          !a.subdistrict ||
          a.subdistrict.includes(selectedTownship) ||
          selectedTownship.includes(a.subdistrict)
      )
    : alerts;

  const displayList = filtered.slice(0, 3);

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-rose-500/35 bg-[#051433]/85 backdrop-blur-xl overflow-hidden p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)] relative">
      <div className="flex items-center justify-between pb-2 border-b border-rose-500/20 shrink-0">
        <div className="flex items-center gap-2">
          <Flame size={15} className="text-rose-400 animate-pulse" />
          <h3 className="text-xs font-semibold text-rose-200 tracking-wider">
            重大突发与应急险情预警
          </h3>
        </div>
        <span className="px-2 py-0.5 rounded-full bg-rose-950/80 border border-rose-500/40 text-[10px] font-mono text-rose-300">
          {displayList.length} 起在控
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2 space-y-2 pr-1 custom-cockpit-scrollbar">
        {displayList.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-emerald-400/80 font-mono gap-1.5">
            <CheckCircle size={14} />
            <span>辖区暂无重大突发险情预警</span>
          </div>
        ) : (
          displayList.map((alert) => {
            const townColor = alert.subdistrict ? getTownshipColor(alert.subdistrict) : "#f43f5e";
            return (
              <div
                key={alert.id}
                className="p-2.5 rounded-xl border border-rose-500/30 bg-rose-950/20 hover:bg-rose-950/30 transition-all"
              >
                <div className="flex items-center justify-between text-xs mb-1">
                  <div className="flex items-center gap-1.5">
                    <span className="px-1.5 py-0.2 rounded bg-rose-600/30 text-rose-300 font-bold text-[10px]">
                      {alert.category}
                    </span>
                    {alert.subdistrict && (
                      <span
                        className="text-[11px] font-medium px-1.5 py-0.2 rounded-full border border-white/20 text-white"
                        style={{ backgroundColor: `${townColor}33`, borderColor: townColor }}
                      >
                        @{alert.subdistrict}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono text-slate-400">{alert.createTime}</span>
                </div>
                <h4 className="text-xs font-medium text-slate-200 line-clamp-1">{alert.title}</h4>
                {alert.desc && (
                  <p className="text-[11px] text-slate-400 line-clamp-1 mt-0.5">{alert.desc}</p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
