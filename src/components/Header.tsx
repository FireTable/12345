import React from "react";
import {
  Radar,
  Network,
  FileSpreadsheet,
  BotMessageSquare,
  Sparkles,
  RefreshCw,
  Layers,
} from "lucide-react";

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
                <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  GraphRAG v2.0
                </span>
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
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
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
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
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
            className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-medium transition-all ${
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
          <button
            onClick={onRefresh}
            disabled={isAnalyzing}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-700/80 text-slate-300 hover:bg-slate-800 hover:text-white transition-all disabled:opacity-50"
            title="重新运行多频图聚类算法"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isAnalyzing ? "animate-spin text-cyan-400" : ""}`} />
            {isAnalyzing ? "聚类中..." : "重新聚类"}
          </button>

          <button
            onClick={onExportMaster}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-950/60 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-900/60 hover:text-emerald-100 transition-all shadow-sm"
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            导出核查报表
          </button>

          <button
            onClick={onOpenCopilot}
            className="flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg text-xs font-medium bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white transition-all shadow-md shadow-purple-500/20"
          >
            <BotMessageSquare className="w-3.5 h-3.5" />
            AI 研判助手
          </button>
        </div>
      </div>
    </header>
  );
};
