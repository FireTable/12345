"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadDialog } from "@/app/_components/dashboard/upload-dialog";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import type { TaskProgress } from "@/lib/task-progress";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useRegion } from "./region-context";
import { useAuthRole } from "@/lib/auth/use-role";

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
  const pathname = usePathname();
  const router = useRouter();
  const { activeRegion } = useRegion();
  const { isAdmin } = useAuthRole();

  const [uploadOpen, setUploadOpen] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [pipelineDrawerOpen, setPipelineDrawerOpenState] = useState(false);

  const setPipelineDrawerOpen: React.Dispatch<React.SetStateAction<boolean>> = useCallback(
    (action) => {
      if (!isAdmin) {
        setPipelineDrawerOpenState(false);
        return;
      }
      setPipelineDrawerOpenState(action);
    },
    [isAdmin]
  );

  const togglePipelineDrawer = useCallback(() => {
    if (!isAdmin) return;
    setPipelineDrawerOpenState((prev) => !prev);
  }, [isAdmin]);

  const [analyzing, setAnalyzing] = useState(false);
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
      if (!isAdmin) return;
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
  }, [isAdmin]);

  const [taskProgress, setTaskProgress] = useState<TaskProgress | null>(null);

  /**
   * SSE 推送：每帧 task-progress 直接驱动 taskProgress / analyzing 状态。
   * 完全替代原先每 3s / 12s 的 HTTP 轮询。
   */
  useCivicSse(pathname === "/login" || !isAdmin ? undefined : activeRegion?.id, (msg) => {
    if (msg.type === "task-progress") {
      const data = msg.taskProgress as TaskProgress | null;
      if (!data) return;
      setTaskProgress(data);
      if (data.status === "RUNNING") {
        setAnalyzing(true);
      } else if (data.status === "COMPLETED" || data.status === "FAILED") {
        setAnalyzing(false);
      }
      return;
    }
    if (msg.type === "civic-data-refresh") {
      loadTicketStatus();
      return;
    }
  });

  React.useEffect(() => {
    if (!isAdmin) {
      setUploadOpen(false);
      setCopilotOpen(false);
      setPipelineDrawerOpenState(false);
    }
  }, [isAdmin]);

  React.useEffect(() => {
    setTaskProgress(null);
    loadTicketStatus();
    const handleRefresh = () => {
      loadTicketStatus();
    };
    window.addEventListener("civic-data-refresh", handleRefresh);
    return () => {
      window.removeEventListener("civic-data-refresh", handleRefresh);
    };
  }, [activeRegion?.id, loadTicketStatus]);

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
    if (!isAdmin) return;
    setUploadOpen(true);
  }, [isAdmin]);

  const runCluster = useCallback(() => {
    if (!isAdmin) return;
    if (isAllAnalyzed) {
      toast.info(`当前 ${ticketStatus.total} 条工单已全部研判完毕，无需重复执行`);
      return;
    }
    setPipelineDrawerOpenState(true);
  }, [isAdmin, isAllAnalyzed, ticketStatus.total]);

  const openCopilot = useCallback(() => {
    if (!isAdmin) return;
    setCopilotOpen(true);
  }, [isAdmin]);

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
        copilotOpen: isAdmin ? copilotOpen : false,
        pipelineDrawerOpen: isAdmin ? pipelineDrawerOpen : false,
        setPipelineDrawerOpen,
        togglePipelineDrawer,
      }}
    >
      {children}
      {isAdmin ? (
        <>
          <UploadDialog
            isOpen={uploadOpen}
            onClose={() => setUploadOpen(false)}
            onDatabaseUpdated={refreshPages}
          />
          <LightCopilot
            isOpen={copilotOpen}
            onClose={() => setCopilotOpen(false)}
          />
        </>
      ) : null}
    </CivicWorkflowContext.Provider>
  );
}
