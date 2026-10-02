"use client";

import React, { useEffect, useRef, useState, useMemo } from "react";
import type { Map as LeafletMap, GeoJSON as LeafletGeoJSON, Layer } from "leaflet";
import { mapColorByShare, getTownshipColor } from "@/lib/civic-cluster";
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
  const [mapInstance, setMapInstance] = useState<LeafletMap | null>(null);
  const [loading, setLoading] = useState(true);
  const [geoData, setGeoData] = useState<any>(null);

  // 统计工单总量与最大值
  const values = Object.values(counts);
  const totalTickets = useMemo(() => values.reduce((a, b) => a + b, 0), [values]);
  const maxCount = useMemo(() => (values.length ? Math.max(...values) : 1), [values]);

  // 1. 默认动态从站点数据库拉取第四级镇街多边形网格面（内置本地静态兜底，确保 100% 出现）
  useEffect(() => {
    let cancelled = false;
    const regionId = activeRegion?.id || "fs_shunde";

    async function loadBoundary() {
      try {
        // 第一优先级：从服务端数据库拉取最新高精第四级镇街多边形
        const res = await fetch(`/api/regions/${regionId}/boundary?level=subdistricts`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (res?.data?.geojson?.features && res.data.geojson.features.length > 0) {
          setGeoData(res.data.geojson);
          return;
        }

        // 第二优先级：本地静态权威多边形兜底（如 public/civic/fs_shunde-townships.geojson）
        const localRes = await fetch(`/civic/${regionId}-townships.geojson`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (localRes?.features && localRes.features.length > 0) {
          setGeoData(localRes);
          return;
        }

        // 第三优先级：回退至区级权威审图轮廓
        const districtRes = await fetch(`/api/regions/${regionId}/boundary?level=district`).then((r) =>
          r.ok ? r.json() : null
        );
        if (cancelled) return;
        if (districtRes?.data?.geojson?.features) {
          setGeoData(districtRes.data.geojson);
        }
      } catch (err) {
        console.warn("[CivicMap] 拉取空间地理资产异常，尝试本地静态兜底:", err);
        try {
          const fallback = await fetch(`/civic/${regionId}-townships.geojson`).then((r) =>
            r.ok ? r.json() : null
          );
          if (!cancelled && fallback?.features) {
            setGeoData(fallback);
          }
        } catch (e) {}
      }
    }

    loadBoundary();

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

      // 1. 前端直连标准矢量底图与注记 CDN（完全走浏览器直连，0 服务端带宽与 CPU 消耗）
      L.tileLayer(
        "https://wprd0{s}.is.autonavi.com/appmaptile?x={x}&y={y}&z={z}&lang=zh_cn&size=1&scale=1&style=7",
        {
          subdomains: ["1", "2", "3", "4"],
          maxZoom: 18,
          attribution: "© AutoNavi",
        }
      ).addTo(map);

      mapRef.current = map;
      setMapInstance(map);
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
      setMapInstance(null);
    };
  }, [activeRegion?.id]);

  // 3. 渲染 GeoJSON 与镇街徽标（当 mapInstance 和 geoData 均准备就绪时必然触发，杜绝竞态）
  useEffect(() => {
    if (!mapInstance || !geoData) return;

    let isMounted = true;
    import("leaflet").then((module) => {
      if (!isMounted || !mapInstance) return;
      const L = module.default;
      const map = mapInstance;

      // 清除旧图层
      if (geojsonLayerRef.current) {
        geojsonLayerRef.current.remove();
        geojsonLayerRef.current = null;
      }

      const isDistrictLevel = geoData.features.length === 1;

      // 3.1 绘制多边形面 (Choropleth 填色并正中央固化名称+数字微胶囊)
      const geoLayer = L.geoJSON(geoData, {
        style: (feature: any) => {
          const name = feature?.properties?.name || "";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;

          if (isDistrictLevel) {
            return {
              fillColor: "#3B82F6",
              fillOpacity: 0.10,
              color: "#1E5AFF",
              weight: 1.5,
              dashArray: "4, 2",
              lineJoin: "round",
            };
          }

          // 镇街独立分区块：统一使用标准镇街专属色彩 (SSOT 单一事实来源)
          const townColor = getTownshipColor(name);
          return {
            fillColor: townColor,
            fillOpacity: isSelected ? 0.28 : 0.14, // 极通透空灵质感，底图道路水系一清二楚
            color: townColor,                      // 绝不使用突兀黑边，始终保持专属纯净色彩
            weight: isSelected ? 1.6 : 1.0,        // 纤细精致线条 (默认 1.0px，选中 1.6px，绝不变粗)
            dashArray: isSelected ? "" : "3, 2",
            lineJoin: "round",
          };
        },
        onEachFeature: (feature: any, layer: Layer) => {
          const name = feature?.properties?.name || activeRegion?.name || "本辖区";
          const count = isDistrictLevel ? totalTickets : (counts[name] || counts[`${name}街道`] || counts[`${name}镇`] || 0);
          const townColor = getTownshipColor(name);
          const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;

          // 获取当前板块真实的几何正中央坐标（与 hover tooltip 完全同源）
          let centerLatLng: any = null;
          if (typeof (layer as any).getBounds === "function") {
            const b = (layer as any).getBounds();
            if (b && b.isValid()) {
              centerLatLng = b.getCenter();
            }
          }

          // 镇街名称 + 数字胶囊：直接永久固化在板块几何正中央
          if (!isDistrictLevel) {
            const centerBadgeHtml = `
              <div class="civic-town-pill ${isSelected ? "is-selected" : ""}" style="
                display: inline-flex;
                align-items: center;
                gap: 5px;
                background: ${isSelected ? townColor : "rgba(255, 255, 255, 0.95)"};
                backdrop-filter: blur(6px);
                border: 1.5px solid ${isSelected ? "#FFFFFF" : townColor};
                border-radius: 14px;
                padding: 2px 7px;
                box-shadow: ${isSelected ? `0 0 0 3px ${townColor}35, 0 3px 8px rgba(0,0,0,0.18)` : "0 2px 6px rgba(0,0,0,0.12)"};
                user-select: none;
                white-space: nowrap;
                transform: translate3d(0, 0, 0);
              ">
                <span style="
                  display: inline-block;
                  width: 6px;
                  height: 6px;
                  border-radius: 50%;
                  background: ${isSelected ? "#FFFFFF" : townColor};
                "></span>
                <span style="
                  font-weight: 700;
                  font-size: 11px;
                  color: ${isSelected ? "#FFFFFF" : "#0F172A"};
                ">${name}</span>
                <span style="
                  background: ${isSelected ? "#FFFFFF" : count > 0 ? townColor : "#94A3B8"};
                  color: ${isSelected ? townColor : "#FFFFFF"};
                  font-weight: 800;
                  font-size: 10px;
                  padding: 1px 5px;
                  border-radius: 8px;
                  font-family: monospace;
                ">${count}</span>
              </div>
            `;

            layer.bindTooltip(centerBadgeHtml, {
              permanent: true,
              direction: "center",
              className: "civic-polygon-center-tooltip",
            });
          }

          layer.on({
            mouseover: (e: any) => {
              const l = e.target;
              l.setStyle({
                weight: 1.4,         // 悬停时仅微增至 1.4px
                color: townColor,    // 保持同色系
                fillOpacity: 0.24,   // 柔和微光加深至 0.24
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
    });

    return () => {
      isMounted = false;
    };
  }, [mapInstance, geoData, counts, clusterCounts, totalTickets, onSelect]);

  // 4. 监听选中状态切换，就地更新多边形样式并平滑飞向该区域，绝不重建 DOM
  useEffect(() => {
    if (!geojsonLayerRef.current || !mapRef.current) return;
    const geoLayer = geojsonLayerRef.current;
    const map = mapRef.current;

    // 4.1 动态更新样式
    geoLayer.setStyle((feature: any) => {
      const name = feature?.properties?.name || "";
      const isSelected = selected === name || selected === `${name}街道` || selected === `${name}镇`;
      const townColor = getTownshipColor(name);
      return {
        fillColor: townColor,
        fillOpacity: isSelected ? 0.28 : 0.14,
        color: townColor,
        weight: isSelected ? 1.6 : 1.0,
        dashArray: isSelected ? "" : "3, 2",
        lineJoin: "round",
      };
    });

    // 4.2 视口保持完全静止，不执行任何平移或变焦，仅响应高亮样式与数据筛选联动
  }, [selected]);

  const handleResetView = () => {
    if (onSelect) onSelect("");
    if (mapRef.current && geojsonLayerRef.current) {
      mapRef.current.fitBounds(geojsonLayerRef.current.getBounds(), { padding: [20, 20], animate: true });
    }
  };

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

      {/* 底部行政网格图例 */}
      <div
        style={{
          position: "absolute",
          left: 12,
          bottom: 10,
          zIndex: 800,
          background: "rgba(255, 255, 255, 0.94)",
          backdropFilter: "blur(6px)",
          padding: "5px 12px",
          borderRadius: 20,
          border: "1px solid #CBD5E1",
          boxShadow: "0 2px 6px rgba(0,0,0,0.06)",
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: 11,
          color: "#475569",
        }}
      >
        <span style={{ width: 8, height: 8, borderRadius: "50%", background: "#1E5AFF" }} />
        <span style={{ fontWeight: 600, color: "#0F172A" }}>镇街网格:</span>
        <span style={{ color: "#64748B" }}>法定专属区划色 · 悬停网格高亮 · 胶囊数字为诉求量</span>
      </div>
    </div>
  );
}

export { CivicMap as ShundeMap };
