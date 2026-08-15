import React from "react";
import {
  Inbox,
  Layers,
  Clock,
  TrendingDown,
  Activity,
  AlertCircle,
} from "lucide-react";
import type { OverallStats } from "@/backend/state";
import { Card } from "@/app/_components/ui/card";

interface HeaderStatsProps {
  stats: OverallStats;
}

export const HeaderStats: React.FC<HeaderStatsProps> = ({ stats }) => {
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5 max-w-7xl mx-auto px-6 pt-5 pb-2">
      {/* 1. Total Tickets */}
      <Card className="p-4 flex flex-col justify-between border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">分析工单总量</span>
          <Inbox className="w-4 h-4 text-zinc-500" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-zinc-100 font-mono">{stats.totalTickets}</span>
          <span className="text-xs text-zinc-500">件</span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          抽样全量诉求
        </div>
      </Card>

      {/* 2. Multi-Frequency Ratio */}
      <Card className="p-4 flex flex-col justify-between border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">多频诉求识别量</span>
          <Activity className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-zinc-100 font-mono">{stats.multiFrequencyTickets}</span>
          <span className="text-xs text-zinc-500">件</span>
          <span className="text-xs font-mono font-medium text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded">
            {stats.multiFrequencyRate}%
          </span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          共现主体/事件聚合覆盖
        </div>
      </Card>

      {/* 3. Compression / Theme Count */}
      <Card className="p-4 flex flex-col justify-between border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">聚合多频主题</span>
          <Layers className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-zinc-100 font-mono">{stats.themeCount}</span>
          <span className="text-xs text-zinc-500">个主题</span>
          <span className="text-xs font-mono font-medium text-zinc-300 bg-zinc-800 px-1.5 py-0.5 rounded flex items-center gap-0.5">
            <TrendingDown className="w-3 h-3" />
            {stats.compressionRatio}%
          </span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          决策负荷降低 {stats.compressionRatio}%
        </div>
      </Card>

      {/* 4. High Risk Warnings */}
      <Card className="p-4 flex flex-col justify-between border-zinc-800 bg-zinc-900/30">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">紧急督办事项</span>
          <AlertCircle className="w-4 h-4 text-red-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-2">
          <span className="text-2xl font-bold text-red-400 font-mono">{stats.highRiskCount}</span>
          <span className="text-xs text-zinc-500">项</span>
          <span className="text-[11px] text-amber-400 bg-amber-950/60 px-1.5 py-0.5 rounded border border-amber-900/50">
            重点: {stats.mediumRiskCount}
          </span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          需优先研判与协同派发
        </div>
      </Card>

      {/* 5. Time Efficiency Saved */}
      <Card className="p-4 flex flex-col justify-between border-zinc-800 bg-zinc-900/30 col-span-2 md:col-span-1">
        <div className="flex items-center justify-between text-zinc-400">
          <span className="text-xs font-medium">AI 研判提效</span>
          <Clock className="w-4 h-4 text-zinc-400" />
        </div>
        <div className="mt-2 flex items-baseline gap-1.5">
          <span className="text-2xl font-bold text-zinc-100 font-mono">~{stats.avgResponseTimeSavedHours}</span>
          <span className="text-xs text-zinc-500">小时 / 日</span>
        </div>
        <div className="mt-1 text-[11px] text-zinc-500">
          替代人工逐单搜索
        </div>
      </Card>
    </div>
  );
};
