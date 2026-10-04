"use client";

import React from "react";
import { TrendingUp, AlertTriangle, Layers, CheckCircle2, Zap } from "lucide-react";
import type { CockpitKpiData } from "./cockpit-types";

interface CockpitKpiStripProps {
  kpi: CockpitKpiData;
}

export function CockpitKpiStrip({ kpi }: CockpitKpiStripProps) {
  const cards = [
    {
      title: "今日受理总量",
      value: kpi.todayCount.toLocaleString(),
      unit: "件",
      changeText: `+${kpi.todayGrowthPct}% 环比上周`,
      changeTone: "up",
      icon: Zap,
      gradient: "from-blue-600/20 via-cyan-500/10 to-transparent",
      borderColor: "border-cyan-500/30",
      glowColor: "text-cyan-300",
      accentBg: "bg-cyan-500/10 text-cyan-400",
    },
    {
      title: "实时办结率",
      value: `${kpi.resolutionRatePct}%`,
      unit: "达标",
      changeText: "符合政企 SLA 指标",
      changeTone: "normal",
      icon: CheckCircle2,
      gradient: "from-emerald-600/20 via-emerald-500/10 to-transparent",
      borderColor: "border-emerald-500/30",
      glowColor: "text-emerald-300",
      accentBg: "bg-emerald-500/10 text-emerald-400",
    },
    {
      title: "活跃多频群组",
      value: kpi.clusterCount.toLocaleString(),
      unit: "组",
      changeText: `累计汇聚 ${kpi.multifreqCount.toLocaleString()} 件共性诉求`,
      changeTone: "normal",
      icon: Layers,
      gradient: "from-purple-600/20 via-indigo-500/10 to-transparent",
      borderColor: "border-purple-500/30",
      glowColor: "text-purple-300",
      accentBg: "bg-purple-500/10 text-purple-400",
    },
    {
      title: "高危突发险情预警",
      value: kpi.urgentAlertCount.toLocaleString(),
      unit: "起",
      changeText: "已触发联动处置预案",
      changeTone: "danger",
      icon: AlertTriangle,
      gradient: "from-rose-600/20 via-amber-500/10 to-transparent",
      borderColor: "border-rose-500/40",
      glowColor: "text-rose-400",
      accentBg: "bg-rose-500/20 text-rose-400 animate-pulse",
    },
  ];

  return (
    <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`relative p-3.5 rounded-xl border ${card.borderColor} bg-gradient-to-br ${card.gradient} bg-[#061226]/80 backdrop-blur-md overflow-hidden shadow-lg group hover:border-cyan-400/50 transition-all`}
          >
            {/* 角标高科技装饰点 */}
            <div className="absolute top-1 right-1 w-1.5 h-1.5 rounded-full bg-cyan-400/40" />
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-300 tracking-wider">
                {card.title}
              </span>
              <div className={`p-1.5 rounded-lg ${card.accentBg}`}>
                <Icon size={14} />
              </div>
            </div>

            <div className="mt-2 flex items-baseline gap-1.5">
              <span
                className={`text-2xl md:text-3xl font-black font-mono tracking-tight ${card.glowColor} drop-shadow-[0_0_10px_currentColor]`}
              >
                {card.value}
              </span>
              <span className="text-xs text-slate-400 font-sans font-medium">{card.unit}</span>
            </div>

            <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1">
              {card.changeTone === "up" && (
                <TrendingUp size={11} className="text-cyan-400 inline" />
              )}
              <span className={card.changeTone === "danger" ? "text-rose-300 font-medium" : ""}>
                {card.changeText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
