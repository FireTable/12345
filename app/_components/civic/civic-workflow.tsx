"use client";

import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import type { TaskProgress } from "@/lib/task-progress";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useRegion } from "./region-context";
import { useAuthRole } from "@/lib/auth/use-role";

const UploadDialog = dynamic(
  () => import("@/app/_components/dashboard/upload-dialog").then((m) => m.UploadDialog),
  { ssr: false }
);

const LightCopilot = dynamic(
  () => import("@/app/_components/copilot/light-copilot").then((m) => m.LightCopilot),
  { ssr: false }
);

const PipelineDrawer = dynamic(
  () => import("./pipeline-drawer").then((m) => m.PipelineDrawer),
  { ssr: false }
);

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
  const { activeRegion, isLoading: regionLoading } = useRegion();
  const { isAdmin } = useAuthRole();
  const isAdminRef = useRef(isAdmin);
  isAdminRef.current = isAdmin;

  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploadMounted, setUploadMounted] = useState(false);
  const [copilotOpen, setCopilotOpen] = useState(false);
  const [copilotMounted, setCopilotMounted] = useState(false);
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

  const statusAbortRef = useRef<AbortController | null>(null);
  const statusSeqRef = useRef(0);

  const loadTicketStatus = useCallback(async () => {
    statusAbortRef.current?.abort();
    const controller = new AbortController();
    statusAbortRef.current = controller;
    const seq = ++statusSeqRef.current;

    const regId = activeRegion?.id;
    const regParam = regId ? `?region=${encodeURIComponent(regId)}` : "";
    const headers: Record<string, string> = regId ? { "x-region-id": regId } : {};

    try {
      // ponytail: 未登录态先打公开端点拿到工单数,登录态再升级到 /api/overview。
      const pub = await fetch(`/api/public/overview${regParam}`, {
        headers,
        signal: controller.signal,
      })
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null);
      if (controller.signal.aborted || seq !== statusSeqRef.current) return;
      if (pub && typeof pub.totalWorkorders === "number") {
        setTicketStatus({
          total: pub.totalWorkorders,
          analyzed: pub.analyzedCount || 0,
          loaded: true,
        });
        return;
      }
      if (!isAdminRef.current) return;
      const res = await fetch(`/api/overview${regParam}`, {
        headers,
        signal: controller.signal,
      });
      if (!res.ok) return;
      const data = await res.json();
      if (controller.signal.aborted || seq !== statusSeqRef.current) return;
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
  }, [activeRegion?.id]);

  useEffect(() => {
    return () => {
      statusSeqRef.current += 1;
      statusAbortRef.current?.abort();
    };
  }, []);

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
      setUploadMounted(false);
      setCopilotOpen(false);
      setCopilotMounted(false);
      setPipelineDrawerOpenState(false);
    }
  }, [isAdmin]);

  React.useEffect(() => {
    if (pathname === "/login" || regionLoading) return;
    setTaskProgress(null);
    loadTicketStatus();
    const handleRefresh = () => {
      loadTicketStatus();
    };
    window.addEventListener("civic-data-refresh", handleRefresh);
    return () => {
      window.removeEventListener("civic-data-refresh", handleRefresh);
    };
  }, [pathname, regionLoading, activeRegion?.id, loadTicketStatus]);

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
    setUploadMounted(true);
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
    setCopilotMounted(true);
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
      {isAdmin && (uploadOpen || uploadMounted) ? (
        <UploadDialog
          isOpen={uploadOpen}
          onClose={() => setUploadOpen(false)}
          onDatabaseUpdated={refreshPages}
        />
      ) : null}
      {isAdmin && (copilotOpen || copilotMounted) ? (
        <LightCopilot
          isOpen={copilotOpen}
          onClose={() => setCopilotOpen(false)}
        />
      ) : null}
      {isAdmin ? <PipelineDrawer /> : null}
    </CivicWorkflowContext.Provider>
  );
}
