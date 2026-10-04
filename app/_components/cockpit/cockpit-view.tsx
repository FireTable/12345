"use client";

import React, { useState, useEffect, useCallback, useRef } from "react";
import { useRegion } from "../civic/region-context";
import { useCockpitData } from "./use-cockpit-data";
import { CockpitTitleCrown, CockpitTopControls } from "./cockpit-header";
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
  const [escWarning, setEscWarning] = useState(false);
  const escTimerRef = useRef<NodeJS.Timeout | null>(null);

  const regionId = activeRegion?.id || "fs_shunde";
  const cockpit = useCockpitData(regionId);

  // 监听浏览器全屏状态
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 快捷键 ESC 双击二次退出防误触逻辑
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();

        // 如果处于原生全屏，先退出原生全屏
        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }

        // 判断是否为 2 秒内二次按下 ESC
        if (escTimerRef.current) {
          clearTimeout(escTimerRef.current);
          escTimerRef.current = null;
          setEscWarning(false);
          onClose();
        } else {
          // 第一次按下，展示 HUD 二次确认提示浮窗
          setEscWarning(true);
          escTimerRef.current = setTimeout(() => {
            escTimerRef.current = null;
            setEscWarning(false);
          }, 2000);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      if (escTimerRef.current) clearTimeout(escTimerRef.current);
    };
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

      {/* 1. 核心底图：全屏 GIS 数字孪生地图底层 (无缝贯穿全屏至最顶部) */}
      <CockpitMap
        activeRegion={activeRegion}
        counts={cockpit.subdistrictCounts}
        selectedTownship={cockpit.selectedTownship}
        onSelectTownship={cockpit.setSelectedTownship}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* 2. 悬浮半透明微胶囊操控中枢 (无常规Header，两侧悬浮微胶囊) */}
      <CockpitTopControls
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

      {/* 3. 悬浮 HUD 视窗内容层 */}
      <div className="absolute inset-0 z-10 p-3 flex flex-col justify-between pointer-events-none">
        {/* 顶部中央：无 Header 翼展流光标题 + 悬浮 KPI 矩阵 */}
        <div className="w-full flex flex-col items-center shrink-0">
          <CockpitTitleCrown title={activeRegion?.name || "顺德区"} />

          <div className="w-full max-w-5xl mx-auto mt-2 pointer-events-auto">
            <CockpitKpiStrip kpi={cockpit.kpi} />
          </div>
        </div>

        {/* 中间层：左侧悬浮坞、中间开阔地图视区（底部悬浮趋势）、右侧悬浮坞 */}
        <div className="flex-1 w-full flex justify-between gap-3.5 mt-2 min-h-0 pointer-events-none">
          {/* 左侧悬浮窗体列 (360px ~ 380px) */}
          <section className="w-[360px] xl:w-[380px] h-full flex flex-col gap-3 min-h-0 pointer-events-auto">
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

          {/* 中间开阔视区：完全裸露给底层 GIS 交互，底部轻量悬浮时序走势波形 */}
          <div className="flex-1 h-full flex flex-col justify-end items-center px-4 pointer-events-none pb-1">
            <div className="w-full max-w-2xl h-[165px] pointer-events-auto">
              <CockpitTrendChart
                daily={cockpit.trendDaily}
                clusters={cockpit.trendClusters}
              />
            </div>
          </div>

          {/* 右侧悬浮窗体列 (360px ~ 380px) */}
          <section className="w-[360px] xl:w-[380px] h-full flex flex-col gap-3 min-h-0 pointer-events-auto">
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

      {/* 4. ESC 二次退出防误触 HUD 提示条 */}
      {escWarning && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[#051129]/95 border border-cyan-400 text-cyan-200 text-xs font-mono shadow-[0_0_25px_rgba(0,242,254,0.5)] backdrop-blur-2xl animate-in fade-in zoom-in-95 flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-cyan-400 animate-ping" />
          <span>
            再按一次 <kbd className="px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300 font-bold border border-cyan-400/50">ESC</kbd> 退出大屏
          </span>
        </div>
      )}
    </div>
  );
}
