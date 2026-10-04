"use client";

import React, { useMemo } from "react";
import { PieChart as PieIcon } from "lucide-react";
import { CivicEChart } from "../civic/civic-charts";
import { categoryColor } from "@/lib/civic-cluster";

interface CockpitCategoryChartProps {
  data: Record<string, number>;
}

export function CockpitCategoryChart({ data }: CockpitCategoryChartProps) {
  const chartOption = useMemo(() => {
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const total = entries.reduce((acc, [, v]) => acc + v, 0) || 1;

    const sorted = [...entries].sort((a, b) => b[1] - a[1]);
    const seriesData = sorted.map(([name, value]) => ({
      name,
      value,
      itemStyle: {
        color: categoryColor(name),
      },
    }));

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(5, 20, 51, 0.95)",
        borderColor: "rgba(22, 119, 255, 0.5)",
        borderWidth: 1,
        textStyle: { color: "#e0f2fe", fontSize: 12 },
        formatter: (params: any) => {
          const pct = Math.round((params.value / total) * 1000) / 10;
          return `
            <div style="font-family: sans-serif; padding: 2px;">
              <span style="font-weight: 600; color: ${params.color};">${params.name}</span><br/>
              工单数量：<b style="color: #fff;">${params.value.toLocaleString()}</b> 件<br/>
              分类占比：<b style="color: #4096ff;">${pct}%</b>
            </div>
          `;
        },
      },
      title: {
        text: `${total.toLocaleString()}`,
        subtext: "诉求总数",
        left: "35%",
        top: "40%",
        textAlign: "center",
        textStyle: {
          color: "#ffffff",
          fontSize: 15,
          fontWeight: "bold",
          fontFamily: "monospace",
        },
        subtextStyle: {
          color: "#69b1ff",
          fontSize: 10,
        },
      },
      legend: {
        orient: "vertical",
        right: "3%",
        top: "middle",
        itemGap: 10,
        itemWidth: 10,
        itemHeight: 10,
        textStyle: {
          color: "#94a3b8",
          fontSize: 11,
        },
        formatter: (name: string) => {
          const item = sorted.find((s) => s[0] === name);
          const val = item ? item[1] : 0;
          const pct = Math.round((val / total) * 100);
          return `${name.slice(0, 4)} ${pct}%`;
        },
      },
      series: [
        {
          name: "诉求分类",
          type: "pie",
          radius: ["50%", "76%"],
          center: ["35%", "50%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 4,
            borderColor: "#051433",
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            scale: true,
            scaleSize: 5,
            label: {
              show: true,
              fontSize: 12,
              fontWeight: "bold",
              color: "#4096ff",
              formatter: "{b}\n{d}%",
            },
          },
          data: seriesData,
        },
      ],
    };
  }, [data]);

  const hasData = Object.keys(data).length > 0;

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-[#1677FF]/25 bg-[#051433]/85 backdrop-blur-xl overflow-hidden p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between pb-1.5 border-b border-[#1677FF]/20 shrink-0">
        <div className="flex items-center gap-2">
          <PieIcon size={15} className="text-[#4096ff]" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            七大民生诉求分类态势
          </h3>
        </div>
        <span className="text-[10px] font-mono text-[#4096ff]/80 uppercase">
          CATEGORY RATIO
        </span>
      </div>

      <div className="flex-1 w-full h-full min-h-[140px] relative flex items-center justify-center">
        {hasData ? (
          <CivicEChart option={chartOption} height="100%" className="w-full h-full" />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            暂无诉求分类数据
          </div>
        )}
      </div>
    </div>
  );
}
