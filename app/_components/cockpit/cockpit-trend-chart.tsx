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
    const displayDates = dates.slice(-14);
    const ticketValues = displayDates.map((d) => daily[d] || 0);
    const clusterValues = displayDates.map((d) => clusters[d] || 0);

    const xLabels = displayDates.map((d) => (d.length > 5 ? d.slice(5) : d));

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "axis",
        backgroundColor: "rgba(5, 20, 51, 0.95)",
        borderColor: "rgba(22, 119, 255, 0.5)",
        borderWidth: 1,
        textStyle: { color: "#e0f2fe", fontSize: 12 },
        axisPointer: {
          lineStyle: { color: "rgba(22, 119, 255, 0.5)", type: "dashed" },
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
        left: "2%",
        right: "3%",
        bottom: "6%",
        containLabel: true,
      },
      xAxis: {
        type: "category",
        boundaryGap: false,
        data: xLabels,
        axisLine: { lineStyle: { color: "rgba(22, 119, 255, 0.3)" } },
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
          axisLabel: { color: "#ff7d00", fontSize: 10 },
        },
      ],
      series: [
        {
          name: "每日工单量",
          type: "line",
          smooth: true,
          showSymbol: false,
          lineStyle: { width: 2.5, color: "#1677FF" },
          areaStyle: {
            color: {
              type: "linear",
              x: 0,
              y: 0,
              x2: 0,
              y2: 1,
              colorStops: [
                { offset: 0, color: "rgba(22, 119, 255, 0.40)" },
                { offset: 1, color: "rgba(22, 119, 255, 0.00)" },
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
          lineStyle: { width: 2, color: "#ff7d00", type: "solid" },
          itemStyle: { color: "#ff7d00" },
          data: clusterValues,
        },
      ],
    };
  }, [daily, clusters]);

  const hasData = Object.keys(daily).length > 0;

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-[#1677FF]/25 bg-[#051433]/85 backdrop-blur-xl overflow-hidden p-3.5 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between pb-1 border-b border-[#1677FF]/20 shrink-0">
        <div className="flex items-center gap-2">
          <TrendingUp size={15} className="text-[#4096ff]" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            工单时序走势与多频激增脉冲
          </h3>
        </div>
        <span className="text-[10px] font-mono text-[#4096ff]/80 uppercase">
          WAVEFORM SURGE
        </span>
      </div>

      <div className="flex-1 min-h-[110px] relative">
        {hasData ? (
          <CivicEChart option={chartOption} height={120} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            等待时序数据沉淀...
          </div>
        )}
      </div>
    </div>
  );
}
