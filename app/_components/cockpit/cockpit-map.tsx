"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import "leaflet/dist/leaflet.css";
import { MapPin } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import { getTiandituTileUrls } from "@/lib/map/tile-layer";
import type { RegionInfo } from "../civic/region-context";

function safeCssColor(value: string | undefined, fallback: string): string {
  const trimmed = (value || "").trim();
  return /^#[0-9a-fA-F]{3,8}$/.test(trimmed) ? trimmed : fallback;
}

function buildCockpitBadgeElement(
  shortLabel: string,
  count: number,
  townColor: string,
  isSelected: boolean,
  isCompactMap: boolean
): HTMLElement {
  const safeColor = safeCssColor(townColor, "#1E5AFF");
  const pill = document.createElement("div");
  pill.className = `cockpit-town-pill ${isSelected ? "is-selected" : ""}`;
  pill.style.display = "inline-flex";
  pill.style.alignItems = "center";
  pill.style.borderRadius = "9999px";
  pill.style.fontFamily = "ui-sans-serif, system-ui, sans-serif";
  pill.style.whiteSpace = "nowrap";
  pill.style.cursor = "pointer";
  pill.style.userSelect = "none";
  pill.style.transform = "translate(-50%, -50%)";
  pill.style.pointerEvents = "auto";

  const dot = document.createElement("span");
  dot.style.borderRadius = "50%";

  const label = document.createElement("span");
  label.style.fontWeight = "600";
  label.textContent = shortLabel;

  if (isCompactMap) {
    pill.style.gap = "4px";
    pill.style.background = isSelected ? safeColor : "rgba(6, 9, 17, 0.88)";
    pill.style.border = `1px solid ${isSelected ? "#FFFFFF" : safeColor}`;
    pill.style.padding = "2px 8px";
    pill.style.color = "#F8FAFC";
    pill.style.fontSize = "11px";
    pill.style.lineHeight = "1.25";

    dot.style.width = "5px";
    dot.style.height = "5px";
    dot.style.background = isSelected ? "#FFFFFF" : safeColor;

    pill.appendChild(dot);
    pill.appendChild(label);
  } else {
    pill.style.gap = "6px";
    pill.style.background = isSelected ? safeColor : "rgba(9, 13, 24, 0.9)";
    const borderColor = isSelected ? "#FFFFFF" : safeColor.length === 7 ? `${safeColor}cc` : safeColor;
    pill.style.border = `1px solid ${borderColor}`;
    pill.style.boxShadow = "0 2px 10px rgba(0, 0, 0, 0.55)";
    pill.style.padding = "3px 9px";
    pill.style.color = "#FFFFFF";
    pill.style.fontSize = "11px";
    pill.style.transition = "background-color 0.15s ease, border-color 0.15s ease";

    dot.style.width = "6px";
    dot.style.height = "6px";
    dot.style.background = safeColor;

    pill.appendChild(dot);
    pill.appendChild(label);

    if (count > 0) {
      const countEl = document.createElement("span");
      countEl.style.color = isSelected ? "#FFFFFF" : "#CBD5E1";
      countEl.style.fontWeight = "600";
      countEl.style.fontFamily = "ui-monospace, monospace";
      countEl.style.fontVariantNumeric = "tabular-nums";
      countEl.textContent = count.toLocaleString();
      pill.appendChild(countEl);
    }
  }

  return pill;
}

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

  const regionId = activeRegion?.id || "gz_tianhe";

  const values = Object.values(counts);
  const totalCount = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);

  // 1. 获取镇街多边形数据
  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    async function loadBoundary() {
      try {
        setLoading(true);
        // 优先数据库第四级镇街
        const res = await fetch(`/api/regions/${regionId}/boundary?level=subdistricts`, {
          signal: controller.signal,
        }).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        if (res?.data?.geojson?.features && res.data.geojson.features.length > 0) {
          setGeoData(res.data.geojson);
          setLoading(false);
          return;
        }

        // 本地静态兜底
        const localRes = await fetch(`/civic/${regionId}-townships.geojson`, {
          signal: controller.signal,
        }).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        if (localRes?.features && localRes.features.length > 0) {
          setGeoData(localRes);
          setLoading(false);
          return;
        }

        // 区级兜底
        const fallbackRes = await fetch(`/api/regions/${regionId}/boundary?level=district`, {
          signal: controller.signal,
        }).then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        if (fallbackRes?.data?.geojson) {
          setGeoData(fallbackRes.data.geojson);
        }
      } catch (e: any) {
        if (controller.signal.aborted || e?.name === "AbortError") return;
        console.error("[CockpitMap] Failed to load geojson:", e);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadBoundary();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [regionId]);

  // 2. 初始化全屏夜间底图
  useEffect(() => {
    if (!mapContainerRef.current) return;
    let isMounted = true;
    let invalidateTimer: ReturnType<typeof setTimeout> | null = null;
    let resizeObserver: ResizeObserver | null = null;

    async function initMap() {
      const module = await import("leaflet");
      if (!isMounted || !mapContainerRef.current) return;
      const L = module.default;

      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch {}
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

      const { vecUrl, cvaUrl, subdomains } = getTiandituTileUrls();
      const baseTileOptions = {
        ...tileOptions,
        ...(subdomains.length > 0 ? { subdomains } : {}),
      };

      // 加载天地图标准底图 (经过 CSS filter 转化为科技暗夜深蓝地图)
      try {
        L.tileLayer(vecUrl, baseTileOptions).addTo(map);
      } catch (e) {}

      // 加载天地图暗夜道路注记
      try {
        L.tileLayer(cvaUrl, {
          ...baseTileOptions,
          opacity: 0.75,
        }).addTo(map);
      } catch (e) {}

      // 初始化 Marker 图层组
      markersLayerRef.current = L.layerGroup().addTo(map);

      mapRef.current = map;
      setMapInstance(map);

      invalidateTimer = setTimeout(() => {
        const m = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
        if (!isMounted || mapRef.current !== map || !m._loaded || !m._mapPane) return;
        try {
          map.invalidateSize();
        } catch {}
      }, 150);

      resizeObserver =
        typeof ResizeObserver !== "undefined" && mapContainerRef.current
          ? new ResizeObserver((entries) => {
              const rect = entries[0]?.contentRect;
              if (!rect || rect.width <= 0 || rect.height <= 0) return;
              const m = map as unknown as { _loaded?: boolean; _mapPane?: unknown };
              if (!isMounted || mapRef.current !== map || !m._loaded || !m._mapPane) return;
              try {
                map.invalidateSize({ animate: false });
              } catch {}
            })
          : null;
      if (resizeObserver && mapContainerRef.current) {
        resizeObserver.observe(mapContainerRef.current);
      }
    }

    initMap();

    return () => {
      isMounted = false;
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (invalidateTimer) {
        clearTimeout(invalidateTimer);
        invalidateTimer = null;
      }
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
        try {
          mapRef.current.remove();
        } catch (e) {}
        mapRef.current = null;
      }
      setMapInstance(null);
    };
  }, [regionId]);

  // 3. 渲染 GeoJSON 镇街面，与系统标准配色统一
  useEffect(() => {
    if (!mapInstance || !geoData) return;
    let isMounted = true;
    let zoomCleanup: (() => void) | null = null;

    import("leaflet").then((module) => {
      const m = mapInstance as unknown as { _loaded?: boolean; _mapPane?: unknown };
      if (!isMounted || !mapInstance || mapRef.current !== mapInstance || !m._loaded || !m._mapPane) return;
      const L = module.default;
      const map = mapInstance;

      // 及时清理旧 GeoJSON 图层
      if (geojsonLayerRef.current) {
        try {
          geojsonLayerRef.current.remove();
        } catch {}
        geojsonLayerRef.current = null;
      }

      // 清理并确保 markersLayerRef 可用，彻底杜绝 DOM Marker 重复堆叠内存泄漏
      if (!markersLayerRef.current) {
        markersLayerRef.current = L.layerGroup().addTo(map);
      } else {
        markersLayerRef.current.clearLayers();
      }

      const isDistrictLevel = geoData.features.length === 1;
      const containerW = mapContainerRef.current?.clientWidth || window.innerWidth || 0;
      const isCompactMap = containerW < 1024;

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
          const isSelected =
            selectedTownship &&
            (name.includes(selectedTownship) || selectedTownship.includes(name));

          layer.on("click", (e: any) => {
            L.DomEvent.stopPropagation(e);
            if (isSelected) {
              onSelectTownship(null);
            } else {
              onSelectTownship(name.replace(/(街道|镇|区)$/, ""));
            }
          });
        },
      }).addTo(map);

      geojsonLayerRef.current = geoLayer;

      // 先执行首次居中缩放，保证随后计算的容器投影坐标精确
      if (hasCenteredRef.current !== regionId) {
        try {
          const bounds = geoLayer.getBounds();
          if (bounds.isValid()) {
            const containerH = mapContainerRef.current?.clientHeight || window.innerHeight || 0;
            const isWideHud = containerW >= 1280 && containerH >= 600;
            map.fitBounds(bounds, {
              paddingTopLeft: isWideHud ? [420, 120] : [14, 14],
              paddingBottomRight: isWideHud ? [420, 200] : [14, 14],
              maxZoom: isWideHud ? 13 : 12,
              animate: false,
            });
            hasCenteredRef.current = regionId;
          }
        } catch (e) {}
      }

      if (!isDistrictLevel) {
        const candidates: Array<{
          name: string;
          count: number;
          isSelected: boolean;
          townColor: string;
          centerLatLng: any;
        }> = [];

        geoLayer.eachLayer((layer: any) => {
          const name = layer?.feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = getTownshipCount(name);
          const isSelected = Boolean(
            selectedTownship &&
              (name.includes(selectedTownship) || selectedTownship.includes(name))
          );
          const townColor = getTownshipColor(name);
          if (typeof layer.getBounds === "function") {
            const b = layer.getBounds();
            if (b && b.isValid()) {
              candidates.push({
                name,
                count,
                isSelected,
                townColor,
                centerLatLng: b.getCenter(),
              });
            }
          }
        });

        candidates.sort((a, b) => {
          if (a.isSelected !== b.isSelected) return a.isSelected ? -1 : 1;
          return b.count - a.count;
        });

        const renderMarkers = () => {
          if (!isMounted || !markersLayerRef.current) return;
          markersLayerRef.current.clearLayers();
          const curW = mapContainerRef.current?.clientWidth || window.innerWidth || 0;
          const compact = curW < 1024;
          const placedRects: Array<{ x: number; y: number; halfW: number; halfH: number }> = [];

          for (const item of candidates) {
            const shortLabel = item.name.replace(/(街道|镇|区)$/, "");
            const pt = map.latLngToContainerPoint(item.centerLatLng);
            const estW = compact
              ? Math.max(54, shortLabel.length * 11 + 24)
              : Math.max(
                  76,
                  shortLabel.length * 12 +
                    (item.count > 0 ? item.count.toLocaleString().length * 7 + 34 : 28)
                );
            const estH = compact ? 24 : 28;
            const halfW = estW / 2 + 4;
            const halfH = estH / 2 + 3;

            const collides = placedRects.some(
              (p) => Math.abs(pt.x - p.x) < p.halfW + halfW && Math.abs(pt.y - p.y) < p.halfH + halfH
            );
            if (collides && !item.isSelected) continue;
            placedRects.push({ x: pt.x, y: pt.y, halfW, halfH });

            const badgeEl = buildCockpitBadgeElement(
              shortLabel,
              item.count,
              item.townColor,
              item.isSelected,
              compact
            );

            const icon = L.divIcon({
              html: badgeEl,
              className: "cockpit-leaflet-div-icon",
              iconSize: [0, 0],
            });

            const marker = L.marker(item.centerLatLng, {
              icon,
              interactive: true,
            });

            marker.on("click", (e: any) => {
              L.DomEvent.stopPropagation(e);
              if (item.isSelected) {
                onSelectTownship(null);
              } else {
                onSelectTownship(shortLabel);
              }
            });

            markersLayerRef.current.addLayer(marker);
          }
        };

        renderMarkers();
        const onZoomEnd = () => renderMarkers();
        map.on("zoomend", onZoomEnd);
        zoomCleanup = () => {
          map.off("zoomend", onZoomEnd);
        };
      }
    });

    return () => {
      isMounted = false;
      zoomCleanup?.();
    };
  }, [mapInstance, geoData, counts, selectedTownship, onSelectTownship, activeRegion, totalCount, regionId]);

  return (
    <div
      role="region"
      aria-label="辖区态势地理分布图"
      className={`relative w-full h-full overflow-hidden bg-[#060911] ${className}`}
    >
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
          background-color: #060911 !important;
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
            "linear-gradient(to right, rgba(148, 163, 184, 0.08) 1px, transparent 1px), linear-gradient(to bottom, rgba(148, 163, 184, 0.08) 1px, transparent 1px)",
          backgroundSize: "48px 48px",
        }}
      />

      {/* 地图真实挂载 DOM (全屏全景呈现，带暗夜滤镜类名) */}
      <div ref={mapContainerRef} className="w-full h-full z-0 cockpit-dark-map" />

      {loading && (
        <div className="absolute inset-0 bg-[#060911]/75 backdrop-blur-xs flex items-center justify-center z-30">
          <div className="flex items-center gap-2 text-slate-200 text-xs font-mono">
            <MapPin size={13} aria-hidden="true" className="text-sky-400 shrink-0" />
            <span>正在加载全域地理空间孪生网格...</span>
          </div>
        </div>
      )}
    </div>
  );
}
