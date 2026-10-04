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
} from "lucide-react";
import type { RegionInfo } from "../civic/region-context";

/**
 * 科技翼展式大屏无 Header 顶部中枢组件
 * 主色调全面对齐系统 Logo 官方政务科技蓝 (#1677FF)
 */

export function CockpitTitleCrown({ title }: { title: string }) {
  return (
    <div className="relative flex flex-col items-center pointer-events-none select-none z-30">
      {/* 科技翼展流光 SVG 底座：以政务科技蓝 #1677FF 为核心主基调 */}
      <svg
        width="780"
        height="52"
        viewBox="0 0 780 52"
        fill="none"
        className="drop-shadow-[0_4px_24px_rgba(22,119,255,0.45)]"
      >
        {/* 外围主体翼展梯形 */}
        <path
          d="M0 0 L150 0 L195 46 L585 46 L630 0 L780 0"
          stroke="url(#wingGrad)"
          strokeWidth="1.6"
          fill="url(#wingFill)"
          opacity="0.95"
        />
        {/* 左翼科技导轨 */}
        <path
          d="M40 3 L145 3 L185 42"
          stroke="#1677FF"
          strokeWidth="1.2"
          opacity="0.5"
        />
        {/* 右翼科技导轨 */}
        <path
          d="M740 3 L635 3 L595 42"
          stroke="#1677FF"
          strokeWidth="1.2"
          opacity="0.5"
        />
        {/* 翼展转折光点 */}
        <circle cx="195" cy="46" r="3" fill="#4096FF" />
        <circle cx="585" cy="46" r="3" fill="#4096FF" />
        <circle cx="150" cy="0" r="2.5" fill="#1677FF" />
        <circle cx="630" cy="0" r="2.5" fill="#1677FF" />

        <defs>
          <linearGradient id="wingGrad" x1="0" y1="0" x2="780" y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#1677FF" stopOpacity="0" />
            <stop offset="20%" stopColor="#0958D9" stopOpacity="0.85" />
            <stop offset="50%" stopColor="#4096FF" stopOpacity="1" />
            <stop offset="80%" stopColor="#0958D9" stopOpacity="0.85" />
            <stop offset="100%" stopColor="#1677FF" stopOpacity="0" />
          </linearGradient>
          <linearGradient id="wingFill" x1="390" y1="0" x2="390" y2="52" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#020919" stopOpacity="0.95" />
            <stop offset="100%" stopColor="#0a204d" stopOpacity="0.45" />
          </linearGradient>
        </defs>
      </svg>

      {/* 居中标题与副标布局 (突出 12345 核心标识，提升副标字号与呼吸空间) */}
      <div className="absolute top-1 flex flex-col items-center">
        {/* 主标题区：突出 12345 核心政务品牌 */}
        <div className="flex items-center gap-2">
          {/* 12345 高亮微胶囊与渐变大字 */}
          <span className="font-mono font-black text-2xl md:text-[26px] tracking-wider text-transparent bg-clip-text bg-gradient-to-r from-[#4096FF] via-[#69b1ff] to-[#e6f4ff] drop-shadow-[0_0_16px_rgba(64,150,255,0.9)]">
            12345
          </span>
          <span className="text-blue-300/40 text-lg font-light">·</span>
          <h1 className="text-xl md:text-[23px] font-black tracking-[0.16em] bg-gradient-to-b from-white via-blue-50 to-[#91caff] bg-clip-text text-transparent drop-shadow-[0_0_20px_rgba(22,119,255,0.65)]">
            {title}智能研判全景指挥大屏
          </h1>
        </div>

        {/* 副标题区：字号提升至 11px，两侧带微光导引线，无横线穿透 */}
        <div className="flex items-center gap-2.5 mt-0.5">
          <span className="h-[1px] w-10 bg-gradient-to-r from-transparent to-[#4096ff]/70" />
          <span className="text-[11px] font-mono tracking-[0.22em] text-[#69b1ff] font-medium uppercase drop-shadow-[0_0_8px_rgba(22,119,255,0.5)]">
            CIVIC INTELLIGENCE DISPATCH COCKPIT
          </span>
          <span className="h-[1px] w-10 bg-gradient-to-l from-transparent to-[#4096ff]/70" />
        </div>
      </div>
    </div>
  );
}

interface CockpitTopControlsProps {
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

export function CockpitTopControls({
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
}: CockpitTopControlsProps) {
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
    <>
      {/* 左上角悬浮胶囊：时钟 + 辖区切换 (Logo 蓝风格) */}
      <div className="absolute top-3.5 left-4 z-40 flex items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-[#051433]/85 border border-[#1677FF]/40 text-blue-100 shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl text-xs font-mono">
          <span className="w-2 h-2 rounded-full bg-[#1677FF] animate-ping inline-block" />
          <span className="tracking-wider font-semibold">{currentTime || "2026-10-04 17:00:00"}</span>
        </div>

        <div className="relative">
          <button
            type="button"
            onClick={() => setShowRegionMenu(!showRegionMenu)}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[#051433]/85 border border-[#1677FF]/40 text-blue-100 hover:text-white hover:border-[#4096ff] transition-all cursor-pointer shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl text-xs font-medium"
          >
            <MapPin size={13} className="text-[#1677FF]" />
            <span>{activeRegion ? `${activeRegion.city} · ${activeRegion.name}` : "选择辖区"}</span>
            <ChevronDown size={12} className="text-slate-400" />
          </button>

          {showRegionMenu && (
            <div className="absolute top-full left-0 mt-2 w-48 py-1 rounded-xl bg-[#091b3d] border border-[#1677FF]/40 shadow-2xl z-50 backdrop-blur-2xl">
              <div className="px-3 py-1 text-[10px] text-slate-400 uppercase tracking-wider border-b border-[#1677FF]/20 font-mono">
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
                  className={`w-full text-left px-3 py-2 text-xs flex items-center justify-between hover:bg-blue-900/40 transition-colors ${
                    activeRegion?.id === r.id ? "text-blue-300 font-semibold bg-blue-950/60" : "text-slate-300"
                  }`}
                >
                  <span>{r.city} · {r.name}</span>
                  {activeRegion?.id === r.id && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-300">当前</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* 右上角悬浮胶囊：轮询 + 刷新 + 全屏 + 退出 (带ESC说明) */}
      <div className="absolute top-3.5 right-4 z-40 flex items-center gap-2 pointer-events-auto">
        <button
          type="button"
          onClick={onTogglePolling}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-xs font-medium transition-all cursor-pointer backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.6)] ${
            isPolling
              ? "bg-emerald-950/60 border-emerald-500/40 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.3)]"
              : "bg-[#051433]/80 border-slate-700 text-slate-400"
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
          className="p-1.5 px-2 rounded-full bg-[#051433]/85 border border-[#1677FF]/40 text-blue-200 hover:text-white hover:border-[#4096ff] transition-all cursor-pointer disabled:opacity-50 backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.6)]"
          title="强制刷新全域数据"
        >
          <RotateCw size={13} className={isRefreshing ? "animate-spin text-[#4096ff]" : ""} />
        </button>

        <button
          type="button"
          onClick={onToggleFullscreen}
          className="p-1.5 px-2 rounded-full bg-[#051433]/85 border border-[#1677FF]/40 text-blue-200 hover:text-white hover:border-[#4096ff] transition-all cursor-pointer backdrop-blur-xl shadow-[0_4px_20px_rgba(0,0,0,0.6)]"
          title={isFullscreen ? "退出全屏" : "进入全屏"}
        >
          {isFullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
        </button>

        {/* 退出大屏按钮 (带 ESC 二次退出提示) */}
        <button
          type="button"
          onClick={onClose}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-rose-950/70 border border-rose-500/40 text-rose-300 hover:bg-rose-900/80 hover:text-white transition-all cursor-pointer text-xs font-medium shadow-[0_4px_20px_rgba(0,0,0,0.6)] backdrop-blur-xl"
          title="退出大屏返回数据总览 (快捷键: 连续按两次 ESC)"
        >
          <X size={13} />
          <span>退出</span>
          <kbd className="hidden sm:inline-block px-1.5 py-0.2 rounded bg-black/40 border border-rose-500/30 font-mono text-[9px] text-rose-300/80">
            ESC
          </kbd>
        </button>
      </div>
    </>
  );
}
