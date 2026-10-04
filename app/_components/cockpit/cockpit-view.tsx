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
        activeRegion={activeRegion}
        counts={cockpit.subdistrictCounts}
        selectedTownship={cockpit.selectedTownship}
        onSelectTownship={cockpit.setSelectedTownship}
        className="absolute inset-0 w-full h-full z-0"
      />

      {/* 2. 顶部微胶囊控制项 (无盒装Header，左右贴顶悬浮) */}
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

      {/* 3. 顶部中央：无 Header 翼展流光标题 (顶格居中) */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 z-30 pointer-events-none">
        <CockpitTitleCrown title={activeRegion?.name || "顺德区"} />
      </div>

      {/* 4. 左侧贴边悬浮坞 (从顶部胶囊下方 top-[54px] 贯穿至底部 bottom-3.5，彻底消除空白) */}
      <section className="absolute left-3.5 top-[54px] bottom-3.5 w-[380px] xl:w-[410px] flex flex-col gap-2.5 z-20 pointer-events-auto">
        <div className="h-[31%] min-h-[160px]">
          <CockpitCategoryChart data={cockpit.categoryStats} />
        </div>
        <div className="h-[27%] min-h-[140px]">
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

      {/* 5. 右侧贴边悬浮坞 (从顶部胶囊下方 top-[54px] 贯穿至底部 bottom-3.5，彻底消除空白) */}
      <section className="absolute right-3.5 top-[54px] bottom-3.5 w-[380px] xl:w-[410px] flex flex-col gap-2.5 z-20 pointer-events-auto">
        <div className="h-[55%] min-h-[260px]">
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

      {/* 6. 中央悬浮区域 (位于左右两坞之间)：顶部为 KPI 矩阵条，底部为 时序波形趋势 */}
      <div className="absolute left-[402px] xl:left-[432px] right-[402px] xl:right-[432px] top-[50px] bottom-3.5 flex flex-col justify-between items-center pointer-events-none z-20">
        {/* 中央上浮动：四大核心 KPI 指标矩阵 */}
        <div className="w-full max-w-4xl pointer-events-auto pt-1">
          <CockpitKpiStrip kpi={cockpit.kpi} />
        </div>

        {/* 中央下浮动：工单时序走势与多频脉冲波形 */}
        <div className="w-full max-w-4xl h-[175px] pointer-events-auto">
          <CockpitTrendChart
            daily={cockpit.trendDaily}
            clusters={cockpit.trendClusters}
          />
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
