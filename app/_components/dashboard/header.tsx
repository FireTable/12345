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
    <header className="sticky top-0 z-30 border-b border-slate-200 bg-white/95 backdrop-blur-md px-6 py-3 shadow-2xs">
      <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
        {/* Left Branding */}
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center font-bold text-sm shadow-xs">
            <LayoutGrid className="w-4 h-4" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-sm font-bold tracking-tight text-slate-900">
                Ticket Radar
              </h1>
              <Badge variant="outline" className="font-mono text-[10px] py-0 px-1.5 text-blue-700 bg-blue-50 border-blue-200">
                LangGraph JS
              </Badge>
            </div>
            <p className="text-[11px] text-slate-500">
              多频诉求智能识别 · 实体图谱聚类 · 批量核查看板
            </p>
          </div>
        </div>

        {/* View Switcher Tabs */}
        <div className="flex items-center bg-slate-100 border border-slate-200 p-0.5 rounded-lg">
          <button
            onClick={() => onViewChange("KANBAN")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "KANBAN"
                ? "bg-white text-slate-900 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <Layers className="w-3.5 h-3.5" />
            主题看板
          </button>
          <button
            onClick={() => onViewChange("TABLE")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "TABLE"
                ? "bg-white text-slate-900 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            核查总表
          </button>
          <button
            onClick={() => onViewChange("GRAPH")}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
              activeView === "GRAPH"
                ? "bg-white text-slate-900 shadow-2xs font-semibold"
                : "text-slate-600 hover:text-slate-900"
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
            className="text-xs h-8 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isAnalyzing ? "animate-spin text-blue-600" : ""}`} />
            {isAnalyzing ? "聚类中..." : "重新聚类"}
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onExportMaster}
            className="text-xs h-8 border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:text-slate-900"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
            导出报表
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={onOpenCopilot}
            className="text-xs h-8 bg-blue-600 text-white hover:bg-blue-700 font-medium shadow-xs"
          >
            <BotMessageSquare className="w-3.5 h-3.5 mr-1" />
            AI 研判
          </Button>
        </div>
      </div>
    </header>
  );
};
