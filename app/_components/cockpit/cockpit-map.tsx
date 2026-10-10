"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { MapPin } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { RegionInfo } from "../civic/region-context";

interface CockpitMapProps {
  activeRegion: RegionInfo | null;
  counts: Record<string, number>;
  selectedTownship: string | null;
  onSelectTownship: (name: string | null) => void;
  className?: string;
}

export function CockpitMap({
  activeRegion,
  counts,
  selectedTownship,
  onSelectTownship,
  className = "",
}: CockpitMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const geojsonLayerRef = useRef<LeafletGeoJSON | null>(null);
  const markersLayerRef = useRef<any>(null);
  const hasCenteredRef = useRef<string | null>(null);

  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const regionId = activeRegion?.id || "fs_shunde";

  const values = Object.values(counts);
  const totalCount = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);

  // 1. 获取镇街多边形数据
  useEffect(() => {
    let cancelled = false;
    async function loadBoundary() {
      try {
        setLoading(true);
        // 优先数据库第四级镇街
        const res = await fetch(`/api/regions/${regionId}/boundary?level=subdistricts`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (res?.data?.geojson?.features && res.data.geojson.features.length > 0) {
          setGeoData(res.data.geojson);
          setLoading(false);
          return;
        }

        // 本地静态兜底
        const localRes = await fetch(`/civic/${regionId}-townships.geojson`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (localRes?.features && localRes.features.length > 0) {
          setGeoData(localRes);
          setLoading(false);
          return;
        }

        // 区级兜底
        const fallbackRes = await fetch(`/api/regions/${regionId}/boundary?level=district`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (fallbackRes?.data?.geojson) {
          setGeoData(fallbackRes.data.geojson);
        }
      } catch (e) {
        console.error("[CockpitMap] Failed to load geojson:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBoundary();
    return () => {
      cancelled = true;
    };
  }, [regionId]);

  // 2. 初始化全屏夜间底图
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isMounted = true;

    async function initMap() {
      const module = await import("leaflet");
      if (!isMounted || !mapContainerRef.current) return;
      const L = module.default;

      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }

      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
        wheelPxPerZoomLevel: 120, // 增加滚轮阻尼，彻底消除 Mac 触控板/滚轮过于灵敏导致的帧数骤降
        wheelDebounceTime: 50,    // 50ms 适度防抖，合并微小缩放动作
        doubleClickZoom: false,
        minZoom: 8,
        maxZoom: 18,
        preferCanvas: true,       // 核心性能优化：多边形使用 GPU HTML5 Canvas 绘制，代替大量 DOM SVG 节点
        zoomAnimation: true,
        fadeAnimation: true,
        markerZoomAnimation: true,
      }).setView(
        regionId.includes("tianhe") || regionId.includes("gz") ? [23.14, 113.36] : [22.84, 113.25],
        regionId.includes("tianhe") || regionId.includes("gz") ? 12 : 11
      );

      const tileOptions = {
        maxZoom: 18,
        updateWhenZooming: false, // 缩放动画中不频繁向服务器发瓦片请求，GPU 平滑缩放现有瓦片
        updateWhenIdle: true,     // 缩放/平移完全停止后再拉取新层级瓦片
        keepBuffer: 6,            // 视口外缓冲 6 块瓦片，缩放移动时避免白块
      };

      // 加载天地图标准底图 (经过 CSS filter 转化为科技暗夜深蓝地图)
      try {
        L.tileLayer("/api/map/tile?type=vec&z={z}&x={x}&y={y}", tileOptions).addTo(map);
      } catch (e) {}

      // 加载天地图暗夜道路注记
      try {
        L.tileLayer("/api/map/tile?type=cva&z={z}&x={x}&y={y}", {
          ...tileOptions,
          opacity: 0.75,
        }).addTo(map);
      } catch (e) {}

      // 初始化 Marker 图层组
      markersLayerRef.current = L.layerGroup().addTo(map);

      mapRef.current = map;
      setMapInstance(map);

      setTimeout(() => {
        map.invalidateSize();
      }, 150);
    }

    initMap();

    return () => {
      isMounted = false;
      if (markersLayerRef.current) {
        try {
          markersLayerRef.current.clearLayers();
          markersLayerRef.current.remove();
        } catch (e) {}
        markersLayerRef.current = null;
      }
      if (geojsonLayerRef.current) {
        try {
          geojsonLayerRef.current.remove();
        } catch (e) {}
        geojsonLayerRef.current = null;
      }
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      setMapInstance(null);
    };
  }, [regionId]);

  // 3. 渲染 GeoJSON 镇街面，与系统标准配色统一
  useEffect(() => {
    if (!mapInstance || !geoData) return;
    let isMounted = true;

    import("leaflet").then((module) => {
      if (!isMounted || !mapInstance) return;
      const L = module.default;
      const map = mapInstance;

      // 及时清理旧 GeoJSON 图层
      if (geojsonLayerRef.current) {
        geojsonLayerRef.current.remove();
        geojsonLayerRef.current = null;
      }

      // 清理并确保 markersLayerRef 可用，彻底杜绝 DOM Marker 重复堆叠内存泄漏
      if (!markersLayerRef.current) {
        markersLayerRef.current = L.layerGroup().addTo(map);
      } else {
        markersLayerRef.current.clearLayers();
      }

      const isDistrictLevel = geoData.features.length === 1;

      const getTownshipCount = (name: string) => {
        if (!name) return 0;
        const clean = name.replace(/(街道|镇|区)$/, "");
        for (const [k, v] of Object.entries(counts)) {
          if (k.includes(clean) || clean.includes(k.replace(/(街道|镇|区)$/, ""))) {
            return v;
          }
        }
        return counts[name] || 0;
      };

      const geoLayer = L.geoJSON(geoData, {
        style: (feature: any) => {
          const name = feature?.properties?.name || "";
          const isSelected =
            selectedTownship &&
            (name.includes(selectedTownship) || selectedTownship.includes(name));

          const townColor = isDistrictLevel ? "#1E5AFF" : getTownshipColor(name);

          return {
            fillColor: townColor,
            fillOpacity: isSelected ? 0.48 : 0.22,
            color: isSelected ? "#FFFFFF" : townColor,
            weight: isSelected ? 2.8 : 1.6,
            dashArray: isSelected ? "" : "4, 2",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature: any, layer: Layer) => {
          const name = feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = isDistrictLevel ? totalCount : getTownshipCount(name);
          const isSelected =
            selectedTownship &&
            (name.includes(selectedTownship) || selectedTownship.includes(name));
          const townColor = isDistrictLevel ? "#1E5AFF" : getTownshipColor(name);

          layer.on("click", (e: any) => {
            L.DomEvent.stopPropagation(e);
            if (isSelected) {
              onSelectTownship(null);
            } else {
              onSelectTownship(name.replace(/(街道|镇|区)$/, ""));
            }
          });

          // 计算几何中心添加悬浮发光微胶囊
          let centerLatLng: any = null;
          if (typeof (layer as any).getBounds === "function") {
            const b = (layer as any).getBounds();
            if (b && b.isValid()) {
              centerLatLng = b.getCenter();
            }
          }

          if (centerLatLng && !isDistrictLevel) {
            // 优化：去除重量级 backdrop-filter: blur() 与 transition: all，使用 GPU 纯粹图层加速，避免缩放时重排卡顿
            const badgeHtml = `
              <div class="cockpit-town-pill ${isSelected ? "is-selected" : ""}" style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: ${isSelected ? townColor : "rgba(6, 17, 40, 0.94)"};
                border: 1.5px solid ${isSelected ? "#FFFFFF" : townColor};
                box-shadow: 0 2px 10px ${isSelected ? "rgba(255, 255, 255, 0.8)" : `${townColor}66`};
                border-radius: 9999px;
                padding: 4px 10px;
                color: #FFFFFF;
                font-size: 11px;
                font-family: ui-sans-serif, system-ui, sans-serif;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
                transform: translate(-50%, -50%);
                pointer-events: auto;
                transition: background-color 0.15s ease, border-color 0.15s ease, box-shadow 0.15s ease;
              ">
                <span style="
                  width: 7px;
                  height: 7px;
                  border-radius: 50%;
                  background: ${townColor};
                  box-shadow: 0 0 6px ${townColor};
                "></span>
                <span style="font-weight: 600;">${name.replace(/(街道|镇|区)$/, "")}</span>
                ${count > 0 ? `<span style="color: ${isSelected ? "#FFFFFF" : "#E2E8F0"}; font-weight: 700; font-family: ui-monospace, monospace;">${count.toLocaleString()}</span>` : ""}
              </div>
            `;

            const icon = L.divIcon({
              html: badgeHtml,
              className: "cockpit-leaflet-div-icon",
              iconSize: [0, 0],
            });

            const marker = L.marker(centerLatLng, {
              icon,
              interactive: true,
            });

            marker.on("click", (e: any) => {
              L.DomEvent.stopPropagation(e);
              if (isSelected) {
                onSelectTownship(null);
              } else {
                onSelectTownship(name.replace(/(街道|镇|区)$/, ""));
              }
            });

            markersLayerRef.current.addLayer(marker);
          }
        },
      }).addTo(map);

      geojsonLayerRef.current = geoLayer;

      // 仅在首次加载辖区时自动 fitBounds 居中适配，避免用户缩放后被重置打断
      if (hasCenteredRef.current !== regionId) {
        try {
          const bounds = geoLayer.getBounds();
          if (bounds.isValid()) {
            map.fitBounds(bounds, {
              paddingTopLeft: [420, 140],
              paddingBottomRight: [420, 180],
              maxZoom: 13,
              animate: false,
            });
            hasCenteredRef.current = regionId;
          }
        } catch (e) {}
      }
    });

    return () => {
      isMounted = false;
    };
  }, [mapInstance, geoData, counts, selectedTownship, onSelectTownship, activeRegion, totalCount, regionId]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#020612] ${className}`}>
      {/* 科技暗夜地图专属 CSS 过滤器：GPU 硬件加速合成层 */}
      <style jsx global>{`
        .cockpit-dark-map .leaflet-tile-pane {
          filter: invert(100%) grayscale(100%) brightness(70%) contrast(130%);
          opacity: 0.75;
          transform: translate3d(0, 0, 0);
          will-change: transform;
        }
        .cockpit-dark-map .leaflet-tile {
          will-change: transform;
          transform: translate3d(0, 0, 0);
          backface-visibility: hidden;
        }
        .cockpit-dark-map .leaflet-zoom-animated {
          will-change: transform;
        }
        .cockpit-dark-map {
          background-color: #020612 !important;
        }
        .cockpit-leaflet-div-icon {
          background: transparent !important;
          border: none !important;
        }
      `}</style>

      {/* 科技经纬网格装饰底纹 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20 z-0"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(0, 242, 254, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 242, 254, 0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* 地图真实挂载 DOM (全屏全景呈现，带暗夜滤镜类名) */}
      <div ref={mapContainerRef} className="w-full h-full z-0 cockpit-dark-map" />

      {loading && (
        <div className="absolute inset-0 bg-[#020612]/70 backdrop-blur-xs flex items-center justify-center z-30">
          <div className="flex items-center gap-2.5 text-blue-300 text-xs font-mono animate-pulse">
            <span className="w-2 h-2 rounded-full bg-[#1677FF] animate-ping inline-block" />
            <span>正在加载全域地理空间孪生网格...</span>
          </div>
        </div>
      )}
    </div>
  );
}
