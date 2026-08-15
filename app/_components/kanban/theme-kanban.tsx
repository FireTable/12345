"use client";

import React from "react";
import { ThemeCard } from "./theme-card";
import type { MultiFrequencyTheme } from "@/backend/state";
import { AlertCircle, Clock, CheckCircle2 } from "lucide-react";

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
      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        {/* Column 1: High Risk */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <h2 className="text-xs font-semibold text-zinc-200 tracking-tight">
                紧急督办 (高危多频)
              </h2>
            </div>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
              {highRiskThemes.length}
            </span>
          </div>

          <div className="space-y-3">
            {highRiskThemes.map((theme) => (
              <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
            ))}
            {highRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg">
                暂无紧急督办事件
              </div>
            )}
          </div>
        </div>

        {/* Column 2: Medium Risk */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <Clock className="w-4 h-4 text-amber-400" />
              <h2 className="text-xs font-semibold text-zinc-200 tracking-tight">
                重点跟进 (中度多频)
              </h2>
            </div>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
              {mediumRiskThemes.length}
            </span>
          </div>

          <div className="space-y-3">
            {mediumRiskThemes.map((theme) => (
              <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
            ))}
            {mediumRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg">
                暂无重点跟进事件
              </div>
            )}
          </div>
        </div>

        {/* Column 3: Low Risk */}
        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between pb-2 border-b border-zinc-800">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 text-zinc-400" />
              <h2 className="text-xs font-semibold text-zinc-200 tracking-tight">
                常规流转 (日常多频)
              </h2>
            </div>
            <span className="text-xs font-mono font-medium px-2 py-0.5 rounded bg-zinc-800 text-zinc-300">
              {lowRiskThemes.length}
            </span>
          </div>

          <div className="space-y-3">
            {lowRiskThemes.map((theme) => (
              <ThemeCard key={theme.id} theme={theme} onClick={onSelectTheme} />
            ))}
            {lowRiskThemes.length === 0 && (
              <div className="p-8 text-center text-xs text-zinc-600 border border-dashed border-zinc-800 rounded-lg">
                暂无常规多频事件
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
