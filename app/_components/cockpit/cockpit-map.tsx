"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { ZoomIn, ZoomOut, Crosshair, MapPin } from "lucide-react";
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
        doubleClickZoom: false,
        minZoom: 8,
        maxZoom: 18,
      }).setView([22.84, 113.25], 11);

      // 加载天地图标准底图 (经过 CSS filter 转化为科技暗夜深蓝地图)
      try {
        L.tileLayer("/api/map/tile?type=vec&z={z}&x={x}&y={y}", {
          maxZoom: 18,
        }).addTo(map);
      } catch (e) {}

      // 加载天地图暗夜道路注记
      try {
        L.tileLayer("/api/map/tile?type=cva&z={z}&x={x}&y={y}", {
          maxZoom: 18,
          opacity: 0.75,
        }).addTo(map);
      } catch (e) {}

      mapRef.current = map;
      setMapInstance(map);

      setTimeout(() => {
        map.invalidateSize();
      }, 200);
    }

    initMap();

    return () => {
      isMounted = false;
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

      if (geojsonLayerRef.current) {
        geojsonLayerRef.current.remove();
        geojsonLayerRef.current = null;
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
            const badgeHtml = `
              <div class="cockpit-town-pill ${isSelected ? "is-selected" : ""}" style="
                display: inline-flex;
                align-items: center;
                gap: 6px;
                background: ${isSelected ? townColor : "rgba(6, 17, 40, 0.90)"};
                backdrop-filter: blur(12px);
                border: 1.5px solid ${isSelected ? "#FFFFFF" : townColor};
                box-shadow: 0 0 16px ${isSelected ? "rgba(255, 255, 255, 0.9)" : `${townColor}77`};
                border-radius: 9999px;
                padding: 4px 10px;
                color: #FFFFFF;
                font-size: 11px;
                font-family: ui-sans-serif, system-ui, sans-serif;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
                transform: translate(-50%, -50%);
                transition: all 0.2s ease;
              ">
                <span style="
                  width: 7px;
                  height: 7px;
                  border-radius: 50%;
                  background: ${townColor};
                  box-shadow: 0 0 8px ${townColor};
                "></span>
                <span style="font-weight: 600;">${name.replace(/(街道|镇|区)$/, "")}</span>
                <span style="color: ${isSelected ? "#FFFFFF" : "#E2E8F0"}; font-weight: 700; font-family: ui-monospace, monospace;">${count.toLocaleString()}</span>
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
            }).addTo(map);

            marker.on("click", (e: any) => {
              L.DomEvent.stopPropagation(e);
              if (isSelected) {
                onSelectTownship(null);
              } else {
                onSelectTownship(name.replace(/(街道|镇|区)$/, ""));
              }
            });
          }
        },
      }).addTo(map);

      geojsonLayerRef.current = geoLayer;

      // 居中适配：预留两侧浮动窗 (左 420px, 右 420px, 顶 140px, 底 180px)
      try {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, {
            paddingTopLeft: [420, 140],
            paddingBottomRight: [420, 180],
            maxZoom: 13,
          });
        }
      } catch (e) {}
    });

    return () => {
      isMounted = false;
    };
  }, [mapInstance, geoData, counts, selectedTownship, onSelectTownship, activeRegion, totalCount]);

  return (
    <div className={`relative w-full h-full overflow-hidden bg-[#020612] ${className}`}>
      {/* 科技暗夜地图专属 CSS 过滤器 */}
      <style jsx global>{`
        .cockpit-dark-map .leaflet-tile-pane {
          filter: invert(92%) hue-rotate(195deg) brightness(65%) contrast(150%) saturate(70%);
          opacity: 0.65;
        }
        .cockpit-dark-map {
          background-color: #020612 !important;
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

      {/* 悬浮全屏地图控制按钮群 */}
      <div className="absolute bottom-6 right-[420px] z-20 flex items-center gap-1.5 p-1 rounded-xl bg-[#06132b]/85 border border-cyan-500/30 backdrop-blur-md shadow-2xl">
        <button
          type="button"
          onClick={() => mapInstance?.zoomIn()}
          className="p-2 rounded-lg text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer"
          title="放大地图"
        >
          <ZoomIn size={14} />
        </button>
        <button
          type="button"
          onClick={() => mapInstance?.zoomOut()}
          className="p-2 rounded-lg text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer"
          title="缩小地图"
        >
          <ZoomOut size={14} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (geojsonLayerRef.current && mapInstance) {
              const bounds = geojsonLayerRef.current.getBounds();
              if (bounds.isValid()) {
                mapInstance.fitBounds(bounds, {
                  paddingTopLeft: [420, 140],
                  paddingBottomRight: [420, 180],
                });
              }
            }
          }}
          className="p-2 rounded-lg text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer"
          title="居中重置视野"
        >
          <Crosshair size={14} />
        </button>
      </div>

      {loading && (
        <div className="absolute inset-0 bg-[#020612]/70 backdrop-blur-xs flex items-center justify-center z-30">
          <div className="flex items-center gap-2.5 text-cyan-300 text-xs font-mono animate-pulse">
            <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
            <span>正在加载全域地理空间孪生网格...</span>
          </div>
        </div>
      )}
    </div>
  );
}
