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
      <Card className="p-4 border-slate-200 bg-white hover:border-blue-400 hover:shadow-md transition-all space-y-3 shadow-2xs">
        {/* Top Header */}
        <div className="flex items-start justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            {isHighRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                🔴 紧急督办
              </span>
            )}
            {isMedRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                🟡 重点跟进
              </span>
            )}
            {!isHighRisk && !isMedRisk && (
              <span className="px-2 py-0.5 rounded text-[10.5px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
                ⚪ 常规流转
              </span>
            )}

            <span className="text-[11px] px-1.5 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
              {theme.category}
            </span>
          </div>

          <span className="font-mono text-xs font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
            {theme.ticketCount} 单
          </span>
        </div>

        {/* Title */}
        <h3 className="text-xs font-bold text-slate-900 leading-snug group-hover:text-blue-600 transition-colors line-clamp-2">
          {theme.title}
        </h3>

        {/* Entities */}
        <div className="space-y-1 text-xs text-slate-600">
          <div className="flex items-center gap-1.5 text-slate-800 font-medium truncate">
            <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{theme.canonicalSubject}</span>
          </div>
          <div className="flex items-center gap-1.5 text-slate-500 truncate text-[11.5px]">
            <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
            <span className="truncate">{theme.canonicalLocation}</span>
          </div>
        </div>

        {/* AI Insight Summary */}
        <div className="p-2.5 rounded-md bg-slate-50 border border-slate-200 text-[11.5px] text-slate-600 leading-relaxed space-y-1">
          <div className="flex items-center gap-1 font-semibold text-blue-700 text-[11px]">
            <Sparkles className="w-3 h-3 text-blue-500" />
            Agent 归因研判
          </div>
          <p className="line-clamp-2 text-slate-600">{theme.riskReason}</p>
        </div>

        {/* Footer */}
        <div className="pt-2 border-t border-slate-100 flex items-center justify-between text-xs text-slate-500">
          <div className="flex items-center gap-1 text-[11px] font-mono">
            <Clock className="w-3 h-3 text-slate-400" />
            <span>跨度 {theme.timeSpanHours}h</span>
          </div>

          <div className="flex items-center gap-0.5 text-blue-600 group-hover:text-blue-700 font-semibold text-xs">
            <span>下钻明细</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Card>
    </div>
  );
};
