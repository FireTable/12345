"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { Activity, Clock } from "lucide-react";
import { useRegion } from "../civic/region-context";
import { DomainChannelMatrix } from "../civic/domain-channel-matrix";
import { useCockpitData } from "./use-cockpit-data";
import type { CockpitClosureFunnel, CockpitHourlyBucket } from "./cockpit-types";
import { CockpitTitleCrown, CockpitTopControls } from "./cockpit-header";
import { CockpitKpiStrip } from "./cockpit-kpi-strip";
import { CockpitMap } from "./cockpit-map";
import { CockpitStream } from "./cockpit-stream";
import { CockpitCategoryChart } from "./cockpit-category-chart";
import { CockpitAlertPanel } from "./cockpit-alert-panel";
import { CockpitTownshipRank } from "./cockpit-township-rank";
import { CockpitTrendChart } from "./cockpit-trend-chart";
import { CockpitNodePulse } from "./cockpit-node-pulse";

interface CockpitViewProps {
  onClose: () => void;
}

export function CockpitView({ onClose }: CockpitViewProps) {
  const { activeRegion, regions, switchRegion } = useRegion();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [escWarning, setEscWarning] = useState(false);
  const escTimerRef = useRef<NodeJS.Timeout | null>(null);

  const currentRegion = activeRegion || (regions.length > 0 ? regions[0] : null);
  const regionId = currentRegion?.id || "gz_tianhe";
  const hasGeoMap = currentRegion?.domainProfile?.hasGeoMap !== false;
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

      {/* 1. 核心底图：政务租户使用全屏 GIS 底图；无地理区划的行业租户保持纯暗夜数字网格背景 */}
      {hasGeoMap ? (
        <CockpitMap
          activeRegion={currentRegion}
          counts={cockpit.subdistrictCounts}
          selectedTownship={cockpit.selectedTownship}
          onSelectTownship={cockpit.setSelectedTownship}
          className="absolute inset-0 w-full h-full z-0"
        />
      ) : (
        <div
          className="absolute inset-0 w-full h-full z-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 35%, rgba(22, 119, 255, 0.16), rgba(2, 6, 18, 0.96) 62%), linear-gradient(rgba(64, 150, 255, 0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(64, 150, 255, 0.05) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 36px 36px, 36px 36px",
          }}
        />
      )}

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
        <CockpitTitleCrown title={currentRegion?.name || "天河区"} />
      </div>

      {/* 4. 悬浮 HUD 视窗内容层 (顶层布局：顶部全宽横向 KPI 矩阵条，下部三栏贴边调度坞) */}
      <div className="absolute inset-0 z-20 p-3.5 pt-[58px] flex flex-col justify-between pointer-events-none">
        {/* 顶部全宽 KPI 矩阵条：横跨全屏宽幅，左右贴边对齐左右坞，彻底解决两边空 gap，四大卡片恢复宽幅单行呼吸空间 */}
        <div className="w-full pointer-events-auto shrink-0">
          <CockpitKpiStrip kpi={cockpit.kpi} loading={cockpit.loading} />
        </div>

        {/* 下部三栏：左贴边悬浮坞、中间开阔 GIS 数字孪生地图视区（底部悬浮趋势）、右贴边悬浮坞 */}
        <div className="flex-1 w-full flex justify-between gap-3 mt-2.5 min-h-0 pointer-events-none">
          {/* 左侧贴边悬浮坞 (对齐顶部卡片1左侧) */}
          <section className="w-[380px] xl:w-[410px] h-full flex flex-col gap-2.5 min-h-0 pointer-events-auto">
            <div className="h-[33%] min-h-[160px]">
              <CockpitCategoryChart data={cockpit.categoryStats} loading={cockpit.loading} />
            </div>
            <div className="h-[24%] min-h-[125px]">
              <CockpitAlertPanel
                alerts={cockpit.alerts}
                selectedTownship={cockpit.selectedTownship}
                loading={cockpit.loading}
              />
            </div>
            <div className="flex-1 min-h-[175px]">
              <CockpitStream
                tickets={cockpit.recentTickets}
                selectedTownship={cockpit.selectedTownship}
              />
            </div>
          </section>

          {/* 中间开阔视区：政务模式留空透出 GIS 底图，无地理区划模式展示渠道/仓网热度矩阵；底部贯通悬浮时序走势与 24h 波峰 */}
          <div
            className={`flex-1 h-full flex flex-col pointer-events-none pb-0.5 min-w-0 ${
              hasGeoMap ? "justify-end" : "justify-between gap-2.5"
            }`}
          >
            {!hasGeoMap && (
              <div className="flex-1 min-h-0 pointer-events-auto">
                <DomainChannelMatrix
                  variant="dark"
                  counts={cockpit.subdistrictCounts}
                  selected={cockpit.selectedTownship || ""}
                  domainProfile={currentRegion?.domainProfile}
                  loading={cockpit.loading}
                  onSelect={(name) =>
                    cockpit.setSelectedTownship(
                      cockpit.selectedTownship === name ? null : name
                    )
                  }
                />
              </div>
            )}
            <div className="w-full h-[176px] grid grid-cols-12 gap-2.5 pointer-events-auto shrink-0">
              <div className="col-span-7 h-full min-h-0 min-w-0">
                <CockpitTrendChart
                  daily={cockpit.trendDaily}
                  clusters={cockpit.trendClusters}
                />
              </div>
              <div className="col-span-5 h-full min-h-0 min-w-0">
                <CockpitHourlyBarCard
                  buckets={cockpit.hourlyDistribution}
                  loading={cockpit.loading}
                />
              </div>
            </div>
          </div>

          {/* 右侧贴边悬浮坞 (对齐顶部卡片4右侧) */}
          <section className="w-[380px] xl:w-[410px] h-full flex flex-col gap-2.5 min-h-0 pointer-events-auto">
            <div className="h-[40%] min-h-[175px]">
              <CockpitTownshipRank
                stats={cockpit.townshipStats}
                selectedTownship={cockpit.selectedTownship}
                onSelectTownship={cockpit.setSelectedTownship}
                loading={cockpit.loading}
              />
            </div>
            <div className="h-[29%] min-h-[145px]">
              <CockpitClosureFunnelCard
                funnel={cockpit.closureFunnel}
                loading={cockpit.loading}
              />
            </div>
            <div className="flex-1 min-h-[145px]">
              <CockpitNodePulse
                nodes={cockpit.systemTwoNodes}
                endpointRecentTickets={cockpit.endpointRecentTickets}
              />
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

function CockpitHourlyBarCard({
  buckets,
  loading,
}: {
  buckets: CockpitHourlyBucket[];
  loading: boolean;
}) {
  const { normalized, maxCount, peak } = useMemo(() => {
    const map = new Map<number, number>();
    for (const b of buckets) {
      map.set(b.hour, Number(b.count || 0));
    }
    const list = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, "0")}:00`,
      count: map.get(hour) || 0,
    }));
    const maxVal = Math.max(1, ...list.map((i) => i.count));
    const top = list.reduce(
      (best, cur) => (cur.count > best.count ? cur : best),
      list[0]
    );
    return { normalized: list, maxCount: maxVal, peak: top };
  }, [buckets]);

  const totalTimed = normalized.reduce((s, b) => s + b.count, 0);

  return (
    <div className="cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5">
      <div className="cockpit-glass-header flex items-center justify-between pb-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Clock size={14} className="text-[#4096ff]" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            24h 来电波峰分布
          </h3>
        </div>
        <span className="text-[10px] font-mono text-sky-300">
          {totalTimed > 0 ? `峰值 ${peak.label} (${peak.count.toLocaleString()})` : loading ? "读取中" : "无时段样本"}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-end pt-2">
        <div className="flex-1 flex items-end gap-[3px] min-h-[72px]">
          {normalized.map((b) => {
            const pct = totalTimed > 0 ? Math.max(b.count > 0 ? 6 : 2, Math.round((b.count / maxCount) * 100)) : 4;
            const isPeak = totalTimed > 0 && b.hour === peak.hour && b.count > 0;
            return (
              <div
                key={b.hour}
                title={`${b.label} · ${b.count.toLocaleString()} 件`}
                className="flex-1 h-full flex items-end group"
              >
                <div
                  className={`w-full rounded-t transition-all duration-300 ${
                    isPeak
                      ? "bg-gradient-to-t from-amber-500 to-amber-300 shadow-[0_0_8px_rgba(251,191,36,0.65)]"
                      : b.count > 0
                        ? "bg-gradient-to-t from-[#1677FF] to-[#69b1ff] group-hover:brightness-125"
                        : "bg-slate-700/40"
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex items-center justify-between text-[9px] font-mono text-slate-400">
          <span>00</span>
          <span>06</span>
          <span>12</span>
          <span>18</span>
          <span>23</span>
        </div>
      </div>
    </div>
  );
}

function CockpitClosureFunnelCard({
  funnel,
  loading,
}: {
  funnel: CockpitClosureFunnel;
  loading: boolean;
}) {
  const base = Math.max(1, funnel.total);
  const stages = [
    {
      key: "total",
      label: "诉求接入",
      value: funnel.total,
      color: "from-blue-600 to-sky-400",
    },
    {
      key: "analyzed",
      label: "AI 已研判",
      value: funnel.analyzed,
      color: "from-indigo-600 to-blue-400",
    },
    {
      key: "clustered",
      label: "多频归集",
      value: funnel.clustered,
      color: "from-cyan-600 to-teal-400",
    },
    {
      key: "dispatched",
      label: "派单处置",
      value: funnel.dispatched,
      color: "from-amber-600 to-amber-400",
    },
    {
      key: "resolved",
      label: "办结归档",
      value: funnel.resolved,
      color: "from-emerald-600 to-emerald-400",
    },
    {
      key: "fake",
      label: "假闭环拦截",
      value: funnel.fakeClosureIntercepted,
      color: "from-rose-600 to-rose-400",
    },
  ];

  return (
    <div className="cockpit-glass-card cockpit-glass-card--emerald w-full h-full flex flex-col rounded-2xl p-3.5">
      <div className="cockpit-glass-header flex items-center justify-between pb-1.5 shrink-0">
        <div className="flex items-center gap-1.5">
          <Activity size={14} className="text-emerald-400" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            闭环处置全链路漏斗
          </h3>
        </div>
        <span className="text-[10px] font-mono text-rose-300">
          {loading ? "读取中" : `拦截 ${funnel.fakeClosureIntercepted.toLocaleString()} 件`}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-between gap-1 pt-2 overflow-y-auto custom-cockpit-scrollbar">
        {stages.map((st) => {
          const pct = funnel.total > 0 ? Math.round((st.value / base) * 100) : 0;
          const barWidth =
            st.value > 0 ? Math.max(4, Math.min(100, pct)) : 0;
          return (
            <div
              key={st.key}
              className="grid grid-cols-[64px_1fr_58px] items-center gap-2 text-[11px]"
            >
              <span className="text-slate-300 truncate">{st.label}</span>
              <div className="h-1.5 rounded-full bg-slate-800/80 overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${st.color}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="text-right font-mono font-semibold text-slate-100 tabular-nums">
                {st.value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
