"use client";

import React from "react";
import { AlertTriangle, Layers, CheckCircle2, Zap } from "lucide-react";
import type { CockpitKpiData } from "./cockpit-types";

interface CockpitKpiStripProps {
  kpi: CockpitKpiData;
  loading?: boolean;
}

export function CockpitKpiStrip({ kpi, loading = false }: CockpitKpiStripProps) {
  const cards = [
    {
      title: "今日受理总量",
      value: loading ? "—" : kpi.todayCount.toLocaleString(),
      unit: "件",
      changeText: loading ? "读取中" : "数据最新一日",
      changeTone: "normal",
      icon: Zap,
      borderColor: "border-[#1677FF]/40",
      glowColor: "text-[#4096ff]",
      accentBg: "bg-blue-600/20 text-[#4096ff]",
    },
    {
      title: "办结率",
      value: loading ? "—" : `${kpi.resolutionRatePct}`,
      unit: "%",
      changeText: loading ? "读取中" : "已办结占全部工单",
      changeTone: "normal",
      icon: CheckCircle2,
      borderColor: "border-emerald-500/35",
      glowColor: "text-emerald-300",
      accentBg: "bg-emerald-500/15 text-emerald-400",
    },
    {
      title: "活跃多频群组",
      value: loading ? "—" : kpi.clusterCount.toLocaleString(),
      unit: "组",
      changeText: loading ? "读取中" : `累计汇聚 ${kpi.multifreqCount.toLocaleString()} 件共性诉求`,
      changeTone: "normal",
      icon: Layers,
      borderColor: "border-purple-500/35",
      glowColor: "text-purple-300",
      accentBg: "bg-purple-500/15 text-purple-400",
    },
    {
      title: "高风险群诉",
      value: loading ? "—" : kpi.urgentAlertCount.toLocaleString(),
      unit: "起",
      changeText: loading ? "读取中" : "需跟进",
      changeTone: "danger",
      icon: AlertTriangle,
      borderColor: "border-rose-500/40",
      glowColor: "text-rose-400",
      accentBg: "bg-rose-500/20 text-rose-400",
    },
  ];

  const variantClasses = [
    "",
    "cockpit-glass-card--emerald",
    "cockpit-glass-card--purple",
    "cockpit-glass-card--danger",
  ];

  return (
    <div className="w-full grid grid-cols-2 md:grid-cols-4 gap-3">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className={`cockpit-glass-card ${variantClasses[idx] || ""} relative p-3 rounded-2xl group transition-all`}
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-200 tracking-wider">
                {card.title}
              </span>
              <div className={`p-1.5 rounded-lg ${card.accentBg}`}>
                <Icon size={14} />
              </div>
            </div>

            <div className="mt-1 flex items-baseline gap-1.5">
              <span
                className={`text-2xl font-black font-mono tracking-tight ${card.glowColor}`}
              >
                {card.value}
              </span>
              <span className="text-xs text-slate-400 font-sans font-medium">{card.unit}</span>
            </div>

            <div className="mt-1 text-[11px] text-slate-300 flex items-center gap-1">
              <span className={card.changeTone === "danger" ? "text-rose-300 font-semibold" : ""}>
                {card.changeText}
              </span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
