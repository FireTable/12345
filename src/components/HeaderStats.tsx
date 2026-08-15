import React from "react";
import {
  Inbox,
  Sparkles,
  Layers,
  AlertTriangle,
  Clock,
  TrendingDown,
  Activity,
} from "lucide-react";
import type { OverallStats } from "../types";

interface HeaderStatsProps {
  stats: OverallStats;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 max-w-7xl mx-auto px-6 pt-5 pb-2">
      {/* 1. Total Tickets */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col justify-between border-slate-800/80 hover:border-slate-700 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">当前分析工单总量</span>
          <div className="w-7 h-7 rounded-lg bg-slate-800/80 flex items-center justify-center text-slate-300">
            <Inbox className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-white tracking-tight">{stats.totalTickets}</span>
          <span className="text-xs text-slate-400">件</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-500 flex items-center gap-1">
          <Activity className="w-3 h-3 text-cyan-400" />
          今日热线脱敏全量抽样
        </div>
      </div>

      {/* 2. Multi-Frequency Ratio */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col justify-between border-slate-800/80 hover:border-cyan-500/30 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">多频诉求识别量</span>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-cyan-400 tracking-tight">{stats.multiFrequencyTickets}</span>
          <span className="text-xs text-slate-400">件</span>
          <span className="text-xs font-semibold text-cyan-300 bg-cyan-950/80 px-1.5 py-0.5 rounded border border-cyan-800/50">
            {stats.multiFrequencyRate}%
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          同主体 / 同事件聚合覆盖
        </div>
      </div>

      {/* 3. Compression / Theme Count */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col justify-between border-slate-800/80 hover:border-purple-500/30 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">聚合主题卡片</span>
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-purple-400 tracking-tight">{stats.themeCount}</span>
          <span className="text-xs text-slate-400">个主题</span>
          <span className="text-xs font-semibold text-purple-300 bg-purple-950/80 px-1.5 py-0.5 rounded border border-purple-800/50 flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" />
            {stats.compressionRatio}%
          </span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          决策负荷降低 {stats.compressionRatio}%
        </div>
      </div>

      {/* 4. High Risk Warnings */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col justify-between border-slate-800/80 hover:border-rose-500/30 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">🔴 高风险紧急群</span>
          <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-rose-400 tracking-tight">{stats.highRiskCount}</span>
          <span className="text-xs text-slate-400">群</span>
          <span className="text-[10px] text-amber-400 bg-amber-950/50 px-1 py-0.5 rounded border border-amber-800/40">
            中风险: {stats.mediumRiskCount}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-rose-400/90 font-medium">
          需优先督办与快速交办
        </div>
      </div>

      {/* 5. Time Efficiency Saved */}
      <div className="glass-panel rounded-2xl p-4 flex flex-col justify-between border-slate-800/80 hover:border-emerald-500/30 transition-all col-span-2 md:col-span-1">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">AI 提效研判时间</span>
          <div className="w-7 h-7 rounded-lg bg-emerald-500/10 flex items-center justify-center text-emerald-400">
            <Clock className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-emerald-400 tracking-tight">~{stats.avgResponseTimeSavedHours}</span>
          <span className="text-xs text-slate-400">小时 / 日</span>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          替代传统人工逐单搜索
        </div>
      </div>
    </div>
  );
};
