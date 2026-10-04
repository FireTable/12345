"use client";

import React, { useState, useEffect } from "react";
import {
  RotateCw,
  Maximize2,
  Minimize2,
  X,
  Radio,
  MapPin,
  ChevronDown,
  ShieldCheck,
} from "lucide-react";
import type { RegionInfo } from "../civic/region-context";

interface CockpitHeaderProps {
  activeRegion: RegionInfo | null;
  regions: RegionInfo[];
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
  onSelectRegion,
  isPolling,
  onTogglePolling,
  onRefresh,
  isRefreshing,
  onClose,
  isFullscreen,
  onToggleFullscreen,
}: CockpitHeaderProps) {
  const [currentTime, setCurrentTime] = useState<string>("");
  const [showRegionMenu, setShowRegionMenu] = useState(false);

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, "0");
      const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const timeStr = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
      setCurrentTime(`${dateStr} ${timeStr}`);
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <header className="relative w-full h-[64px] px-5 flex items-center justify-between rounded-2xl border border-cyan-500/25 bg-[#051129]/85 backdrop-blur-xl shadow-[0_8px_32px_rgba(0,0,0,0.6)] select-none z-30 pointer-events-auto">
      {/* 顶部中央科幻光条 */}
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-2/5 h-[2px] bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-80 shadow-[0_0_12px_#00f2fe]" />

      {/* 左侧：时钟、站点切换 */}
      <div className="flex items-center gap-3 text-xs font-mono text-cyan-300">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-cyan-950/60 border border-cyan-500/40 text-cyan-200 shadow-inner">
          <span className="w-2 h-2 rounded-full bg-cyan-400 animate-ping inline-block" />
          <span className="tracking-wider font-semibold">{currentTime || "2026-10-04 17:00:00"}</span>
        </div>

        {/* 站点快速切换器 */}
        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRegionMenu(!showRegionMenu)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-950/70 border border-blue-500/40 text-blue-200 hover:text-white hover:border-cyan-400 transition-all cursor-pointer shadow-sm"
          >
            <MapPin size={13} className="text-cyan-400" />
            <span className="font-sans font-medium text-xs">
              {activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "选择辖区"}
            </span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>

          {showRegionMenu && (
            <div className="absolute top-full left-0 mt-2 w-48 py-1 rounded-xl bg-[#0b1730] border border-cyan-500/40 shadow-2xl z-50 backdrop-blur-2xl">
              <div className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider border-b border-cyan-500/20 font-mono">
                切换调度辖区
              </div>
              {regions.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => {
                    onSelectRegion(r.id);
                    setShowRegionMenu(false);
                  }}
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-cyan-950/50 transition-colors ${
                    activeRegion?.id === r.id ? "text-cyan-300 font-semibold bg-cyan-950/40" : "text-slate-300"
                  }`}
                >
                  <span>{r.city} · {r.name}</span>
                  {activeRegion?.id === r.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-300">当前</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="hidden xl:flex items-center gap-1.5 text-[11px] text-slate-300">
          <ShieldCheck size={13} className="text-emerald-400" />
          <span>双引擎智能协同</span>
          <span className="text-cyan-500/40">|</span>
          <span className="text-emerald-400 font-medium">全域态势实时研判中</span>
        </div>
      </div>

      {/* 中央：主标题 */}
      <div className="absolute left-1/2 -translate-x-1/2 flex flex-col items-center pointer-events-none">
        <div className="flex items-center gap-3">
          <span className="text-cyan-400 font-mono text-xs opacity-70">◀◀</span>
          <h1 className="text-lg md:text-xl font-black tracking-widest bg-gradient-to-b from-white via-cyan-100 to-cyan-300 bg-clip-text text-transparent drop-shadow-[0_0_12px_rgba(0,242,254,0.4)]">
            {activeRegion ? `${activeRegion.name}` : "政务服务便民热线"} · 智能研判全景指挥大屏
          </h1>
          <span className="text-cyan-400 font-mono text-xs opacity-70">▶▶</span>
        </div>
        <span className="text-[9px] text-cyan-400/70 font-mono tracking-[0.25em] uppercase">
          CIVIC INTELLIGENCE DISPATCH COCKPIT
        </span>
      </div>

      {/* 右侧：实时轮询、刷新、全屏、退出 */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={onTogglePolling}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl border text-xs font-medium transition-all cursor-pointer ${
            isPolling
              ? "bg-emerald-950/50 border-emerald-500/40 text-emerald-300 shadow-[0_0_10px_rgba(16,185,129,0.25)]"
              : "bg-slate-900/60 border-slate-700 text-slate-400"
          }`}
          title={isPolling ? "实时流自动轮询中 (25s)" : "已暂停自动轮询"}
        >
          <Radio size={12} className={isPolling ? "animate-pulse text-emerald-400" : "text-slate-500"} />
          <span className="hidden sm:inline">{isPolling ? "实时流：开启" : "实时流：暂停"}</span>
        </button>

        <button
          type="button"
          onClick={onRefresh}
          disabled={isRefreshing}
          className="p-2 rounded-xl bg-blue-950/60 border border-blue-500/40 text-cyan-300 hover:text-white hover:border-cyan-400 transition-all cursor-pointer disabled:opacity-50"
          title="强制刷新全域数据"
        >
          <RotateCw size={14} className={isRefreshing ? "animate-spin text-cyan-400" : ""} />
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          className="p-2 rounded-xl bg-blue-950/60 border border-blue-500/40 text-cyan-300 hover:text-white hover:border-cyan-400 transition-all cursor-pointer"
          title={isFullscreen ? "退出全屏" : "进入全屏"}
        >
          {isFullscreen ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
        </button>

        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1 px-3 py-1.5 rounded-xl bg-rose-950/50 border border-rose-500/40 text-rose-300 hover:bg-rose-900/60 hover:text-white transition-all cursor-pointer text-xs font-medium shadow-sm"
          title="退出大屏返回数据总览"
        >
          <X size={14} />
          <span>退出</span>
        </button>
      </div>
    </header>
  );
}
