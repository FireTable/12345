"use client";

import React, { useState, useEffect, useCallback } from "react";
import { useRegion } from "../civic/region-context";
import { useCockpitData } from "./use-cockpit-data";
import { CockpitHeader } from "./cockpit-header";
import { CockpitKpiStrip } from "./cockpit-kpi-strip";
import { CockpitMap } from "./cockpit-map";
import { CockpitStream } from "./cockpit-stream";
import { CockpitCategoryChart } from "./cockpit-category-chart";
import { CockpitAlertPanel } from "./cockpit-alert-panel";
import { CockpitTownshipRank } from "./cockpit-township-rank";
import { CockpitTrendChart } from "./cockpit-trend-chart";
import { CockpitInsights } from "./cockpit-insights";

interface CockpitViewProps {
  onClose: () => void;
}

export function CockpitView({ onClose }: CockpitViewProps) {
  const { activeRegion, regions, switchRegion } = useRegion();
  const [isFullscreen, setIsFullscreen] = useState(false);

  const regionId = activeRegion?.id || "fs_shunde";
  const cockpit = useCockpitData(regionId);

  // 监听全屏变动
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 监听 Esc 快捷键退出
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        } else {
          onClose();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  const toggleFullscreen = useCallback(() => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, []);

  return (
    <div className="fixed inset-0 z-50 w-screen h-screen bg-[#020714] text-slate-100 flex flex-col overflow-hidden select-none animate-in fade-in duration-300">
      <style jsx global>{`
        .custom-cockpit-scrollbar::-webkit-scrollbar {
          width: 4px;
        }
        .custom-cockpit-scrollbar::-webkit-scrollbar-track {
          background: rgba(0, 242, 254, 0.03);
          border-radius: 4px;
        }
        .custom-cockpit-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(0, 242, 254, 0.25);
          border-radius: 4px;
        }
        .custom-cockpit-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(0, 242, 254, 0.5);
        }
      `}</style>

      {/* 顶部指挥枢纽 */}
      <CockpitHeader
        activeRegion={activeRegion}
        regions={regions}
        onSelectRegion={switchRegion}
        isPolling={cockpit.isPolling}
        onTogglePolling={() => cockpit.setIsPolling(!cockpit.isPolling)}
        onRefresh={cockpit.refresh}
        isRefreshing={cockpit.isRefreshing}
        onClose={onClose}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {/* 主体大屏视区 (16:9 自适应 Flex 网格) */}
      <main className="flex-1 w-full p-3.5 flex flex-col gap-3 min-h-0 overflow-hidden bg-radial from-[#071738]/40 via-[#030919]/90 to-[#020714]">
        {/* 第一行：四大核心动态 KPI 指标条 */}
        <div className="shrink-0 w-full">
          <CockpitKpiStrip kpi={cockpit.kpi} />
        </div>

        {/* 第二行：核心三栏式指挥沙盘 (左翼 · 中央GIS · 右翼) */}
        <div className="flex-1 w-full grid grid-cols-12 gap-3 min-h-0">
          {/* 左翼 (3列/12)：分类分布 + 突发险情预警 + 实时工单流水 */}
          <section className="col-span-3 h-full flex flex-col gap-3 min-h-0">
            <div className="h-[28%] min-h-[140px]">
              <CockpitCategoryChart data={cockpit.categoryStats} />
            </div>
            <div className="h-[28%] min-h-[140px]">
              <CockpitAlertPanel
                alerts={cockpit.alerts}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
            <div className="flex-1 min-h-[180px]">
              <CockpitStream
                tickets={cockpit.recentTickets}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
          </section>

          {/* 中央舞台 (6列/12)：高科技辖区 GIS 地图 + 时序波形 */}
          <section className="col-span-6 h-full flex flex-col gap-3 min-h-0">
            <div className="flex-1 min-h-[280px]">
              <CockpitMap
                activeRegion={activeRegion}
                counts={cockpit.subdistrictCounts}
                selectedTownship={cockpit.selectedTownship}
                onSelectTownship={cockpit.setSelectedTownship}
              />
            </div>
            <div className="h-[30%] min-h-[160px] shrink-0">
              <CockpitTrendChart
                daily={cockpit.trendDaily}
                clusters={cockpit.trendClusters}
              />
            </div>
          </section>

          {/* 右翼 (3列/12)：镇街排行榜 + AI 慢思考政策研判 */}
          <section className="col-span-3 h-full flex flex-col gap-3 min-h-0">
            <div className="h-[52%] min-h-[220px]">
              <CockpitTownshipRank
                stats={cockpit.townshipStats}
                selectedTownship={cockpit.selectedTownship}
                onSelectTownship={cockpit.setSelectedTownship}
              />
            </div>
            <div className="flex-1 min-h-[180px]">
              <CockpitInsights insights={cockpit.insights} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
