"use client";

import React, { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { CivicEChart } from "../civic/civic-charts";
import type { DomainProfile } from "../civic/region-context";

interface CockpitTrendChartProps {
  daily: Record<string, number>;
  clusters?: Record<string, number>;
  domainProfile?: DomainProfile | null;
}

export function CockpitTrendChart({
  daily,
  clusters = {},
  domainProfile,
}: CockpitTrendChartProps) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

  const chartOption = useMemo(() => {
    const dates = Object.keys(daily).sort();
    const displayDates = dates.slice(-14);
    const ticketValues = displayDates.map((d) => daily[d] || 0);
    const clusterValues = displayDates.map((d) => clusters[d] || 0);

    const xLabels = displayDates.map((d) => (d.length > 5 ? d.slice(5) : d));
    const primaryLabel = isEcommerce ? "每日客诉量" : "每日工单量";
    const secondaryLabel = isEcommerce ? "多频案卷突发" : "多频群组突发";

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(9, 13, 24, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        borderWidth: 1,
        textStyle: { color: "#f1f5f9", fontSize: 12 },
        axisPointer: {
          lineStyle: { color: "rgba(148, 163, 184, 0.35)", type: "dashed" },
        },
      },
      legend: {
        top: 0,
        left: "center",
        itemWidth: 10,
        itemHeight: 7,
        itemGap: 14,
        textStyle: { color: "#94a3b8", fontSize: 11 },
        data: [primaryLabel, secondaryLabel],
      },
      grid: {
        top: 38,
        left: 8,
        right: 8,
        bottom: 4,
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xLabels,
        axisLine: { lineStyle: { color: "rgba(255, 255, 255, 0.12)" } },
        axisTick: { show: false },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: isEcommerce ? "客诉" : "工单",
          nameGap: 8,
          nameTextStyle: { color: "#94a3b8", fontSize: 10, align: "left" },
          splitLine: { lineStyle: { color: "rgba(255, 255, 255, 0.06)" } },
          axisLabel: { color: "#94a3b8", fontSize: 10 },
        },
        {
          type: "value",
          name: isEcommerce ? "案卷" : "多频",
          nameGap: 8,
          nameTextStyle: { color: "#94a3b8", fontSize: 10, align: "right" },
          splitLine: { show: false },
          axisLabel: { color: "#f59e0b", fontSize: 10 },
        },
      ],
      series: [
        {
          name: primaryLabel,
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2, color: "#38bdf8" },
          itemStyle: { color: "#38bdf8" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(56, 189, 248, 0.24)" },
                { offset: 1, color: "rgba(56, 189, 248, 0.00)" },
              ],
            },
          },
          data: ticketValues,
        },
        {
          name: secondaryLabel,
          type: "line",
          yAxisIndex: 1,
          smooth: true,
          showSymbol: true,
          symbolSize: 4,
          lineStyle: { width: 2, color: "#f59e0b", type: "solid" },
          itemStyle: { color: "#f59e0b" },
          data: clusterValues,
        },
      ],
    };
  }, [daily, clusters, isEcommerce]);

  const hasData = Object.keys(daily).length > 0;

  return (
    <div className="cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-1.5 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <TrendingUp size={14} aria-hidden="true" className="text-sky-400 shrink-0" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            {isEcommerce ? "客诉时序走势与多频脉冲" : "工单时序走势与多频激增脉冲"}
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400 uppercase whitespace-nowrap shrink-0">
          WAVEFORM SURGE
        </span>
      </div>

      <div className="flex-1 w-full h-full min-h-[110px] relative">
        {hasData ? (
          <CivicEChart option={chartOption} height="100%" className="w-full h-full" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            等待时序数据沉淀...
          </div>
        )}
      </div>
    </div>
  );
}
