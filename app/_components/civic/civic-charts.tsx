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

export function CivicEChart({ option, height }: { option: Record<string, unknown>; height: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const key = JSON.stringify(option);

  useEffect(() => {
    let chart: ReturnType<NonNullable<Window["echarts"]>["init"]> | null = null;
    let cancelled = false;
    loadEcharts().then((echarts) => {
      if (cancelled || !ref.current) return;
      chart = echarts.init(ref.current);
      chart.setOption(JSON.parse(key));
    });
    const onResize = () => chart?.resize();
    window.addEventListener("resize", onResize);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      chart?.dispose();
    };
  }, [key]);

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
        color: "#1E293B",
        fontFamily: "ui-sans-serif, system-ui, -apple-system, sans-serif",
        lineHeight: 32,
      },
      subtextStyle: {
        fontSize: 12,
        color: "#64748B",
        fontWeight: "500",
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
      icon: "circle",
      itemWidth: 8,
      itemHeight: 8,
      textStyle: { color: "#64748B", fontSize: 11 },
      formatter: (name: string) => {
        const d = data.find((x) => x.name === name);
        const pct = d && total ? ((d.value / total) * 100).toFixed(1) : "0.0";
        return `${name} ${pct}%`;
      },
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

export function radarOption(values: number[]) {
  const data = values.length === 5 ? values : [0, 0, 0, 0, 0];
  return {
    tooltip: { trigger: "item" },
    radar: {
      indicator: [
        { name: "关键词", max: 100 },
        { name: "地理", max: 100 },
        { name: "时间", max: 100 },
        { name: "情绪", max: 100 },
        { name: "重复度", max: 100 },
      ],
      shape: "polygon",
      splitNumber: 4,
      axisName: { color: "#64748B", fontSize: 11 },
      splitLine: { lineStyle: { color: "rgba(22,119,255,0.12)" } },
      splitArea: { areaStyle: { color: ["rgba(22,119,255,0.02)", "rgba(22,119,255,0.05)"] } },
      axisLine: { lineStyle: { color: "rgba(22,119,255,0.15)" } },
    },
    series: [
      {
        type: "radar",
        data: [
          {
            value: data,
            name: "匹配度",
            symbol: "circle",
            symbolSize: 4,
            lineStyle: { color: "#1E5AFF", width: 2 },
            areaStyle: { color: "rgba(22,119,255,0.18)" },
            itemStyle: { color: "#1E5AFF" },
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
  if (!regions.length || !cats.length) return <div className="empty-hint">暂无交叉统计。请先启动 AI 聚类。</div>;
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
                <td key={c}>
                  <div className="heatmap-cell" style={{ background: bg, color: textColor }}>
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
