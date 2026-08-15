"use client";

import React, { useState, useEffect, useMemo } from "react";
import { Header } from "@/app/_components/dashboard/header";
import { HeaderStats } from "@/app/_components/dashboard/header-stats";
import { FilterToolbar } from "@/app/_components/dashboard/filter-toolbar";
import { ThemeKanban } from "@/app/_components/kanban/theme-kanban";
import { GraphVisualizer } from "@/app/_components/graph/graph-visualizer";
import { MasterTable } from "@/app/_components/table/master-table";
import { TicketDetailSheet } from "@/app/_components/table/ticket-detail-sheet";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import { exportThemesToCSV } from "@/lib/export-csv";
import type {
  MultiFrequencyTheme,
  RiskLevel,
  OverallStats,
  GraphData,
  RawTicket,
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
  const [isLoadingThemeTickets, setIsLoadingThemeTickets] = useState(false);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRisk, setSelectedRisk] = useState<RiskLevel | "ALL">("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  // State from Decoupled APIs
  const [themes, setThemes] = useState<MultiFrequencyTheme[]>([]);
  const [stats, setStats] = useState<OverallStats>({
    totalTickets: 128278,
    multiFrequencyTickets: 7964,
    multiFrequencyRate: 38,
    themeCount: 48,
    highRiskCount: 6,
    mediumRiskCount: 24,
    lowRiskCount: 18,
    compressionRatio: 99,
    topSubject: "大良街道重点诉求责任主体",
    avgResponseTimeSavedHours: 5.2,
  });
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] });

  // 1. Initial Load: Split fast fetch for stats & themes
  useEffect(() => {
    async function loadInitialData() {
      try {
        setIsLoading(true);

        // Fetch stats and themes in parallel (fast <15ms)
        const [statsRes, themesRes] = await Promise.all([
          fetch("/api/stats").then((r) => r.json()).catch(() => null),
          fetch("/api/themes").then((r) => r.json()).catch(() => null),
        ]);

        if (statsRes?.success) {
          setStats(statsRes.data);
        }

        if (themesRes?.success) {
          setThemes(themesRes.data);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
      } finally {
        setIsLoading(false);
      }
    }
    loadInitialData();
  }, []);

  // 2. Load Graph Data on demand when Graph tab is active
  useEffect(() => {
    if (activeView === "GRAPH" && graphData.nodes.length === 0) {
      fetch("/api/graph")
        .then((r) => r.json())
        .then((json) => {
          if (json.success) setGraphData(json.data);
        })
        .catch(console.error);
    }
  }, [activeView, graphData.nodes.length]);

  // 3. On-Demand Theme Drilldown: Load tickets when a theme is selected
  const handleSelectTheme = async (theme: MultiFrequencyTheme) => {
    setSelectedTheme(theme);

    if (!theme.tickets || theme.tickets.length === 0) {
      try {
        setIsLoadingThemeTickets(true);
        const res = await fetch(
          `/api/themes/${theme.id}/tickets?subject=${encodeURIComponent(theme.canonicalSubject)}`
        );
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          setSelectedTheme((prev) =>
            prev && prev.id === theme.id ? { ...prev, tickets: json.data } : prev
          );
        }
      } catch (e) {
        console.error("Failed to load theme tickets:", e);
      } finally {
        setIsLoadingThemeTickets(false);
      }
    }
  };

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
        return matchesTitle || matchesSubj || matchesLoc;
      }
      return true;
    });
  }, [themes, selectedRisk, selectedCategory, searchQuery]);

  // Re-run LangGraph Agent Clustering
  const handleRefreshClustering = async () => {
    try {
      setIsAnalyzing(true);
      toast.info("正在执行多频知识图谱聚类计算...");
      const res = await fetch("/api/cluster");
      const json = await res.json();
      if (json.success) {
        setThemes(json.data.themes);
        setStats(json.data.stats);
        if (json.data.graphData) setGraphData(json.data.graphData);
        toast.success(`聚类分析完成！已聚合 ${json.data.themes.length} 个多频主题`);
      }
    } catch (err) {
      toast.error("调用多频聚类分析失败");
    } finally {
      setIsAnalyzing(false);
    }
  };

  // Export Master Verification Table
  const handleExportMaster = () => {
    exportThemesToCSV(themes);
    toast.success("多频工单核查总表 (CSV) 已成功导出！");
  };

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col selection:bg-primary selection:text-primary-foreground">
      {/* 1. Header */}
      <Header
        activeView={activeView}
        onViewChange={setActiveView}
        onExportMaster={handleExportMaster}
        onOpenCopilot={() => setIsCopilotOpen(false)}
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
          <div className="max-w-7xl mx-auto px-6 py-20 flex flex-col items-center justify-center gap-3 text-muted-foreground">
            <Loader2 className="w-8 h-8 animate-spin text-primary" />
            <p className="text-xs font-medium">正在拉取多频知识图谱与工单数据...</p>
          </div>
        ) : (
          <>
            {activeView === "KANBAN" && (
              <ThemeKanban
                themes={filteredThemes}
                onSelectTheme={handleSelectTheme}
              />
            )}

            {activeView === "GRAPH" && (
              <GraphVisualizer
                graphData={graphData}
                onNodeClick={(node) => {
                  if (node.type === "THEME") {
                    const found = themes.find((t) => t.id === node.id);
                    if (found) handleSelectTheme(found);
                  }
                }}
              />
            )}

            {activeView === "TABLE" && (
              <MasterTable
                themes={themes}
                onSelectTheme={handleSelectTheme}
              />
            )}
          </>
        )}
      </main>

      {/* 5. Drill-Down Detail Sheet */}
      <TicketDetailSheet
        theme={selectedTheme}
        onClose={() => setSelectedTheme(null)}
        isLoadingTickets={isLoadingThemeTickets}
      />

      {/* 6. Light Copilot AI Drawer */}
      <LightCopilot
        isOpen={isCopilotOpen}
        onClose={() => setIsCopilotOpen(false)}
        themes={themes}
        stats={stats}
        onSelectTheme={(t) => {
          handleSelectTheme(t);
          setIsCopilotOpen(false);
        }}
      />
    </div>
  );
}
