"use client";

import React, { useEffect, useRef, useState } from "react";
import { mapColorByShare } from "@/lib/civic-cluster";
import { useRegion } from "./region-context";
import { MapPin, Layers, Building } from "lucide-react";

export type CivicMapProps = {
  counts: Record<string, number>;
  clusterCounts?: Record<string, number>;
  selected?: string;
  onSelect?: (name: string) => void;
  svgPath?: string | null;
  townships?: string[];
};

export function CivicMap({
  counts,
  clusterCounts = {},
  selected = "",
  onSelect,
  svgPath,
  townships = [],
}: CivicMapProps) {
  const { activeRegion } = useRegion();
  const hostRef = useRef<HTMLDivElement>(null);
  const [svgReady, setSvgReady] = useState(false);
  const [svgFailed, setSvgFailed] = useState(false);
  const [tip, setTip] = useState<{
    x: number;
    y: number;
    name: string;
    count: number;
    clusters: number;
  } | null>(null);

  // 决定 SVG 路径
  const activeSvgPath = svgPath !== undefined ? svgPath : activeRegion?.svgMapPath;

  // 1. 加载 SVG 地图
  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    if (!activeSvgPath) {
      setSvgFailed(true);
      setSvgReady(false);
      return;
    }

    let cancelled = false;
    setSvgReady(false);
    setSvgFailed(false);

    fetch(activeSvgPath)
      .then((r) => {
        if (!r.ok) throw new Error("SVG not found");
        return r.text();
      })
      .then((svgText) => {
        if (cancelled || !host) return;
        if (!svgText.includes("<svg") || !svgText.includes("class=\"region\"") && !svgText.includes("class='region'")) {
          // 如果 SVG 中不包含 .region 交互类名，依然允许渲染，但若无交互元素可降级
        }
        host.innerHTML = svgText.replace(/<\?xml[^?]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/g, "");
        const svg = host.querySelector("svg");
        if (!svg) throw new Error("Invalid SVG");
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block";
        setSvgReady(true);
        setSvgFailed(false);
      })
      .catch(() => {
        if (!cancelled) {
          setSvgFailed(true);
          setSvgReady(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeSvgPath]);

  function bringToFront(el: SVGElement) {
    const parent = el.parentElement;
    if (!parent) return;
    const labelsGroup = parent.querySelector("g");
    if (labelsGroup && el.nextElementSibling !== labelsGroup) {
      parent.insertBefore(el, labelsGroup);
    } else if (!labelsGroup && parent.lastElementChild !== el) {
      parent.appendChild(el);
    }
  }

  // 2. SVG 颜色与选中状态更新
  useEffect(() => {
    const host = hostRef.current;
    if (!host || !svgReady) return;
    const max = Math.max(1, ...Object.values(counts));
    const isEmpty = Object.values(counts).every((v) => !v);

    host.querySelectorAll<SVGElement>(".region").forEach((poly) => {
      const name = poly.dataset.name || "";
      const count = counts[name] || 0;
      poly.style.fill = isEmpty ? "#E5E7EB" : mapColorByShare(count, max);
      const isSel = Boolean(selected) && selected === name;
      poly.classList.toggle("is-selected", isSel);
      if (isSel) {
        bringToFront(poly);
      }
    });
  }, [counts, selected, svgReady]);

  function onSvgMove(e: React.MouseEvent<HTMLDivElement>) {
    const wrap = e.currentTarget;
    const target = e.target as SVGElement | null;
    const region = target?.closest?.(".region") as SVGElement | null;
    if (!region) {
      setTip(null);
      return;
    }
    bringToFront(region);
    const name = region.dataset.name || "";
    const rect = wrap.getBoundingClientRect();
    setTip({
      x: Math.min(e.clientX - rect.left + 12, rect.width - 160),
      y: e.clientY - rect.top + 12,
      name,
      count: counts[name] || 0,
      clusters: clusterCounts[name] || 0,
    });
  }

  function onSvgClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as SVGElement | null;
    const region = target?.closest?.(".region") as SVGElement | null;
    if (!region || !onSelect) return;
    const name = region.dataset.name || "";
    bringToFront(region);
    onSelect(selected === name ? "" : name);
  }

  const values = Object.values(counts);
  const max = values.length ? Math.max(...values) : 0;
  const isEmpty = max <= 0;
  const legend = isEmpty
    ? [{ color: "#E5E7EB", label: "暂无已研判工单" }]
    : [
        { color: "#F53F3F", label: `≥ ${Math.round(max * 0.8).toLocaleString("zh-CN")}` },
        { color: "#FF7D00", label: `≥ ${Math.round(max * 0.55).toLocaleString("zh-CN")}` },
        { color: "#FFB84D", label: `≥ ${Math.round(max * 0.3).toLocaleString("zh-CN")}` },
        { color: "#52C41A", label: `< ${Math.round(max * 0.3).toLocaleString("zh-CN")}` },
      ];

  // 计算需要展示的镇街列表（兼顾 counts 和外部传入列表）
  const allTownNames = Array.from(
    new Set([...townships, ...Object.keys(counts), ...Object.keys(clusterCounts)])
  ).filter(Boolean);

  // 如果加载了 SVG 地图，走标准 SVG 渲染模式
  if (svgReady && !svgFailed) {
    return (
      <div
        className="map-wrap"
        onMouseMove={onSvgMove}
        onMouseLeave={() => setTip(null)}
        onClick={onSvgClick}
      >
        <div ref={hostRef} className="map-svg" style={{ width: "100%", height: "100%" }} />
        {isEmpty && <div className="map-empty">暂无镇街研判数据</div>}
        {tip && (
          <div className="map-tooltip is-show" style={{ left: tip.x, top: tip.y }}>
            <div className="map-tooltip__title">{tip.name}</div>
            <div className="map-tooltip__row">
              <span>工单数</span>
              <span className="map-tooltip__val">{tip.count.toLocaleString("zh-CN")}</span>
            </div>
            <div className="map-tooltip__row">
              <span>聚类数</span>
              <span className="map-tooltip__val">{tip.clusters.toLocaleString("zh-CN")}</span>
            </div>
          </div>
        )}
        <div className="map-legend">
          <div className="map-legend__title">工单密度</div>
          {legend.map((l) => (
            <div key={l.color} className="map-legend__row">
              <span className="map-legend__color" style={{ background: l.color }} />
              {l.label}
            </div>
          ))}
        </div>
      </div>
    );
  }

  // 兜底降级：自适应网格热力矩阵 (Township Grid Heatmap Matrix)
  return (
    <div className="w-full h-full flex flex-col justify-between p-3 select-none">
      {/* 顶部标题与提示 */}
      <div className="flex items-center justify-between pb-2 border-b border-slate-100 mb-3">
        <div className="flex items-center gap-1.5 text-xs font-semibold text-slate-700">
          <Building className="h-3.5 w-3.5 text-blue-600" />
          <span>{activeRegion?.name || "本辖区"} · 镇街网格工单热度矩阵</span>
        </div>
        <span className="text-[11px] text-slate-400">
          点击镇街卡片筛选 · 色块深度代表诉求集中度
        </span>
      </div>

      {/* 矩阵主体 */}
      {allTownNames.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-slate-400 text-xs py-12">
          <MapPin className="h-6 w-6 text-slate-300 mb-2" />
          <span>暂无该辖区镇街分布数据</span>
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5 flex-1 overflow-y-auto max-h-[380px] p-1">
          {allTownNames.map((town) => {
            const count = counts[town] || 0;
            const clusters = clusterCounts[town] || 0;
            const isSelected = selected === town;
            const color = isEmpty ? "#E5E7EB" : mapColorByShare(count, max);

            return (
              <div
                key={town}
                onClick={() => onSelect && onSelect(isSelected ? "" : town)}
                className={`relative rounded-xl border p-3 cursor-pointer transition-all duration-150 flex flex-col justify-between ${
                  isSelected
                    ? "border-blue-600 ring-2 ring-blue-500/20 bg-blue-50/50 shadow-xs"
                    : "border-slate-200/80 bg-white hover:border-slate-300 hover:shadow-2xs"
                }`}
              >
                {/* 顶部状态色块 */}
                <div className="flex items-center justify-between mb-1.5">
                  <span className="text-xs font-bold text-slate-800">{town}</span>
                  <span
                    className="h-2.5 w-2.5 rounded-full border border-black/10 shrink-0"
                    style={{ backgroundColor: color }}
                    title={`诉求密度: ${count}`}
                  />
                </div>

                {/* 数量对比 */}
                <div className="flex items-center justify-between text-[11px] text-slate-500 pt-1">
                  <span>工单</span>
                  <span className="font-bold text-slate-900 font-mono">
                    {count.toLocaleString("zh-CN")}
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-slate-400 pt-0.5">
                  <span>多频群组</span>
                  <span className="font-semibold text-blue-600 font-mono">
                    {clusters}
                  </span>
                </div>

                {/* 底部热度条 */}
                <div className="w-full bg-slate-100 rounded-full h-1 mt-2 overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${max > 0 ? Math.min(100, Math.round((count / max) * 100)) : 0}%`,
                      backgroundColor: color,
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* 底部图例栏 */}
      <div className="flex items-center justify-between pt-3 mt-2 border-t border-slate-100 text-[11px] text-slate-500">
        <span className="font-medium text-slate-600">热度分级:</span>
        <div className="flex items-center gap-3">
          {legend.map((l) => (
            <div key={l.color} className="flex items-center gap-1">
              <span
                className="w-2.5 h-2.5 rounded-xs inline-block"
                style={{ background: l.color }}
              />
              <span className="text-[10px]">{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 保持向下兼容导出
export { CivicMap as ShundeMap };
