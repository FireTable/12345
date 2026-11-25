"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock,
  Download,
  ExternalLink,
  FileText,
  Loader2,
  PhoneCall,
  Play,
  Radar,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  XCircle,
} from "lucide-react";
import { useAuthRole } from "@/lib/auth/use-role";
import { useRegion } from "@/app/_components/civic/region-context";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import { SkBone, SkCard } from "@/app/_components/civic/skeletons";
import type { AgentTaskItem } from "@/app/_components/agent/voice-outreach-dialog";
import "@/app/_components/copilot/copilot-md.css";

const VoiceOutreachDialog = dynamic(
  () =>
    import("@/app/_components/agent/voice-outreach-dialog").then(
      (m) => m.VoiceOutreachDialog
    ),
  { ssr: false }
);

const AgentReportMarkdown = dynamic(
  async () => {
    const [{ default: ReactMarkdown }, { default: remarkGfm }] = await Promise.all([
      import("react-markdown"),
      import("remark-gfm"),
    ]);
    return function AgentReportMarkdown({ markdown }: { markdown: string }) {
      return (
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            h1: () => null,
            h2: ({ node: _node, ...props }) => <h3 {...props} />,
            h3: ({ node: _node, ...props }) => <h4 {...props} />,
            h4: ({ node: _node, ...props }) => <h5 {...props} />,
            h5: ({ node: _node, ...props }) => <h6 {...props} />,
            th: ({ node: _node, scope, ...props }) => (
              <th scope={scope ?? "col"} {...props} />
            ),
            table: ({ node: _node, ...props }) => (
              <div
                role="region"
                tabIndex={0}
                aria-label="专报数据表格"
                className="my-3 w-full max-w-full overflow-x-auto rounded-lg border border-slate-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
              >
                <table
                  className="!w-max min-w-full !my-0 [&_th]:whitespace-nowrap [&_th]:bg-slate-50 [&_th]:px-3 [&_th]:py-2 [&_td]:px-3 [&_td]:py-2 [&_td]:break-normal [&_td]:whitespace-nowrap [&_td]:tabular-nums [&_td:nth-child(2)]:whitespace-normal [&_td:nth-child(2)]:min-w-[160px] [&_td:nth-child(2)]:max-w-[300px] [&_td:last-child]:whitespace-normal [&_td:last-child]:min-w-[140px]"
                  {...props}
                />
              </div>
            ),
          }}
        >
          {markdown}
        </ReactMarkdown>
      );
    };
  },
  {
    ssr: false,
    loading: () => (
      <div className="py-6 text-xs text-slate-400">正在加载专报渲染引擎…</div>
    ),
  }
);

interface AgentSummary {
  total: number;
  pending: number;
  l1Count: number;
  l2Count: number;
  l3Count: number;
}

interface AgentReportItem {
  id: string;
  reportDate: string;
  title: string;
  markdown: string;
  statsJson?: string | Record<string, unknown> | null;
  createdAt: string;
}

type AutonomyFilter = "ALL" | "L1_AUTO" | "L2_APPROVAL" | "L3_BLOCKED";

const AUTONOMY_FILTER_LABELS: Record<Exclude<AutonomyFilter, "ALL">, string> = {
  L1_AUTO: "L1 自动执行",
  L2_APPROVAL: "L2 人工审批",
  L3_BLOCKED: "L3 红线熔断",
};

function getTaskAutonomyBucket(
  task: AgentTaskItem
): Exclude<AutonomyFilter, "ALL"> {
  if (
    task.autonomyLevel === "L3_BLOCKED" ||
    task.taskType === "REDLINE_BLOCK" ||
    task.status === "BLOCKED"
  ) {
    return "L3_BLOCKED";
  }
  if (task.autonomyLevel === "L1_AUTO") {
    return "L1_AUTO";
  }
  return "L2_APPROVAL";
}

const EMPTY_SUMMARY: AgentSummary = {
  total: 0,
  pending: 0,
  l1Count: 0,
  l2Count: 0,
  l3Count: 0,
};

const TASK_TYPE_LABELS: Record<string, string> = {
  MISSING_INFO: "缺失要素补全",
  SLA_OVERDUE: "超期督办催办",
  REOPEN_CALLBACK: "48h 满意度回访",
  REDLINE_BLOCK: "红线熔断阻断",
};

const TASK_STATUS_META: Record<
  string,
  { label: string; className: string }
> = {
  PENDING: {
    label: "待处理",
    className: "bg-amber-50 text-amber-700 border-amber-200",
  },
  APPROVED: {
    label: "已批准",
    className: "bg-blue-50 text-blue-700 border-blue-200",
  },
  EXECUTED: {
    label: "已执行",
    className: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  REJECTED: {
    label: "已驳回",
    className: "bg-slate-100 text-slate-600 border-slate-200",
  },
  BLOCKED: {
    label: "红线阻断",
    className: "bg-rose-50 text-rose-700 border-rose-200",
  },
};

function normalizeTasks(raw: unknown): AgentTaskItem[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((item) => {
    const t = item as Record<string, unknown>;
    let missingSlots: string[] = [];
    if (Array.isArray(t.missingSlots)) {
      missingSlots = t.missingSlots.map(String).filter(Boolean);
    } else if (typeof t.missingSlotsJson === "string") {
      try {
        const parsed = JSON.parse(t.missingSlotsJson);
        if (Array.isArray(parsed)) {
          missingSlots = parsed.map(String).filter(Boolean);
        }
      } catch {
        // ignore malformed json
      }
    }
    return {
      id: String(t.id || ""),
      taskType: String(t.taskType || "MISSING_INFO"),
      autonomyLevel: String(t.autonomyLevel || "L2_APPROVAL"),
      status: String(t.status || "PENDING"),
      targetType: String(t.targetType || "TICKET"),
      targetId: String(t.targetId || ""),
      targetTitle: String(t.targetTitle || "未命名事项"),
      channel: String(t.channel || "VOICE_SIM"),
      maskedContact: t.maskedContact ? String(t.maskedContact) : null,
      missingSlots,
      draftMessage: String(t.draftMessage || ""),
      suggestedOwner: t.suggestedOwner ? String(t.suggestedOwner) : null,
      reason: String(t.reason || ""),
      resultSummary: t.resultSummary ? String(t.resultSummary) : null,
      createdAt: String(t.createdAt || ""),
      updatedAt: String(t.updatedAt || ""),
    };
  });
}

function getTargetHref(task: AgentTaskItem): string {
  const id = encodeURIComponent(task.targetId);
  return task.targetType === "THEME" ? `/themes/${id}` : `/tickets/${id}`;
}

function formatTaskTime(iso: string | undefined | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) {
    return String(iso).slice(0, 16).replace("T", " ");
  }
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(d);
  const pick = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "00";
  const hour = String((Number.parseInt(pick("hour"), 10) || 0) % 24).padStart(2, "0");
  return `${pick("year")}-${pick("month")}-${pick("day")} ${hour}:${pick("minute")}`;
}

export default function AgentCenterPage() {
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const { activeRegion } = useRegion();

  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const regionId = activeRegion?.id;

  const [activeTab, setActiveTab] = useState<"queue" | "report">("queue");
  const queueTabRef = useRef<HTMLButtonElement>(null);
  const reportTabRef = useRef<HTMLButtonElement>(null);

  const [tasks, setTasks] = useState<AgentTaskItem[]>([]);
  const [summary, setSummary] = useState<AgentSummary>(EMPTY_SUMMARY);
  const [loadingTasks, setLoadingTasks] = useState(false);
  const [tasksError, setTasksError] = useState<string | null>(null);
  const [patrolling, setPatrolling] = useState(false);
  const [busyTaskId, setBusyTaskId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"ALL" | "ACTIVE" | "DONE">("ALL");
  const [autonomyFilter, setAutonomyFilter] = useState<AutonomyFilter>("ALL");

  const [reports, setReports] = useState<AgentReportItem[]>([]);
  const [selectedReportId, setSelectedReportId] = useState<string>("");
  const [loadingReport, setLoadingReport] = useState(false);
  const [reportsError, setReportsError] = useState<string | null>(null);
  const [generatingReport, setGeneratingReport] = useState(false);

  const [voiceDialogOpen, setVoiceDialogOpen] = useState(false);
  const [voiceMounted, setVoiceMounted] = useState(false);
  const [voiceTask, setVoiceTask] = useState<AgentTaskItem | null>(null);
  const [reportTabVisited, setReportTabVisited] = useState(false);

  useEffect(() => {
    if (typeof window !== "undefined" && window.location.hash === "#report") {
      setActiveTab("report");
      setReportTabVisited(true);
    }
  }, []);

  const tasksAbortRef = useRef<AbortController | null>(null);
  const tasksSeqRef = useRef(0);
  const reportsAbortRef = useRef<AbortController | null>(null);
  const reportsSeqRef = useRef(0);

  useEffect(() => {
    return () => {
      tasksSeqRef.current += 1;
      tasksAbortRef.current?.abort();
      reportsSeqRef.current += 1;
      reportsAbortRef.current?.abort();
    };
  }, []);

  const buildHeaders = useCallback(
    (withJson = false): Record<string, string> => {
      const headers: Record<string, string> = {};
      if (withJson) headers["Content-Type"] = "application/json";
      if (regionId) headers["x-region-id"] = regionId;
      return headers;
    },
    [regionId]
  );

  const fetchTasks = useCallback(async () => {
    if (!isAdmin) return;
    tasksAbortRef.current?.abort();
    const controller = new AbortController();
    tasksAbortRef.current = controller;
    const seq = ++tasksSeqRef.current;

    setLoadingTasks(true);
    setTasksError(null);
    try {
      const res = await fetch("/api/agent/tasks", {
        headers: buildHeaders(),
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted || seq !== tasksSeqRef.current) return;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `加载待办队列失败 (${res.status})`);
      }
      setTasks(normalizeTasks(json.tasks));
      if (json.summary && typeof json.summary === "object") {
        setSummary({
          total: Number(json.summary.total || 0),
          pending: Number(json.summary.pending || 0),
          l1Count: Number(json.summary.l1Count || 0),
          l2Count: Number(json.summary.l2Count || 0),
          l3Count: Number(json.summary.l3Count || 0),
        });
      }
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || seq !== tasksSeqRef.current) return;
      const msg = err instanceof Error ? err.message : "加载待办队列失败";
      setTasksError(msg);
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted && seq === tasksSeqRef.current) {
        setLoadingTasks(false);
      }
    }
  }, [isAdmin, buildHeaders]);

  const fetchReports = useCallback(async () => {
    if (!isAdmin) return;
    reportsAbortRef.current?.abort();
    const controller = new AbortController();
    reportsAbortRef.current = controller;
    const seq = ++reportsSeqRef.current;

    setLoadingReport(true);
    setReportsError(null);
    try {
      const res = await fetch("/api/agent/report", {
        headers: buildHeaders(),
        cache: "no-store",
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted || seq !== reportsSeqRef.current) return;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `加载研判专报失败 (${res.status})`);
      }
      const list: AgentReportItem[] = [];
      if (Array.isArray(json.reports)) {
        for (const r of json.reports) {
          if (r && r.id && r.markdown) list.push(r as AgentReportItem);
        }
      }
      if (json.report && json.report.id && !list.some((r) => r.id === json.report.id)) {
        list.unshift(json.report as AgentReportItem);
      }
      setReports(list);
      setSelectedReportId((prev) =>
        prev && list.some((r) => r.id === prev) ? prev : list[0]?.id || ""
      );
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || seq !== reportsSeqRef.current) return;
      const msg = err instanceof Error ? err.message : "加载研判专报失败";
      setReportsError(msg);
      toast.error(msg);
    } finally {
      if (!controller.signal.aborted && seq === reportsSeqRef.current) {
        setLoadingReport(false);
      }
    }
  }, [isAdmin, buildHeaders]);

  const loadAll = useCallback(async () => {
    await Promise.all([fetchTasks(), fetchReports()]);
  }, [fetchTasks, fetchReports]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    void loadAll();
  }, [isRolePending, isAdmin, regionId, loadAll]);

  const handlePatrol = async () => {
    if (!isAdmin || patrolling) return;
    setPatrolling(true);
    try {
      const res = await fetch("/api/agent/patrol", {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `巡检执行失败 (${res.status})`);
      }
      setTasks(normalizeTasks(json.tasks));
      if (json.summary && typeof json.summary === "object") {
        setSummary({
          total: Number(json.summary.total || 0),
          pending: Number(json.summary.pending || 0),
          l1Count: Number(json.summary.l1Count || 0),
          l2Count: Number(json.summary.l2Count || 0),
          l3Count: Number(json.summary.l3Count || 0),
        });
      }
      const created = Number(json.createdCount || 0);
      toast.success(
        created > 0
          ? `巡检完成，新发现 ${created} 条主动治理待办`
          : "巡检完成，待办队列已同步最新状态"
      );
      setActiveTab("queue");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "主动巡检失败");
    } finally {
      setPatrolling(false);
    }
  };

  const handleGenerateReport = async () => {
    if (!isAdmin || generatingReport) return;
    setGeneratingReport(true);
    try {
      const res = await fetch("/api/agent/report", {
        method: "POST",
        headers: buildHeaders(true),
        body: JSON.stringify({}),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.report) {
        throw new Error(json.error || `生成专报失败 (${res.status})`);
      }
      const newReport = json.report as AgentReportItem;
      setReports((prev) => [newReport, ...prev.filter((r) => r.id !== newReport.id)]);
      setSelectedReportId(newReport.id);
      setReportTabVisited(true);
      setActiveTab("report");
      toast.success(
        json.webhookSent
          ? "今日研判专报已生成并推送至协同 Webhook"
          : "今日研判专报已生成"
      );
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "生成今日专报失败");
    } finally {
      setGeneratingReport(false);
    }
  };

  const handleTaskAction = async (
    task: AgentTaskItem,
    action: "APPROVE" | "REJECT" | "EXECUTE"
  ) => {
    if (!isAdmin || busyTaskId) return;
    setBusyTaskId(task.id);
    try {
      const res = await fetch(`/api/agent/tasks/${encodeURIComponent(task.id)}`, {
        method: "PATCH",
        headers: buildHeaders(true),
        body: JSON.stringify({ action }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `任务操作失败 (${res.status})`);
      }
      const label =
        action === "APPROVE"
          ? "已批准执行"
          : action === "EXECUTE"
          ? json.webhookSent
            ? "已执行催办并触发外部 Webhook"
            : "已执行催办闭环"
          : "已驳回该任务";
      toast.success(label);
      await fetchTasks();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "任务更新失败");
    } finally {
      setBusyTaskId(null);
    }
  };

  const selectAutonomyFilter = (level: Exclude<AutonomyFilter, "ALL">) => {
    setAutonomyFilter((prev) => {
      const next = prev === level ? "ALL" : level;
      if (next !== "ALL") {
        setActiveTab("queue");
        if (statusFilter === "DONE") {
          setStatusFilter("ALL");
        }
      }
      return next;
    });
  };

  const filteredTasks = useMemo(() => {
    return tasks.filter((t) => {
      if (statusFilter === "ACTIVE") {
        if (
          t.status !== "PENDING" &&
          t.status !== "APPROVED" &&
          t.status !== "BLOCKED"
        ) {
          return false;
        }
      } else if (statusFilter === "DONE") {
        if (t.status !== "EXECUTED" && t.status !== "REJECTED") {
          return false;
        }
      }
      if (autonomyFilter !== "ALL") {
        return getTaskAutonomyBucket(t) === autonomyFilter;
      }
      return true;
    });
  }, [tasks, statusFilter, autonomyFilter]);

  const selectedReport = useMemo(() => {
    if (!reports.length) return null;
    return reports.find((r) => r.id === selectedReportId) || reports[0];
  }, [reports, selectedReportId]);

  const handleExportMarkdown = () => {
    if (!selectedReport) return;
    const blob = new Blob([selectedReport.markdown], {
      type: "text/markdown;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const safeDate = (selectedReport.reportDate || "today").replace(/[^\w-]/g, "");
    a.href = url;
    a.download = `agent-report-${safeDate}-${selectedReport.id}.md`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出 Markdown 研判专报");
  };

  const switchTab = (next: "queue" | "report", focusRef?: React.RefObject<HTMLButtonElement | null>) => {
    if (next === "report") {
      setReportTabVisited(true);
    }
    setActiveTab(next);
    const btn = focusRef?.current;
    if (btn) {
      btn.focus();
      btn.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  };

  const handleTabKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
      e.preventDefault();
      if (activeTab === "queue") {
        switchTab("report", reportTabRef);
      } else {
        switchTab("queue", queueTabRef);
      }
    } else if (e.key === "Home") {
      e.preventDefault();
      switchTab("queue", queueTabRef);
    } else if (e.key === "End") {
      e.preventDefault();
      switchTab("report", reportTabRef);
    }
  };

  // 1. 权限加载骨架
  if (isRolePending) {
    return (
      <div className="sk-page space-y-4" aria-busy="true" aria-label="校验管理员权限">
        <div className="page-hero">
          <div className="space-y-2 flex-1">
            <SkBone w="240px" h={24} />
            <SkBone w="360px" h={14} />
          </div>
          <div className="flex items-center gap-2">
            <SkBone w={96} h={34} />
            <SkBone w={110} h={34} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <SkCard title={false} height={74}>
            <SkBone w="60%" h={18} />
          </SkCard>
          <SkCard title={false} height={74}>
            <SkBone w="60%" h={18} />
          </SkCard>
          <SkCard title={false} height={74}>
            <SkBone w="60%" h={18} />
          </SkCard>
        </div>
        <SkCard height={280}>
          <div className="space-y-3">
            <SkBone w="85%" h={16} />
            <SkBone w="72%" h={14} />
            <SkBone w="90%" h={14} />
          </div>
        </SkCard>
      </div>
    );
  }

  // 2. 非管理员严格拦截（不渲染任何待办/专报数据或操作按钮）
  if (!isAdmin) {
    return (
      <div className="max-w-xl mx-auto py-8 sm:py-14">
        <div className="bg-white rounded-2xl border border-slate-200 shadow-xs p-6 sm:p-8 text-center space-y-4">
          <div className="w-12 h-12 rounded-2xl bg-amber-50 border border-amber-200 text-amber-600 flex items-center justify-center mx-auto">
            <ShieldAlert className="w-6 h-6" />
          </div>
          <div className="space-y-1.5">
            <h1 className="text-lg font-bold text-slate-900">
              仅限管理员操作 · 智能治理控制台受限
            </h1>
            <p className="text-xs sm:text-sm text-slate-500 leading-relaxed">
              当前账号不具备管理员权限。主动巡检、AI 语音外呼调度、红线熔断接管与每日研判专报仅对管理员开放。
            </p>
          </div>
          <div className="pt-2 flex items-center justify-center gap-3 flex-wrap">
            <Link href="/submit" className="btn btn--primary min-h-[44px] sm:min-h-[40px] text-xs px-4">
              <span>前往市民/买家投诉端 (/submit)</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // 3. 管理员主控制台
  return (
    <>
      {/* 紧凑 PageHeader */}
      <div className="page-hero flex-col lg:flex-row lg:items-center">
        <div className="min-w-0 flex-1">
          <h1 className="page-hero__title">智能治理 · 主动 Agent 中心</h1>
          <div className="page-hero__sub">
            {isEcommerce
              ? "全渠道电商客诉主动巡检 · 缺失 SKU/仓网语音补全 · 48h 挽回回访与食安合规红线熔断"
              : "12345 政务热线主动巡检闭环 · 缺失门牌要素外呼核实 · 48h 满意度回访与涉稳红线熔断接管"}
          </div>
        </div>

        <PageHeaderActions
          onRefresh={loadAll}
          refreshing={loadingTasks || loadingReport}
          className="flex-wrap"
        >
          <button
            type="button"
            disabled={patrolling}
            onClick={() => void handlePatrol()}
            className="btn btn--primary min-h-[44px] sm:min-h-[36px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            {patrolling ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
            ) : (
              <Radar className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            )}
            <span>{patrolling ? "巡检中…" : "立即巡检"}</span>
          </button>
          <button
            type="button"
            disabled={generatingReport}
            onClick={() => void handleGenerateReport()}
            className="btn btn--default min-h-[44px] sm:min-h-[36px] px-3.5 text-xs font-medium inline-flex items-center gap-1.5 whitespace-nowrap disabled:opacity-60"
          >
            {generatingReport ? (
              <Loader2 className="h-3.5 w-3.5 motion-safe:animate-spin shrink-0 text-blue-600" aria-hidden="true" />
            ) : (
              <Sparkles className="h-3.5 w-3.5 shrink-0 text-blue-600" aria-hidden="true" />
            )}
            <span>{generatingReport ? "生成中…" : "生成今日专报"}</span>
          </button>
        </PageHeaderActions>
      </div>

      {/* 3 个可交互分层筛选摘要卡片 */}
      <section
        aria-label="主动治理分层摘要"
        className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5"
      >
        {(
          [
            {
              level: "L1_AUTO" as const,
              title: "L1 自动执行",
              count: summary.l1Count,
              guidance: isEcommerce
                ? "点「一键催办执行」发送补全/催办"
                : "点「一键催办执行」完成内部催办",
              Icon: ShieldCheck,
              valueClass: "text-emerald-700",
              iconWrapClass: "bg-emerald-50 border-emerald-200/80 text-emerald-600",
              activeCardClass:
                "border-emerald-500 ring-2 ring-emerald-500/20 bg-emerald-50/35",
              activeTagClass:
                "bg-emerald-100 text-emerald-800 border-emerald-200",
            },
            {
              level: "L2_APPROVAL" as const,
              title: "L2 人工审批",
              count: summary.l2Count,
              guidance: "点「发起 AI 语音外呼」完成核实",
              Icon: PhoneCall,
              valueClass: "text-blue-700",
              iconWrapClass: "bg-blue-50 border-blue-200/80 text-blue-600",
              activeCardClass:
                "border-blue-500 ring-2 ring-blue-500/20 bg-blue-50/35",
              activeTagClass: "bg-blue-100 text-blue-800 border-blue-200",
            },
            {
              level: "L3_BLOCKED" as const,
              title: "L3 红线熔断",
              count: summary.l3Count,
              guidance: "点「人工核查接管」转入人工处置",
              Icon: AlertTriangle,
              valueClass: "text-rose-700",
              iconWrapClass: "bg-rose-50 border-rose-200/80 text-rose-600",
              activeCardClass:
                "border-rose-500 ring-2 ring-rose-500/20 bg-rose-50/35",
              activeTagClass: "bg-rose-100 text-rose-800 border-rose-200",
            },
          ] as const
        ).map((card) => {
          const isSelected = autonomyFilter === card.level;
          const Icon = card.Icon;
          return (
            <button
              key={card.level}
              type="button"
              aria-pressed={isSelected}
              onClick={() => selectAutonomyFilter(card.level)}
              className={`w-full text-left rounded-xl border px-4 py-3.5 shadow-2xs flex items-center justify-between gap-3 min-w-0 max-w-full cursor-pointer transition-[border-color,background-color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 ${
                isSelected
                  ? card.activeCardClass
                  : "bg-white border-slate-200/90 hover:border-slate-300 hover:bg-slate-50/50"
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="text-xs font-semibold text-slate-700">
                    {card.title}
                  </span>
                  {isSelected ? (
                    <span
                      className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-semibold border whitespace-nowrap ${card.activeTagClass}`}
                    >
                      筛选中
                    </span>
                  ) : null}
                </div>
                <div className={`text-xl font-bold tabular-nums mt-0.5 ${card.valueClass}`}>
                  {card.count}
                </div>
                <div className="text-[11px] text-slate-500 leading-snug mt-1 break-words">
                  {card.guidance}
                </div>
              </div>
              <div
                className={`w-9 h-9 rounded-lg border flex items-center justify-center shrink-0 ${card.iconWrapClass}`}
                aria-hidden="true"
              >
                <Icon className="w-4 h-4" />
              </div>
            </button>
          );
        })}
      </section>

      {/* 无障碍单行 Tabs */}
      <div
        role="tablist"
        aria-label="智能治理工作视图"
        onKeyDown={handleTabKeyDown}
        className="flex items-center gap-1 overflow-x-auto border-b border-slate-200 mb-4"
      >
        <button
          ref={queueTabRef}
          type="button"
          role="tab"
          id="tab-agent-queue"
          aria-selected={activeTab === "queue"}
          tabIndex={activeTab === "queue" ? 0 : -1}
          onClick={() => switchTab("queue")}
          className="relative inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors text-slate-600 hover:text-slate-900 aria-selected:text-blue-700 after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-[3px] after:border-transparent aria-selected:after:border-blue-600 min-h-[44px] sm:min-h-[42px]"
        >
          <Bot className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>主动待办队列</span>
          <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
            {summary.pending}/{summary.total}
          </span>
        </button>

        <button
          ref={reportTabRef}
          type="button"
          role="tab"
          id="tab-agent-report"
          aria-selected={activeTab === "report"}
          tabIndex={activeTab === "report" ? 0 : -1}
          onClick={() => switchTab("report")}
          className="relative inline-flex items-center gap-2 px-4 py-2.5 text-xs sm:text-sm font-semibold whitespace-nowrap shrink-0 cursor-pointer transition-colors text-slate-600 hover:text-slate-900 aria-selected:text-blue-700 after:content-[''] after:absolute after:inset-x-0 after:bottom-0 after:border-b-[3px] after:border-transparent aria-selected:after:border-blue-600 min-h-[44px] sm:min-h-[42px]"
        >
          <FileText className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>每日研判专报</span>
          {reports.length > 0 && (
            <span className="text-[11px] font-mono tabular-nums px-1.5 py-0.5 rounded bg-slate-100 text-slate-700">
              {reports.length}
            </span>
          )}
        </button>
      </div>

      {/* TabPanel 1: 主动待办队列 */}
      <div
        role="tabpanel"
        aria-labelledby="tab-agent-queue"
        hidden={activeTab !== "queue"}
        tabIndex={activeTab === "queue" ? 0 : undefined}
      >
        <div className="space-y-3">
          {/* 队列筛选头 */}
          <div className="flex items-center justify-between gap-2 flex-wrap min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap min-w-0 max-w-full">
              {(
                [
                  { key: "ALL", label: "全部待办" },
                  { key: "ACTIVE", label: "待处置 / 熔断" },
                  { key: "DONE", label: "已完结 / 驳回" },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  aria-pressed={statusFilter === opt.key}
                  onClick={() => setStatusFilter(opt.key)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-colors cursor-pointer min-h-[44px] sm:min-h-[36px] ${
                    statusFilter === opt.key
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  {opt.label}
                </button>
              ))}

              {autonomyFilter !== "ALL" && (
                <div className="inline-flex items-center gap-1.5 rounded-lg border border-blue-200 bg-blue-50/80 px-2.5 py-1 text-xs text-blue-800 max-w-full min-h-[44px] sm:min-h-[36px]">
                  <span className="font-semibold whitespace-nowrap">
                    分层：{AUTONOMY_FILTER_LABELS[autonomyFilter]}
                  </span>
                  <button
                    type="button"
                    onClick={() => setAutonomyFilter("ALL")}
                    className="inline-flex items-center gap-1 rounded px-2 py-1 text-xs font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer whitespace-nowrap min-h-[44px] sm:min-h-[36px]"
                  >
                    <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>清除筛选</span>
                  </button>
                </div>
              )}
            </div>
            <span className="text-xs text-slate-500 tabular-nums shrink-0">
              当前显示 {filteredTasks.length} 条任务
            </span>
          </div>

          {tasksError && (
            <div
              role="alert"
              className="bg-rose-50 rounded-xl border border-rose-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-xs text-rose-800"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                <span className="break-words">{tasksError}</span>
              </div>
              <button
                type="button"
                disabled={loadingTasks}
                onClick={() => void fetchTasks()}
                className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px] shrink-0"
              >
                重新加载
              </button>
            </div>
          )}

          {loadingTasks && tasks.length === 0 ? (
            <div className="space-y-3">
              <SkCard height={120}>
                <SkBone w="75%" h={14} />
              </SkCard>
              <SkCard height={120}>
                <SkBone w="65%" h={14} />
              </SkCard>
            </div>
          ) : filteredTasks.length === 0 ? (
            tasksError ? null : (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
              <div className="text-sm font-semibold text-slate-800">
                {tasks.length > 0
                  ? "当前筛选条件下暂无匹配任务"
                  : "暂无主动治理待办任务"}
              </div>
              <p className="text-xs text-slate-500">
                {tasks.length > 0
                  ? "可清除当前分层或状态筛选查看全部待办，或重新巡检同步最新状态。"
                  : "点击右上角「立即巡检」，AI 将扫描当前工作区的缺失要素工单、超期高危专题与待回访已办结事项。"}
              </p>
              {tasks.length > 0 ? (
                <button
                  type="button"
                  onClick={() => {
                    setAutonomyFilter("ALL");
                    setStatusFilter("ALL");
                  }}
                  className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px]"
                >
                  <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>清除筛选查看全部</span>
                </button>
              ) : (
                <button
                  type="button"
                  disabled={patrolling}
                  onClick={() => void handlePatrol()}
                  className="btn btn--primary text-xs min-h-[44px] sm:min-h-[36px]"
                >
                  <Radar className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>立即执行首次巡检</span>
                </button>
              )}
            </div>
            )
          ) : (
            <div className="space-y-3 pb-20">
              {filteredTasks.map((task) => {
                const isL3 =
                  task.autonomyLevel === "L3_BLOCKED" ||
                  task.taskType === "REDLINE_BLOCK" ||
                  task.status === "BLOCKED";
                const isL1 = task.autonomyLevel === "L1_AUTO";
                const isTerminal =
                  task.status === "EXECUTED" || task.status === "REJECTED";
                const isBusy = busyTaskId === task.id;
                const statusMeta =
                  TASK_STATUS_META[task.status] || TASK_STATUS_META.PENDING;
                const targetHref = getTargetHref(task);

                return (
                  <article
                    key={task.id}
                    className={`bg-white rounded-xl border p-4 shadow-2xs space-y-3 transition-colors min-w-0 max-w-full ${
                      isL3
                        ? "border-rose-200 bg-rose-50/15"
                        : "border-slate-200/90"
                    }`}
                  >
                    {/* 顶部标签行 */}
                    <div className="flex items-start justify-between gap-2 flex-wrap">
                      <div className="flex items-center gap-2 flex-wrap min-w-0 text-xs text-slate-600">
                        <span
                          className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-semibold border whitespace-nowrap ${
                            isL3
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : isL1
                              ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                              : "bg-blue-50 text-blue-700 border-blue-200"
                          }`}
                        >
                          {isL3
                            ? "L3 红线熔断"
                            : isL1
                            ? "L1 自动"
                            : "L2 待批"}
                        </span>

                        {!(isL3 && task.status === "BLOCKED") && (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-md text-[11px] font-medium border whitespace-nowrap ${statusMeta.className}`}
                          >
                            {statusMeta.label}
                          </span>
                        )}

                        {!isL3 && (
                          <span className="font-medium text-slate-700 whitespace-nowrap">
                            {TASK_TYPE_LABELS[task.taskType] || task.taskType}
                          </span>
                        )}

                        {task.maskedContact && (
                          <span className="font-mono text-slate-600 whitespace-nowrap">
                            · 脱敏联系：{task.maskedContact}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-xs text-slate-500 font-mono tabular-nums shrink-0">
                        <Clock className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{formatTaskTime(task.createdAt)}</span>
                      </div>
                    </div>

                    {/* 标题与目标对象 */}
                    <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2.5 sm:gap-3 min-w-0">
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap min-w-0">
                          <Link
                            href={targetHref}
                            className="text-sm font-bold text-slate-900 hover:text-blue-600 inline-flex items-center gap-1 min-w-0 max-w-full break-words min-h-[24px] py-0.5"
                          >
                            <span className="break-words">{task.targetTitle}</span>
                            <ExternalLink className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                          </Link>
                          <span className="text-xs font-mono text-slate-500 break-all">
                            {task.targetType} #{task.targetId}
                          </span>
                        </div>

                        {/* 缺失槽位或超期/红线原因 */}
                        <div className="flex items-center gap-1.5 flex-wrap text-xs text-slate-600 min-w-0">
                          {task.missingSlots.length > 0 && (
                            <span className="text-amber-800 font-medium">
                              缺失要素：{task.missingSlots.join("、")}
                            </span>
                          )}
                          {task.reason && (
                            <span className="text-xs text-slate-600 break-words">
                              {task.missingSlots.length > 0 ? "· " : ""}
                              {task.reason}
                            </span>
                          )}
                        </div>
                      </div>

                      {task.suggestedOwner && (
                        <div className="text-xs text-slate-600 bg-slate-50 rounded-md px-2.5 py-1 max-w-full sm:shrink-0 sm:max-w-[42%] min-w-0 break-words">
                          建议责任方：<b className="text-slate-800 break-words">{task.suggestedOwner}</b>
                        </div>
                      )}
                    </div>

                    {/* AI 拟定话术 */}
                    <div className="rounded-lg bg-slate-50/90 px-3 py-2.5 text-xs text-slate-700 leading-relaxed space-y-1">
                      <div className="text-xs font-semibold text-slate-600 flex items-center justify-between gap-2">
                        <span>AI 拟定外联/催办话术</span>
                        <span className="font-mono text-slate-500">
                          通道：{task.channel}
                        </span>
                      </div>
                      <p className="break-words text-slate-800">{task.draftMessage}</p>
                      {task.resultSummary && (
                        <p className="pt-1.5 mt-1.5 border-t border-slate-200/70 text-xs text-emerald-700 font-medium flex items-center gap-1">
                          <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                          <span>执行结果：{task.resultSummary}</span>
                        </p>
                      )}
                    </div>

                    {/* 动作按钮区 */}
                    <div className="flex items-center justify-between gap-2 flex-wrap pt-1">
                      {isL3 ? (
                        <>
                          <div className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-700 py-1">
                            <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            <span>命中安全红线 · 已强制禁用自动外联与语音外呼</span>
                          </div>
                          <div className="flex items-center gap-2 ml-auto flex-wrap">
                            <button
                              type="button"
                              disabled
                              className="btn btn--default text-xs opacity-50 cursor-not-allowed min-h-[44px] sm:min-h-[36px]"
                            >
                              自动外联已禁用
                            </button>
                            <Link
                              href={targetHref}
                              className="btn btn--primary text-xs min-h-[44px] sm:min-h-[36px]"
                            >
                              <span>人工核查接管</span>
                              <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                            </Link>
                          </div>
                        </>
                      ) : (
                        <>
                          <Link
                            href={targetHref}
                            className="text-xs text-slate-500 hover:text-blue-600 inline-flex items-center gap-1 min-h-[44px] sm:min-h-[36px] py-1.5 sm:py-0.5"
                          >
                            <span>查看关联对象详情</span>
                            <ExternalLink className="w-3 h-3" aria-hidden="true" />
                          </Link>

                          <div className="flex items-center gap-2 flex-wrap ml-auto">
                            {(task.taskType === "MISSING_INFO" ||
                              task.taskType === "REOPEN_CALLBACK") && (
                              <>
                                <button
                                  type="button"
                                  disabled={!isAdmin || isTerminal || isBusy}
                                  onClick={() => {
                                    setVoiceTask(task);
                                    setVoiceMounted(true);
                                    setVoiceDialogOpen(true);
                                  }}
                                  className="btn btn--primary text-xs min-h-[44px] sm:min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  <PhoneCall className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  <span>发起 AI 语音外呼</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={!isAdmin || isTerminal || isBusy}
                                  onClick={() => void handleTaskAction(task, "APPROVE")}
                                  className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px] text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                  {isBusy ? (
                                    <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                                  ) : (
                                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                  )}
                                  <span>批准执行</span>
                                </button>
                              </>
                            )}

                            {task.taskType === "SLA_OVERDUE" && (
                              <button
                                type="button"
                                disabled={!isAdmin || isTerminal || isBusy}
                                onClick={() => void handleTaskAction(task, "EXECUTE")}
                                className="btn btn--primary text-xs min-h-[44px] sm:min-h-[36px] disabled:opacity-50 disabled:cursor-not-allowed"
                              >
                                {isBusy ? (
                                  <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                                ) : (
                                  <Play className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                )}
                                <span>一键催办执行</span>
                              </button>
                            )}

                            <button
                              type="button"
                              disabled={!isAdmin || isTerminal || isBusy}
                              onClick={() => void handleTaskAction(task, "REJECT")}
                              className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px] text-slate-600 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                              <XCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                              <span>驳回</span>
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* TabPanel 2: 每日研判专报 */}
      <div
        role="tabpanel"
        aria-labelledby="tab-agent-report"
        hidden={activeTab !== "report"}
        tabIndex={activeTab === "report" ? 0 : undefined}
      >
        <div className="space-y-4 pb-20">
          {reportsError && (
            <div
              role="alert"
              className="bg-rose-50 rounded-xl border border-rose-200 px-4 py-3 flex items-center justify-between gap-3 flex-wrap text-xs text-rose-800"
            >
              <div className="flex items-center gap-2 min-w-0">
                <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" aria-hidden="true" />
                <span className="break-words">{reportsError}</span>
              </div>
              <button
                type="button"
                disabled={loadingReport}
                onClick={() => void fetchReports()}
                className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px] shrink-0"
              >
                重新加载
              </button>
            </div>
          )}

          {loadingReport && reports.length === 0 ? (
            <SkCard height={300}>
              <div className="space-y-3">
                <SkBone w="45%" h={18} />
                <SkBone w="92%" h={13} />
                <SkBone w="88%" h={13} />
                <SkBone w="76%" h={13} />
              </div>
            </SkCard>
          ) : !selectedReport ? (
            reportsError ? null : (
            <div className="bg-white rounded-xl border border-slate-200 p-8 text-center space-y-3">
              <div className="text-sm font-semibold text-slate-800">
                尚未生成每日研判专报
              </div>
              <p className="text-xs text-slate-500">
                系统将于每日 18:00 自动生成当日研判专报；也可点击下方按钮立即聚合本工作区最新多频专题、超期工单与假闭环明细生成 Markdown 专报。
              </p>
              <button
                type="button"
                disabled={generatingReport}
                onClick={() => void handleGenerateReport()}
                className="btn btn--primary text-xs min-h-[44px] sm:min-h-[36px]"
              >
                <Sparkles className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                <span>生成今日研判专报</span>
              </button>
            </div>
            )
          ) : (
            <div className="bg-white rounded-xl border border-slate-200/90 shadow-2xs overflow-hidden">
              {/* 专报头部工具栏 */}
              <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50/70 flex items-center justify-between gap-3 flex-wrap">
                <div className="min-w-0 space-y-0.5">
                  <h2 className="text-sm sm:text-base font-bold text-slate-900 break-words">
                    {selectedReport.title}
                  </h2>
                  <div className="text-xs text-slate-500 font-mono tabular-nums">
                    专报日期：{selectedReport.reportDate} · 生成于{" "}
                    {formatTaskTime(selectedReport.createdAt)} · 每日 18:00 自动生成
                  </div>
                </div>

                <div className="flex items-center gap-2 flex-wrap min-w-0 max-w-full">
                  {reports.length > 1 && (
                    <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 min-w-0 max-w-full">
                      <span className="whitespace-nowrap shrink-0">历史专报：</span>
                      <select
                        aria-label="选择历史研判专报"
                        value={selectedReport.id}
                        onChange={(e) => setSelectedReportId(e.target.value)}
                        className="filter-select h-9 text-xs max-w-[180px] sm:max-w-[240px] min-w-0"
                      >
                        {reports.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.reportDate} · {r.title}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <button
                    type="button"
                    onClick={handleExportMarkdown}
                    className="btn btn--default text-xs min-h-[44px] sm:min-h-[36px]"
                  >
                    <Download className="w-3.5 h-3.5 shrink-0" />
                    <span>导出 Markdown (.md)</span>
                  </button>
                </div>
              </div>

              {/* 专报 Markdown 渲染区 */}
              <div className="p-4 sm:p-6 min-w-0">
                <div className="copilot-md text-slate-800 max-w-none [&_h3]:text-[15px] [&_h4]:text-sm [&_p]:text-sm [&_li]:text-sm [&_table]:text-xs">
                  {(activeTab === "report" || reportTabVisited) && (
                    <AgentReportMarkdown markdown={selectedReport.markdown} />
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* AI 语音外呼与回访弹窗 */}
      {(voiceMounted || voiceDialogOpen) && (
        <VoiceOutreachDialog
          open={voiceDialogOpen}
          onOpenChange={(nextOpen) => {
            setVoiceDialogOpen(nextOpen);
            if (!nextOpen) {
              setVoiceTask(null);
            }
          }}
          task={voiceTask}
          domainType={isEcommerce ? "ECOMMERCE_CS" : "GOV_12345"}
          regionId={regionId}
          onCompleted={async () => {
            await fetchTasks();
          }}
        />
      )}
    </>
  );
}
