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

  const currentRegion = activeRegion || (regions.length > 0 ? regions[0] : null);
  const regionId = currentRegion?.id || "fs_shunde";
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

        if (document.fullscreenElement) {
          document.exitFullscreen().catch(() => {});
        }

        if (escTimerRef.current) {
          clearTimeout(escTimerRef.current);
          escTimerRef.current = null;
          setEscWarning(false);
          onClose();
        } else {
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
          background: rgba(22, 119, 255, 0.05);
          border-radius: 4px;
        }
        .custom-cockpit-scrollbar::-webkit-scrollbar-thumb {
          background: rgba(22, 119, 255, 0.35);
          border-radius: 4px;
        }
        .custom-cockpit-scrollbar::-webkit-scrollbar-thumb:hover {
          background: rgba(22, 119, 255, 0.6);
        }
      `}</style>

      {/* 1. 核心底图：全屏贯通数字孪生 GIS 底图 (覆盖整个视口) */}
      <CockpitMap
        activeRegion={currentRegion}
        counts={cockpit.subdistrictCounts}
        selectedTownship={cockpit.selectedTownship}
        onSelectTownship={cockpit.setSelectedTownship}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* 2. 顶部微胶囊控制项 (无盒装Header，左右贴顶悬浮) */}
      <CockpitTopControls
        activeRegion={currentRegion}
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

      {/* 3. 顶部中央：无 Header 翼展流光标题 (顶格居中) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <CockpitTitleCrown title={currentRegion?.name || "顺德区"} />
      </div>

      {/* 4. 悬浮 HUD 视窗内容层 (顶层布局：顶部全宽横向 KPI 矩阵条，下部三栏贴边调度坞) */}
      <div className="absolute inset-0 z-20 p-3.5 pt-[58px] flex flex-col justify-between pointer-events-none">
        {/* 顶部全宽 KPI 矩阵条：横跨全屏宽幅，左右贴边对齐左右坞，彻底解决两边空 gap，四大卡片恢复宽幅单行呼吸空间 */}
        <div className="w-full pointer-events-auto shrink-0">
          <CockpitKpiStrip kpi={cockpit.kpi} />
        </div>

        {/* 下部三栏：左贴边悬浮坞、中间开阔 GIS 数字孪生地图视区（底部悬浮趋势）、右贴边悬浮坞 */}
        <div className="flex-1 w-full flex justify-between gap-3 mt-2.5 min-h-0 pointer-events-none">
          {/* 左侧贴边悬浮坞 (对齐顶部卡片1左侧) */}
          <section className="w-[380px] xl:w-[410px] h-full flex flex-col gap-2.5 min-h-0 pointer-events-auto">
            <div className="h-[33%] min-h-[160px]">
              <CockpitCategoryChart data={cockpit.categoryStats} />
            </div>
            <div className="h-[24%] min-h-[125px]">
              <CockpitAlertPanel
                alerts={cockpit.alerts}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
            <div className="flex-1 min-h-[175px]">
              <CockpitStream
                tickets={cockpit.recentTickets}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
          </section>

          {/* 中间开阔视区：展示底层 GIS 数字孪生地图交互，底部轻量悬浮工单时序走势 */}
          <div className="flex-1 h-full flex flex-col justify-end items-center px-4 pointer-events-none pb-0.5">
            <div className="w-full max-w-3xl xl:max-w-4xl h-[170px] pointer-events-auto">
              <CockpitTrendChart
                daily={cockpit.trendDaily}
                clusters={cockpit.trendClusters}
              />
            </div>
          </div>

          {/* 右侧贴边悬浮坞 (对齐顶部卡片4右侧) */}
          <section className="w-[380px] xl:w-[410px] h-full flex flex-col gap-2.5 min-h-0 pointer-events-auto">
            <div className="h-[55%] min-h-[250px]">
              <CockpitTownshipRank
                stats={cockpit.townshipStats}
                selectedTownship={cockpit.selectedTownship}
                onSelectTownship={cockpit.setSelectedTownship}
              />
            </div>
            <div className="flex-1 min-h-[175px]">
              <CockpitInsights insights={cockpit.insights} />
            </div>
          </section>
        </div>
      </div>

      {/* 7. ESC 二次退出防误触 HUD 提示条 (Logo 蓝风格) */}
      {escWarning && (
        <div className="absolute top-20 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 rounded-full bg-[#051433]/95 border border-[#1677FF] text-blue-100 text-xs font-mono shadow-[0_0_25px_rgba(22,119,255,0.6)] backdrop-blur-2xl animate-in fade-in zoom-in-95 flex items-center gap-2.5">
          <span className="w-2.5 h-2.5 rounded-full bg-[#1677FF] animate-ping" />
          <span>
            再按一次 <kbd className="px-1.5 py-0.5 rounded bg-blue-600/30 text-white font-bold border border-blue-400/50">ESC</kbd> 退出大屏
          </span>
        </div>
      )}
    </div>
  );
}
