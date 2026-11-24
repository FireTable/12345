"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, ZoomIn, ZoomOut } from "lucide-react";
import { getTiandituTileUrls } from "@/lib/map/tile-layer";
import { useRegion } from "./region-context";

export function safeCssColor(value: string | undefined, fallback: string): string {
  const trimmed = (value || "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

function buildCivicTooltipElement(
  primaryText: string,
  township?: string,
  variant: "single" | "multi" = "single"
): HTMLElement {
  const wrapper = document.createElement("div");
  wrapper.className = "civic-tooltip-bubble";
  wrapper.style.position = "relative";
  wrapper.style.display = "inline-flex";
  wrapper.style.alignItems = "center";
  wrapper.style.gap = variant === "single" ? "6px" : "5px";
  wrapper.style.background = "#ffffff";
  wrapper.style.border = "1px solid #CBD5E1";
  wrapper.style.padding = variant === "single" ? "4px 8px" : "3px 8px";
  wrapper.style.borderRadius = variant === "single" ? "6px" : "5px";
  wrapper.style.boxShadow =
    variant === "single"
      ? "0 4px 12px rgba(15, 23, 42, 0.16)"
      : "0 3px 10px rgba(15, 23, 42, 0.14)";
  wrapper.style.fontFamily = "ui-sans-serif, system-ui, -apple-system, sans-serif";
  wrapper.style.whiteSpace = "nowrap";
  if (variant === "multi") {
    wrapper.style.fontSize = "11px";
  }

  const makeBadge = (text: string) => {
    const badge = document.createElement("span");
    badge.style.background = "#EFF6FF";
    badge.style.color = "#1E5AFF";
    badge.style.fontSize = "10px";
    badge.style.fontWeight = "600";
    badge.style.padding = variant === "single" ? "1px 5px" : "0 4px";
    badge.style.borderRadius = variant === "single" ? "4px" : "3px";
    if (variant === "single") {
      badge.style.border = "1px solid #DBEAFE";
    }
    badge.textContent = text;
    return badge;
  };

  const labelSpan = document.createElement("span");
  labelSpan.style.fontWeight = variant === "single" ? "700" : "600";
  labelSpan.style.color = "#0F172A";
  if (variant === "single") {
    labelSpan.style.fontSize = "11px";
  }
  labelSpan.textContent = primaryText;

  if (variant === "single") {
    wrapper.appendChild(labelSpan);
    if (township) wrapper.appendChild(makeBadge(township));
  } else {
    if (township) wrapper.appendChild(makeBadge(township));
    wrapper.appendChild(labelSpan);
  }

  const arrow = document.createElement("div");
  arrow.style.position = "absolute";
  arrow.style.bottom = "-4px";
  arrow.style.left = "50%";
  arrow.style.transform = "translateX(-50%) rotate(45deg)";
  arrow.style.width = variant === "single" ? "7px" : "6px";
  arrow.style.height = variant === "single" ? "7px" : "6px";
  arrow.style.background = "#ffffff";
  arrow.style.borderRight = "1px solid #CBD5E1";
  arrow.style.borderBottom = "1px solid #CBD5E1";
  wrapper.appendChild(arrow);

  return wrapper;
}

function buildCivicPopupElement(point: GeoPoint): HTMLElement {
  const root = document.createElement("div");
  root.style.padding = "6px";
  root.style.fontFamily = "ui-sans-serif, system-ui";
  root.style.fontSize = "12px";
  root.style.minWidth = "200px";

  const titleEl = document.createElement("div");
  titleEl.style.fontWeight = "700";
  titleEl.style.color = "#0F172A";
  titleEl.style.fontSize = "13px";
  titleEl.style.marginBottom = "4px";
  titleEl.textContent = point.title || "工单事发地";
  root.appendChild(titleEl);

  if (point.township) {
    const townEl = document.createElement("div");
    townEl.style.color = "#1E5AFF";
    townEl.style.fontWeight = "600";
    townEl.style.fontSize = "11px";
    townEl.style.marginBottom = "3px";
    townEl.textContent = `所属镇街: ${point.township}`;
    root.appendChild(townEl);
  }

  const addrEl = document.createElement("div");
  addrEl.style.color = "#475569";
  addrEl.style.lineHeight = "1.4";
  addrEl.style.fontSize = "11px";
  addrEl.textContent = `详细位置: ${point.address || "无具体门牌"}`;
  root.appendChild(addrEl);

  const coordEl = document.createElement("div");
  coordEl.style.color = "#94A3B8";
  coordEl.style.fontSize = "10px";
  coordEl.style.marginTop = "4px";
  coordEl.style.fontFamily = "monospace";
  coordEl.textContent = `坐标: ${point.lng.toFixed(5)}, ${point.lat.toFixed(5)}`;
  root.appendChild(coordEl);

  return root;
}

export type GeoPoint = {
  id?: string;
  lng: number;
  lat: number;
  title?: string;
  subTitle?: string;
  address?: string;
  township?: string;
  category?: string;
  color?: string;
  badge?: string;
  isMain?: boolean;
  raw?: unknown;
};

export type CivicGeoMapProps = {
  mode?: "single" | "multi" | "picker";
  center?: [number, number];
  zoom?: number;
  height?: number | string;
  className?: string;
  point?: GeoPoint | null;
  /** 同专题/群组的相关工单位置列表 */
  relatedPoints?: GeoPoint[];
  points?: GeoPoint[];
  onLocationPick?: (res: {
    lng: number;
    lat: number;
    formattedAddress?: string;
    township?: string;
    district?: string;
    road?: string;
  }) => void;
  onPointClick?: (point: GeoPoint) => void;
  showControls?: boolean;
  selectedPointId?: string | null;
};

const DEFAULT_CENTER: [number, number] = [113.25368, 22.80477];

function isValidCoordPair<T extends { lng?: unknown; lat?: unknown }>(
  p?: T | null
): p is T & { lng: number; lat: number } {
  return (
    typeof p?.lng === "number" &&
    Number.isFinite(p.lng) &&
    typeof p?.lat === "number" &&
    Number.isFinite(p.lat)
  );
}

export function CivicGeoMap({
  mode = "single",
  center,
  zoom = 15,
  height = 300,
  className = "",
  point,
  relatedPoints = [],
  points = [],
  onLocationPick,
  onPointClick,
  showControls = true,
  selectedPointId,
}: CivicGeoMapProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<LeafletMarker[]>([]);
  const lastPointsKeyRef = useRef<string>("");
  const onPointClickRef = useRef(onPointClick);
  const pointRef = useRef(point);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
    pointRef.current = point;
  });

  const { activeRegion } = useRegion();
  const isTianhe =
    activeRegion?.id?.includes("tianhe") ||
    activeRegion?.name?.includes("天河") ||
    activeRegion?.city?.includes("广州");
  const fallbackCenter: [number, number] = isTianhe ? [113.36, 23.14] : DEFAULT_CENTER;

  // 1. 初始化地图并建立自适应居中监听
  useEffect(() => {
    let isMounted = true;
    const reCenterTimers: Array<ReturnType<typeof setTimeout>> = [];
    let observer: ResizeObserver | null = null;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = (await import("leaflet")).default;
      if (!isMounted || !containerRef.current || mapRef.current) return;

      const currentPoint = pointRef.current;
      const targetLat = isValidCoordPair(currentPoint)
        ? currentPoint.lat
        : center && Number.isFinite(center[1])
          ? center[1]
          : fallbackCenter[1];
      const targetLng = isValidCoordPair(currentPoint)
        ? currentPoint.lng
        : center && Number.isFinite(center[0])
          ? center[0]
          : fallbackCenter[0];

      const map = L.map(containerRef.current, {
        center: [targetLat, targetLng],
        zoom: currentPoint ? 15 : zoom,
        zoomControl: false,
        attributionControl: false,
      });

      const { vecUrl, cvaUrl, subdomains } = getTiandituTileUrls();
      const baseTileOptions = {
        maxZoom: 18,
        minZoom: 4,
        ...(subdomains.length > 0 ? { subdomains } : {}),
      };

      // 天地图矢量底图 (自适应前端 CDN 直连或后端代理)
      L.tileLayer(vecUrl, baseTileOptions).addTo(map);

      // 天地图中文注记 (道路、建筑物名)
      L.tileLayer(cvaUrl, baseTileOptions).addTo(map);

      mapRef.current = map;
      setLoading(false);

      // 强制在 Drawer 动画滑入完成各阶段重新校准尺寸并精准居中
      const reCenter = () => {
        if (!isMounted || mapRef.current !== map || !containerRef.current) return;
        const mapInternal = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
        if (!mapInternal._loaded || !mapInternal._mapPane) return;
        try {
          map.invalidateSize({ animate: false });
          const latestPoint = pointRef.current;
          if (isValidCoordPair(latestPoint)) {
            map.setView([latestPoint.lat, latestPoint.lng], 15, { animate: false });
          }
        } catch {}
      };

      [50, 150, 300, 500, 800].forEach((ms) => {
        reCenterTimers.push(setTimeout(reCenter, ms));
      });

      // 监听容器大小动态变化 (比如抽屉尺寸改变)
      if (typeof ResizeObserver !== "undefined" && containerRef.current) {
        observer = new ResizeObserver((entries) => {
          if (!isMounted || mapRef.current !== map || !containerRef.current) return;
          if (entries.length > 0 && (entries[0].contentRect.width <= 0 || entries[0].contentRect.height <= 0)) {
            return;
          }
          const mapInternal = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
          if (!mapInternal._loaded || !mapInternal._mapPane) return;
          try {
            map.invalidateSize({ animate: false });
          } catch {}
        });
        observer.observe(containerRef.current);
      }
    }

    initMap();

    return () => {
      isMounted = false;
      reCenterTimers.forEach((timerId) => clearTimeout(timerId));
      reCenterTimers.length = 0;
      if (observer) {
        observer.disconnect();
        observer = null;
      }
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
        mapRef.current = null;
      }
      markersRef.current = [];
      lastPointsKeyRef.current = "";
      setLoading(true);
    };
  }, [mode, activeRegion?.id]);

  // 2. 渲染标记点与悬浮标识 Tooltip
  useEffect(() => {
    if (!mapRef.current || loading) return;

    let isMounted = true;
    let boundMap: LeafletMap | null = null;
    let zoomHandler: (() => void) | null = null;

    import("leaflet").then((module) => {
      if (!isMounted || !mapRef.current) return;
      const L = module.default;
      const map = mapRef.current;
      const mapInternal = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
      if (!mapInternal._loaded || !mapInternal._mapPane) return;

      // 动态计算当前 Zoom 级别对应的 Marker 比例
      const updateMarkerScale = () => {
        if (!isMounted || mapRef.current !== map || !containerRef.current) return;
        const internal = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
        if (!internal._loaded || !internal._mapPane) return;
        const currentZoom = map.getZoom();
        let scale = 1;
        if (currentZoom >= 16) {
          scale = 1.12;
        } else if (currentZoom === 15) {
          scale = 1.0;
        } else if (currentZoom === 14) {
          scale = 0.88;
        } else if (currentZoom === 13) {
          scale = 0.76;
        } else if (currentZoom === 12) {
          scale = 0.65;
        } else {
          scale = 0.55;
        }
        // Tooltip 动态紧贴补偿：Marker 原始高度 44px，缩放时顶部降低，Tooltip 必须按比例下移紧贴
        const ty = (44 * (1 - scale)).toFixed(1);
        containerRef.current.style.setProperty("--map-marker-scale", String(scale));
        containerRef.current.style.setProperty("--map-tooltip-ty", `${ty}px`);
        containerRef.current.setAttribute("data-zoom-level", currentZoom >= 14 ? "detailed" : "macro");
      };

      boundMap = map;
      zoomHandler = updateMarkerScale;
      map.off("zoom", updateMarkerScale);
      map.off("zoomend", updateMarkerScale);
      map.on("zoom", updateMarkerScale);
      map.on("zoomend", updateMarkerScale);
      updateMarkerScale();

      // 创建主事发地点大号 Pin（带脉冲微光晕）
      const createMainPinIcon = (color = "#1E5AFF") => {
        const safeColor = safeCssColor(color, "#1E5AFF");
        const pulseBg = safeColor.length === 7 ? `${safeColor}40` : safeColor;
        const html = `
          <div class="civic-pin-anchor" style="position: relative; width: 36px; height: 44px; transform-origin: 50% 100%; transition: transform 0.15s ease-out; transform: scale(var(--map-marker-scale, 1));">
            <!-- 底部脉冲光环 -->
            <div style="
              position: absolute;
              bottom: 0px;
              left: 50%;
              transform: translate(-50%, 50%);
              width: 22px;
              height: 10px;
              border-radius: 50%;
              background: ${pulseBg};
              filter: blur(2px);
              ${typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "" : "animation: pulse 2s infinite ease-in-out;"}
            "></div>
            <!-- 主体矢量水滴图标 -->
            <svg viewBox="0 0 36 44" width="36" height="44" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3));">
              <path d="M18 0C8.059 0 0 8.059 0 18c0 13.5 18 26 18 26s18-12.5 18-26C36 8.059 27.941 0 18 0z" fill="${safeColor}" stroke="#ffffff" stroke-width="2.5"/>
              <circle cx="18" cy="17" r="7" fill="#ffffff"/>
              <circle cx="18" cy="17" r="3.5" fill="${safeColor}"/>
            </svg>
          </div>
        `;
        return L.divIcon({
          html,
          className: "civic-main-pin-marker",
          iconSize: [36, 44],
          iconAnchor: [18, 44],
          popupAnchor: [0, -46],
        });
      };

      // 创建关联次要工单点位小标
      const createRelatedPinIcon = (color = "#FF7D00") => {
        const safeColor = safeCssColor(color, "#FF7D00");
        const html = `
          <div class="civic-pin-anchor" style="position: relative; width: 22px; height: 28px; transform-origin: 50% 100%; transition: transform 0.15s ease-out; transform: scale(var(--map-marker-scale, 1)); opacity: 0.9;">
            <svg viewBox="0 0 22 28" width="22" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));">
              <path d="M11 0C4.925 0 0 4.925 0 11c0 8 11 17 11 17s11-9 11-17C22 4.925 17.075 0 11 0z" fill="${safeColor}" stroke="#ffffff" stroke-width="1.8"/>
              <circle cx="11" cy="10" r="4" fill="#ffffff"/>
            </svg>
          </div>
        `;
        return L.divIcon({
          html,
          className: "civic-related-pin-marker",
          iconSize: [22, 28],
          iconAnchor: [11, 28],
          popupAnchor: [0, -30],
        });
      };

      // 单点/工单详情模式
      if (mode === "single" && isValidCoordPair(point)) {
        markersRef.current.forEach((m) => m.remove());
        markersRef.current = [];

        // 1. 主工单点位
        const mainMarker = L.marker([point.lat, point.lng], {
          icon: createMainPinIcon(point.color || "#1E5AFF"),
          zIndexOffset: 1000,
        }).addTo(map);

        // 默认【常显悬浮标识 Card】(permanent: true)，位于 Marker 顶部上方紧贴，带朝下指示箭头
        const labelText = point.address || point.title || "事发地点";
        const shortLabel = labelText.length > 22 ? `${labelText.slice(0, 21)}…` : labelText;
        const tooltipEl = buildCivicTooltipElement(shortLabel, point.township, "single");

        mainMarker.bindTooltip(tooltipEl, {
          permanent: true,
          direction: "top",
          offset: [0, -44],
          className: "civic-permanent-tooltip",
        });

        // 点击时弹出更详尽的诉求要素卡片
        mainMarker.bindPopup(buildCivicPopupElement(point));
        markersRef.current.push(mainMarker);

        // 2. 渲染同群组关联工单点位（如果有）
        const validRelated = relatedPoints.filter(isValidCoordPair);
        if (validRelated.length > 0) {
          validRelated.forEach((rp, idx) => {
            const relMarker = L.marker([rp.lat, rp.lng], {
              icon: createRelatedPinIcon("#FF7D00"),
              zIndexOffset: 500,
            }).addTo(map);

            const relTooltipEl = document.createElement("span");
            relTooltipEl.textContent = `关联诉求 #${idx + 1}: ${rp.address || rp.title || "同群组工单"}`;
            relMarker.bindTooltip(relTooltipEl, {
              direction: "top",
              offset: [0, -30],
            });
            markersRef.current.push(relMarker);
          });
        }

        // 强制中心定位并在动画结束后再次校准
        try {
          map.invalidateSize({ animate: false });
          if (validRelated.length > 0) {
            const allLatlngs = [[point.lat, point.lng], ...validRelated.map((rp) => [rp.lat, rp.lng])];
            const bounds = L.latLngBounds(allLatlngs as any);
            map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
          } else {
            map.setView([point.lat, point.lng], 15, { animate: false });
          }
        } catch {}
      }

      // 多点全览模式 (批量打点)
      if (mode === "multi") {
        const valid = points.filter((p) => isValidCoordPair(p));
        const pointsKey = valid.map((p) => `${p.id || ""}:${p.lng},${p.lat}`).sort().join(";");

        // 仅在点位列表数据发生实质改变（如初始加载、镇街过滤切换）时才重新打点并 fitBounds
        // 用户交互、点击点位、右侧详情卡片展示时，绝不重新打点，更绝不重置用户当前的 Zoom 级别
        if (lastPointsKeyRef.current !== pointsKey) {
          lastPointsKeyRef.current = pointsKey;

          // 清除旧 Marker
          markersRef.current.forEach((m) => m.remove());
          markersRef.current = [];

          valid.forEach((p) => {
            const marker = L.marker([p.lat, p.lng], {
              icon: createMainPinIcon(p.color || "#1E5AFF"),
            }).addTo(map);

            // 全览模式下的顶部 Tooltip
            const titleText = p.title || p.address || "坐标点位";
            const tooltipEl = buildCivicTooltipElement(titleText, p.township, "multi");

            marker.bindTooltip(tooltipEl, {
              direction: "top",
              offset: [0, -44],
              className: "civic-permanent-tooltip",
            });

            marker.on("click", (e) => {
              if (e && e.originalEvent) {
                e.originalEvent.stopPropagation();
              }
              // 关键：绝对不恢复/改变 zoom，仅将点击点位平滑平移居中！
              map.panTo([p.lat, p.lng], { animate: true, duration: 0.35 });
              if (onPointClickRef.current) {
                onPointClickRef.current(p);
              }
            });

            markersRef.current.push(marker);
          });

          if (valid.length > 0) {
            try {
              const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
              map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
            } catch {}
          }
        }
      }
    });

    return () => {
      isMounted = false;
      if (boundMap && zoomHandler) {
        try {
          boundMap.off("zoom", zoomHandler);
          boundMap.off("zoomend", zoomHandler);
        } catch {}
      }
    };
  }, [point, relatedPoints, points, mode, loading]);

  // 外部选中点位变更时（如右侧卡片切换、列表点击打点进入全览），仅平移居中，绝不恢复或改变 zoom
  useEffect(() => {
    if (!mapRef.current || !selectedPointId || mode !== "multi") return;
    const target = points.find((p) => p.id === selectedPointId);
    if (target && isValidCoordPair(target)) {
      try {
        mapRef.current.panTo([target.lat, target.lng], { animate: true, duration: 0.35 });
      } catch {}
    }
  }, [selectedPointId, mode, points]);

  return (
    <div
      role="region"
      aria-label="事发地点空间分布地图"
      style={{
        position: "relative",
        width: "100%",
        height,
        borderRadius: "var(--r-md, 8px)",
        overflow: "hidden",
        border: "1px solid var(--c-border-soft, #E2E8F0)",
        isolation: "isolate",
        zIndex: 1,
      }}
      className={`civic-geo-map-container ${className}`}
    >
      <div ref={containerRef} style={{ width: "100%", height: "100%", background: "#F1F5F9" }} />

      {/* 加载中状态 */}
      {loading && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            background: "rgba(255, 255, 255, 0.85)",
            backdropFilter: "blur(2px)",
            zIndex: 1000,
            fontSize: 12,
            color: "var(--c-ink-2, #475569)",
            fontWeight: 500,
          }}
        >
          <Loader2 className="w-4 h-4 motion-safe:animate-spin text-[#1E5AFF]" aria-hidden="true" />
          <span>正在精准定位事发空间位置...</span>
        </div>
      )}

      {/* 缩放控件 */}
      {showControls && !loading && (
        <div
          style={{
            position: "absolute",
            right: 10,
            bottom: 10,
            display: "flex",
            flexDirection: "column",
            gap: 4,
            zIndex: 900,
          }}
        >
          <button
            type="button"
            onClick={() => mapRef.current?.zoomIn()}
            title="放大"
            aria-label="放大地图"
            className="w-11 h-11 sm:w-7 sm:h-7 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 rounded-md bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ZoomIn className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            title="缩小"
            aria-label="缩小地图"
            className="w-11 h-11 sm:w-7 sm:h-7 [@media(pointer:coarse)]:w-11 [@media(pointer:coarse)]:h-11 rounded-md bg-white border border-slate-200 shadow-sm flex items-center justify-center text-slate-700 hover:bg-slate-50 cursor-pointer"
          >
            <ZoomOut className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      )}

      {/* 底部天地图官方地理服务标志 */}
      <div
        style={{
          position: "absolute",
          left: 8,
          bottom: 6,
          zIndex: 800,
          fontSize: 10,
          color: "#475569",
          background: "rgba(255, 255, 255, 0.88)",
          padding: "1px 6px",
          borderRadius: 4,
          backdropFilter: "blur(2px)",
          pointerEvents: "none",
        }}
      >
        国家地理信息公共服务平台 · 天地图
      </div>
    </div>
  );
}
