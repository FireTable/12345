"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { CockpitTownshipStat } from "./cockpit-types";

interface CockpitTownshipRankProps {
  stats: CockpitTownshipStat[];
  selectedTownship: string | null;
  onSelectTownship: (name: string | null) => void;
}

export function CockpitTownshipRank({
  stats,
  selectedTownship,
  onSelectTownship,
}: CockpitTownshipRankProps) {
  const maxCount = stats.length > 0 ? stats[0].count : 1;

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-[#1677FF]/25 bg-[#051433]/85 backdrop-blur-xl overflow-hidden p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between pb-2.5 border-b border-[#1677FF]/20 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 size={15} className="text-[#4096ff]" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            镇街工单态势排行榜
          </h3>
        </div>
        <span className="text-[10px] font-mono text-[#4096ff]/80 uppercase">
          TOWNSHIP RANK
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-2 pr-1 custom-cockpit-scrollbar">
        {stats.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            暂无镇街分布统计
          </div>
        ) : (
          stats.map((item) => {
            const isSelected =
              selectedTownship &&
              (item.name.includes(selectedTownship) || selectedTownship.includes(item.name));
            const widthPct = Math.max(8, Math.round((item.count / maxCount) * 100));
            const townColor = getTownshipColor(item.name);

            return (
              <div
                key={item.name}
                onClick={() =>
                  onSelectTownship(isSelected ? null : item.name.replace(/(街道|镇|区)$/, ""))
                }
                className={`p-2 rounded-xl border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-blue-950/70 border-white shadow-[0_0_16px_rgba(255,255,255,0.4)]"
                    : "bg-[#091f48]/40 border-[#1677FF]/15 hover:border-[#1677FF]/50 hover:bg-[#0c285e]/60"
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className="w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono font-bold text-white shadow-xs"
                      style={{ backgroundColor: townColor }}
                    >
                      {item.rank}
                    </span>
                    <span className="font-semibold text-slate-100">{item.name}</span>
                  </div>

                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-white font-bold">{item.count.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400">({item.sharePct}%)</span>
                  </div>
                </div>

                {/* 镇街色系发光进度条 */}
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500 shadow-sm"
                    style={{
                      width: `${widthPct}%`,
                      backgroundColor: townColor,
                      boxShadow: `0 0 8px ${townColor}99`,
                    }}
                  />
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
