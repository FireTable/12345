"use client";

import React from "react";
import { BarChart3, ChevronRight, Award } from "lucide-react";
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
    <div className="w-full h-full flex flex-col rounded-xl border border-cyan-500/20 bg-[#061226]/85 backdrop-blur-md overflow-hidden p-3.5 shadow-lg">
      <div className="flex items-center justify-between pb-2 border-b border-cyan-500/15 shrink-0">
        <div className="flex items-center gap-2">
          <BarChart3 size={14} className="text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-200 tracking-wider">
            镇街工单态势排行榜
          </h3>
        </div>
        <span className="text-[10px] font-mono text-cyan-400/80">TOP TOWNSHIPS</span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2 space-y-2 pr-1 custom-cockpit-scrollbar">
        {stats.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            暂无镇街分布统计
          </div>
        ) : (
          stats.map((item) => {
            const isSelected =
              selectedTownship &&
              (item.name.includes(selectedTownship) || selectedTownship.includes(item.name));
            const widthPct = Math.max(8, Math.round((item.count / maxCount) * 100));

            return (
              <div
                key={item.name}
                onClick={() => onSelectTownship(isSelected ? null : item.name.replace(/(街道|镇|区)$/, ""))}
                className={`p-2 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-cyan-950/60 border-cyan-400 shadow-[0_0_12px_rgba(0,242,254,0.3)]"
                    : "bg-[#091b38]/40 border-cyan-500/15 hover:border-cyan-400/40 hover:bg-[#0c2246]/50"
                }`}
              >
                <div className="flex items-center justify-between text-xs mb-1.5">
                  <div className="flex items-center gap-2">
                    <span
                      className={`w-4 h-4 rounded-full flex items-center justify-center text-[10px] font-mono font-bold ${
                        item.rank === 1
                          ? "bg-amber-400 text-slate-950 shadow-[0_0_8px_#fbbf24]"
                          : item.rank === 2
                          ? "bg-slate-300 text-slate-950"
                          : item.rank === 3
                          ? "bg-amber-700 text-white"
                          : "bg-slate-800 text-slate-400"
                      }`}
                    >
                      {item.rank}
                    </span>
                    <span className="font-semibold text-slate-200">{item.name}</span>
                  </div>

                  <div className="flex items-center gap-2 font-mono">
                    <span className="text-cyan-300 font-bold">{item.count.toLocaleString()}</span>
                    <span className="text-[10px] text-slate-400">({item.sharePct}%)</span>
                  </div>
                </div>

                {/* 科技光感进度条 */}
                <div className="w-full h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      item.rank === 1
                        ? "bg-gradient-to-r from-amber-500 to-amber-300"
                        : "bg-gradient-to-r from-blue-600 via-cyan-500 to-cyan-300"
                    }`}
                    style={{ width: `${widthPct}%` }}
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
