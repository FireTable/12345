"use client";

import { useEffect, useRef, useState } from "react";
import { categoryColor } from "@/lib/civic-cluster";

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function cloneOptionPreservingFunctions<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  if (value instanceof Date) {
    return new Date(value.getTime()) as T;
  }
  if (value instanceof RegExp) {
    return new RegExp(value.source, value.flags) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cloneOptionPreservingFunctions(item)) as T;
  }
  const cloned: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    cloned[k] = cloneOptionPreservingFunctions(v);
  }
  return cloned as T;
}

function serializeOptionKey(option: unknown): string {
  return JSON.stringify(option, (_k, v) =>
    typeof v === "function" ? `__fn__:${v.toString()}` : v
  );
}

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
    let settled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const cleanupTimer = () => {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
    };

    const fail = (message: string, scriptEl?: Element | null) => {
      if (settled) return;
      settled = true;
      cleanupTimer();
      echartsPromise = null;
      if (scriptEl) {
        try {
          scriptEl.setAttribute("data-civic-echarts-state", "failed");
          scriptEl.remove();
        } catch {}
      }
      reject(new Error(message));
    };

    const succeed = (scriptEl?: Element | null) => {
      if (settled) return;
      if (window.echarts) {
        settled = true;
        cleanupTimer();
        if (scriptEl) {
          try {
            scriptEl.setAttribute("data-civic-echarts-state", "loaded");
          } catch {}
        }
        resolve(window.echarts);
        return;
      }
      fail("echarts global missing after script load", scriptEl);
    };

    const existing = document.querySelector("script[data-civic-echarts]");
    if (existing) {
      const state = existing.getAttribute("data-civic-echarts-state");
      if (state === "failed" || (state === "loaded" && !window.echarts)) {
        try {
          existing.remove();
        } catch {}
      } else {
        const onLoad = () => {
          existing.removeEventListener("error", onError);
          succeed(existing);
        };
        const onError = () => {
          existing.removeEventListener("load", onLoad);
          fail("echarts load failed", existing);
        };
        existing.addEventListener("load", onLoad, { once: true });
        existing.addEventListener("error", onError, { once: true });
        timer = setTimeout(() => {
          existing.removeEventListener("load", onLoad);
          existing.removeEventListener("error", onError);
          fail("echarts load timeout", existing);
        }, 15_000);
        return;
      }
    }

    const s = document.createElement("script");
    s.src = "/civic/echarts.min.js";
    s.async = true;
    s.dataset.civicEcharts = "1";
    s.dataset.civicEchartsState = "loading";
    s.onload = () => succeed(s);
    s.onerror = () => fail("echarts load failed", s);
    timer = setTimeout(() => fail("echarts load timeout", s), 15_000);
    document.head.appendChild(s);
  });

  return echartsPromise;
}

export function CivicEChart({
  option,
  height = "100%",
  className = "",
  onHover,
  hoveredName,
}: {
  option: Record<string, unknown>;
  height?: number | string;
  className?: string;
  onHover?: (name: string | null) => void;
  hoveredName?: string | null;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const chartInstanceRef = useRef<any>(null);
  const optionRef = useRef(option);
  optionRef.current = option;
  const onHoverRef = useRef(onHover);
  onHoverRef.current = onHover;
  const key = serializeOptionKey(option);
  const [loadState, setLoadState] = useState<"loading" | "ready" | "error">("loading");
  const [errorMsg, setErrorMsg] = useState("");
  const [retryCount, setRetryCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoadState("loading");
    setErrorMsg("");

    loadEcharts()
      .then((echarts) => {
        if (cancelled || !ref.current) return;
        try {
          const chart = echarts.init(ref.current);
          chartInstanceRef.current = chart;
          const parsedOption = cloneOptionPreservingFunctions(optionRef.current) as Record<
            string,
            any
          >;
          if (prefersReducedMotion()) {
            parsedOption.animation = false;
          }
          // Narrow mobile screens: let ECharts auto-space category dates cleanly across full width
          const containerW = ref.current.clientWidth || 0;
          if (
            containerW > 0 &&
            containerW < 520 &&
            parsedOption.xAxis &&
            !Array.isArray(parsedOption.xAxis) &&
            parsedOption.xAxis.type === "category" &&
            Array.isArray(parsedOption.xAxis.data)
          ) {
            const prevLabel = parsedOption.xAxis.axisLabel || {};
            parsedOption.xAxis = {
              ...parsedOption.xAxis,
              axisLabel: {
                ...prevLabel,
                hideOverlap: true,
                interval: "auto",
              },
            };
          }
          chart.setOption(parsedOption);

          // 监听鼠标悬停交互：动态实时切换环形图圆心百分比与分类，并通知外部聚焦
          const defaultTitle = parsedOption.title
            ? cloneOptionPreservingFunctions(parsedOption.title)
            : null;
          if (parsedOption.series?.some((s: any) => s.type === "pie")) {
            chart.on("mouseover", "series.pie", (params: any) => {
              const pct = params.percent != null ? Number(params.percent).toFixed(1) : "0.0";
              if (defaultTitle && defaultTitle.show !== false) {
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
              }
              onHoverRef.current?.(params.name);
            });

            chart.on("mouseout", "series.pie", () => {
              if (defaultTitle && defaultTitle.show !== false) {
                chart.setOption({
                  title: defaultTitle,
                });
              }
              onHoverRef.current?.(null);
            });
          }
          setLoadState("ready");
        } catch (err) {
          chartInstanceRef.current?.dispose?.();
          chartInstanceRef.current = null;
          setLoadState("error");
          setErrorMsg(err instanceof Error ? err.message : "图表初始化失败");
        }
      })
      .catch((err) => {
        if (cancelled) return;
        setLoadState("error");
        setErrorMsg(err instanceof Error ? err.message : "图表引擎加载失败");
      });

    const onResize = () => chartInstanceRef.current?.resize();
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver !== "undefined" && ref.current ? new ResizeObserver(() => {
      chartInstanceRef.current?.resize();
    }) : null;
    if (ref.current && ro) {
      ro.observe(ref.current);
    }

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      chartInstanceRef.current?.dispose();
      chartInstanceRef.current = null;
    };
  }, [key, retryCount]);

  // 外部 hoverName 变化时，触发联动 highlight/downplay
  useEffect(() => {
    const chart = chartInstanceRef.current;
    if (!chart) return;
    const parsedOption = cloneOptionPreservingFunctions(optionRef.current) as Record<
      string,
      any
    >;
    const defaultTitle = parsedOption.title
      ? cloneOptionPreservingFunctions(parsedOption.title)
      : null;
    if (hoveredName) {
      chart.dispatchAction({
        type: "highlight",
        seriesIndex: 0,
        name: hoveredName,
      });
      // 联动更新圆心文字
      const pieSeries = parsedOption.series?.find((s: any) => s.type === "pie");
      if (pieSeries && defaultTitle && defaultTitle.show !== false) {
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
      if (defaultTitle && defaultTitle.show !== false) {
        chart.setOption({
          title: defaultTitle,
        });
      }
    }
  }, [hoveredName, key]);

  const heightStyle = typeof height === "number" ? `${height}px` : height;
  return (
    <div className={className} style={{ position: "relative", width: "100%", height: heightStyle }}>
      <div ref={ref} style={{ width: "100%", height: "100%" }} />
      {loadState === "error" && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-lg bg-slate-50/95 p-4 text-center border border-slate-200">
          <p className="text-xs font-medium text-slate-700">图表加载失败</p>
          {errorMsg ? <p className="text-[11px] text-slate-500 max-w-xs break-words">{errorMsg}</p> : null}
          <button
            type="button"
            onClick={() => setRetryCount((c) => c + 1)}
            className="btn btn--default min-h-[44px] sm:min-h-[32px] px-3 text-xs"
          >
            重试加载图表
          </button>
        </div>
      )}
    </div>
  );
}

export function trendOption(daily: Record<string, number>, clusters: Record<string, number> = {}) {
  const entries = Object.entries(daily).sort((a, b) => a[0].localeCompare(b[0]));
  const dates = entries.map(([d]) => d);
  const orders = entries.map(([, v]) => v);
  const aligned = entries.map(([d]) => clusters[d] || 0);
  const crossYear = new Set(dates.map((d) => d.slice(0, 4))).size > 1;

  return {
    grid: {
      left: 16,
      right: 16,
      top: 36,
      bottom: 24,
      containLabel: true,
    },
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
        hideOverlap: true,
        interval: Math.max(0, Math.ceil(dates.length / 6) - 1),
        formatter: (v: string) => {
          const parts = v.split("-");
          if (parts.length >= 3) {
            const year = parts[0] || "";
            const month = parseInt(parts[1] || "", 10);
            const day = parseInt(parts[2] || "", 10);
            if (crossYear) return `${year.slice(2)}/${month}/${day}`;
            return `${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
          }
          const [m, d] = v.split("-");
          return `${String(parseInt(m, 10)).padStart(2, "0")}/${String(parseInt(d, 10)).padStart(2, "0")}`;
        },
      },
    },
    yAxis: [
      {
        type: "value",
        name: "工单量",
        nameTextStyle: { color: "#94A3B8", fontSize: 11, align: "left" },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { lineStyle: { color: "#F0F1F3", type: "dashed" } },
        axisLabel: { color: "#94A3B8", fontSize: 11 },
      },
      {
        type: "value",
        name: "新增群组",
        nameTextStyle: { color: "#94A3B8", fontSize: 11, align: "right" },
        axisLine: { show: false },
        axisTick: { show: false },
        splitLine: { show: false },
        axisLabel: { color: "#94A3B8", fontSize: 11 },
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
    animation: !prefersReducedMotion(),
    animationDuration: prefersReducedMotion() ? 0 : 1200,
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
        `<b>${escapeHtml(p.name)}</b><br/>${Number(p.value).toLocaleString("zh-CN")} 件 (${Number(p.percent).toFixed(1)}%)`,
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
    animation: !prefersReducedMotion(),
    animationDuration: prefersReducedMotion() ? 0 : 1000,
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
    animation: !prefersReducedMotion(),
    title: {
      show: false,
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
    animation: !prefersReducedMotion(),
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
    "#EFF8FF",
    "#BADFFF",
    "#7CC0FF",
    "#1D68D8",
    "#0E52C4",
    "#063A9B",
  ];
  return (
    <table className="heatmap">
      <caption className="sr-only">区域与诉求类型交叉分布热力矩阵</caption>
      <thead>
        <tr>
          <th scope="col" className="row-label">
            <span className="sr-only">区域</span>
          </th>
          {cats.map((c) => (
            <th key={c} scope="col">{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {regions.map((r) => (
          <tr key={r}>
            <th scope="row" className="row-label">{r}</th>
            {cats.map((c) => {
              const n = grid[r]?.[c] || 0;
              const intensity = n / max;
              const lvl =
                intensity > 0.75 ? 6 : intensity > 0.5 ? 5 : intensity > 0.3 ? 4 : intensity > 0.15 ? 3 : intensity > 0.05 ? 2 : 1;
              const bg = colors[lvl - 1];
              const textColor = lvl >= 4 ? "#FFFFFF" : "#0B2559";
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
