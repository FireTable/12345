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
    <div className="fixed inset-0 z-[9999] w-screen h-screen bg-[#020612] text-slate-100 overflow-hidden select-none animate-in fade-in duration-300">
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

      {/* 1. 核心底图：全屏 GIS 数字孪生地图底层 (贯穿全屏，充满视窗) */}
      <CockpitMap
        activeRegion={activeRegion}
        counts={cockpit.subdistrictCounts}
        selectedTownship={cockpit.selectedTownship}
        onSelectTownship={cockpit.setSelectedTownship}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* 2. 悬浮半透明 HUD 指挥调度视窗层 (覆盖在地图上方) */}
      <div className="absolute inset-0 z-10 p-3.5 flex flex-col justify-between pointer-events-none">
        {/* 顶部悬浮栏与 KPI */}
        <div className="w-full flex flex-col gap-2.5 shrink-0">
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

          <div className="w-full max-w-6xl mx-auto pointer-events-auto">
            <CockpitKpiStrip kpi={cockpit.kpi} />
          </div>
        </div>

        {/* 中间层：左侧悬浮坞、中间开阔地图视区（底部悬浮趋势）、右侧悬浮坞 */}
        <div className="flex-1 w-full flex justify-between gap-3.5 mt-2.5 min-h-0 pointer-events-none">
          {/* 左侧悬浮窗体列 (370px) */}
          <section className="w-[370px] xl:w-[390px] h-full flex flex-col gap-3 min-h-0 pointer-events-auto">
            <div className="h-[30%] min-h-[145px]">
              <CockpitCategoryChart data={cockpit.categoryStats} />
            </div>
            <div className="h-[28%] min-h-[135px]">
              <CockpitAlertPanel
                alerts={cockpit.alerts}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
            <div className="flex-1 min-h-[170px]">
              <CockpitStream
                tickets={cockpit.recentTickets}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
          </section>

          {/* 中间开阔视区：中央展现地图交互，底部悬浮时序走势波形 */}
          <div className="flex-1 h-full flex flex-col justify-end items-center px-4 pointer-events-none pb-1">
            <div className="w-full max-w-3xl h-[175px] pointer-events-auto">
              <CockpitTrendChart
                daily={cockpit.trendDaily}
                clusters={cockpit.trendClusters}
              />
            </div>
          </div>

          {/* 右侧悬浮窗体列 (370px) */}
          <section className="w-[370px] xl:w-[390px] h-full flex flex-col gap-3 min-h-0 pointer-events-auto">
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
      </div>
    </div>
  );
}
