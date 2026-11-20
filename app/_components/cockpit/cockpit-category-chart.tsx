"use client";

import React, { useMemo, useState } from "react";
import { PieChart as PieIcon } from "lucide-react";
import { CivicEChart } from "../civic/civic-charts";
import { categoryColor } from "@/lib/civic-cluster";
import type { DomainProfile } from "../civic/region-context";

interface CockpitCategoryChartProps {
  data: Record<string, number>;
  loading?: boolean;
  domainProfile?: DomainProfile | null;
}

const ECOM_FALLBACK_COLORS: Record<string, string> = {
  商品质量与破损: "#2563EB",
  物流延误与丢件: "#0891B2",
  货不对板与宣传不符: "#7C3AED",
  退款与价保纠纷: "#D97706",
  假冒伪劣与欺诈: "#E11D48",
  客服推诿与售后超时: "#4F46E5",
  食安与合规红线: "#DC2626",
};

const PALETTE_FALLBACK = [
  "#2563EB",
  "#0891B2",
  "#7C3AED",
  "#D97706",
  "#E11D48",
  "#4F46E5",
  "#10B981",
];

function resolveCategoryColor(name: string, idx: number): string {
  const fromShared = categoryColor(name);
  if (fromShared && fromShared !== "#86909C") {
    return fromShared;
  }
  const trimmed = name.trim();
  if (ECOM_FALLBACK_COLORS[trimmed]) {
    return ECOM_FALLBACK_COLORS[trimmed];
  }
  for (const [k, color] of Object.entries(ECOM_FALLBACK_COLORS)) {
    if (trimmed.includes(k) || k.includes(trimmed)) return color;
  }
  return PALETTE_FALLBACK[idx % PALETTE_FALLBACK.length];
}

export function CockpitCategoryChart({
  data,
  loading = false,
  domainProfile,
}: CockpitCategoryChartProps) {
  const [hoveredName, setHoveredName] = useState<string | null>(null);
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

  const { sorted, total, chartOption } = useMemo(() => {
    const entries = Object.entries(data).filter(([, v]) => v > 0);
    const totalCount = entries.reduce((acc, [, v]) => acc + v, 0);
    const divisor = totalCount || 1;

    const sortedItems = [...entries]
      .sort((a, b) => b[1] - a[1])
      .map(([name, value], idx) => ({
        name,
        value,
        pct: Math.round((value / divisor) * 1000) / 10,
        color: resolveCategoryColor(name, idx),
      }));

    const seriesData = sortedItems.map((item) => ({
      name: item.name,
      value: item.value,
      itemStyle: {
        color: item.color,
      },
    }));

    const option = {
      backgroundColor: "transparent",
      tooltip: {
        trigger: "item",
        backgroundColor: "rgba(9, 13, 24, 0.96)",
        borderColor: "rgba(255, 255, 255, 0.14)",
        borderWidth: 1,
        textStyle: { color: "#f1f5f9", fontSize: 12 },
        formatter: (params: any) => {
          const pct = Math.round((params.value / divisor) * 1000) / 10;
          const countLabel = isEcommerce ? "客诉数量" : "工单数量";
          return `
            <div style="font-family: sans-serif; padding: 2px;">
              <span style="font-weight: 600; color: ${params.color};">${params.name}</span><br/>
              ${countLabel}：<b style="color: #fff;">${Number(params.value).toLocaleString()}</b> 件<br/>
              分类占比：<b style="color: #38bdf8;">${pct}%</b>
            </div>
          `;
        },
      },
      title: {
        text: totalCount.toLocaleString(),
        subtext: isEcommerce ? "客诉总数" : "诉求总数",
        left: "center",
        top: "38%",
        textAlign: "center",
        itemGap: 2,
        textStyle: {
          color: "#f8fafc",
          fontSize:
            totalCount.toLocaleString().length >= 6
              ? 12
              : totalCount.toLocaleString().length >= 4
                ? 13
                : 15,
          fontWeight: "bold",
          fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        },
        subtextStyle: {
          color: "#94a3b8",
          fontSize: 9,
          width: 78,
          overflow: "truncate",
        },
      },
      legend: { show: false },
      series: [
        {
          name: isEcommerce ? "客诉分类" : "诉求分类",
          type: "pie",
          radius: ["66%", "88%"],
          center: ["50%", "50%"],
          avoidLabelOverlap: false,
          itemStyle: {
            borderRadius: 3,
            borderColor: "#0a0f1c",
            borderWidth: 1.5,
          },
          label: { show: false },
          emphasis: {
            scale: true,
            scaleSize: 4,
            label: { show: false },
          },
          data: seriesData,
        },
      ],
    };

    return { sorted: sortedItems, total: totalCount, chartOption: option };
  }, [data, isEcommerce]);

  const hasData = sorted.length > 0;

  return (
    <div className="cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <PieIcon size={14} aria-hidden="true" className="text-sky-400 shrink-0" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            {isEcommerce ? "七大电商客诉分类态势" : "七大民生诉求分类态势"}
          </h3>
        </div>
        <span className="text-[10px] font-mono text-slate-400 uppercase whitespace-nowrap shrink-0">
          CATEGORY RATIO
        </span>
      </div>

      <div className="flex-1 w-full min-h-[140px] pt-2 flex items-center gap-2.5 min-w-0 overflow-hidden">
        {hasData ? (
          <>
            <div className="w-[144px] sm:w-[158px] xl:w-[152px] h-full min-h-[132px] shrink-0 relative">
              <CivicEChart
                option={chartOption}
                height="100%"
                className="w-full h-full"
                hoveredName={hoveredName}
                onHover={setHoveredName}
              />
            </div>

            <div className="flex-1 min-w-0 h-full overflow-y-auto custom-cockpit-scrollbar pr-1 flex flex-col">
              <div className="my-auto flex flex-col gap-0.5 min-w-0">
                {sorted.map((item) => {
                  const isActive = hoveredName === item.name;
                  return (
                    <div
                      key={item.name}
                      onMouseEnter={() => setHoveredName(item.name)}
                      onMouseLeave={() => setHoveredName(null)}
                      className={`flex items-center justify-between gap-2 px-1.5 py-[3px] rounded-md transition-colors cursor-default min-w-0 ${
                        isActive ? "bg-white/[0.08]" : "hover:bg-white/[0.04]"
                      }`}
                    >
                      <div className="flex items-center gap-1.5 min-w-0 flex-1">
                        <span
                          aria-hidden="true"
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: item.color }}
                        />
                        <span
                          className="text-[11px] text-slate-200 cockpit-single-line leading-tight"
                          title={`${item.name} (${item.value.toLocaleString()} 件)`}
                        >
                          {item.name}
                        </span>
                      </div>
                      <span className="text-[11px] font-mono tabular-nums text-slate-400 whitespace-nowrap shrink-0 leading-tight">
                        {item.pct.toFixed(1)}%
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </>
        ) : (
          <div className="w-full h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            {loading
              ? "正在读取..."
              : isEcommerce
                ? "暂无客诉分类数据"
                : "暂无诉求分类数据"}
          </div>
        )}
      </div>
    </div>
  );
}
