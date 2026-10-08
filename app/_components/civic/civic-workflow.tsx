"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadDialog } from "@/app/_components/dashboard/upload-dialog";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";
import type { TaskProgress } from "@/lib/task-progress";
import { useRegion } from "./region-context";

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
  taskProgress: TaskProgress | null;
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
  const { activeRegion } = useRegion();
  const [uploadOpen, setUploadOpen] = useState(false);
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

  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);

  const pollTaskProgress = useCallback(async () => {
    try {
      const res = await fetch("/api/cluster/progress?taskId=latest", { cache: "no-store" });
      const json = await res.json();
      if (json.success && json.data) {
        const data = json.data as TaskProgress;
        setTaskProgress(data);
        if (data.status === "RUNNING") {
          setAnalyzing(true);
        } else if (data.status === "COMPLETED" || data.status === "FAILED") {
          setAnalyzing(false);
        }
      }
    } catch {
      // silent
    }
  }, []);

  React.useEffect(() => {
    // 切区时立刻清掉旧 taskProgress 并拉一次新区的，避免 3s 内 header 还显示旧区数据
    setTaskProgress(null);
    pollTaskProgress();
    loadTicketStatus();
    const interval = setInterval(pollTaskProgress, analyzing ? 3000 : 12000);
    const handleRefresh = () => {
      loadTicketStatus();
      pollTaskProgress();
    };
    window.addEventListener("civic-data-refresh", handleRefresh);
    return () => {
      clearInterval(interval);
      window.removeEventListener("civic-data-refresh", handleRefresh);
    };
  }, [analyzing, loadTicketStatus, pollTaskProgress, activeRegion?.id]);

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
    pollTaskProgress();
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("civic-data-refresh"));
    }
  }, [router, loadTicketStatus, pollTaskProgress]);

  const openUpload = useCallback(() => {
    setUploadOpen(true);
  }, []);

  const runCluster = useCallback(() => {
    if (isAllAnalyzed) {
      toast.info(`当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`);
      return;
    }
    // 唤醒侧拉研判控制台（不再跳转独立页面）
    setPipelineDrawerOpen(true);
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
        taskProgress,
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
      {/* 工单数据录入弹窗 (复用经典的 upload-dialog 样式，仅保留完成按钮) */}
      <UploadDialog
        isOpen={uploadOpen}
        onClose={() => setUploadOpen(false)}
        onDatabaseUpdated={refreshPages}
      />

      {/* 进度展示已迁移到 navbar 研判图标上的进度环；底部浮动胶囊下线 */}
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
