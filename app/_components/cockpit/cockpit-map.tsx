"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { ZoomIn, ZoomOut, RotateCcw, Crosshair, MapPin } from "lucide-react";
import type { RegionInfo } from "../civic/region-context";

interface CockpitMapProps {
  activeRegion: RegionInfo | null;
  counts: Record<string, number>;
  selectedTownship: string | null;
  onSelectTownship: (name: string | null) => void;
}

export function CockpitMap({
  activeRegion,
  counts,
  selectedTownship,
  onSelectTownship,
}: CockpitMapProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const geojsonLayerRef = useRef<LeafletGeoJSON | null>(null);
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [geoData, setGeoData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const regionId = activeRegion?.id || "fs_shunde";

  // 计算最大工单量以计算色阶
  const values = Object.values(counts);
  const maxCount = useMemo(() => (values.length ? Math.max(...values, 1) : 1), [values]);
  const totalCount = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);

  // 1. 获取镇街 GeoJSON
  useEffect(() => {
    let cancelled = false;
    async function loadBoundary() {
      try {
        setLoading(true);
        // 先查数据库第四级镇街
        const res = await fetch(`/api/regions/${regionId}/boundary?level=subdistricts`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (res?.data?.geojson?.features && res.data.geojson.features.length > 0) {
          setGeoData(res.data.geojson);
          setLoading(false);
          return;
        }

        // 兜底本地公共静态资源
        const localRes = await fetch(`/civic/${regionId}-townships.geojson`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (localRes?.features && localRes.features.length > 0) {
          setGeoData(localRes);
          setLoading(false);
          return;
        }

        // 兜底整区边界
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

  // 2. 初始化 Leaflet 暗黑科幻地图
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

      // 纯净深空黑夜底图风格容器
      const map = L.map(mapContainerRef.current, {
        zoomControl: false,
        attributionControl: false,
        scrollWheelZoom: true,
        doubleClickZoom: false,
        minZoom: 9,
        maxZoom: 16,
      }).setView([22.8, 113.25], 11);

      // 加载天地图暗黑中文道路注记 (若失败则静默降级为暗黑坐标网格)
      try {
        L.tileLayer("/api/map/tile?type=cva&z={z}&x={x}&y={y}", {
          maxZoom: 18,
          opacity: 0.35,
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

  // 3. 渲染 GeoJSON 赛博发光多边形与镇街中心微观胶囊
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

      // 提取并匹配镇街工单数
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
          const count = isDistrictLevel ? totalCount : getTownshipCount(name);
          const ratio = Math.min(1, count / maxCount);
          const isSelected = selectedTownship && (name.includes(selectedTownship) || selectedTownship.includes(name));

          // 赛博渐变发光色彩体系
          let strokeColor = "#00f2fe";
          let fillColor = "#0284c7";

          if (ratio > 0.6) {
            strokeColor = "#f59e0b"; // 高发橙黄
            fillColor = "#d97706";
          } else if (ratio > 0.3) {
            strokeColor = "#06b6d4"; // 中发青蓝
            fillColor = "#0284c7";
          }

          if (isSelected) {
            strokeColor = "#38bdf8";
            fillColor = "#0ea5e9";
          }

          return {
            fillColor,
            fillOpacity: isSelected ? 0.45 : Math.max(0.12, ratio * 0.35),
            color: strokeColor,
            weight: isSelected ? 2.5 : 1.2,
            dashArray: isSelected ? "" : "3, 2",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature: any, layer: Layer) => {
          const name = feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = isDistrictLevel ? totalCount : getTownshipCount(name);
          const isSelected = selectedTownship && (name.includes(selectedTownship) || selectedTownship.includes(name));

          // 点击镇街切换联动
          layer.on("click", (e: any) => {
            L.DomEvent.stopPropagation(e);
            if (isSelected) {
              onSelectTownship(null);
            } else {
              onSelectTownship(name.replace(/(街道|镇|区)$/, ""));
            }
          });

          // 计算几何中心
          let centerLatLng: any = null;
          if (typeof (layer as any).getBounds === "function") {
            const b = (layer as any).getBounds();
            if (b && b.isValid()) {
              centerLatLng = b.getCenter();
            }
          }

          // 添加中心悬浮科技胶囊
          if (centerLatLng && !isDistrictLevel) {
            const badgeHtml = `
              <div class="cockpit-map-pill ${isSelected ? "is-selected" : ""}" style="
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: ${isSelected ? "rgba(14, 165, 233, 0.95)" : "rgba(4, 18, 43, 0.85)"};
                backdrop-filter: blur(8px);
                border: 1px solid ${isSelected ? "#38bdf8" : "rgba(0, 242, 254, 0.4)"};
                box-shadow: 0 0 10px ${isSelected ? "rgba(56, 189, 248, 0.5)" : "rgba(0, 242, 254, 0.2)"};
                border-radius: 9999px;
                padding: 3px 8px;
                color: #e0f2fe;
                font-size: 11px;
                font-family: ui-monospace, SFMono-Regular, monospace;
                white-space: nowrap;
                cursor: pointer;
                user-select: none;
                transform: translate(-50%, -50%);
              ">
                <span style="
                  width: 6px;
                  height: 6px;
                  border-radius: 50%;
                  background: ${count > 0 ? "#00f2fe" : "#94a3b8"};
                  box-shadow: 0 0 6px ${count > 0 ? "#00f2fe" : "transparent"};
                "></span>
                <span style="font-weight: 600; font-family: sans-serif;">${name.replace(/(街道|镇|区)$/, "")}</span>
                <span style="color: #38bdf8; font-weight: 700;">${count}</span>
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

      // 自动最佳缩放贴合
      try {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [25, 25], maxZoom: 12 });
        }
      } catch (e) {}
    });

    return () => {
      isMounted = false;
    };
  }, [mapInstance, geoData, counts, selectedTownship, maxCount, totalCount, onSelectTownship, activeRegion]);

  return (
    <div className="relative w-full h-full min-h-[380px] rounded-xl overflow-hidden border border-cyan-500/30 bg-[#030919] shadow-[inset_0_0_40px_rgba(0,10,30,0.8)]">
      {/* 科技经纬网格线与雷达扫描装饰背景 */}
      <div
        className="absolute inset-0 pointer-events-none opacity-20"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(0, 242, 254, 0.1) 1px, transparent 1px), linear-gradient(to bottom, rgba(0, 242, 254, 0.1) 1px, transparent 1px)",
          backgroundSize: "40px 40px",
        }}
      />

      {/* 四角高科技标线 */}
      <div className="absolute top-2 left-2 w-4 h-4 border-t-2 border-l-2 border-cyan-400 z-10 pointer-events-none" />
      <div className="absolute top-2 right-2 w-4 h-4 border-t-2 border-r-2 border-cyan-400 z-10 pointer-events-none" />
      <div className="absolute bottom-2 left-2 w-4 h-4 border-b-2 border-l-2 border-cyan-400 z-10 pointer-events-none" />
      <div className="absolute bottom-2 right-2 w-4 h-4 border-b-2 border-r-2 border-cyan-400 z-10 pointer-events-none" />

      {/* 地图真实挂载 DOM */}
      <div ref={mapContainerRef} className="w-full h-full" />

      {/* 左上角 HUD 浮动状态 */}
      <div className="absolute top-3 left-3 z-20 flex items-center gap-2">
        <div className="px-3 py-1.5 rounded-lg bg-[#071738]/90 border border-cyan-500/40 backdrop-blur-md text-xs flex items-center gap-2 shadow-lg">
          <MapPin size={13} className="text-cyan-400" />
          <span className="text-slate-300">
            {selectedTownship ? (
              <>
                已聚焦镇街：<span className="text-cyan-300 font-bold">{selectedTownship}</span>
              </>
            ) : (
              <span>全域空间态势感知</span>
            )}
          </span>
          {selectedTownship && (
            <button
              type="button"
              onClick={() => onSelectTownship(null)}
              className="text-[10px] text-cyan-400 underline hover:text-white ml-1 cursor-pointer"
            >
              重置
            </button>
          )}
        </div>
      </div>

      {/* 右上角地图控制组件 */}
      <div className="absolute top-3 right-3 z-20 flex flex-col gap-1.5">
        <button
          type="button"
          onClick={() => mapInstance?.zoomIn()}
          className="p-1.5 rounded-lg bg-[#071738]/80 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer shadow"
          title="放大"
        >
          <ZoomIn size={13} />
        </button>
        <button
          type="button"
          onClick={() => mapInstance?.zoomOut()}
          className="p-1.5 rounded-lg bg-[#071738]/80 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer shadow"
          title="缩小"
        >
          <ZoomOut size={13} />
        </button>
        <button
          type="button"
          onClick={() => {
            if (geojsonLayerRef.current && mapInstance) {
              const bounds = geojsonLayerRef.current.getBounds();
              if (bounds.isValid()) {
                mapInstance.fitBounds(bounds, { padding: [25, 25] });
              }
            }
          }}
          className="p-1.5 rounded-lg bg-[#071738]/80 border border-cyan-500/40 text-cyan-300 hover:text-white hover:bg-cyan-900/50 transition-all cursor-pointer shadow"
          title="居中重置"
        >
          <Crosshair size={13} />
        </button>
      </div>

      {/* 左下角热度色标图例 */}
      <div className="absolute bottom-3 left-3 z-20 px-3 py-1.5 rounded-lg bg-[#071738]/80 border border-cyan-500/30 backdrop-blur-md text-[11px] flex items-center gap-2">
        <span className="text-slate-400">工单热度：</span>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#0284c7]" />
          <span className="text-slate-300">常规</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#06b6d4]" />
          <span className="text-slate-300">活跃</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="w-2.5 h-2.5 rounded-xs bg-[#f59e0b]" />
          <span className="text-amber-400 font-semibold">热点聚焦</span>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 bg-[#030919]/70 backdrop-blur-xs flex items-center justify-center z-30">
          <div className="flex items-center gap-2 text-cyan-400 text-xs font-mono animate-pulse">
            <RotateCcw className="animate-spin" size={14} />
            <span>加载辖区三维空间几何图层...</span>
          </div>
        </div>
      )}
    </div>
  );
}
