"use client";

import React, { useEffect, useRef, useState } from "react";
import type { Map as LeafletMap, Marker as LeafletMarker } from "leaflet";
import { Loader2, MapPin, ZoomIn, ZoomOut } from "lucide-react";

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
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    onPointClickRef.current = onPointClick;
  });

  // 1. 初始化地图并建立自适应居中监听
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!containerRef.current || mapRef.current) return;

      const L = (await import("leaflet")).default;
      if (!isMounted || !containerRef.current) return;

      const targetLat = point && point.lat ? point.lat : center ? center[1] : DEFAULT_CENTER[1];
      const targetLng = point && point.lng ? point.lng : center ? center[0] : DEFAULT_CENTER[0];

      const map = L.map(containerRef.current, {
        center: [targetLat, targetLng],
        zoom: point ? 15 : zoom,
        zoomControl: false,
        attributionControl: false,
      });

      // 天地图矢量底图 (通过安全后端代理)
      L.tileLayer("/api/map/tile?type=vec&z={z}&x={x}&y={y}", {
        maxZoom: 18,
        minZoom: 4,
      }).addTo(map);

      // 天地图中文注记 (道路、建筑物名)
      L.tileLayer("/api/map/tile?type=cva&z={z}&x={x}&y={y}", {
        maxZoom: 18,
        minZoom: 4,
      }).addTo(map);

      mapRef.current = map;
      setLoading(false);

      // 强制在 Drawer 动画滑入完成各阶段重新校准尺寸并精准居中
      const reCenter = () => {
        if (!mapRef.current || !containerRef.current) return;
        mapRef.current.invalidateSize({ animate: false });
        if (point && point.lat && point.lng) {
          mapRef.current.setView([point.lat, point.lng], 15, { animate: false });
        }
      };

      [50, 150, 300, 500, 800].forEach((ms) => {
        setTimeout(reCenter, ms);
      });

      // 监听容器大小动态变化 (比如抽屉尺寸改变)
      const observer = new ResizeObserver(() => {
        if (mapRef.current) {
          mapRef.current.invalidateSize({ animate: false });
        }
      });
      observer.observe(containerRef.current);
    }

    initMap();

    return () => {
      isMounted = false;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
  }, [mode]);

  // 2. 渲染标记点与悬浮标识 Tooltip
  useEffect(() => {
    if (!mapRef.current || loading) return;

    let isMounted = true;
    import("leaflet").then((module) => {
      if (!isMounted || !mapRef.current) return;
      const L = module.default;
      const map = mapRef.current;

      // 动态计算当前 Zoom 级别对应的 Marker 比例
      const updateMarkerScale = () => {
        if (!mapRef.current || !containerRef.current) return;
        const currentZoom = mapRef.current.getZoom();
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

      map.off("zoom", updateMarkerScale);
      map.off("zoomend", updateMarkerScale);
      map.on("zoom", updateMarkerScale);
      map.on("zoomend", updateMarkerScale);
      updateMarkerScale();

      // 创建主事发地点大号 Pin（带脉冲微光晕）
      const createMainPinIcon = (color = "#1E5AFF") => {
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
              background: ${color}40;
              filter: blur(2px);
              animation: pulse 2s infinite ease-in-out;
            "></div>
            <!-- 主体矢量水滴图标 -->
            <svg viewBox="0 0 36 44" width="36" height="44" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; filter: drop-shadow(0 3px 6px rgba(0,0,0,0.3));">
              <path d="M18 0C8.059 0 0 8.059 0 18c0 13.5 18 26 18 26s18-12.5 18-26C36 8.059 27.941 0 18 0z" fill="${color}" stroke="#ffffff" stroke-width="2.5"/>
              <circle cx="18" cy="17" r="7" fill="#ffffff"/>
              <circle cx="18" cy="17" r="3.5" fill="${color}"/>
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
        const html = `
          <div class="civic-pin-anchor" style="position: relative; width: 22px; height: 28px; transform-origin: 50% 100%; transition: transform 0.15s ease-out; transform: scale(var(--map-marker-scale, 1)); opacity: 0.9;">
            <svg viewBox="0 0 22 28" width="22" height="28" fill="none" xmlns="http://www.w3.org/2000/svg" style="display: block; filter: drop-shadow(0 2px 4px rgba(0,0,0,0.25));">
              <path d="M11 0C4.925 0 0 4.925 0 11c0 8 11 17 11 17s11-9 11-17C22 4.925 17.075 0 11 0z" fill="${color}" stroke="#ffffff" stroke-width="1.8"/>
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
      if (mode === "single" && point && point.lng && point.lat) {
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
        const tooltipHtml = `
          <div class="civic-tooltip-bubble" style="
            position: relative;
            display: inline-flex;
            align-items: center;
            gap: 6px;
            background: #ffffff;
            border: 1px solid #CBD5E1;
            padding: 4px 8px;
            border-radius: 6px;
            box-shadow: 0 4px 12px rgba(15, 23, 42, 0.16);
            font-family: ui-sans-serif, system-ui, -apple-system, sans-serif;
            white-space: nowrap;
          ">
            <span style="font-weight: 700; color: #0F172A; font-size: 11px;">${shortLabel}</span>
            ${point.township ? `<span style="background: #EFF6FF; color: #1E5AFF; font-size: 10px; font-weight: 600; padding: 1px 5px; border-radius: 4px; border: 1px solid #DBEAFE;">${point.township}</span>` : ""}
            <!-- 朝下指示小三角 -->
            <div style="
              position: absolute;
              bottom: -4px;
              left: 50%;
              transform: translateX(-50%) rotate(45deg);
              width: 7px;
              height: 7px;
              background: #ffffff;
              border-right: 1px solid #CBD5E1;
              border-bottom: 1px solid #CBD5E1;
            "></div>
          </div>
        `;

        mainMarker.bindTooltip(tooltipHtml, {
          permanent: true,
          direction: "top",
          offset: [0, -44],
          className: "civic-permanent-tooltip",
        });

        // 点击时弹出更详尽的诉求要素卡片
        const popupHtml = `
          <div style="padding: 6px; font-family: ui-sans-serif, system-ui; font-size: 12px; min-width: 200px;">
            <div style="font-weight: 700; color: #0F172A; font-size: 13px; margin-bottom: 4px;">
              ${point.title || "工单事发地"}
            </div>
            ${point.township ? `<div style="color: #1E5AFF; font-weight: 600; font-size: 11px; margin-bottom: 3px;">所属镇街: ${point.township}</div>` : ""}
            <div style="color: #475569; line-height: 1.4; font-size: 11px;">详细位置: ${point.address || "无具体门牌"}</div>
            <div style="color: #94A3B8; font-size: 10px; margin-top: 4px; font-family: monospace;">
              坐标: ${point.lng.toFixed(5)}, ${point.lat.toFixed(5)}
            </div>
          </div>
        `;
        mainMarker.bindPopup(popupHtml);
        markersRef.current.push(mainMarker);

        // 2. 渲染同群组关联工单点位（如果有）
        if (relatedPoints.length > 0) {
          relatedPoints.forEach((rp, idx) => {
            if (!rp.lng || !rp.lat) return;
            const relMarker = L.marker([rp.lat, rp.lng], {
              icon: createRelatedPinIcon("#FF7D00"),
              zIndexOffset: 500,
            }).addTo(map);

            relMarker.bindTooltip(`关联诉求 #${idx + 1}: ${rp.address || rp.title || "同群组工单"}`, {
              direction: "top",
              offset: [0, -30],
            });
            markersRef.current.push(relMarker);
          });
        }

        // 强制中心定位并在动画结束后再次校准
        map.invalidateSize({ animate: false });
        if (relatedPoints.length > 0) {
          const allLatlngs = [[point.lat, point.lng], ...relatedPoints.map((rp) => [rp.lat, rp.lng])];
          const bounds = L.latLngBounds(allLatlngs as any);
          map.fitBounds(bounds, { padding: [40, 40], maxZoom: 16 });
        } else {
          map.setView([point.lat, point.lng], 15, { animate: false });
        }
      }

      // 多点全览模式 (批量打点)
      if (mode === "multi") {
        const valid = points.filter((p) => typeof p.lng === "number" && typeof p.lat === "number");
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
            const tooltipHtml = `
              <div class="civic-tooltip-bubble" style="
                position: relative;
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: #ffffff;
                border: 1px solid #CBD5E1;
                padding: 3px 8px;
                border-radius: 5px;
                box-shadow: 0 3px 10px rgba(15, 23, 42, 0.14);
                font-family: ui-sans-serif, system-ui;
                white-space: nowrap;
                font-size: 11px;
              ">
                ${p.township ? `<span style="background: #EFF6FF; color: #1E5AFF; font-size: 10px; font-weight: 600; padding: 0 4px; border-radius: 3px;">${p.township}</span>` : ""}
                <span style="font-weight: 600; color: #0F172A;">${titleText}</span>
                <div style="
                  position: absolute;
                  bottom: -4px;
                  left: 50%;
                  transform: translateX(-50%) rotate(45deg);
                  width: 6px;
                  height: 6px;
                  background: #ffffff;
                  border-right: 1px solid #CBD5E1;
                  border-bottom: 1px solid #CBD5E1;
                "></div>
              </div>
            `;

            marker.bindTooltip(tooltipHtml, {
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
            const bounds = L.latLngBounds(valid.map((p) => [p.lat, p.lng]));
            map.fitBounds(bounds, { padding: [50, 50], maxZoom: 15 });
          }
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [point, relatedPoints, points, mode, loading]);

  // 外部选中点位变更时（如右侧卡片切换、列表点击打点进入全览），仅平移居中，绝不恢复或改变 zoom
  useEffect(() => {
    if (!mapRef.current || !selectedPointId || mode !== "multi") return;
    const target = points.find((p) => p.id === selectedPointId);
    if (target && typeof target.lat === "number" && typeof target.lng === "number") {
      mapRef.current.panTo([target.lat, target.lng], { animate: true, duration: 0.35 });
    }
  }, [selectedPointId, mode, points]);

  return (
    <div
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
          <Loader2 className="w-4 h-4 animate-spin text-[#1E5AFF]" />
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
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "#ffffff",
              border: "1px solid #E2E8F0",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#334155",
              cursor: "pointer",
            }}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => mapRef.current?.zoomOut()}
            title="缩小"
            style={{
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "#ffffff",
              border: "1px solid #E2E8F0",
              boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#334155",
              cursor: "pointer",
            }}
          >
            <ZoomOut className="w-3.5 h-3.5" />
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
          color: "rgba(100, 116, 139, 0.75)",
          background: "rgba(255, 255, 255, 0.7)",
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
