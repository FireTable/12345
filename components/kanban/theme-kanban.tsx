"use client";

import React from "react";
import { ThemeCard } from "./theme-card";
import type { MultiFrequencyTheme } from "@/backend/state";
import { Badge } from "@/components/ui/badge";
import { AnimatePresence } from "motion/react";

interface ThemeKanbanProps {
  themes: MultiFrequencyTheme[];
  onSelectTheme: (theme: MultiFrequencyTheme) => void;
}

export const ThemeKanban: React.FC<ThemeKanbanProps> = ({
  themes,
  onSelectTheme,
}) => {
  const highRiskThemes = themes.filter((t) => t.riskLevel === "HIGH");
  const mediumRiskThemes = themes.filter((t) => t.riskLevel === "MEDIUM");
  const lowRiskThemes = themes.filter((t) => t.riskLevel === "LOW");

  return (
    <div className="max-w-7xl mx-auto px-6 py-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Column 1: High Risk (🔴 高危多频预警) */}
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-rose-500/30">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse" />
              <h2 className="text-sm font-bold text-rose-200 tracking-tight flex items-center gap-1.5">
                高危多频预警 (紧急督办)
              </h2>
            </div>
            <Badge variant="destructive">
              {highRiskThemes.length}
            </Badge>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {highRiskThemes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
              ))}
            </AnimatePresence>
            {highRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                暂无高危多频事件
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Medium Risk (🟡 中度多频集中) */}
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-amber-500/30">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
              <h2 className="text-sm font-bold text-amber-200 tracking-tight flex items-center gap-1.5">
                中度多频集中 (反复回潮)
              </h2>
            </div>
            <Badge variant="warning">
              {mediumRiskThemes.length}
            </Badge>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {mediumRiskThemes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
              ))}
            </AnimatePresence>
            {mediumRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                暂无中度多频事件
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Low Risk (🟢 常规多频跟踪) */}
        <div className="flex flex-col gap-3.5">
          <div className="flex items-center justify-between pb-2 border-b border-emerald-500/30">
            <div className="flex items-center gap-2">
              <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              <h2 className="text-sm font-bold text-emerald-200 tracking-tight flex items-center gap-1.5">
                常规多频跟踪 (日常办结)
              </h2>
            </div>
            <Badge variant="success">
              {lowRiskThemes.length}
            </Badge>
          </div>

          <div className="space-y-4">
            <AnimatePresence>
              {lowRiskThemes.map((theme) => (
                <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
              ))}
            </AnimatePresence>
            {lowRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-slate-500 border border-dashed border-slate-800 rounded-2xl">
                暂无常规多频事件
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
