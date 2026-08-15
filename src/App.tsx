import React, { useState, useMemo } from "react";
import { Header } from "./components/Header";
import { HeaderStats } from "./components/HeaderStats";
import { FilterToolbar } from "./components/FilterToolbar";
import { ThemeKanban } from "./components/ThemeKanban";
import { GraphVisualizer } from "./components/GraphVisualizer";
import { MasterTableModal } from "./components/MasterTableModal";
import { TicketDetailDrawer } from "./components/TicketDetailDrawer";
import { LightCopilot } from "./components/LightCopilot";
import { MOCK_RAW_TICKETS } from "./lib/mock-data";
import { clusterTickets } from "./lib/graph-cluster";
import { exportThemesToCSV } from "./lib/export-csv";
import type { MultiFrequencyTheme, RiskLevel } from "./types";
import { Toaster, toast } from "sonner";

export const App: React.FC = () => {
  // Active View State
  const [activeView, setActiveView] = useState<"KANBAN" | "GRAPH" | "TABLE">("KANBAN");
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isCopilotOpen, setIsCopilotOpen] = useState(false);
  const [selectedTheme, setSelectedTheme] = useState<MultiFrequencyTheme | null>(null);

  // Filters State
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedRisk, setSelectedRisk] = useState<RiskLevel | "ALL">("ALL");
  const [selectedCategory, setSelectedCategory] = useState("ALL");

  // Clustering Engine Result
  const clusterResult = useMemo(() => {
    return clusterTickets(MOCK_RAW_TICKETS);
  }, []);

  const [themes, setThemes] = useState<MultiFrequencyTheme[]>(clusterResult.themes);
  const stats = clusterResult.stats;
  const graphData = clusterResult.graphData;

  // Unique categories for filtering
  const categories = useMemo(() => {
    return Array.from(new Set(themes.map((t) => t.category)));
  }, [themes]);

  // Filtered Themes based on search and filters
  const filteredThemes = useMemo(() => {
    return themes.filter((t) => {
      // Risk Filter
      if (selectedRisk !== "ALL" && t.riskLevel !== selectedRisk) {
        return false;
      }
      // Category Filter
      if (selectedCategory !== "ALL" && t.category !== selectedCategory) {
        return false;
      }
      // Search Query
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

  // Re-run Clustering simulation
  const handleRefreshClustering = () => {
    setIsAnalyzing(true);
    toast.info("正在调用 GraphRAG 实体规范化与社区聚类引擎...");
    setTimeout(() => {
      const refreshed = clusterTickets(MOCK_RAW_TICKETS);
      setThemes(refreshed.themes);
      setIsAnalyzing(false);
      toast.success(`多频聚类完成！成功识别 ${refreshed.themes.length} 个多频主题，聚合 ${refreshed.stats.multiFrequencyTickets} 件工单`);
    }, 600);
  };

  // Export Master Verification Table
  const handleExportMaster = () => {
    exportThemesToCSV(themes);
    toast.success("热线多频工单核查报表 (CSV) 已成功导出！");
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col selection:bg-cyan-500 selection:text-white">
      <Toaster position="top-right" theme="dark" richColors />

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
          <MasterTableModal
            themes={themes}
            onSelectTheme={(t) => setSelectedTheme(t)}
          />
        )}
      </main>

      {/* 5. Drill-Down Detail Drawer */}
      <TicketDetailDrawer
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
};
