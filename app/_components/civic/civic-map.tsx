"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { mapColorByShare } from "@/lib/civic-cluster";
import { useRegion } from "./region-context";
import { RefreshCw, ZoomIn, ZoomOut } from "lucide-react";

export type CivicMapProps = {
  counts: Record<string, number>;
  clusterCounts?: Record<string, number>;
  selected?: string;
  onSelect?: (name: string) => void;
  svgPath?: string | null;
  townships?: string[];
};

/**
 * 重点城市区县下辖第四级法定乡镇/街道的精确行政经纬度坐标字典 (CGCS2000 / WGS84)
 */
const DEFAULT_TOWNSHIP_CENTERS: Record<string, Record<string, [number, number]>> = {
  shunde: {
    "陈村": [113.2212, 22.9911],
    "北滘": [113.2155, 22.9480],
    "乐从": [113.1038, 22.9455],
    "龙江": [113.0570, 22.8614],
    "伦教": [113.2395, 22.8807],
    "勒流": [113.1498, 22.8559],
    "大良": [113.2769, 22.8333],
    "杏坛": [113.1144, 22.7878],
    "容桂": [113.2555, 22.7820],
    "均安": [113.1061, 22.7230],
  },
  tianhe: {
    "猎德": [113.332, 23.118],
    "冼村": [113.334, 23.131],
    "石牌": [113.345, 23.135],
    "天河南": [113.325, 23.135],
    "天园": [113.365, 23.128],
    "五山": [113.352, 23.158],
    "棠下": [113.385, 23.132],
    "车陂": [113.405, 23.125],
  },
};

/**
 * 自动计算任意 GeoJSON Feature 或 Leaflet Layer 的几何行政中心点 (Centroid)
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

  const cleanRegionId = useMemo(() => {
    return (activeRegion?.id || "fs_shunde").replace(/^(fs_|gz_|sz_)/, "");
  }, [activeRegion?.id]);

  // 1. 默认动态从站点数据库拉取第四级镇街多边形网格面
  useEffect(() => {
    let cancelled = false;
    const regionId = activeRegion?.id || "fs_shunde";

    // 优先拉取第四级镇街多边形
    fetch(`/api/regions/${regionId}/boundary?level=subdistricts`)
      .then((r) => (r.ok ? r.json() : null))
      .then((res) => {
        if (cancelled) return;
        if (res?.data?.geojson?.features && res.data.geojson.features.length > 0) {
          setGeoData(res.data.geojson);
        } else {
          // 若站点尚未持久化第四级多边形，优雅回退至区级权威审图轮廓
          fetch(`/api/regions/${regionId}/boundary?level=district`)
            .then((r) => (r.ok ? r.json() : null))
            .then((districtRes) => {
              if (cancelled) return;
              if (districtRes?.data?.geojson?.features) {
                setGeoData(districtRes.data.geojson);
              }
            });
        }
      })
      .catch((err) => {
        console.warn("[CivicMap] 拉取空间地理资产失败:", err);
      });

    return () => {
      cancelled = true;
    };
  }, [activeRegion?.id]);

  // 2. 初始化天地图 GIS 实景底图
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

      // 天地图矢量底图 (通过服务端安全代理)
      L.tileLayer("/api/map/tile?type=vec&z={z}&x={x}&y={y}", {
        maxZoom: 18,
      }).addTo(map);

      // 天地图中文道路/街道注记 (包含各镇街天然境界标注)
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

  // 3. 渲染 GeoJSON 与镇街徽标
  useEffect(() => {
    if (!mapRef.current || !geoData) return;

    let isMounted = true;
    import("leaflet").then((module) => {
      if (!isMounted || !mapRef.current) return;
      const L = module.default;
      const map = mapRef.current;

      // 清除旧图层与徽标
      if (geojsonLayerRef.current) {
        geojsonLayerRef.current.remove();
        geojsonLayerRef.current = null;
      }
      badgesLayerRef.current.forEach((b) => b.remove());
      badgesLayerRef.current = [];

      const isDistrictLevel = geoData.features.length === 1;

      // 3.1 绘制多边形面 (Choropleth 填色或高亮外边框)
      const geoLayer = L.geoJSON(geoData, {
        style: (feature: any) => {
          const name = feature?.properties?.name || "";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;

          if (isDistrictLevel) {
            // 方案一（区县轮廓）：清透的半透明水蓝色底，配合清晰发光边界，让底图镇街道路清晰可见
            return {
              fillColor: "#3B82F6",
              fillOpacity: 0.12,
              color: "#1E5AFF",
              weight: 3,
              dashArray: "4, 2",
              lineJoin: "round",
            };
          }

          // 镇街独立分区块：根据各自诉求量赋予热力梯度色彩
          const fillColor = count === 0 ? "#94A3B8" : mapColorByShare(count, maxCount);
          return {
            fillColor,
            fillOpacity: isSelected ? 0.55 : count > 0 ? 0.38 : 0.18,
            color: isSelected ? "#1E40AF" : "#2563EB", // 采用高辨识度的深蓝边界，替代原隐形且不易辨识的白色
            weight: isSelected ? 2.5 : 1.5,           // 默认 1.5px 纤细精致边框
            dashArray: isSelected ? "" : "4, 2",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature: any, layer: Layer) => {
          const name = feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const clusters = isDistrictLevel
            ? Object.values(clusterCounts).reduce((a, b) => a + b, 0)
            : (clusterCounts[name] || clusterCounts[`${name}街道`] || clusterCounts[`${name}镇`] || 0);
          const share = totalTickets > 0 ? ((count / totalTickets) * 100).toFixed(1) : "0.0";

          layer.on({
            mouseover: (e: any) => {
              const l = e.target;
              l.setStyle({
                weight: 2,          // 精准控制在 2px，告别过粗边框
                color: "#1E40AF",   // 深邃高饱和聚焦蓝
                fillOpacity: 0.5,   // 柔和半透明高亮，不遮挡底图道路注记
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
              if (onSelect && !isDistrictLevel) {
                const isSel = selected === name || selected === `${name}街道` || selected === `${name}镇`;
                onSelect(isSel ? "" : name);
              }
            },
          });

          // Tooltip 详细卡片
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

      // 自动自适应视野
      try {
        const bounds = geoLayer.getBounds();
        if (bounds.isValid()) {
          map.fitBounds(bounds, { padding: [24, 24], maxZoom: 13 });
        }
      } catch (e) {}

      // 3.2 收集需要挂载胶囊徽标的镇街项
      const itemsToBadge: Array<{
        name: string;
        centerCoords: [number, number];
        count: number;
        clusters: number;
      }> = [];

      if (isDistrictLevel) {
        // 方案一：在官方区县实景底图上，根据预置镇街字典打出每一个第四级镇街的中心徽标！
        const townMap = DEFAULT_TOWNSHIP_CENTERS[cleanRegionId] || {};
        const townNames = Object.keys(townMap);

        if (townNames.length > 0) {
          townNames.forEach((tName) => {
            const coords = townMap[tName];
            const c = counts[tName] || counts[`${tName}街道`] || counts[`${tName}镇`] || 0;
            const cl = clusterCounts[tName] || clusterCounts[`${tName}街道`] || clusterCounts[`${tName}镇`] || 0;
            itemsToBadge.push({
              name: tName,
              centerCoords: coords,
              count: c,
              clusters: cl,
            });
          });
        } else {
          // Fallback 单个中心
          const f = geoData.features[0];
          const coords = getFeatureCenter(f);
          if (coords) {
            itemsToBadge.push({
              name: activeRegion?.name || "全境",
              centerCoords: coords,
              count: totalTickets,
              clusters: Object.values(clusterCounts).reduce((a, b) => a + b, 0),
            });
          }
        }
      } else {
        // 方案二：第四级多边形面模式，为各个镇街独立挂载徽标
        geoData.features.forEach((feature: any) => {
          const name = feature?.properties?.name || "未知";
          const coords = getFeatureCenter(feature);
          if (!coords) return;
          const c = counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0;
          const cl = clusterCounts[name] || clusterCounts[`${name}街道`] || clusterCounts[`${name}镇`] || 0;
          itemsToBadge.push({
            name,
            centerCoords: coords,
            count: c,
            clusters: cl,
          });
        });
      }

      // 3.3 绘制各镇街中心胶囊徽标
      itemsToBadge.forEach((item) => {
        const { name, centerCoords, count, clusters } = item;
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
          // 平滑飞行平移聚焦到该镇街
          map.flyTo([centerCoords[1], centerCoords[0]], 13, { duration: 0.8 });
        });

        badgesLayerRef.current.push(badgeMarker);
      });

      // 3.4 若有选中项，聚焦该区域
      if (selected) {
        const selName = selected.replace(/(街道|镇)$/, "");
        const targetBadge = itemsToBadge.find((b) => b.name === selName);
        if (targetBadge) {
          map.flyTo([targetBadge.centerCoords[1], targetBadge.centerCoords[0]], 13, { duration: 0.6 });
        }
      }
    });

    return () => {
      isMounted = false;
    };
  }, [geoData, counts, clusterCounts, selected, maxCount, totalTickets, onSelect, cleanRegionId]);

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

      {/* 顶部标题与选区指示 */}
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
              : `${activeRegion ? activeRegion.name : "全区"}行政区划工单热力分布`}
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

      {/* 右侧缩放控制按钮 */}
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
