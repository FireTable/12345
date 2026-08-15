"use client";

import React from "react";
import {
  FileSpreadsheet,
  BotMessageSquare,
  RefreshCw,
  Layers,
  Network,
  LayoutGrid,
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
    <header className="sticky top-0 z-30 border-b border-zinc-800 bg-zinc-950/95 px-6 py-3">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left Branding */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-100 font-bold text-sm">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-semibold tracking-tight text-zinc-100">
                Ticket Radar
              </h1>
              <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 text-zinc-400 border-zinc-700">
                LangGraph JS
              </Badge>
            </div>
            <p className="text-[11px] text-zinc-500">
              热线多频诉求智能识别与批量核查看板
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-zinc-900 border border-zinc-800 p-0.5 rounded-lg">
          <button
            onClick={() => onViewChange("KANBAN")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "KANBAN"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            主题看板
          </button>
          <button
            onClick={() => onViewChange("TABLE")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "TABLE"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            核查总表
          </button>
          <button
            onClick={() => onViewChange("GRAPH")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "GRAPH"
                ? "bg-zinc-800 text-zinc-100 shadow-sm"
                : "text-zinc-400 hover:text-zinc-200"
            }`}
          >
            <Network className="w-3.5 h-3.5" />
            知识图谱
          </button>
        </div>

        {/* Right Action Tools */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onRefresh}
            disabled={isAnalyzing}
            className="text-xs h-8 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isAnalyzing ? "animate-spin" : ""}`} />
            {isAnalyzing ? "聚类中..." : "重新聚类"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onExportMaster}
            className="text-xs h-8 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
            导出报表
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={onOpenCopilot}
            className="text-xs h-8 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 font-medium"
          >
            <BotMessageSquare className="w-3.5 h-3.5 mr-1" />
            AI 研判
          </Button>
        </div>
      </div>
    </header>
  );
};
