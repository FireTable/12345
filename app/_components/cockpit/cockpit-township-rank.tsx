"use client";

import React from "react";
import { BarChart3 } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { DomainProfile } from "../civic/region-context";
import type { CockpitTownshipStat } from "./cockpit-types";

interface CockpitTownshipRankProps {
  stats: CockpitTownshipStat[];
  selectedTownship: string | null;
  onSelectTownship: (name: string | null) => void;
  loading?: boolean;
  domainProfile?: DomainProfile | null;
}

export function CockpitTownshipRank({
  stats,
  selectedTownship,
  onSelectTownship,
  loading = false,
  domainProfile,
}: CockpitTownshipRankProps) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";
  const maxCount = Math.max(1, ...stats.map((item) => item.count));

  return (
    <div className="cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <BarChart3 size={14} aria-hidden="true" className="text-sky-400 shrink-0" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            {isEcommerce ? "渠道/仓网客诉排行榜" : "镇街工单态势排行榜"}
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400 uppercase whitespace-nowrap shrink-0">
          {isEcommerce ? "CHANNEL RANK" : "TOWNSHIP RANK"}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-1.5 pr-1 custom-cockpit-scrollbar min-w-0">
        {stats.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            {loading
              ? "正在读取..."
              : isEcommerce
                ? "暂无渠道/仓网分布统计"
                : "暂无镇街分布统计"}
          </div>
        ) : (
          stats.map((item) => {
            const isSelected = Boolean(
              selectedTownship &&
                (item.name.includes(selectedTownship) ||
                  selectedTownship.includes(item.name))
            );
            const widthPct = Math.max(6, Math.round((item.count / maxCount) * 100));
            const townColor = getTownshipColor(item.name);
            const selectionKey = isEcommerce
              ? item.name
              : item.name.replace(/(街道|镇|区)$/, "");

            return (
              <button
                key={item.name}
                type="button"
                aria-pressed={isSelected}
                onClick={() => onSelectTownship(isSelected ? null : selectionKey)}
                className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer min-w-0 ${
                  isSelected
                    ? "bg-sky-500/15 border-sky-400/50"
                    : "cockpit-glass-subcard"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-xs mb-1.5 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span
                      className={`w-5 h-5 rounded-md flex items-center justify-center text-[10px] font-mono tabular-nums font-semibold shrink-0 border ${
                        item.rank <= 3
                          ? "bg-white/[0.08] border-white/20 text-white"
                          : "bg-white/[0.03] border-white/[0.08] text-slate-400"
                      }`}
                    >
                      {item.rank}
                    </span>
                    <span
                      aria-hidden="true"
                      className="w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: townColor }}
                    />
                    <span
                      className="font-medium text-slate-100 cockpit-single-line"
                      title={item.name}
                    >
                      {item.name}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 font-mono tabular-nums shrink-0 whitespace-nowrap">
                    <span className="text-slate-100 font-semibold">
                      {item.count.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-slate-400">
                      ({item.sharePct}%)
                    </span>
                  </div>
                </div>

                {/* 细腻 1.5px 质感进度条 */}
                <div className="w-full h-[2px] rounded-full bg-white/[0.06] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${widthPct}%`,
                      height: "1.5px",
                      backgroundColor: isSelected ? "#38bdf8" : townColor,
                    }}
                  />
                </div>
              </button>
            );
          })
        )}
      </div>
    </div>
  );
}
