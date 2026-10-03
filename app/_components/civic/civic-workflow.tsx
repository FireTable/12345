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
  copilotOpen: boolean;
  pipelineDrawerOpen: boolean;
  setPipelineDrawerOpen: React.Dispatch<React.SetStateAction<boolean>>;
  togglePipelineDrawer: () => void;
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
  const [pipelineDrawerOpen, setPipelineDrawerOpen] = useState(false);
  const togglePipelineDrawer = useCallback(() => {
    setPipelineDrawerOpen((prev) => !prev);
  }, []);
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
      // ponytail: 未登录态先打公开端点拿到工单数,登录态再升级到 /api/overview。
      const pub = await fetch("/api/public/overview")
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (pub && typeof pub.totalWorkorders === "number") {
        setTicketStatus({
          total: pub.totalWorkorders,
          analyzed: pub.analyzedCount || 0,
          loaded: true,
        });
        return;
      }
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
      // ponytail: 未登录态 overview/clusters 返 401,优先打 /api/public/* 拿公开数据;
      // 公开端点也挂了再退到 ticketStatus(本地已加载的态),最后兜底 0。
      const [ov, cl] = await Promise.all([
        fetch("/api/public/overview")
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null),
        fetch("/api/clusters").then((r) => (r.ok ? r.json() : null)).catch(() => null),
      ]);
      const fallbackOv = ov || { totalWorkorders: ticketStatus.total, multiFreqCount: 0, multiFreqClusters: 0 };
      const list = cl?.topClusters || [];
      const totalTickets = fallbackOv.totalWorkorders || 0;
      const themeCount = fallbackOv.multiFreqClusters || list.length || 0;
      setStats({
        ...emptyStats,
        totalTickets,
        multiFrequencyTickets: fallbackOv.multiFreqCount || 0,
        themeCount,
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
  }, [ticketStatus.total]);

  return (
    <CivicWorkflowContext.Provider
      value={{
        analyzing,
        openUpload,
        openCopilot,
        runCluster,
        isAllAnalyzed,
        disabledReason,
        copilotOpen,
        pipelineDrawerOpen,
        setPipelineDrawerOpen,
        togglePipelineDrawer,
      }}
    >
      {children}
      <UploadDialog
        isOpen={uploadOpen}
        autoStartCluster={clusterOnly}
        onClusteringChange={setAnalyzing}
        onShowProgress={() => setUploadOpen(true)}
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
    </CivicWorkflowContext.Provider>
  );
}
