"use client";

import { useEffect, useRef } from "react";
import { categoryColor } from "@/lib/civic-cluster";

declare global {
  interface Window {
    echarts?: {
      init: (el: HTMLElement) => {
        setOption: (opt: unknown) => void;
        resize: () => void;
        dispose: () => void;
        on: (event: string, query: any, handler?: any) => void;
        dispatchAction: (payload: any) => void;
        [key: string]: any;
      };
    };
  }
}

let echartsPromise: Promise<NonNullable<Window["echarts"]>> | null = null;

export function loadEcharts() {
  if (typeof window === "undefined") return Promise.reject(new Error("ssr"));
  if (window.echarts) return Promise.resolve(window.echarts);
  if (echartsPromise) return echartsPromise;
  echartsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector("script[data-civic-echarts]");
    if (existing) {
      existing.addEventListener("load", () => resolve(window.echarts!));
      existing.addEventListener("error", () => reject(new Error("echarts load failed")));
      return;
    }
    const s = document.createElement("script");
    s.src = "/civic/echarts.min.js";
    s.async = true;
    s.dataset.civicEcharts = "1";
    s.onload = () => resolve(window.echarts!);
    s.onerror = () => reject(new Error("echarts load failed"));
    document.head.appendChild(s);
  });
  return echartsPromise;
}

export function CivicEChart({
  option,
  height,
  onHover,
  hoveredName,
}: {
  option: Record<string, unknown>;
  height: number;
  onHover?: (name: string | null) => void;
  hoveredName?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const key = JSON.stringify(option);

  useEffect(() => {
    let cancelled = false;
    loadEcharts().then((echarts) => {
      if (cancelled || !ref.current) return;
      const chart = echarts.init(ref.current);
      chartInstanceRef.current = chart;
      const parsedOption = JSON.parse(key);
      chart.setOption(parsedOption);

      // 监听鼠标悬停交互：动态实时切换环形图圆心百分比与分类，并通知外部聚焦
      const defaultTitle = parsedOption.title ? JSON.parse(JSON.stringify(parsedOption.title)) : null;
      if (defaultTitle && parsedOption.series?.some((s: any) => s.type === "pie")) {
        chart.on("mouseover", "series.pie", (params: any) => {
          const pct = params.percent != null ? Number(params.percent).toFixed(1) : "0.0";
          chart.setOption({
            title: {
              ...defaultTitle,
              text: `${pct}%`,
              subtext: params.name,
              textStyle: {
                ...defaultTitle.textStyle,
                color: params.color || defaultTitle.textStyle?.color || "#1E5AFF",
              },
              subtextStyle: {
                ...defaultTitle.subtextStyle,
              },
            },
          });
          onHover?.(params.name);
        });

        chart.on("mouseout", "series.pie", () => {
          chart.setOption({
            title: defaultTitle,
          });
          onHover?.(null);
        });
      }
    });
    const onResize = () => chartInstanceRef.current?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, [key]);

  // 外部 hoverName 变化时，触发联动 highlight/downplay
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    const parsedOption = JSON.parse(key);
    const defaultTitle = parsedOption.title ? JSON.parse(JSON.stringify(parsedOption.title)) : null;
    if (hoveredName) {
      chart.dispatchAction({
        type: "highlight",
        seriesIndex: 0,
        name: hoveredName,
      });
      // 联动更新圆心文字
      const pieSeries = parsedOption.series?.find((s: any) => s.type === "pie");
      if (pieSeries && defaultTitle) {
        const item = pieSeries.data?.find((d: any) => d.name === hoveredName);
        const total = pieSeries.data?.reduce((sum: number, d: any) => sum + (d.value || 0), 0) || 1;
        if (item) {
          const pct = ((item.value / total) * 100).toFixed(1);
          chart.setOption({
            title: {
              ...defaultTitle,
              text: `${pct}%`,
              subtext: item.name,
              textStyle: {
                ...defaultTitle.textStyle,
                color: item.itemStyle?.color || defaultTitle.textStyle?.color || "#1E5AFF",
              },
            },
          });
        }
      }
    } else {
      chart.dispatchAction({
        type: "downplay",
        seriesIndex: 0,
      });
      if (defaultTitle) {
        chart.setOption({
          title: defaultTitle,
        });
      }
    }
  }, [hoveredName, key]);

  return <div ref={ref} style={{ width: "100%", height }} />;
}

export function trendOption(daily: Record<string, number>, clusters: Record<string, number> = {}) {
  const entries = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
  const dates = entries.map(([d]) => d.slice(5));
  const orders = entries.map(([, v]) => v);
  const aligned = entries.map(([d]) => clusters[d] || 0);

  return {
    grid: { left: 50, right: 50, top: 30, bottom: 36 },
    tooltip: {
      trigger: "axis",
      backgroundColor: "rgba(31,35,41,0.95)",
      borderWidth: 0,
      textStyle: { color: "#fff", fontSize: 12 },
      padding: [8, 12],
    },
    legend: { show: false },
    xAxis: {
      type: "category",
      data: dates,
      axisLine: { lineStyle: { color: "#E5E7EB" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#86909C",
        fontSize: 11,
        interval: Math.max(0, Math.floor(dates.length / 8) - 1),
        formatter: (v: string) => {
          const [m, d] = v.split("-");
          return `${parseInt(m, 10)}月${parseInt(d, 10)}日`;
        },
      },
    },
    yAxis: [
      {
        type: "value",
        name: "工单量",
        nameTextStyle: { color: "#94A3B8", fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#F0F1F3", type: "dashed" } },
        axisLabel: { color: "#94A3B8", fontSize: 10 },
      },
      {
        type: "value",
        name: "新增群组",
        nameTextStyle: { color: "#94A3B8", fontSize: 10 },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: "#94A3B8", fontSize: 10 },
        min: 0,
      },
    ],
    series: [
      {
        name: "每日工单量",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        yAxisIndex: 0,
        data: orders,
        lineStyle: { color: "#1677FF", width: 2 },
        itemStyle: { color: "#1677FF" },
        areaStyle: {
          color: {
            type: "linear",
            x: 0,
            y: 0,
            x2: 0,
            y2: 1,
            colorStops: [
              { offset: 0, color: "rgba(22,119,255,0.18)" },
              { offset: 1, color: "rgba(22,119,255,0)" },
            ],
          },
        },
      },
      {
        name: "多频群组新增",
        type: "line",
        smooth: true,
        symbol: "circle",
        symbolSize: 4,
        yAxisIndex: 1,
        data: aligned,
        lineStyle: { color: "#FF7D00", width: 2 },
        itemStyle: { color: "#FF7D00" },
      },
    ],
    animationDuration: 1200,
    animationEasing: "cubicOut",
  };
}

export function donutOption(dist: Record<string, number>) {
  const data = Object.entries(dist)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      value,
      name,
      itemStyle: { color: categoryColor(name) },
    }));
  const total = data.reduce((s, d) => s + d.value, 0);
  const topItem = data[0];
  const topPct = total > 0 && topItem ? ((topItem.value / total) * 100).toFixed(1) : "0.0";
  const topColor = topItem ? categoryColor(topItem.name) : "#1E5AFF";

  return {
    title: {
      text: `${topPct}%`,
      subtext: topItem?.name || "工单分类",
      left: "50%",
      top: "36%",
      textAlign: "center",
      itemGap: 3,
      textStyle: {
        fontSize: 28,
        fontWeight: "bold",
        color: topColor,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        lineHeight: 32,
      },
      subtextStyle: {
        fontSize: 12,
        color: "#334155",
        fontWeight: "600",
        lineHeight: 16,
      },
    },
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(30, 41, 59, 0.95)",
      borderColor: "transparent",
      textStyle: { color: "#fff", fontSize: 12 },
      formatter: (p: { name: string; value: number; percent: number }) =>
        `<b>${p.name}</b><br/>${Number(p.value).toLocaleString("zh-CN")} 件 (${Number(p.percent).toFixed(1)}%)`,
    },
    legend: {
      bottom: 0,
      left: "center",
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      itemGap: 10,
      textStyle: { color: "#64748B", fontSize: 11 },
    },
    series: [
      {
        type: "pie",
        radius: ["54%", "78%"],
        center: ["50%", "44%"],
        avoidLabelOverlap: false,
        label: {
          show: false,
        },
        labelLine: { show: false },
        data,
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: {
          scale: true,
          scaleSize: 6,
          label: {
            show: false,
          },
        },
      },
    ],
    animationDuration: 1000,
    animationEasing: "cubicOut",
  };
}

export function miniDonutOption(
  dist: Record<string, number> | Array<{ category: string; count: number }>
) {
  const entries = Array.isArray(dist)
    ? dist.map((d) => [d.category, d.count] as [string, number])
    : Object.entries(dist);

  const data = entries
    .filter(([, v]) => v > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([name, value]) => ({
      value,
      name,
      itemStyle: { color: categoryColor(name) },
    }));

  const total = data.reduce((s, d) => s + d.value, 0);
  const topItem = data[0];
  const topPct = total > 0 && topItem ? ((topItem.value / total) * 100).toFixed(1) : "0.0";
  const topColor = topItem ? categoryColor(topItem.name) : "#1677FF";

  return {
    title: {
      text: `${topPct}%`,
      subtext: topItem?.name || "分类分布",
      left: "center",
      top: "center",
      textAlign: "center",
      itemGap: 2,
      textStyle: {
        fontSize: 15,
        fontWeight: "bold",
        color: topColor,
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        lineHeight: 17,
      },
      subtextStyle: {
        fontSize: 10.5,
        color: "#64748B",
        fontWeight: "600",
        lineHeight: 13,
      },
    },
    tooltip: {
      show: false,
    },
    series: [
      {
        type: "pie",
        radius: ["58%", "88%"],
        center: ["50%", "50%"],
        avoidLabelOverlap: false,
        label: { show: false },
        itemStyle: { borderColor: "#fff", borderWidth: 2 },
        emphasis: {
          focus: "self",
          scale: true,
          scaleSize: 6,
          itemStyle: {
            shadowBlur: 10,
            shadowColor: "rgba(0, 0, 0, 0.18)",
          },
        },
        data,
      },
    ],
  };
}

export function radarOption(values: number[]) {
  const data = values.length === 5 ? values : [0, 0, 0, 0, 0];
  return {
    tooltip: {
      trigger: "item",
      backgroundColor: "rgba(15, 23, 42, 0.95)",
      borderColor: "#334155",
      textStyle: { color: "#F8FAFC", fontSize: 12 },
      formatter: (p: { value: number[] }) => {
        const names = ["关键词", "地理", "时间", "情绪", "重复度"];
        const colors = ["#2563EB", "#10B981", "#F59E0B", "#EC4899", "#8B5CF6"];
        return (
          `<b>AI 五维研判匹配度</b><br/>` +
          names
            .map((n, i) => `<span style="color:${colors[i]}">●</span> ${n}：<b>${p.value[i] ?? 0}%</b>`)
            .join("<br/>")
        );
      },
    },
    radar: {
      indicator: [
        { name: "关键词", max: 100, color: "#1D4ED8" },
        { name: "地理", max: 100, color: "#059669" },
        { name: "时间", max: 100, color: "#D97706" },
        { name: "情绪", max: 100, color: "#DB2777" },
        { name: "重复度", max: 100, color: "#7C3AED" },
      ],
      shape: "polygon",
      splitNumber: 4,
      axisName: {
        fontSize: 12,
        fontWeight: 600,
        padding: [2, 4],
      },
      splitLine: {
        lineStyle: {
          color: [
            "rgba(148, 163, 184, 0.15)",
            "rgba(148, 163, 184, 0.25)",
            "rgba(148, 163, 184, 0.35)",
            "rgba(148, 163, 184, 0.45)",
          ],
          width: 1,
        },
      },
      splitArea: {
        show: true,
        areaStyle: {
          color: [
            "rgba(241, 245, 249, 0.25)",
            "rgba(241, 245, 249, 0.45)",
            "rgba(241, 245, 249, 0.65)",
            "rgba(241, 245, 249, 0.85)",
          ],
        },
      },
      axisLine: {
        lineStyle: {
          color: "rgba(148, 163, 184, 0.3)",
          type: "dashed",
        },
      },
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: data,
            name: "研判五维匹配度",
            symbol: "circle",
            symbolSize: 6,
            lineStyle: {
              width: 2.5,
              color: "#2563EB",
              shadowColor: "rgba(37, 99, 235, 0.35)",
              shadowBlur: 8,
            },
            areaStyle: {
              color: {
                type: "radial",
                x: 0.5,
                y: 0.5,
                r: 0.5,
                colorStops: [
                  { offset: 0, color: "rgba(37, 99, 235, 0.45)" },
                  { offset: 0.6, color: "rgba(99, 102, 241, 0.3)" },
                  { offset: 1, color: "rgba(236, 72, 153, 0.15)" },
                ],
              },
            },
            itemStyle: {
              color: "#2563EB",
              borderColor: "#FFFFFF",
              borderWidth: 2,
              shadowColor: "rgba(0, 0, 0, 0.2)",
              shadowBlur: 4,
            },
          },
        ],
      },
    ],
  };
}

export function CivicHeatmap({
  regions,
  cats,
  grid,
}: {
  regions: string[];
  cats: string[];
  grid: Record<string, Record<string, number>>;
}) {
  if (!regions.length || !cats.length) return <div className="empty-hint">暂无交叉统计。请先启动 Agent 研判。</div>;
  const max = Math.max(1, ...regions.flatMap((r) => cats.map((c) => grid[r]?.[c] || 0)));
  const colors = [
    "rgb(239, 248, 255)",
    "rgb(186, 220, 255)",
    "rgb(120, 188, 255)",
    "rgb(60, 150, 255)",
    "rgb(22, 119, 255)",
    "rgb(9, 88, 217)",
  ];
  return (
    <table className="heatmap">
      <thead>
        <tr>
          <th className="row-label" />
          {cats.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {regions.map((r) => (
          <tr key={r}>
            <th className="row-label">{r}</th>
            {cats.map((c) => {
              const n = grid[r]?.[c] || 0;
              const intensity = n / max;
              const lvl =
                intensity > 0.75 ? 6 : intensity > 0.5 ? 5 : intensity > 0.3 ? 4 : intensity > 0.15 ? 3 : intensity > 0.05 ? 2 : 1;
              const bg = colors[lvl - 1];
              const textColor = lvl >= 4 ? "#fff" : "#1E5AFF";
              return (
                <td key={c} style={{ overflow: "visible" }}>
                  <div
                    className="heatmap-cell"
                    style={{ background: bg, color: textColor }}
                    title={`${r} × ${c}：${n ? n.toLocaleString("zh-CN") + " 件" : "暂无工单"}`}
                  >
                    {n ? n.toLocaleString("zh-CN") : "—"}
                  </div>
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
