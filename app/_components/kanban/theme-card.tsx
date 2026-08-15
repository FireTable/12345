"use client";

import React from "react";
import {
  Clock,
  MapPin,
  Building2,
  ChevronRight,
  Sparkles,
} from "lucide-react";
import type { MultiFrequencyTheme } from "@/backend/state";
import { Card } from "@/app/_components/ui/card";
import { Badge } from "@/app/_components/ui/badge";

interface ThemeCardProps {
  theme: MultiFrequencyTheme;
  onClick: (theme: MultiFrequencyTheme) => void;
}

export const ThemeCard: React.FC<ThemeCardProps> = ({ theme, onClick }) => {
  const isHighRisk = theme.riskLevel === "HIGH";
  const isMedRisk = theme.riskLevel === "MEDIUM";

  return (
    <div
      onClick={() => onClick(theme)}
      className="cursor-pointer group transition-all"
    >
      <Card className="p-4 border-zinc-800/90 bg-zinc-900/40 hover:bg-zinc-900/70 hover:border-zinc-700 transition-all space-y-3">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isHighRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-red-950/80 text-red-400 border border-red-900/60">
                紧急督办
              </span>
            )}
            {isMedRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-amber-950/80 text-amber-400 border border-amber-900/60">
                重点跟进
              </span>
            )}
            {!isHighRisk && !isMedRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-semibold bg-zinc-800 text-zinc-300 border border-zinc-700">
                常规流转
              </span>
            )}

            <span className="text-[11px] px-1.5 py-0.5 rounded bg-zinc-800/80 text-zinc-400">
              {theme.category}
            </span>
          </div>

          <span className="font-mono text-xs font-semibold text-zinc-200 bg-zinc-800 px-2 py-0.5 rounded border border-zinc-700/60">
            {theme.ticketCount} 单
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xs font-semibold text-zinc-100 leading-snug group-hover:text-zinc-200 line-clamp-2">
          {theme.title}
        </h3>

        {/* Entities */}
        <div className="space-y-1 text-xs text-zinc-400">
          <div className="flex items-center gap-1.5 text-zinc-300 truncate">
            <Building2 className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="truncate">{theme.canonicalSubject}</span>
          </div>
          <div className="flex items-center gap-1.5 text-zinc-400 truncate text-[11.5px]">
            <MapPin className="w-3.5 h-3.5 text-zinc-500 shrink-0" />
            <span className="truncate">{theme.canonicalLocation}</span>
          </div>
        </div>

        {/* AI Insight Summary */}
        <div className="p-2.5 rounded-md bg-zinc-950/80 border border-zinc-800/80 text-[11.5px] text-zinc-400 leading-relaxed space-y-1">
          <div className="flex items-center gap-1 font-medium text-zinc-300 text-[11px]">
            <Sparkles className="w-3 h-3 text-zinc-400" />
            LangGraph 研判归因
          </div>
          <p className="line-clamp-2">{theme.riskReason}</p>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-zinc-800/60 flex items-center justify-between text-xs text-zinc-500">
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <Clock className="w-3 h-3" />
            <span>跨度 {theme.timeSpanHours}h</span>
          </div>

          <div className="flex items-center gap-0.5 text-zinc-400 group-hover:text-zinc-200 font-medium text-xs">
            <span>下钻明细</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Card>
    </div>
  );
};
