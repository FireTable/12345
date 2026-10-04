"use client";

import React, { useMemo } from "react";
import { TrendingUp } from "lucide-react";
import { CivicEChart } from "../civic/civic-charts";

interface CockpitTrendChartProps {
  daily: Record<string, number>;
  clusters?: Record<string, number>;
}

export function CockpitTrendChart({ daily, clusters = {} }: CockpitTrendChartProps) {
  const chartOption = useMemo(() => {
    const dates = Object.keys(daily).sort();
    const displayDates = dates.slice(-14); // 近14天/时段趋势
    const ticketValues = displayDates.map((d) => daily[d] || 0);
    const clusterValues = displayDates.map((d) => clusters[d] || 0);

    const xLabels = displayDates.map((d) => (d.length > 5 ? d.slice(5) : d));

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(5, 14, 33, 0.95)",
        borderColor: "rgba(0, 242, 254, 0.4)",
        borderWidth: 1,
        textStyle: { color: "#e0f2fe", fontSize: 12 },
        axisPointer: {
          lineStyle: { color: "rgba(0, 242, 254, 0.5)", type: "dashed" },
        },
      },
      legend: {
        top: 0,
        right: 10,
        itemWidth: 12,
        itemHeight: 8,
        textStyle: { color: "#94a3b8", fontSize: 11 },
        data: ["每日工单量", "多频群组突发"],
      },
      grid: {
        top: 25,
        left: "3%",
        right: "4%",
        bottom: "8%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xLabels,
        axisLine: { lineStyle: { color: "rgba(0, 242, 254, 0.2)" } },
        axisLabel: { color: "#94a3b8", fontSize: 10 },
      },
      yAxis: [
        {
          type: "value",
          name: "工单",
          nameTextStyle: { color: "#64748b", fontSize: 10 },
          splitLine: { lineStyle: { color: "rgba(255, 255, 255, 0.05)" } },
          axisLabel: { color: "#94a3b8", fontSize: 10 },
        },
        {
          type: "value",
          name: "多频",
          nameTextStyle: { color: "#64748b", fontSize: 10 },
          splitLine: { show: false },
          axisLabel: { color: "#f59e0b", fontSize: 10 },
        },
      ],
      series: [
        {
          name: "每日工单量",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#00f2fe" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(0, 242, 254, 0.35)" },
                { offset: 1, color: "rgba(0, 242, 254, 0.00)" },
              ],
            },
          },
          data: ticketValues,
        },
        {
          name: "多频群组突发",
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
  }, [daily, clusters]);

  const hasData = Object.keys(daily).length > 0;

  return (
    <div className="w-full h-full flex flex-col rounded-xl border border-cyan-500/20 bg-[#061226]/85 backdrop-blur-md overflow-hidden p-3.5 shadow-lg">
      <div className="flex items-center justify-between pb-1 border-b border-cyan-500/15 shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp size={14} className="text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-200 tracking-wider">
            工单时序走势与多频激增脉冲
          </h3>
        </div>
        <span className="text-[10px] font-mono text-cyan-400/70">WAVEFORM SURGE</span>
      </div>

      <div className="flex-1 min-h-[140px] relative">
        {hasData ? (
          <CivicEChart option={chartOption} height={145} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            等待时序数据沉淀...
          </div>
        )}
      </div>
    </div>
  );
}
