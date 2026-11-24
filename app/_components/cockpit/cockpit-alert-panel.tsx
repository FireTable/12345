"use client";

import React from "react";
import { Flame, CheckCircle } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { DomainProfile } from "../civic/region-context";
import type { CockpitAlertItem } from "./cockpit-types";

interface CockpitAlertPanelProps {
  alerts: CockpitAlertItem[];
  selectedTownship?: string | null;
  loading?: boolean;
  domainProfile?: DomainProfile | null;
}

export function CockpitAlertPanel({
  alerts,
  selectedTownship,
  loading = false,
  domainProfile,
}: CockpitAlertPanelProps) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

  const filtered = selectedTownship
    ? alerts.filter(
        (a) =>
          !a.subdistrict ||
          a.subdistrict.includes(selectedTownship) ||
          selectedTownship.includes(a.subdistrict)
      )
    : alerts;

  const displayList = filtered.slice(0, 3);

  return (
    <div className="cockpit-glass-card cockpit-glass-card--danger w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 relative min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Flame size={14} aria-hidden="true" className="text-rose-400 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            {isEcommerce ? "高风险客诉预警" : "高风险群诉"}
          </h2>
        </div>
        <span className="px-2 py-0.5 rounded-md bg-rose-500/12 border border-rose-400/25 text-[10px] font-mono tabular-nums text-rose-200 whitespace-nowrap shrink-0">
          {loading ? "读取中" : `${displayList.length} 起需跟进`}
        </span>
      </div>

      <div
        className={`flex-1 overflow-y-auto mt-2 space-y-2 pr-1 custom-cockpit-scrollbar min-w-0 ${
          displayList.length <= 1 ? "flex flex-col justify-center space-y-0" : ""
        }`}
      >
        {displayList.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-emerald-300/90 font-mono gap-1.5">
            <CheckCircle size={14} aria-hidden="true" className="shrink-0" />
            <span>
              {loading
                ? "正在读取..."
                : isEcommerce
                  ? "当前没有需要提级的客诉预警"
                  : "当前没有需要提级的群诉"}
            </span>
          </div>
        ) : (
          displayList.map((alert) => {
            const townColor = alert.subdistrict
              ? getTownshipColor(alert.subdistrict)
              : "#f43f5e";
            return (
              <div
                key={alert.id}
                className="p-2.5 rounded-xl border border-white/[0.07] border-l-2 border-l-rose-400/80 bg-white/[0.03] hover:bg-white/[0.05] transition-colors min-w-0"
              >
                <div className="flex items-center justify-between gap-2 text-xs mb-1 min-w-0">
                  <div className="flex items-center gap-1.5 min-w-0 flex-1">
                    <span className="px-1.5 py-0.5 rounded bg-rose-500/15 text-rose-200 font-medium text-[10px] whitespace-nowrap shrink-0">
                      {alert.category}
                    </span>
                    {alert.subdistrict && (
                      <span
                        className="inline-flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-md bg-white/[0.05] border border-white/10 text-slate-200 cockpit-single-line"
                        title={alert.subdistrict}
                      >
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: townColor }}
                        />
                        <span className="cockpit-single-line">{alert.subdistrict}</span>
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0">
                    {alert.createTime}
                  </span>
                </div>
                <h3
                  className="text-xs font-medium text-slate-100 cockpit-single-line"
                  title={alert.title}
                >
                  {alert.title}
                </h3>
                {alert.desc && (
                  <p className="text-[11px] text-slate-400 cockpit-single-line mt-0.5 tabular-nums">
                    {alert.desc}
                  </p>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
