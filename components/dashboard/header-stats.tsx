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
import type { OverallStats } from "@/backend/state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface HeaderStatsProps {
  stats: OverallStats;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 max-w-7xl mx-auto px-6 pt-5 pb-2">
      {/* 1. Total Tickets */}
      <Card className="p-4 flex flex-col justify-between hover:border-slate-700 transition-all">
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
      </Card>

      {/* 2. Multi-Frequency Ratio */}
      <Card className="p-4 flex flex-col justify-between hover:border-cyan-500/40 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">多频诉求识别量</span>
          <div className="w-7 h-7 rounded-lg bg-cyan-500/10 flex items-center justify-center text-cyan-400">
            <Sparkles className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-cyan-400 tracking-tight">{stats.multiFrequencyTickets}</span>
          <span className="text-xs text-slate-400">件</span>
          <Badge variant="cyan">
            {stats.multiFrequencyRate}%
          </Badge>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          同主体 / 同事件聚合覆盖
        </div>
      </Card>

      {/* 3. Compression / Theme Count */}
      <Card className="p-4 flex flex-col justify-between hover:border-purple-500/40 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">聚合主题卡片</span>
          <div className="w-7 h-7 rounded-lg bg-purple-500/10 flex items-center justify-center text-purple-400">
            <Layers className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-purple-400 tracking-tight">{stats.themeCount}</span>
          <span className="text-xs text-slate-400">个主题</span>
          <Badge variant="purple" className="flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" />
            {stats.compressionRatio}%
          </Badge>
        </div>
        <div className="mt-1 text-[11px] text-slate-400">
          决策负荷降低 {stats.compressionRatio}%
        </div>
      </Card>

      {/* 4. High Risk Warnings */}
      <Card className="p-4 flex flex-col justify-between hover:border-rose-500/40 transition-all">
        <div className="flex items-center justify-between text-slate-400">
          <span className="text-xs font-medium">🔴 高风险紧急群</span>
          <div className="w-7 h-7 rounded-lg bg-rose-500/10 flex items-center justify-center text-rose-400">
            <AlertTriangle className="w-4 h-4" />
          </div>
        </div>
        <div className="mt-3 flex items-baseline gap-2">
          <span className="text-2xl font-extrabold text-rose-400 tracking-tight">{stats.highRiskCount}</span>
          <span className="text-xs text-slate-400">群</span>
          <Badge variant="warning" className="text-[10px]">
            中风险: {stats.mediumRiskCount}
          </Badge>
        </div>
        <div className="mt-1 text-[11px] text-rose-400/90 font-medium">
          需优先督办与快速交办
        </div>
      </Card>

      {/* 5. Time Efficiency Saved */}
      <Card className="p-4 flex flex-col justify-between hover:border-emerald-500/40 transition-all col-span-2 md:col-span-1">
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
      </Card>
    </div>
  );
};
