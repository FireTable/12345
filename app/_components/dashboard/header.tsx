"use client";

import React from "react";
import {
  Radar,
  Network,
  FileSpreadsheet,
  BotMessageSquare,
  RefreshCw,
  Layers,
} from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { Badge } from "@/app/_components/ui/badge";

interface HeaderProps {
  activeView: "KANBAN" | "GRAPH" | "TABLE";
  onViewChange: (view: "KANBAN" | "GRAPH" | "TABLE") => void;
  onExportMaster: () => void;
  onOpenCopilot: () => void;
  onRefresh: () => void;
  isAnalyzing: boolean;
}

export const Header: React.FC<HeaderProps> = ({
  activeView,
  onViewChange,
  onExportMaster,
  onOpenCopilot,
  onRefresh,
  isAnalyzing,
}) => {
  return (
    <header className="sticky top-0 z-30 border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl px-6 py-3.5">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left Branding */}
        <div className="flex items-center gap-3.5">
          <div className="relative flex items-center justify-center w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-blue-500 shadow-lg shadow-cyan-500/25">
            <Radar className="w-5 h-5 text-white animate-spin" style={{ animationDuration: "12s" }} />
            <div className="absolute inset-0 rounded-xl border border-cyan-300/40 animate-radar-pulse" />
          </div>
          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-lg font-bold tracking-tight text-white flex items-center gap-2">
                Ticket Radar
                <Badge variant="cyan" className="font-mono text-[10px]">
                  LangGraph JS
                </Badge>
              </h1>
            </div>
            <p className="text-xs text-slate-400">
              热线多频诉求智能识别 · 实体图谱聚类 · 批量核查看板
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-slate-900/90 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => onViewChange("KANBAN")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === "KANBAN"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            主题看板
          </button>
          <button
            onClick={() => onViewChange("GRAPH")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === "GRAPH"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            知识图谱拓扑
          </button>
          <button
            onClick={() => onViewChange("TABLE")}
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
              activeView === "TABLE"
                ? "bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-md shadow-cyan-500/20"
                : "text-slate-400 hover:text-slate-200"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            核查总表
          </button>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isAnalyzing}
            className="text-xs"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin text-cyan-400" : ""}`} />
            {isAnalyzing ? "聚类中..." : "重新聚类"}
          </Button>

          <Button
            variant="emerald"
            size="sm"
            onClick={onExportMaster}
            className="text-xs"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            导出核查报表
          </Button>

          <Button
            variant="purple"
            size="sm"
            onClick={onOpenCopilot}
            className="text-xs"
          >
            <BotMessageSquare className="w-3.5 h-3.5" />
            AI 研判助手
          </Button>
        </div>
      </div>
    </header>
  );
};
