"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Header } from "@/components/dashboard/header";
import { HeaderStats } from "@/components/dashboard/header-stats";
import { FilterToolbar } from "@/components/dashboard/filter-toolbar";
import { ThemeKanban } from "@/components/kanban/theme-kanban";
import { GraphVisualizer } from "@/components/graph/graph-visualizer";
import { MasterTable } from "@/components/table/master-table";
import { TicketDetailSheet } from "@/components/table/ticket-detail-sheet";
import { LightCopilot } from "@/components/copilot/light-copilot";
import { exportThemesToCSV } from "@/lib/export-csv";
import type {
  MultiFrequencyTheme,
  RiskLevel,
  OverallStats,
  GraphData,
} from "@/backend/state";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export default function HomePage() {
  // Active View State
  const [activeView, setActiveView] = useState<"KANBAN" | "GRAPH" | "TABLE">("KANBAN");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<MultiFrequencyTheme | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRisk, setSelectedRisk] = useState<RiskLevel | "ALL">("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  // State from Backend LangGraph Agent
  const [themes, setThemes] = useState<MultiFrequencyTheme[]>([]);
  const [stats, setStats] = useState<OverallStats>({
    totalTickets: 0,
    multiFrequencyTickets: 0,
    multiFrequencyRate: 0,
    themeCount: 0,
    highRiskCount: 0,
    mediumRiskCount: 0,
    lowRiskCount: 0,
    compressionRatio: 0,
    topSubject: "",
    avgResponseTimeSavedHours: 4.8,
  });
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  // 1. Initial Load: Fetch from LangGraph backend /api/cluster
  useEffect(() => {
    async function loadData() {
      try {
        setIsLoading(true);
        const res = await fetch("/api/cluster");
        const json = await res.json();
        if (json.success) {
          setThemes(json.data.themes);
          setStats(json.data.stats);
          setGraphData(json.data.graphData);
        }
      } catch (err) {
        console.error("Failed to load initial cluster data:", err);
        toast.error("从 LangGraph 后端获取多频数据失败，请检查服务状态");
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Unique categories for filtering
  const categories = useMemo(() => {
    return Array.from(new Set(themes.map((t) => t.category)));
  }, [themes]);

  // Filtered Themes based on search and filters
  const filteredThemes = useMemo(() => {
    return themes.filter((t) => {
      if (selectedRisk !== "ALL" && t.riskLevel !== selectedRisk) {
        return false;
      }
      if (selectedCategory !== "ALL" && t.category !== selectedCategory) {
        return false;
      }
      if (searchQuery.trim()) {
        const q = searchQuery.toLowerCase();
        const matchesTitle = t.title.toLowerCase().includes(q);
        const matchesSubj = t.canonicalSubject.toLowerCase().includes(q);
        const matchesLoc = t.canonicalLocation.toLowerCase().includes(q);
        const matchesTickets = t.tickets.some(
          (tk) => tk.ticketNo.toLowerCase().includes(q) || tk.content.toLowerCase().includes(q)
        );
        return matchesTitle || matchesSubj || matchesLoc || matchesTickets;
      }
      return true;
    });
  }, [themes, selectedRisk, selectedCategory, searchQuery]);

  // Re-run LangGraph Agent Clustering
  const handleRefreshClustering = async () => {
    try {
      setIsAnalyzing(true);
      toast.info("正在调用 LangGraph JS 后端执行多频图聚类...");
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ threadId: `manual-run-${Date.now()}` }),
      });
      const json = await res.json();
      if (json.success) {
        setThemes(json.data.themes);
        setStats(json.data.stats);
        setGraphData(json.data.graphData);
        toast.success(`LangGraph 聚类完成！识别 ${json.data.themes.length} 个多频主题，聚合 ${json.data.stats.multiFrequencyTickets} 件工单`);
      }
    } catch (err) {
      toast.error("调用 LangGraph 聚类失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Export Master Verification Table
  const handleExportMaster = () => {
    exportThemesToCSV(themes);
    toast.success("热线多频工单核查报表 (CSV) 已成功导出！");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      {/* 1. Header */}
      <Header
        activeView={activeView}
        onViewChange={setActiveView}
        onExportMaster={handleExportMaster}
        onOpenCopilot={() => setIsCopilotOpen(true)}
        onRefresh={handleRefreshClustering}
        isAnalyzing={isAnalyzing}
      />

      {/* 2. Top Stats Dashboard */}
      <HeaderStats stats={stats} />

      {/* 3. Filter Toolbar */}
      {activeView === "KANBAN" && (
        <FilterToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          selectedRisk={selectedRisk}
          onRiskChange={setSelectedRisk}
          selectedCategory={selectedCategory}
          onCategoryChange={setSelectedCategory}
          categories={categories}
        />
      )}

      {/* 4. Main Content Area */}
      <main className="flex-1 pb-12">
        {isLoading ? (
          <div className="max-w-7xl mx-auto px-6 py-20 flex flex-col items-center justify-center gap-3 text-slate-400">
            <Loader2 className="w-8 h-8 animate-spin text-cyan-400" />
            <p className="text-xs">正在从 LangGraph JS 后端拉取多频工单知识图谱...</p>
          </div>
        ) : (
          <>
            {activeView === "KANBAN" && (
              <ThemeKanban
                themes={filteredThemes}
                onSelectTheme={(t) => setSelectedTheme(t)}
              />
            )}

            {activeView === "GRAPH" && (
              <GraphVisualizer
                graphData={graphData}
                onNodeClick={(node) => {
                  if (node.type === "THEME") {
                    const found = themes.find((t) => t.id === node.id);
                    if (found) setSelectedTheme(found);
                  }
                }}
              />
            )}

            {activeView === "TABLE" && (
              <MasterTable
                themes={themes}
                onSelectTheme={(t) => setSelectedTheme(t)}
              />
            )}
          </>
        )}
      </main>

      {/* 5. Drill-Down Detail Sheet */}
      <TicketDetailSheet
        theme={selectedTheme}
        onClose={() => setSelectedTheme(null)}
      />

      {/* 6. Light Copilot AI Drawer */}
      <LightCopilot
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        themes={themes}
        stats={stats}
        onSelectTheme={(t) => {
          setSelectedTheme(t);
          setIsCopilotOpen(false);
        }}
      />
    </div>
  );
}
