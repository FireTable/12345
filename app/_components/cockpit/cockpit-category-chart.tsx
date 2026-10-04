"use client";

import React, { useMemo } from "react";
import { PieChart as PieIcon } from "lucide-react";
import { CivicEChart } from "../civic/civic-charts";

interface CockpitCategoryChartProps {
  data: Record<string, number>;
}

export function CockpitCategoryChart({ data }: CockpitCategoryChartProps) {
  const chartOption = useMemo(() => {
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const total = entries.reduce((acc, [, v]) => acc + v, 0) || 1;

    // 格式化为 ECharts 系列数据，按数量从多到少排序
    const sorted = entries.sort((a, b) => b[1] - a[1]);
    const seriesData = sorted.map(([name, value]) => ({
      name,
      value,
    }));

    const colors = [
      "#00f2fe", // 极光青
      "#1890ff", // 科技蓝
      "#52c41a", // 翡翠绿
      "#faad14", // 琥珀黄
      "#722ed1", // 紫晶
      "#f5222d", // 珊瑚红
      "#13c2c2", // 湖蓝
      "#fa8c16", // 橘橙
    ];

    return {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(5, 14, 33, 0.95)",
        borderColor: "rgba(0, 242, 254, 0.4)",
        borderWidth: 1,
        textStyle: { color: "#e0f2fe", fontSize: 12 },
        formatter: (params: any) => {
          const pct = Math.round((params.value / total) * 1000) / 10;
          return `
            <div style="font-family: sans-serif; padding: 2px;">
              <span style="font-weight: 600; color: #38bdf8;">${params.name}</span><br/>
              工单数量：<b style="color: #fff;">${params.value.toLocaleString()}</b> 件<br/>
              全域占比：<b style="color: #00f2fe;">${pct}%</b>
            </div>
          `;
        },
      },
      legend: {
        orient: "vertical",
        right: "4%",
        top: "middle",
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
          radius: ["50%", "75%"],
          center: ["36%", "50%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 5,
            borderColor: "#061226",
            borderWidth: 2,
          },
          label: {
            show: false,
          },
          emphasis: {
            scale: true,
            scaleSize: 6,
            label: {
              show: true,
              fontSize: 12,
              fontWeight: "bold",
              color: "#38bdf8",
              formatter: "{b}\n{d}%",
            },
          },
          color: colors,
          data: seriesData,
        },
      ],
    };
  }, [data]);

  const hasData = Object.keys(data).length > 0;

  return (
    <div className="w-full h-full flex flex-col rounded-xl border border-cyan-500/20 bg-[#061226]/85 backdrop-blur-md overflow-hidden p-3.5 shadow-lg">
      <div className="flex items-center justify-between pb-1.5 border-b border-cyan-500/15 shrink-0">
        <div className="flex items-center gap-2">
          <PieIcon size={14} className="text-cyan-400" />
          <h3 className="text-xs font-semibold text-slate-200 tracking-wider">
            七大民生诉求分类态势
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400">CATEGORY RATIO</span>
      </div>

      <div className="flex-1 min-h-[160px] relative">
        {hasData ? (
          <CivicEChart option={chartOption} height={160} />
        ) : (
          <div className="h-full flex items-center justify-center text-xs text-slate-500 font-mono">
            暂无诉求分类数据
          </div>
        )}
      </div>
    </div>
  );
}
