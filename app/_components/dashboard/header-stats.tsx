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
    <div className="w-full">
      <div className="max-w-7xl mx-auto px-6 pt-5 pb-2">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-3.5">
          {/* 1. Total Tickets */}
          <Card className="p-4 flex flex-col justify-between border-border bg-card shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">分析工单总量</span>
              <Inbox className="w-4 h-4 text-muted-foreground/70" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-foreground font-mono">
                {stats.totalTickets.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">件</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              PostgreSQL 全量库底座
            </div>
          </Card>

          {/* 2. Multi-Frequency Ratio */}
          <Card className="p-4 flex flex-col justify-between border-border bg-card shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">多频诉求识别量</span>
              <Activity className="w-4 h-4 text-primary" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-primary font-mono">
                {stats.multiFrequencyTickets.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">件</span>
              <span className="text-xs font-mono font-medium text-primary bg-primary/10 px-1.5 py-0.5 rounded border border-primary/20">
                {stats.multiFrequencyRate}%
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              共现主体/地点多频覆盖
            </div>
          </Card>

          {/* 3. Compression / Theme Count */}
          <Card className="p-4 flex flex-col justify-between border-border bg-card shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">聚合治理主题</span>
              <Layers className="w-4 h-4 text-purple-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-purple-600 font-mono">
                {stats.themeCount}
              </span>
              <span className="text-xs text-muted-foreground">个主题</span>
              <span className="text-xs font-mono font-medium text-emerald-700 bg-emerald-50 px-1.5 py-0.5 rounded border border-emerald-200 flex items-center gap-0.5">
                <TrendingDown className="w-3 h-3" />
                {stats.compressionRatio}%
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              决策负荷降低 {stats.compressionRatio}%
            </div>
          </Card>

          {/* 4. High Risk Warnings */}
          <Card className="p-4 flex flex-col justify-between border-border bg-card shadow-2xs">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">紧急督办事项</span>
              <AlertCircle className="w-4 h-4 text-rose-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-2">
              <span className="text-2xl font-bold text-rose-600 font-mono">{stats.highRiskCount}</span>
              <span className="text-xs text-muted-foreground">项</span>
              <span className="text-[11px] text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded border border-amber-200">
                重点: {stats.mediumRiskCount}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              需优先研判与协同派发
            </div>
          </Card>

          {/* 5. Time Efficiency Saved */}
          <Card className="p-4 flex flex-col justify-between border-border bg-card shadow-2xs col-span-2 md:col-span-1">
            <div className="flex items-center justify-between text-muted-foreground">
              <span className="text-xs font-medium">AI 研判提效</span>
              <Clock className="w-4 h-4 text-emerald-600" />
            </div>
            <div className="mt-2 flex items-baseline gap-1.5">
              <span className="text-2xl font-bold text-emerald-600 font-mono">~{stats.avgResponseTimeSavedHours}</span>
              <span className="text-xs text-muted-foreground">小时 / 日</span>
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground/80">
              替代人工逐单检索
            </div>
          </Card>
        </div>
      </div>
    </div>
  );
};
