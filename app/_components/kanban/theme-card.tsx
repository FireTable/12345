"use client";

import React from "react";
import {
  Clock,
  MapPin,
  Building2,
  ChevronRight,
  AlertTriangle,
  Flame,
  Sparkles,
  Tag,
} from "lucide-react";
import { motion } from "motion/react";
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

  const glowClass = isHighRisk
    ? "glass-panel-glow-rose hover:border-rose-500/60"
    : isMedRisk
    ? "glass-panel-glow-amber hover:border-amber-500/60"
    : "hover:border-emerald-500/50";

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, scale: 0.95 }}
      whileHover={{ y: -3, transition: { duration: 0.2 } }}
      onClick={() => onClick(theme)}
      className="cursor-pointer"
    >
      <Card
        className={`p-4.5 flex flex-col justify-between transition-all duration-300 relative group overflow-hidden ${glowClass}`}
      >
        {/* Top Banner & Risk Tag */}
        <div>
          <div className="flex items-start justify-between gap-2.5 mb-2.5">
            <div className="flex flex-wrap items-center gap-1.5">
              {isHighRisk && (
                <Badge variant="destructive">
                  <Flame className="w-3 h-3 text-rose-400 animate-bounce" />
                  高危警报
                </Badge>
              )}
              {isMedRisk && (
                <Badge variant="warning">
                  <AlertTriangle className="w-3 h-3 text-amber-400" />
                  中度多频
                </Badge>
              )}
              {!isHighRisk && !isMedRisk && (
                <Badge variant="success">
                  常规多频
                </Badge>
              )}

              <Badge variant="secondary" className="font-normal">
                {theme.category}
              </Badge>
            </div>

            {/* Ticket Count Badge */}
            <div className="flex items-center gap-1 bg-slate-900/90 px-2.5 py-1 rounded-xl border border-slate-700/70 shadow-sm shrink-0">
              <span className="text-sm font-extrabold text-white">{theme.ticketCount}</span>
              <span className="text-[10px] text-slate-400">单</span>
            </div>
          </div>

          {/* Card Title */}
          <h3 className="text-sm font-bold text-white tracking-tight leading-snug group-hover:text-cyan-300 transition-colors line-clamp-2">
            {theme.title}
          </h3>

          {/* Entities (Canonical Subject & Location) */}
          <div className="mt-2.5 space-y-1 text-xs">
            <div className="flex items-center gap-1.5 text-slate-300">
              <Building2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
              <span className="font-medium text-slate-200 truncate">{theme.canonicalSubject}</span>
            </div>
            <div className="flex items-center gap-1.5 text-slate-400">
              <MapPin className="w-3.5 h-3.5 text-purple-400 shrink-0" />
              <span className="truncate">{theme.canonicalLocation}</span>
            </div>
          </div>

          {/* AI Key Insight / Reason */}
          <div className="mt-3 p-2.5 rounded-xl bg-slate-950/80 border border-slate-800/80 text-[11.5px] text-slate-300/95 leading-relaxed">
            <div className="flex items-center gap-1 text-cyan-400 font-semibold mb-1 text-[11px]">
              <Sparkles className="w-3 h-3" />
              LangGraph 聚类研判
            </div>
            <p className="line-clamp-2 text-slate-300">{theme.riskReason}</p>
          </div>

          {/* Citizen Expression Alignment Tags */}
          {theme.relatedSubjects.length > 1 && (
            <div className="mt-2.5">
              <div className="text-[10.5px] text-slate-500 mb-1 flex items-center gap-1">
                <Tag className="w-3 h-3 text-slate-500" />
                已归一化市民不同表述 ({theme.relatedSubjects.length} 种):
              </div>
              <div className="flex flex-wrap gap-1">
                {theme.relatedSubjects.slice(0, 3).map((sub, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800/60 text-slate-400 border border-slate-700/40 truncate max-w-[150px]"
                  >
                    "{sub}"
                  </span>
                ))}
                {theme.relatedSubjects.length > 3 && (
                  <span className="text-[10px] px-1 text-slate-500">
                    +{theme.relatedSubjects.length - 3}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Card Footer: Time Span & Action */}
        <div className="mt-4 pt-3 border-t border-slate-800/80 flex items-center justify-between text-xs">
          <div className="flex items-center gap-1 text-[11px] text-slate-400">
            <Clock className="w-3 h-3 text-slate-500" />
            <span>跨度 {theme.timeSpanHours}h</span>
          </div>

          <div className="flex items-center gap-1 font-semibold text-cyan-400 group-hover:text-cyan-300 group-hover:translate-x-0.5 transition-all text-xs">
            <span>下钻核查</span>
            <ChevronRight className="w-3.5 h-3.5" />
          </div>
        </div>
      </Card>
    </motion.div>
  );
};
