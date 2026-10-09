"use client";

import React, { createContext, useCallback, useContext, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { UploadDialog } from "@/app/_components/dashboard/upload-dialog";
import { LightCopilot } from "@/app/_components/copilot/light-copilot";
import type { TaskProgress } from "@/lib/task-progress";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useRegion } from "./region-context";

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

  /**
   * SSE 推送：每帧 task-progress 直接驱动 taskProgress / analyzing 状态。
   * 完全替代原先每 3s / 12s 的 HTTP 轮询。
   */
  useCivicSse(activeRegion?.id, (msg) => {
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
      // 兜底：数据大屏写入触发，但 taskProgress 不需要再拉
      loadTicketStatus();
      return;
    }
    // pipeline-state-refresh 由 pipeline-* 组件自己订阅处理
  });

  React.useEffect(() => {
    // 切区时立刻清掉旧 taskProgress，等 WS 推新区第一帧
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
    // taskProgress 不再需要单独 HTTP 拉，WS 会推；此处保留 router.refresh
    // 让 server component（如 /themes、/tickets）服务端重渲
    if (typeof window !== "undefined") {
      window.dispatchEvent(new Event("civic-data-refresh"));
    }
  }, [router, loadTicketStatus]);

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

  const openCopilot = useCallback(() => {
    setCopilotOpen(true);
  }, []);

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
      />
    </CivicWorkflowContext.Provider>
  );
}
