"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { mapColorByShare } from "@/lib/civic-cluster";
import { useRegion } from "./region-context";
import { RefreshCw, ZoomIn, ZoomOut, Layers, Eye } from "lucide-react";

export type CivicMapProps = {
  counts: Record<string, number>;
  clusterCounts?: Record<string, number>;
  selected?: string;
  onSelect?: (name: string) => void;
  svgPath?: string | null;
  townships?: string[];
};

/**
 * 自动计算任意 GeoJSON Feature 或 Leaflet Layer 的几何行政中心点 (Centroid)
 * 无需任何写死的经纬度字典，支持任意区县/镇街自适应挂载徽标
 */
function getFeatureCenter(feature: any, layer?: any): [number, number] | null {
  if (Array.isArray(feature?.properties?.center) && feature.properties.center.length === 2) {
    return [feature.properties.center[0], feature.properties.center[1]];
  }
  if (layer && typeof layer.getBounds === "function") {
    const latLng = layer.getBounds().getCenter();
    return [latLng.lng, latLng.lat];
  }
  const coords = feature?.geometry?.coordinates;
  if (!coords) return null;
  let totalLng = 0, totalLat = 0, count = 0;
  function walk(arr: any) {
    if (typeof arr[0] === "number" && typeof arr[1] === "number") {
      totalLng += arr[0];
      totalLat += arr[1];
      count++;
    } else if (Array.isArray(arr)) {
      arr.forEach(walk);
    }
  }
  walk(coords);
  return count > 0 ? [totalLng / count, totalLat / count] : null;
}

export function CivicMap({
  counts,
  clusterCounts = {},
  selected = "",
  onSelect,
}: CivicMapProps) {
  const { activeRegion } = useRegion();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const geojsonLayerRef = useRef<LeafletGeoJSON | null>(null);
  const badgesLayerRef = useRef<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [geoData, setGeoData] = useState<any>(null);

  // 统计工单总量与最大值
  const values = Object.values(counts);
  const totalTickets = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);
  const maxCount = useMemo(() => (values.length ? Math.max(...values) : 1), [values]);

  // 1. 优先拉取当前站点在站点管理中心持久化保存的官方高精行政区划 GeoJSON 数据
  useEffect(() => {
    let cancelled = false;
    const regionId = activeRegion?.id || "fs_shunde";

    fetch(`/api/regions/${regionId}/boundary`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return;
        if (res?.data?.geojson?.features) {
          setGeoData(res.data.geojson);
        } else {
          // 若暂无专门数据，回退到本地官方标准 GeoJSON 资产
          const cleanId = regionId.replace(/^(fs_|gz_|sz_)/, "");
          fetch(`/civic/${regionId}-townships.geojson`)
            .then((r) => (r.ok ? r.json() : fetch(`/civic/${cleanId}-townships.geojson`).then((r2) => (r2.ok ? r2.json() : null))))
            .catch(() => null)
            .then((fallback) => {
              if (cancelled) return;
              if (fallback && fallback.features) {
                setGeoData(fallback);
              }
            });
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [activeRegion?.id]);

  // 2. 初始化天地图 GIS 底图
  useEffect(() => {
    let isMounted = true;

    async function initMap() {
      if (!mapContainerRef.current || mapRef.current) return;
      const L = (await import("leaflet")).default;
      if (!isMounted || !mapContainerRef.current) return;

      const map = L.map(mapContainerRef.current, {
        center: [22.84, 113.2],
        zoom: 11,
        zoomControl: false,
        attributionControl: false,
        minZoom: 8,
        maxZoom: 18,
      });

      // 天地图矢量底图 (通过安全后端代理)
      L.tileLayer("/api/map/tile?type=vec&z={z}&x={x}&y={y}", {
        maxZoom: 18,
      }).addTo(map);

      // 天地图中文道路/注记
      L.tileLayer("/api/map/tile?type=cva&z={z}&x={x}&y={y}", {
        maxZoom: 18,
      }).addTo(map);

      mapRef.current = map;
      setLoading(false);

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
    };
  }, [activeRegion?.id]);

  // 3. 在真实地图上渲染行政区划 GeoJSON 边界多边形与数量胶囊徽标
  useEffect(() => {
    if (!mapRef.current || !geoData) return;

    let isMounted = true;
    import("leaflet").then((module) => {
      if (!isMounted || !mapRef.current) return;
      const L = module.default;
      const map = mapRef.current;

      // 清除旧行政区划图层与徽标
      if (geojsonLayerRef.current) {
        geojsonLayerRef.current.remove();
        geojsonLayerRef.current = null;
      }
      badgesLayerRef.current.forEach((b) => b.remove());
      badgesLayerRef.current = [];

      // 3.1 绘制行政区域 GeoJSON 边界多边形面 (Choropleth 行政区划)
      const isDistrictLevel = geoData.features.length === 1;

      const geoLayer = L.geoJSON(geoData, {
        style: (feature: any) => {
          const name = feature?.properties?.name || "";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;

          // 根据诉求量赋予半透明渐变热力色彩
          const fillColor = count === 0 ? "#94A3B8" : mapColorByShare(count, isDistrictLevel ? count : maxCount);

          return {
            fillColor,
            fillOpacity: isSelected ? 0.65 : count > 0 ? 0.38 : 0.2,
            color: isSelected ? "#1E5AFF" : "#FFFFFF",
            weight: isSelected ? 3.5 : 2,
            dashArray: isSelected ? "" : "2, 1",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature: any, layer: Layer) => {
          const name = feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const clusters = isDistrictLevel ? Object.values(clusterCounts).reduce((a, b) => a + b, 0) : (clusterCounts[name] || clusterCounts[`${name}街道`] || clusterCounts[`${name}镇`] || 0);
          const share = totalTickets > 0 ? ((count / totalTickets) * 100).toFixed(1) : "0.0";

          // 悬停高亮与交互
          layer.on({
            mouseover: (e: any) => {
              const l = e.target;
              l.setStyle({
                weight: 4,
                color: "#1E5AFF",
                fillOpacity: 0.55,
                dashArray: "",
              });
              if (!L.Browser.ie && !L.Browser.opera && !L.Browser.edge) {
                l.bringToFront();
              }
            },
            mouseout: (e: any) => {
              geoLayer.resetStyle(e.target);
            },
            click: () => {
              if (onSelect) {
                const isSel = selected === name || selected === `${name}街道` || selected === `${name}镇`;
                onSelect(isSel ? "" : name);
              }
            },
          });

          // 悬浮 Tooltip 详细卡片
          layer.bindTooltip(
            `
            <div style="font-family: ui-sans-serif, system-ui; font-size: 12px; padding: 4px 6px;">
              <div style="font-weight: 700; color: #0F172A; font-size: 13px; margin-bottom: 3px;">📍 ${name}</div>
              <div style="display: flex; justify-content: space-between; gap: 12px; color: #475569; font-size: 11px;">
                <span>工单总量</span>
                <span style="font-weight: 800; color: #1E5AFF; font-family: monospace;">${count.toLocaleString()} 件</span>
              </div>
              <div style="display: flex; justify-content: space-between; gap: 12px; color: #475569; font-size: 11px;">
                <span>多频群组</span>
                <span style="font-weight: 700; color: #EA580C; font-family: monospace;">${clusters} 个</span>
              </div>
              <div style="color: #94A3B8; font-size: 10px; margin-top: 2px;">全区占比: ${share}% · 点击聚焦筛选</div>
            </div>
            `,
            { direction: "top", offset: [0, -10], className: "civic-zone-tooltip" }
          );
        },
      }).addTo(map);

      geojsonLayerRef.current = geoLayer;

      // 自动自适应视野包裹整个辖区行政多边形
      try {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
        }
      } catch (e) {}

      // 3.2 在各行政几何中心自动挂载数量徽标 Badge (完全动态计算质心)
      geoData.features.forEach((feature: any) => {
        const name = feature?.properties?.name || activeRegion?.name || "全境";
        const centerCoords = getFeatureCenter(feature);
        if (!centerCoords) return;

        const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
        const clusters = isDistrictLevel ? Object.values(clusterCounts).reduce((a, b) => a + b, 0) : (clusterCounts[name] || clusterCounts[`${name}街道`] || clusterCounts[`${name}镇`] || 0);
        const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;

        const badgeHtml = `
          <div style="
            position: relative;
            transform: translate(-50%, -50%);
            cursor: pointer;
            user-select: none;
            filter: drop-shadow(0 3px 6px rgba(0,0,0,0.18));
            transition: transform 0.15s ease-out;
          ">
            <div style="
              display: flex;
              align-items: center;
              gap: 4px;
              background: ${isSelected ? "#1E5AFF" : "#FFFFFF"};
              border: 1.5px solid ${isSelected ? "#FFFFFF" : "#CBD5E1"};
              border-radius: 16px;
              padding: 2px 7px;
              box-shadow: ${isSelected ? "0 0 0 3px rgba(30, 90, 255, 0.35)" : "none"};
              white-space: nowrap;
            ">
              <span style="
                font-weight: 700;
                font-size: 11px;
                color: ${isSelected ? "#FFFFFF" : "#0F172A"};
              ">${name}</span>
              <span style="
                background: ${isSelected ? "#FFFFFF" : count > maxCount * 0.5 ? "#F53F3F" : "#1E5AFF"};
                color: ${isSelected ? "#1E5AFF" : "#FFFFFF"};
                font-weight: 800;
                font-size: 10px;
                padding: 1px 5px;
                border-radius: 10px;
                font-family: monospace;
              ">${count}</span>
            </div>
            ${
              clusters > 0
                ? `<div style="
                    position: absolute;
                    top: 100%;
                    left: 50%;
                    transform: translateX(-50%);
                    background: #FFF7ED;
                    color: #C2410C;
                    font-size: 9px;
                    font-weight: 700;
                    padding: 0 4px;
                    border-radius: 8px;
                    border: 0.5px solid #FDBA74;
                    margin-top: 1px;
                    white-space: nowrap;
                  ">🔥 ${clusters}群组</div>`
                : ""
            }
          </div>
        `;

        const badgeIcon = L.divIcon({
          html: badgeHtml,
          className: "civic-zone-center-badge",
          iconSize: [60, 24],
          iconAnchor: [30, 12],
        });

        const badgeMarker = L.marker([centerCoords[1], centerCoords[0]], {
          icon: badgeIcon,
          zIndexOffset: isSelected ? 1000 : 500,
        }).addTo(map);

        badgeMarker.on("click", () => {
          if (onSelect) {
            onSelect(isSelected ? "" : name);
          }
        });

        badgesLayerRef.current.push(badgeMarker);
      });

      // 3.3 若有选中项，聚焦该区域
      if (selected) {
        const selName = selected.replace(/(街道|镇)$/, "");
        const targetFeature = geoData.features.find((f: any) => f.properties?.name === selName);
        if (targetFeature) {
          const tempLayer = L.geoJSON(targetFeature);
          map.fitBounds(tempLayer.getBounds(), { padding: [50, 50], maxZoom: 13, animate: true });
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [geoData, counts, clusterCounts, selected, maxCount, totalTickets, onSelect]);

  const handleResetView = () => {
    if (onSelect) onSelect("");
    if (mapRef.current && geojsonLayerRef.current) {
      mapRef.current.fitBounds(geojsonLayerRef.current.getBounds(), { padding: [20, 20], animate: true });
    }
  };

  const legend = [
    { color: "#F53F3F", label: `高热 (≥${Math.round(maxCount * 0.75)})` },
    { color: "#FF7D00", label: `中高 (≥${Math.round(maxCount * 0.45)})` },
    { color: "#1E5AFF", label: `一般 (≥${Math.round(maxCount * 0.2)})` },
    { color: "#14C9C9", label: `平稳 (<${Math.round(maxCount * 0.2)})` },
  ];

  return (
    <div
      style={{
        position: "relative",
        width: "100%",
        height: "100%",
        minHeight: 460,
        borderRadius: "var(--r-md, 12px)",
        overflow: "hidden",
        border: "1px solid var(--c-border-soft, #E2E8F0)",
        isolation: "isolate",
        zIndex: 1,
      }}
    >
      <div ref={mapContainerRef} style={{ width: "100%", height: "100%", minHeight: 460, background: "#F1F5F9" }} />

      {/* 顶部标题与选区筛选指示条 */}
      <div
        style={{
          position: "absolute",
          top: 12,
          left: 12,
          zIndex: 800,
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            background: "rgba(255, 255, 255, 0.96)",
            backdropFilter: "blur(6px)",
            padding: "5px 12px",
            borderRadius: 20,
            border: "1px solid #E2E8F0",
            boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: 12,
            fontWeight: 700,
            color: "#0F172A",
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: "50%", background: "#1E5AFF" }} />
          <span>
            {selected
              ? `聚焦辖区：${selected}`
              : `${activeRegion ? activeRegion.name : "全区"}行政区划热力透势 (GIS 实景底图)`}
          </span>
          <span style={{ color: "#64748B", fontWeight: 400, marginLeft: 2 }}>
            ({totalTickets.toLocaleString()} 件诉求)
          </span>
        </div>

        {selected && (
          <button
            type="button"
            onClick={handleResetView}
            style={{
              background: "#1E5AFF",
              color: "#ffffff",
              border: "none",
              padding: "5px 12px",
              borderRadius: 20,
              fontSize: 11,
              fontWeight: 600,
              cursor: "pointer",
              boxShadow: "0 2px 4px rgba(30, 90, 255, 0.35)",
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            <RefreshCw style={{ width: 12, height: 12 }} />
            <span>返回全区</span>
          </button>
        )}
      </div>

      {/* 右侧缩放按钮 */}
      <div
        style={{
          position: "absolute",
          right: 12,
          bottom: 12,
          zIndex: 800,
          display: "flex",
          flexDirection: "column",
          gap: 4,
        }}
      >
        <button
          type="button"
          onClick={() => mapRef.current?.zoomIn()}
          title="放大"
          style={{
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "#ffffff",
            border: "1px solid #E2E8F0",
            boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
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
            width: 28,
            height: 28,
            borderRadius: 6,
            background: "#ffffff",
            border: "1px solid #E2E8F0",
            boxShadow: "0 2px 4px rgba(0,0,0,0.08)",
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

      {/* 底部热力分级图例 */}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 10,
          zIndex: 800,
          background: "rgba(255, 255, 255, 0.92)",
          backdropFilter: "blur(4px)",
          padding: "4px 10px",
          borderRadius: 8,
          border: "1px solid #E2E8F0",
          display: "flex",
          alignItems: "center",
          gap: 10,
          fontSize: 11,
          color: "#475569",
        }}
      >
        <span style={{ fontWeight: 600 }}>诉求密度:</span>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {legend.map((l) => (
            <div key={l.color} style={{ display: "flex", alignItems: "center", gap: 3 }}>
              <span style={{ width: 8, height: 8, borderRadius: 2, background: l.color }} />
              <span style={{ fontSize: 10 }}>{l.label}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

export { CivicMap as ShundeMap };
