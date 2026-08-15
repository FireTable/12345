"use client";

import { useEffect, useRef, useState } from "react";
import { mapColorByShare } from "@/lib/civic-cluster";

type Props = {
  counts: Record<string, number>;
  clusterCounts?: Record<string, number>;
  selected?: string;
  onSelect?: (name: string) => void;
};

export function ShundeMap({ counts, clusterCounts = {}, selected = "", onSelect }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const [ready, setReady] = useState(false);
  const [tip, setTip] = useState<{ x: number; y: number; name: string; count: number; clusters: number } | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let cancelled = false;
    fetch("/civic/shunde-map.svg")
      .then((r) => r.text())
      .then((svgText) => {
        if (cancelled || !host) return;
        host.innerHTML = svgText.replace(/<\?xml[^?]*\?>/g, "").replace(/<!DOCTYPE[^>]*>/g, "");
        const svg = host.querySelector("svg");
        if (!svg) return;
        svg.setAttribute("width", "100%");
        svg.setAttribute("height", "100%");
        svg.style.display = "block";
        setReady(true);
      })
      .catch(() => {
        if (host) host.innerHTML = '<div class="empty-hint">地图加载失败</div>';
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host || !ready) return;
    const max = Math.max(1, ...Object.values(counts));
    host.querySelectorAll<SVGElement>(".region").forEach((poly) => {
      const name = poly.dataset.name || "";
      const count = counts[name] || 0;
      poly.style.fill = mapColorByShare(count, max);
      poly.classList.toggle("is-selected", Boolean(selected) && selected === name);
    });
  }, [counts, selected, ready]);

  function onMove(e: React.MouseEvent<HTMLDivElement>) {
    const wrap = e.currentTarget;
    const target = e.target as SVGElement | null;
    const region = target?.closest?.(".region") as SVGElement | null;
    if (!region) {
      setTip(null);
      return;
    }
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

  function onClick(e: React.MouseEvent<HTMLDivElement>) {
    const target = e.target as SVGElement | null;
    const region = target?.closest?.(".region") as SVGElement | null;
    if (!region || !onSelect) return;
    const name = region.dataset.name || "";
    onSelect(selected === name ? "" : name);
  }

  const values = Object.values(counts);
  const max = values.length ? Math.max(...values) : 0;
  const legend =
    max <= 0
      ? [{ color: "#D9F7BE", label: "暂无已研判工单" }]
      : [
          { color: "#F53F3F", label: `≥ ${Math.round(max * 0.8).toLocaleString("zh-CN")}` },
          { color: "#FF7D00", label: `≥ ${Math.round(max * 0.55).toLocaleString("zh-CN")}` },
          { color: "#FFB84D", label: `≥ ${Math.round(max * 0.3).toLocaleString("zh-CN")}` },
          { color: "#52C41A", label: `< ${Math.round(max * 0.3).toLocaleString("zh-CN")}` },
        ];

  return (
    <div className="map-wrap" onMouseMove={onMove} onMouseLeave={() => setTip(null)} onClick={onClick}>
      <div ref={hostRef} className="map-svg" style={{ width: "100%", height: "100%" }} />
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
