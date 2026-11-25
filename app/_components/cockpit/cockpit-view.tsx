"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, useId } from "react";
import { Activity, Clock, AlertTriangle, RotateCw } from "lucide-react";
import { useRegion, type DomainProfile } from "../civic/region-context";
import { DomainChannelMatrix } from "../civic/domain-channel-matrix";
import { useCockpitData } from "./use-cockpit-data";
import type { CockpitClosureFunnel, CockpitHourlyBucket } from "./cockpit-types";
import { CockpitHeader } from "./cockpit-header";
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
  /** True when launched as a modal overlay from Dashboard; false on standalone /screen route. */
  modal?: boolean;
}

export function CockpitView({ onClose, modal = true }: CockpitViewProps) {
  const { activeRegion, regions, switchRegion, isLoading: regionLoading } = useRegion();
  const [isFullscreen, setIsFullscreen] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = useId();

  const currentRegion = activeRegion || (regions.length > 0 ? regions[0] : null);
  const regionId = currentRegion?.id || "gz_tianhe";
  const hasResolvedRegion = !regionLoading && Boolean(currentRegion);
  const domainProfile = currentRegion?.domainProfile ?? null;
  const hasGeoMap = hasResolvedRegion && domainProfile?.hasGeoMap !== false;
  const showEcomMatrix = hasResolvedRegion && domainProfile?.hasGeoMap === false;
  const cockpit = useCockpitData(regionId);
  const shellRef = useRef<HTMLElement>(null);

  // Standalone /screen mount: mark underlying sibling nav/content inert so Tab never escapes to hidden navbar links
  useEffect(() => {
    if (modal) return;
    const shellEl = shellRef.current;
    const targets = Array.from(
      document.querySelectorAll<HTMLElement>(
        "a.skip-link, nav.navbar, .chat-fab, main.main:not(.cockpit-shell)"
      )
    );
    const cleanups: Array<() => void> = [];
    for (const el of targets) {
      if (shellEl && (el === shellEl || el.contains(shellEl))) continue;
      const prevInert = el.inert;
      el.inert = true;
      cleanups.push(() => {
        el.inert = prevInert;
      });
    }
    const parentMain = shellEl?.closest("main.main");
    if (parentMain) {
      for (const child of Array.from(parentMain.children)) {
        if (
          child instanceof HTMLElement &&
          child !== shellEl &&
          !(shellEl && child.contains(shellEl))
        ) {
          const prevInert = child.inert;
          child.inert = true;
          cleanups.push(() => {
            child.inert = prevInert;
          });
        }
      }
    }
    return () => {
      for (const restore of cleanups) restore();
    };
  }, [modal]);

  // 监听浏览器全屏状态
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  // 原生 <dialog> 模态管控：showModal() 提供 top layer、inert 背景、Esc 退出与焦点自动归还
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!modal) {
      if (dialog?.open) dialog.close();
      return;
    }
    if (!dialog) return;

    const handleClose = () => {
      // Ignore stale queued HTMLDialogElement `close` events from StrictMode remounts when still open
      if (dialog.open) return;
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
      onCloseRef.current();
    };

    dialog.addEventListener("close", handleClose);
    if (!dialog.open) {
      dialog.showModal();
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
    };
  }, [modal]);

  const handleRequestClose = useCallback(() => {
    if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
    if (modal && dialogRef.current?.open) {
      dialogRef.current.close();
    } else {
      onCloseRef.current();
    }
  }, [modal]);

  const toggleFullscreen = useCallback(() => {
    const target = (modal ? dialogRef.current : null) ?? document.documentElement;
    if (!document.fullscreenElement) {
      target.requestFullscreen().catch(() => {});
    } else {
      document.exitFullscreen().catch(() => {});
    }
  }, [modal]);

  const bodyContent = (
    <>
      {/* 非地理域环境暗夜 Obsidian 微纹理背景 */}
      {!hasGeoMap && (
        <div
          aria-hidden="true"
          className="fixed inset-0 z-0 pointer-events-none"
          style={{
            background:
              "radial-gradient(ellipse 80% 45% at 50% 0%, rgba(56, 189, 248, 0.08), rgba(6, 9, 17, 0.96) 65%), linear-gradient(rgba(148, 163, 184, 0.035) 1px, transparent 1px), linear-gradient(90deg, rgba(148, 163, 184, 0.035) 1px, transparent 1px)",
            backgroundSize: "100% 100%, 40px 40px, 40px 40px",
          }}
        />
      )}

      {/* 1. 一体悬浮指挥顶栏（PC 单行 / 移动端紧凑两行） */}
      <CockpitHeader
        titleId={titleId}
        activeRegion={currentRegion}
        regions={regions}
        domainProfile={domainProfile}
        onSelectRegion={switchRegion}
        isPolling={cockpit.isPolling}
        onTogglePolling={() => cockpit.setIsPolling(!cockpit.isPolling)}
        onRefresh={cockpit.refresh}
        isRefreshing={cockpit.isRefreshing}
        onClose={handleRequestClose}
        isFullscreen={isFullscreen}
        onToggleFullscreen={toggleFullscreen}
      />

      {cockpit.error && (
        <div
          role="alert"
          className="relative z-30 mx-3 mt-2 px-3.5 py-2 rounded-xl bg-rose-950/85 border border-rose-400/35 text-rose-100 text-xs flex items-center justify-between gap-2 flex-wrap"
        >
          <span className="inline-flex items-center gap-2">
            <AlertTriangle size={14} aria-hidden="true" className="text-rose-300 shrink-0" />
            <span>{cockpit.error}</span>
          </span>
          <button
            type="button"
            onClick={cockpit.refresh}
            className="cockpit-action-btn inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-400/40 text-rose-100 hover:bg-rose-500/30 text-xs font-medium cursor-pointer"
          >
            <RotateCw size={12} aria-hidden="true" />
            <span>重试</span>
          </button>
        </div>
      )}

      {/* 2. 主内容区：PC 端三栏悬浮 HUD，移动端流式纵向暗夜指挥台 */}
      <div
        className="relative flex-1 flex flex-col gap-3 px-3 pt-3 xl:px-3.5 xl:pt-1.5 xl:min-h-0 xl:pointer-events-none"
        style={{
          paddingBottom: "max(0.875rem, env(safe-area-inset-bottom, 0px))",
          paddingLeft: "max(0.75rem, env(safe-area-inset-left, 0px))",
          paddingRight: "max(0.75rem, env(safe-area-inset-right, 0px))",
        }}
      >
        {/* 顶部全宽 KPI 矩阵条（移动端 2×2，PC 端 4 列） */}
        <div className="relative z-20 w-full pointer-events-auto shrink-0">
          <CockpitKpiStrip
            kpi={cockpit.kpi}
            loading={cockpit.loading}
            domainProfile={domainProfile}
          />
        </div>

        {/* 下部：PC 端三栏贴边调度坞 / 移动端按业务顺序单列流式排布 */}
        <div className="flex-1 w-full flex flex-col gap-3 xl:grid xl:grid-cols-[380px_minmax(0,1fr)_380px] 2xl:grid-cols-[410px_minmax(0,1fr)_410px] xl:gap-3 xl:min-h-0 xl:pointer-events-none">
          {/* 左侧调度坞（移动端拆平参与流式排序） */}
          <section
            aria-label="分类态势与实时工单"
            className="contents xl:flex xl:flex-col xl:gap-2.5 xl:h-full xl:min-h-0 xl:relative xl:z-20 xl:pointer-events-auto xl:order-1"
          >
            <div className="order-4 xl:order-none h-[260px] sm:h-[280px] xl:h-[33%] xl:min-h-[160px] min-w-0">
              <CockpitCategoryChart
                data={cockpit.categoryStats}
                loading={cockpit.loading}
                domainProfile={domainProfile}
              />
            </div>
            <div className="order-7 xl:order-none min-h-[190px] max-h-[280px] xl:max-h-none xl:h-[24%] xl:min-h-[125px] min-w-0">
              <CockpitAlertPanel
                alerts={cockpit.alerts}
                selectedTownship={cockpit.selectedTownship}
                loading={cockpit.loading}
                domainProfile={domainProfile}
              />
            </div>
            <div className="order-8 xl:order-none h-[280px] sm:h-[300px] xl:h-auto xl:flex-1 xl:min-h-[175px] min-w-0">
              <CockpitStream
                tickets={cockpit.recentTickets}
                selectedTownship={cockpit.selectedTownship}
                domainProfile={domainProfile}
              />
            </div>
          </section>

          {/* 中央视区：政务 GIS 底图或电商渠道矩阵 + 时序趋势与 24h 波峰 */}
          <div
            className={`contents xl:flex xl:flex-col xl:h-full xl:min-h-0 xl:min-w-0 xl:pointer-events-none xl:order-2 ${
              showEcomMatrix ? "xl:justify-between xl:gap-2.5" : "xl:justify-end"
            }`}
          >
            {hasGeoMap && (
              <div className="order-1 xl:order-none relative z-10 w-full h-[300px] sm:h-[360px] rounded-2xl overflow-hidden border border-white/10 shrink-0 pointer-events-auto xl:fixed xl:inset-0 xl:w-dvw xl:h-dvh xl:rounded-none xl:border-0 xl:z-0">
                <CockpitMap
                  activeRegion={currentRegion}
                  counts={cockpit.subdistrictCounts}
                  selectedTownship={cockpit.selectedTownship}
                  onSelectTownship={cockpit.setSelectedTownship}
                  className="w-full h-full"
                />
              </div>
            )}

            {showEcomMatrix && (
              <div className="order-1 xl:order-none relative z-20 w-full min-h-[300px] xl:h-auto xl:flex-1 xl:min-h-0 pointer-events-auto min-w-0">
                <DomainChannelMatrix
                  variant="dark"
                  counts={cockpit.subdistrictCounts}
                  selected={cockpit.selectedTownship || ""}
                  domainProfile={domainProfile}
                  loading={cockpit.loading}
                  onSelect={(name) =>
                    cockpit.setSelectedTownship(
                      cockpit.selectedTownship === name ? null : name
                    )
                  }
                />
              </div>
            )}

            <div className="contents xl:relative xl:z-20 xl:w-full xl:h-[176px] xl:grid xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)] xl:gap-2.5 xl:pointer-events-auto xl:shrink-0">
              <div className="order-2 xl:order-none relative z-20 h-[180px] xl:h-full min-h-0 min-w-0 pointer-events-auto">
                <CockpitTrendChart
                  daily={cockpit.trendDaily}
                  clusters={cockpit.trendClusters}
                  domainProfile={domainProfile}
                />
              </div>
              <div className="order-3 xl:order-none relative z-20 h-[180px] xl:h-full min-h-0 min-w-0 pointer-events-auto">
                <CockpitHourlyBarCard
                  buckets={cockpit.hourlyDistribution}
                  loading={cockpit.loading}
                  domainProfile={domainProfile}
                />
              </div>
            </div>
          </div>

          {/* 右侧调度坞（移动端拆平参与流式排序） */}
          <section
            aria-label="排行、漏斗与算力节拍"
            className="contents xl:flex xl:flex-col xl:gap-2.5 xl:h-full xl:min-h-0 xl:relative xl:z-20 xl:pointer-events-auto xl:order-3"
          >
            <div className="order-5 xl:order-none h-[280px] sm:h-[300px] xl:h-[40%] xl:min-h-[175px] min-w-0">
              <CockpitTownshipRank
                stats={cockpit.townshipStats}
                selectedTownship={cockpit.selectedTownship}
                onSelectTownship={cockpit.setSelectedTownship}
                loading={cockpit.loading}
                domainProfile={domainProfile}
              />
            </div>
            <div className="order-6 xl:order-none h-[220px] sm:h-[235px] xl:h-[29%] xl:min-h-[145px] min-w-0">
              <CockpitClosureFunnelCard
                funnel={cockpit.closureFunnel}
                loading={cockpit.loading}
                domainProfile={domainProfile}
              />
            </div>
            <div className="order-9 xl:order-none min-h-[200px] max-h-[300px] xl:max-h-none xl:flex-1 xl:min-h-[145px] min-w-0">
              <CockpitNodePulse
                nodes={cockpit.systemTwoNodes}
                endpointRecentTickets={cockpit.endpointRecentTickets}
                domainProfile={domainProfile}
              />
            </div>
          </section>
        </div>
      </div>
    </>
  );

  if (modal) {
    return (
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        className="cockpit-dialog cockpit-shell overflow-y-auto xl:overflow-hidden custom-cockpit-scrollbar"
      >
        {bodyContent}
      </dialog>
    );
  }

  return (
    <main
      ref={shellRef}
      className="cockpit-shell fixed inset-0 z-[9999] w-dvw min-h-dvh h-dvh overflow-y-auto xl:overflow-hidden flex flex-col custom-cockpit-scrollbar"
    >
      {bodyContent}
    </main>
  );
}

function CockpitHourlyBarCard({
  buckets,
  loading,
  domainProfile,
}: {
  buckets: CockpitHourlyBucket[];
  loading: boolean;
  domainProfile?: DomainProfile | null;
}) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

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
    <div className="cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-1.5 pb-1.5 shrink-0 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Clock size={13} aria-hidden="true" className="text-sky-400 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-100 tracking-normal cockpit-single-line">
            {isEcommerce ? "24h 客诉波峰" : "24h 来电波峰"}
          </h2>
        </div>
        <span className="text-xs font-mono tabular-nums text-sky-300 whitespace-nowrap shrink-0">
          {totalTimed > 0
            ? `峰值 ${peak.label} · ${peak.count.toLocaleString()}`
            : loading
              ? "读取中"
              : "无时段样本"}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-end pt-2">
        <div className="flex-1 flex items-end gap-[3px] min-h-[72px]">
          {normalized.map((b) => {
            const pct =
              totalTimed > 0
                ? Math.max(b.count > 0 ? 6 : 2, Math.round((b.count / maxCount) * 100))
                : 4;
            const isPeak = totalTimed > 0 && b.hour === peak.hour && b.count > 0;
            return (
              <div
                key={b.hour}
                title={`${b.label} · ${b.count.toLocaleString()} 件`}
                className="flex-1 h-full flex items-end group"
              >
                <div
                  className={`w-full rounded-t transition-[height,background-color] duration-300 ${
                    isPeak
                      ? "bg-gradient-to-t from-amber-500/90 to-amber-300"
                      : b.count > 0
                        ? "bg-gradient-to-t from-sky-500/75 to-sky-300/90 group-hover:brightness-125"
                        : "bg-white/[0.06]"
                  }`}
                  style={{ height: `${pct}%` }}
                />
              </div>
            );
          })}
        </div>
        <div className="mt-1 flex items-center justify-between text-[11px] font-mono tabular-nums text-slate-400">
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
  domainProfile,
}: {
  funnel: CockpitClosureFunnel;
  loading: boolean;
  domainProfile?: DomainProfile | null;
}) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";
  const base = Math.max(1, funnel.total);
  const stages = [
    {
      key: "total",
      label: isEcommerce ? "客诉接入" : "诉求接入",
      value: funnel.total,
      color: "from-sky-500/90 to-sky-300/90",
    },
    {
      key: "analyzed",
      label: "AI 已研判",
      value: funnel.analyzed,
      color: "from-indigo-500/90 to-sky-400/90",
    },
    {
      key: "clustered",
      label: isEcommerce ? "多频案卷" : "多频归集",
      value: funnel.clustered,
      color: "from-cyan-500/90 to-teal-300/90",
    },
    {
      key: "dispatched",
      label: isEcommerce ? "团队派单" : "派单处置",
      value: funnel.dispatched,
      color: "from-amber-500/90 to-amber-300/90",
    },
    {
      key: "resolved",
      label: isEcommerce ? "完结归档" : "办结归档",
      value: funnel.resolved,
      color: "from-emerald-500/90 to-emerald-300/90",
    },
    {
      key: "fake",
      label: "假闭环拦截",
      value: funnel.fakeClosureIntercepted,
      color: "from-rose-500/90 to-rose-300/90",
    },
  ];

  return (
    <div className="cockpit-glass-card cockpit-glass-card--emerald w-full h-full flex flex-col rounded-2xl p-3.5 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-1.5 shrink-0 min-w-0">
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          <Activity size={14} aria-hidden="true" className="text-emerald-400 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            闭环处置全链路漏斗
          </h2>
        </div>
        <span className="text-xs font-mono tabular-nums text-rose-200 whitespace-nowrap shrink-0">
          {loading ? "读取中" : `拦截 ${funnel.fakeClosureIntercepted.toLocaleString()} 件`}
        </span>
      </div>

      <div className="flex-1 min-h-0 flex flex-col justify-between gap-1 pt-2 overflow-y-auto custom-cockpit-scrollbar">
        {stages.map((st) => {
          const pct = funnel.total > 0 ? Math.round((st.value / base) * 100) : 0;
          const barWidth = st.value > 0 ? Math.max(4, Math.min(100, pct)) : 0;
          return (
            <div
              key={st.key}
              className="grid grid-cols-[78px_1fr_64px] items-center gap-2 text-xs min-w-0"
            >
              <span className="text-slate-300 cockpit-single-line">{st.label}</span>
              <div className="h-1.5 rounded-full bg-white/[0.06] overflow-hidden">
                <div
                  className={`h-full rounded-full bg-gradient-to-r ${st.color}`}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
              <span className="text-right font-mono font-semibold text-slate-100 tabular-nums whitespace-nowrap">
                {st.value.toLocaleString()}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
