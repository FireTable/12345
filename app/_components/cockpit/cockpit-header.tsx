"use client";

import React, { useState, useEffect, useRef, useMemo } from "react";
import {
  RotateCw,
  Maximize2,
  Minimize2,
  X,
  Radio,
  MapPin,
  Layers,
  ChevronDown,
  Clock,
  Check,
} from "lucide-react";
import type { DomainProfile, RegionInfo } from "../civic/region-context";

/**
 * Obsidian Studio 极简现代指挥中心顶栏
 * - 去除繁琐翼展大 SVG 与纯粹装饰闪烁圆点
 * - PC 端单行悬浮三区排布；移动端 (< xl) 紧凑两行自适应、绝不重叠
 */

export function CockpitTitleCrown({
  title,
  domainProfile,
  align = "center",
}: {
  title: string;
  domainProfile?: DomainProfile | null;
  align?: "left" | "center" | "responsive";
}) {
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";
  const subtitle = isEcommerce
    ? "ECOMMERCE COMPLAINT INTELLIGENCE COCKPIT"
    : "12345 CIVIC INTELLIGENCE COCKPIT";

  const alignClasses =
    align === "left"
      ? "items-start text-left"
      : align === "center"
        ? "items-center text-center"
        : "items-start text-left xl:items-center xl:text-center";

  return (
    <div className={`flex flex-col ${alignClasses} min-w-0 max-w-full select-none`}>
      <h1
        className="cockpit-single-line font-semibold tracking-[0.03em] sm:tracking-[0.11em] bg-gradient-to-b from-white via-slate-100 to-slate-300 bg-clip-text text-transparent max-w-full leading-snug"
        style={{ fontSize: "clamp(0.875rem, 0.82rem + 0.45vw, 1.3rem)" }}
        title={`${title} · 智能研判全景指挥大屏`}
      >
        {title} · 智能研判全景指挥大屏
      </h1>
      <span className="cockpit-single-line text-[9px] sm:text-[10px] font-mono tracking-[0.03em] sm:tracking-[0.2em] text-slate-400 uppercase max-w-full">
        {subtitle}
      </span>
    </div>
  );
}

export interface CockpitHeaderProps {
  activeRegion: RegionInfo | null;
  regions: RegionInfo[];
  domainProfile?: DomainProfile | null;
  onSelectRegion: (id: string) => void;
  isPolling: boolean;
  onTogglePolling: () => void;
  onRefresh: () => void;
  isRefreshing: boolean;
  onClose: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
}

export function CockpitHeader({
  activeRegion,
  regions,
  domainProfile,
  onSelectRegion,
  isPolling,
  onTogglePolling,
  onRefresh,
  isRefreshing,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: CockpitHeaderProps) {
  const [dateTime, setDateTime] = useState<{ full: string; short: string }>({
    full: "2026-11-20 00:00:00",
    short: "00:00:00",
  });
  const [showRegionMenu, setShowRegionMenu] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setDateTime({
        full: `${dateStr} ${timeStr}`,
        short: timeStr,
      });
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!showRegionMenu) return;
    const onPointerDown = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setShowRegionMenu(false);
      }
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        setShowRegionMenu(false);
      }
    };
    document.addEventListener("mousedown", onPointerDown);
    window.addEventListener("keydown", onKeyDown, true);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown, true);
    };
  }, [showRegionMenu]);

  const { govRegions, ecomRegions } = useMemo(() => {
    const gov: RegionInfo[] = [];
    const ecom: RegionInfo[] = [];
    for (const r of regions) {
      if (r.domainProfile?.domainType === "ECOMMERCE_CS") {
        ecom.push(r);
      } else {
        gov.push(r);
      }
    }
    return { govRegions: gov, ecomRegions: ecom };
  }, [regions]);

  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";
  const regionDisplay = activeRegion
    ? `${activeRegion.city} · ${activeRegion.name}`
    : "选择站点";

  const glassBtnShape =
    "cockpit-action-btn items-center justify-center h-8 rounded-full border border-white/10 bg-[#0d1424]/85 text-slate-200 hover:text-white hover:border-white/25 hover:bg-[#141e33]/90 transition-colors cursor-pointer backdrop-blur-xl";

  const streamBtn = (compactOnMobile: boolean) => (
    <button
      type="button"
      onClick={onTogglePolling}
      aria-label={isPolling ? "暂停实时流轮询" : "开启实时流轮询"}
      aria-pressed={isPolling}
      title={isPolling ? "实时流自动刷新已开启" : "实时流自动刷新已暂停"}
      className={`cockpit-action-btn inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full border text-xs font-medium transition-colors cursor-pointer backdrop-blur-xl whitespace-nowrap shrink-0 ${
        isPolling
          ? "bg-emerald-500/12 border-emerald-400/30 text-emerald-200 hover:bg-emerald-500/20"
          : "bg-[#0d1424]/85 border-white/10 text-slate-400 hover:text-slate-200 hover:border-white/20"
      }`}
    >
      <Radio
        size={13}
        aria-hidden="true"
        className={isPolling ? "text-emerald-400 shrink-0" : "text-slate-500 shrink-0"}
      />
      {compactOnMobile ? (
        <>
          <span className="sm:hidden">{isPolling ? "实时" : "暂停"}</span>
          <span className="hidden sm:inline">
            {isPolling ? "实时流：开启" : "实时流：暂停"}
          </span>
        </>
      ) : (
        <span>{isPolling ? "实时流：开启" : "实时流：暂停"}</span>
      )}
    </button>
  );

  return (
    <header
      className="relative z-40 w-full shrink-0 border-b border-white/[0.06] xl:border-b-0 bg-[#080c17]/80 xl:bg-transparent backdrop-blur-xl xl:backdrop-blur-none"
      style={{
        paddingTop: "max(0.75rem, env(safe-area-inset-top, 0px))",
        paddingBottom: "0.5rem",
        paddingLeft: "max(0.75rem, env(safe-area-inset-left, 0px))",
        paddingRight: "max(0.75rem, env(safe-area-inset-right, 0px))",
      }}
    >
      <div className="w-full max-w-full grid grid-cols-[minmax(0,1fr)_auto] xl:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-x-3 gap-y-2 xl:px-1">
        {/* 标题区：移动端在第一行左侧，PC 端居中 */}
        <div className="col-start-1 row-start-1 xl:col-start-2 xl:row-start-1 xl:justify-self-center min-w-0">
          <CockpitTitleCrown
            title={activeRegion?.name || "天河区"}
            domainProfile={domainProfile}
            align="responsive"
          />
        </div>

        {/* 右侧操作按钮组：移动端在第一行右侧，PC 端居右（含实时流按钮） */}
        <div className="col-start-2 row-start-1 xl:col-start-3 xl:row-start-1 xl:justify-self-end flex items-center gap-3 shrink-0">
          <div className="hidden xl:inline-flex">{streamBtn(false)}</div>

          <button
            type="button"
            onClick={onRefresh}
            disabled={isRefreshing}
            aria-label="强制刷新全域数据"
            title="强制刷新全域数据"
            className={`${glassBtnShape} inline-flex w-8 px-0 disabled:opacity-50`}
          >
            <RotateCw
              size={14}
              aria-hidden="true"
              className={isRefreshing ? "animate-spin text-sky-400" : ""}
            />
          </button>

          <button
            type="button"
            onClick={onToggleFullscreen}
            aria-label={isFullscreen ? "退出全屏" : "进入全屏"}
            title={isFullscreen ? "退出全屏" : "进入全屏"}
            className={`${glassBtnShape} hidden sm:inline-flex w-8 px-0`}
          >
            {isFullscreen ? (
              <Minimize2 size={14} aria-hidden="true" />
            ) : (
              <Maximize2 size={14} aria-hidden="true" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            aria-label="退出大屏返回数据总览"
            title="退出大屏返回数据总览 (快捷键: 连续按两次 ESC)"
            className="cockpit-action-btn inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full border border-white/10 bg-[#0d1424]/85 text-slate-200 hover:border-rose-400/40 hover:bg-rose-500/15 hover:text-rose-200 transition-colors cursor-pointer text-xs font-medium backdrop-blur-xl whitespace-nowrap shrink-0"
          >
            <X size={14} aria-hidden="true" className="shrink-0" />
            <span>退出</span>
            <kbd className="hidden md:inline-block px-1.5 py-0.5 rounded bg-white/[0.06] border border-white/10 font-mono text-[9px] text-slate-400">
              ESC
            </kbd>
          </button>
        </div>

        {/* 左侧控制区（移动端为第二行：时钟 + 域切换 + 状态） */}
        <div className="col-span-2 row-start-2 xl:col-span-1 xl:col-start-1 xl:row-start-1 xl:justify-self-start flex items-center justify-between xl:justify-start gap-3 min-w-0">
          <div className="flex items-center gap-2.5 min-w-0 flex-1 xl:flex-initial">
            {/* 极简静态时钟徽章 */}
            <div
              className="inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full bg-[#0d1424]/85 border border-white/10 text-slate-200 backdrop-blur-xl text-xs font-mono tabular-nums whitespace-nowrap shrink-0"
              aria-label="当前系统时间"
            >
              <Clock size={12} aria-hidden="true" className="text-slate-400 shrink-0" />
              <span className="sm:hidden">{dateTime.short}</span>
              <span className="hidden sm:inline">{dateTime.full}</span>
            </div>

            {/* 域/站点切换下拉胶囊 */}
            <div className="relative min-w-0" ref={menuRef}>
              <button
                type="button"
                onClick={() => setShowRegionMenu((prev) => !prev)}
                aria-haspopup="listbox"
                aria-expanded={showRegionMenu}
                aria-label={`切换业务域或站点，当前为 ${regionDisplay}`}
                className="cockpit-action-btn inline-flex items-center gap-1.5 h-8 px-2.5 sm:px-3 rounded-full bg-[#0d1424]/85 border border-white/10 text-slate-100 hover:text-white hover:border-white/25 transition-colors cursor-pointer backdrop-blur-xl text-xs font-medium max-w-[172px] sm:max-w-[240px] min-w-0"
              >
                {isEcommerce ? (
                  <Layers size={13} aria-hidden="true" className="text-amber-400 shrink-0" />
                ) : (
                  <MapPin size={13} aria-hidden="true" className="text-sky-400 shrink-0" />
                )}
                <span className="cockpit-single-line">{regionDisplay}</span>
                <ChevronDown
                  size={12}
                  aria-hidden="true"
                  className={`text-slate-400 shrink-0 transition-transform duration-150 ${
                    showRegionMenu ? "rotate-180" : ""
                  }`}
                />
              </button>

              {showRegionMenu && (
                <div
                  role="listbox"
                  aria-label="站点与业务域列表"
                  className="absolute top-full -left-14 sm:left-0 mt-2 w-[min(276px,calc(100dvw-1.5rem))] max-h-[65dvh] overflow-y-auto custom-cockpit-scrollbar py-1.5 rounded-xl bg-[#0b1120]/95 border border-white/15 shadow-2xl z-50 backdrop-blur-2xl"
                >
                  {govRegions.length > 0 && (
                    <div>
                      <div className="px-3 py-1.5 text-[10px] text-slate-400 tracking-wider font-mono border-b border-white/[0.06] flex items-center justify-between">
                        <span>政务 12345 热线</span>
                        <span className="tabular-nums">{govRegions.length}</span>
                      </div>
                      <div className="py-1">
                        {govRegions.map((r) => {
                          const isCurrent = activeRegion?.id === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              role="option"
                              aria-selected={isCurrent}
                              onClick={() => {
                                onSelectRegion(r.id);
                                setShowRegionMenu(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isCurrent
                                  ? "text-white font-semibold bg-white/[0.08]"
                                  : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                              }`}
                            >
                              <span className="cockpit-single-line">
                                {r.city} · {r.name}
                              </span>
                              {isCurrent && (
                                <Check size={13} aria-hidden="true" className="text-sky-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {ecomRegions.length > 0 && (
                    <div className={govRegions.length > 0 ? "border-t border-white/[0.08] mt-1 pt-1" : ""}>
                      <div className="px-3 py-1.5 text-[10px] text-amber-300/90 tracking-wider font-mono border-b border-white/[0.06] flex items-center justify-between">
                        <span>{govRegions.length > 0 ? "跨行业示范 · 电商客诉" : "电商客诉站点"}</span>
                        <span className="tabular-nums">{ecomRegions.length}</span>
                      </div>
                      <div className="py-1">
                        {ecomRegions.map((r) => {
                          const isCurrent = activeRegion?.id === r.id;
                          return (
                            <button
                              key={r.id}
                              type="button"
                              role="option"
                              aria-selected={isCurrent}
                              onClick={() => {
                                onSelectRegion(r.id);
                                setShowRegionMenu(false);
                              }}
                              className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                                isCurrent
                                  ? "text-white font-semibold bg-white/[0.08]"
                                  : "text-slate-300 hover:bg-white/[0.05] hover:text-white"
                              }`}
                            >
                              <span className="cockpit-single-line">
                                {r.city} · {r.name}
                              </span>
                              {isCurrent && (
                                <Check size={13} aria-hidden="true" className="text-amber-400 shrink-0" />
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* 移动端实时流状态按钮 */}
          <div className="xl:hidden shrink-0">{streamBtn(true)}</div>
        </div>
      </div>
    </header>
  );
}

/**
 * 保留 CockpitTopControls 命名导出以维持向后兼容
 */
export const CockpitTopControls = CockpitHeader;
