"use client";

import React from "react";
import { AlertTriangle, Layers, CheckCircle2, Zap } from "lucide-react";
import type { DomainProfile } from "../civic/region-context";
import type { CockpitKpiData } from "./cockpit-types";

interface CockpitKpiStripProps {
  kpi: CockpitKpiData;
  loading?: boolean;
  domainProfile?: DomainProfile | null;
}

export function CockpitKpiStrip({
  kpi,
  loading = false,
  domainProfile,
}: CockpitKpiStripProps) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

  const cards = [
    {
      title: isEcommerce ? "今日客诉总量" : "今日受理总量",
      value: loading ? "—" : kpi.todayCount.toLocaleString(),
      unit: "件",
      changeText: loading ? "读取中" : "数据最新一日",
      icon: Zap,
      indicatorColor: "bg-sky-400",
      valueColor: "text-slate-50",
      iconColor: "text-sky-400",
      subColor: "text-slate-400",
    },
    {
      title: isEcommerce ? "售后完结率" : "办结率",
      value: loading ? "—" : `${kpi.resolutionRatePct}`,
      unit: "%",
      changeText: loading
        ? "读取中"
        : isEcommerce
          ? "已完结占全部客诉"
          : "已办结占全部工单",
      icon: CheckCircle2,
      indicatorColor: "bg-emerald-400",
      valueColor: "text-slate-50",
      iconColor: "text-emerald-400",
      subColor: "text-slate-400",
    },
    {
      title: isEcommerce ? "活跃多频案卷" : "活跃多频群组",
      value: loading ? "—" : kpi.clusterCount.toLocaleString(),
      unit: "组",
      changeText: loading
        ? "读取中"
        : isEcommerce
          ? `累计汇聚 ${kpi.multifreqCount.toLocaleString()} 件共性客诉`
          : `累计汇聚 ${kpi.multifreqCount.toLocaleString()} 件共性诉求`,
      icon: Layers,
      indicatorColor: "bg-violet-400",
      valueColor: "text-slate-50",
      iconColor: "text-violet-400",
      subColor: "text-slate-400",
    },
    {
      title: isEcommerce ? "高风险客诉" : "高风险群诉",
      value: loading ? "—" : kpi.urgentAlertCount.toLocaleString(),
      unit: "起",
      changeText: loading ? "读取中" : isEcommerce ? "红线预警需跟进" : "需跟进",
      icon: AlertTriangle,
      indicatorColor: "bg-rose-400",
      valueColor: "text-rose-300",
      iconColor: "text-rose-400",
      subColor: "text-rose-300/90",
    },
  ];

  return (
    <div className="w-full grid grid-cols-2 xl:grid-cols-4 gap-2.5 sm:gap-3">
      {cards.map((card, idx) => {
        const Icon = card.icon;
        return (
          <div
            key={idx}
            className="cockpit-glass-card relative px-3.5 py-2.5 sm:px-4 sm:py-3 rounded-2xl min-w-0 flex items-stretch gap-3"
          >
            {/* 左侧克制 2px 语义指示线 */}
            <div
              aria-hidden="true"
              className={`w-[2px] rounded-full shrink-0 my-0.5 opacity-85 ${card.indicatorColor}`}
            />

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div className="flex items-center justify-between gap-2 min-w-0">
                <span className="text-xs font-medium text-slate-300 tracking-wide cockpit-single-line">
                  {card.title}
                </span>
                <div className="p-1.5 rounded-lg bg-white/[0.04] border border-white/[0.07] shrink-0">
                  <Icon size={13} aria-hidden="true" className={card.iconColor} />
                </div>
              </div>

              <div className="mt-1 flex items-baseline gap-1.5 min-w-0">
                <span
                  className={`font-bold font-mono tabular-nums tracking-tight leading-none ${card.valueColor}`}
                  style={{ fontSize: "clamp(1.25rem, 1.1rem + 0.6vw, 1.6rem)" }}
                >
                  {card.value}
                </span>
                <span className="text-xs text-slate-400 font-medium shrink-0">
                  {card.unit}
                </span>
              </div>

              <div className="mt-1 text-[11px] leading-snug min-w-0">
                <span className={`block cockpit-single-line tabular-nums ${card.subColor}`}>
                  {card.changeText}
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
