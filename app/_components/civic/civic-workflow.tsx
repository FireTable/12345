"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadDialog } from "@/app/_components/dashboard/upload-dialog";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";

const emptyStats: OverallStats = {
  totalTickets: 0,
  multiFrequencyTickets: 0,
  multiFrequencyRate: 0,
  themeCount: 0,
  highRiskCount: 0,
  mediumRiskCount: 0,
  lowRiskCount: 0,
  compressionRatio: 0,
  topSubject: "",
  avgResponseTimeSavedHours: 0,
};

type CivicWorkflow = {
  analyzing: boolean;
  openUpload: () => void;
  openCopilot: () => void;
  runCluster: () => void;
  isAllAnalyzed: boolean;
  disabledReason: string;
};

const CivicWorkflowContext = createContext<CivicWorkflow | null>(null);

export function useCivicWorkflow() {
  const ctx = useContext(CivicWorkflowContext);
  if (!ctx) throw new Error("useCivicWorkflow must be used under CivicWorkflowProvider");
  return ctx;
}

export function CivicWorkflowProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [clusterOnly, setClusterOnly] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [themes, setThemes] = useState<MultiFrequencyTheme[]>([]);
  const [stats, setStats] = useState<OverallStats>(emptyStats);
  const [ticketStatus, setTicketStatus] = useState<{
    total: number;
    analyzed: number;
    loaded: boolean;
  }>({ total: 0, analyzed: 0, loaded: false });

  const loadTicketStatus = useCallback(async () => {
    try {
      const res = await fetch("/api/overview");
      const data = await res.json();
      if (data.success) {
        setTicketStatus({
          total: data.totalWorkorders || 0,
          analyzed: data.analyzedCount || 0,
          loaded: true,
        });
      }
    } catch {
      // silent
    }
  }, []);

  React.useEffect(() => {
    loadTicketStatus();
    const handleRefresh = () => loadTicketStatus();
    window.addEventListener("civic-data-refresh", handleRefresh);
    return () => window.removeEventListener("civic-data-refresh", handleRefresh);
  }, [loadTicketStatus]);

  const isAllAnalyzed =
    ticketStatus.loaded &&
    ticketStatus.total > 0 &&
    ticketStatus.analyzed >= ticketStatus.total;

  const disabledReason =
    ticketStatus.loaded && ticketStatus.total === 0
      ? "暂无工单数据，请先上传工单表格"
      : isAllAnalyzed
      ? `当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`
      : "";

  const refreshPages = useCallback(() => {
    router.refresh();
    loadTicketStatus();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("civic-data-refresh"));
    }
  }, [router, loadTicketStatus]);

  const openUpload = useCallback(() => {
    setClusterOnly(false);
    setUploadOpen(true);
  }, []);

  const runCluster = useCallback(() => {
    if (isAllAnalyzed) {
      toast.info(`当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`);
      return;
    }
    setClusterOnly(true);
    setUploadOpen(true);
  }, [isAllAnalyzed, ticketStatus.total]);

  const openCopilot = useCallback(async () => {
    try {
      const [ov, cl] = await Promise.all([
        fetch("/api/overview").then((r) => r.json()),
        fetch("/api/clusters").then((r) => r.json()),
      ]);
      const list = cl.topClusters || [];
      setStats({
        ...emptyStats,
        totalTickets: ov.totalWorkorders || 0,
        multiFrequencyTickets: ov.multiFreqCount || 0,
        themeCount: ov.multiFreqClusters || list.length,
        highRiskCount: list.filter((c: { urgency?: string }) => c.urgency === "urgent").length,
      });
      setThemes(
        list.map(
          (c: {
            id: string;
            title?: string;
            region?: string;
            type?: string;
            count?: number;
            urgency?: string;
          }) => ({
            id: c.id,
            title: c.title || `${c.region || ""} · ${c.type || ""}`,
            canonicalSubject: c.title || "",
            canonicalLocation: c.region || "",
            eventType: c.type || "",
            category: c.type || "",
            riskLevel: c.urgency === "urgent" ? "HIGH" : "LOW",
            riskReason: "",
            ticketCount: c.count || 0,
            timeSpanHours: 0,
            firstOccurrence: "",
            lastOccurrence: "",
            aiSummary: "",
            recommendedAction: "",
            tickets: [],
            relatedSubjects: [],
            relatedLocations: [],
            status: "UNCHECKED" as const,
          })
        )
      );
    } catch {
      /* 打开助手仍可用，只是开场统计可能为空 */
    }
    setCopilotOpen(true);
  }, []);

  return (
    <CivicWorkflowContext.Provider
      value={{
        analyzing,
        openUpload,
        openCopilot,
        runCluster,
        isAllAnalyzed,
        disabledReason,
      }}
    >
      {children}
      <UploadDialog
        isOpen={uploadOpen}
        autoStartCluster={clusterOnly}
        onClusteringChange={setAnalyzing}
        onClose={() => {
          if (analyzing) return;
          setUploadOpen(false);
          setClusterOnly(false);
        }}
        onDatabaseUpdated={refreshPages}
        onUploadSuccess={(data) => {
          setThemes(data.themes || []);
          if (data.stats) setStats({ ...emptyStats, ...data.stats });
          toast.success(clusterOnly ? "研判完成" : "入库并研判完成");
          setAnalyzing(false);
          setUploadOpen(false);
          setClusterOnly(false);
          refreshPages();
        }}
      />
      {copilotOpen ? (
        <LightCopilot
          isOpen={copilotOpen}
          onClose={() => setCopilotOpen(false)}
          themes={themes}
          stats={stats}
          onSelectTheme={(t) => {
            setCopilotOpen(false);
            router.push(`/themes/${t.id}`);
          }}
        />
      ) : null}
    </CivicWorkflowContext.Provider>
  );
}
