"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  ExternalLink,
  Loader2,
  PhoneCall,
  PhoneOff,
  RefreshCw,
  ShieldCheck,
  UserCheck,
  X,
} from "lucide-react";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";

export interface AgentTaskItem {
  id: string;
  taskType: "MISSING_INFO" | "SLA_OVERDUE" | "REOPEN_CALLBACK" | "REDLINE_BLOCK" | string;
  autonomyLevel: "L1_AUTO" | "L2_APPROVAL" | "L3_BLOCKED" | string;
  status: "PENDING" | "APPROVED" | "EXECUTED" | "REJECTED" | "BLOCKED" | string;
  targetType: "TICKET" | "THEME" | string;
  targetId: string;
  targetTitle: string;
  channel: string;
  maskedContact: string | null;
  missingSlots: string[];
  draftMessage: string;
  suggestedOwner: string | null;
  reason: string;
  resultSummary: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface VoiceOutreachDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  task: AgentTaskItem | null;
  domainType?: "GOV_12345" | "ECOMMERCE_CS";
  regionId?: string;
  onCompleted?: (updatedTask?: AgentTaskItem) => void | Promise<void>;
}

interface AdminOutreachTurn {
  id: string;
  role: "agent" | "citizen";
  text: string;
  spokenText?: string;
  reasoning?: string;
  extractedPatch?: Record<string, string>;
  sentiment?: "NEGATIVE" | "POSITIVE" | "UNCLEAR";
  createdAt: string;
}

interface AdminOutreachSession {
  id: string;
  regionId: string;
  taskId: string;
  taskType: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  domainType: "GOV_12345" | "ECOMMERCE_CS";
  targetUserId: string | null;
  targetUserName: string | null;
  initiatedBy: string;
  status: "RINGING" | "IN_CALL" | "COMPLETED" | "REJECTED" | "CANCELLED";
  missingSlots: string[];
  reason: string;
  turns: AdminOutreachTurn[];
  extractedPatch: Record<string, string> | null;
  triggeredFakeClosure: boolean;
  reopenedThemeId: string | null;
  resultSummary: string | null;
  onlineTargetCount: number;
  processing: boolean;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

const PATCH_FIELD_LABELS: Record<string, string> = {
  address: "补全事发地址",
  canonicalSubject: "补全涉事主体",
  subject: "补全涉事主体",
  subdistrict: "补全所属镇街 / 渠道",
  category: "校准诉求分类",
  sku: "补全涉事 SKU",
  orderNo: "补全订单编号",
  eventType: "细分事件类型",
  satisfaction: "回访满意度结论",
  note: "核实备注",
};

const SENTIMENT_LABELS: Record<string, { label: string; cls: string }> = {
  NEGATIVE: {
    label: "负反馈 · 疑似假闭环",
    cls: "bg-rose-50 text-rose-700 border-rose-200",
  },
  POSITIVE: {
    label: "满意办结 · 闭环确认",
    cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
  },
  UNCLEAR: {
    label: "语义待明晰 · 继续追问",
    cls: "bg-amber-50 text-amber-800 border-amber-200",
  },
};

function formatTimeLabel(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString();
}

export function VoiceOutreachDialog({
  open,
  onOpenChange,
  task,
  domainType = "GOV_12345",
  regionId,
  onCompleted,
}: VoiceOutreachDialogProps) {
  const isEcommerce = domainType === "ECOMMERCE_CS";
  const dialogRef = useRef<HTMLDialogElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const pointerDownOnBackdropRef = useRef(false);
  const validBackdropClickRef = useRef(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const completedRef = useRef(false);
  const refreshedOnCloseRef = useRef(false);

  const titleId = useId();
  const descId = useId();

  const [session, setSession] = useState<AdminOutreachSession | null>(null);
  const [loading, setLoading] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const completed = session?.status === "COMPLETED" || task?.status === "EXECUTED";
  completedRef.current = Boolean(completed);

  const buildHeaders = useCallback(
    (withJson = false): Record<string, string> => {
      const h: Record<string, string> = {};
      if (withJson) h["Content-Type"] = "application/json";
      if (regionId) h["x-region-id"] = regionId;
      return h;
    },
    [regionId]
  );

  const startOrLoadSession = useCallback(
    async (forceNew = false, resumeOnly = false) => {
      if (!task) return;
      setLoading(true);
      setErrorMsg(null);
      try {
        const res = await fetch("/api/agent/outreach/sessions", {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({
            taskId: task.id,
            regionId,
            forceNew,
            resumeOnly,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !json.session) {
          const msg = json.error || `发起实时外呼失败 (${res.status})`;
          setErrorMsg(msg);
          return;
        }
        setSession(json.session as AdminOutreachSession);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "发起实时外呼失败";
        setErrorMsg(msg);
      } finally {
        setLoading(false);
      }
    },
    [task, regionId, buildHeaders]
  );

  // 打开弹窗时同步原生 modal 与发起/恢复双向通话会话
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    if (open && task) {
      if (!dialogEl.open) {
        dialogEl.showModal();
        closeButtonRef.current?.focus({ preventScroll: true });
      }
      refreshedOnCloseRef.current = false;
      setConfirming(false);
      setSession(null);
      // 打开监听窗只恢复最近一次会话；仅在从未外呼过时才首次发起，重新呼叫需点击「重新发起外呼」
      void startOrLoadSession(false, true);
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [open, task?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // 实时 SSE 监听用户端应答、通话状态与 AI 推理更新
  useCivicSse(open ? session?.regionId || regionId : undefined, (msg) => {
    if (!open || !session?.id) return;
    if (msg.type === "outreach-update" && msg.session && typeof msg.session === "object") {
      const incoming = msg.session as AdminOutreachSession;
      if (incoming.id !== session.id) return;
      const wasCompleted = session.status === "COMPLETED";
      setSession({
        ...incoming,
        processing: Boolean(msg.processing ?? incoming.processing),
      });
      if (!wasCompleted && incoming.status === "COMPLETED") {
        toast.success(
          incoming.triggeredFakeClosure
            ? "用户端回访识别负反馈，已触发假闭环核查重开！"
            : "用户端已完成语音/文本应答，要素已自动写回业务库"
        );
      }
    }
  });

  // 降级短轮询：确保跨进程或 SSE 重连窗口期间也能同步用户端实时回答
  useEffect(() => {
    if (!open || !session?.id) return;
    if (session.status !== "RINGING" && session.status !== "IN_CALL") return;

    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const res = await fetch(
            `/api/outreach/sessions/${encodeURIComponent(session.id)}`,
            { cache: "no-store", headers: buildHeaders(false) }
          );
          if (!res.ok) return;
          const json = await res.json().catch(() => ({}));
          if (json.success && json.session) {
            setSession((prev) => {
              const next = json.session as AdminOutreachSession;
              if (prev && prev.status !== "COMPLETED" && next.status === "COMPLETED") {
                toast.success(
                  next.triggeredFakeClosure
                    ? "用户端回访识别负反馈，已触发假闭环核查重开！"
                    : "用户端已完成应答，要素已自动写回业务库"
                );
              }
              return {
                ...next,
                processing: Boolean(prev?.processing && next.turns.length === prev.turns.length),
              };
            });
          }
        } catch {
          /* ignore */
        }
      })();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [open, session?.id, session?.status, buildHeaders]);

  useEffect(() => {
    if (!session?.turns?.length) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transcriptEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [session?.turns?.length, session?.processing]);

  const handleCloseCleanup = useCallback(() => {
    pointerDownOnBackdropRef.current = false;
    validBackdropClickRef.current = false;
    setConfirming(false);
    if (dialogRef.current) {
      dialogRef.current.returnValue = "";
    }
    onOpenChange(false);
    if (completedRef.current && !refreshedOnCloseRef.current && onCompleted) {
      refreshedOnCloseRef.current = true;
      void onCompleted(task || undefined);
    }
  }, [onOpenChange, onCompleted, task]);

  const isOutsidePanel = useCallback((clientX: number, clientY: number) => {
    const panel = panelRef.current;
    if (!panel) return false;
    const r = panel.getBoundingClientRect();
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom;
  }, []);

  const handleCancelCall = useCallback(async () => {
    if (!session || actionBusy) return;
    setActionBusy(true);
    try {
      const res = await fetch(
        `/api/outreach/sessions/${encodeURIComponent(session.id)}/action`,
        {
          method: "POST",
          headers: buildHeaders(true),
          body: JSON.stringify({ action: "CANCEL" }),
        }
      );
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success || !json.session) {
        throw new Error(json.error || `取消外呼失败 (${res.status})`);
      }
      setSession(json.session as AdminOutreachSession);
      toast.info("已取消本次 AI 外呼");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "取消外呼失败");
    } finally {
      setActionBusy(false);
    }
  }, [session, actionBusy, buildHeaders]);

  const handleConfirmAndRefresh = useCallback(() => {
    if (confirming) return;
    setConfirming(true);
    if (dialogRef.current?.open) {
      dialogRef.current.close("confirmed");
    } else {
      handleCloseCleanup();
    }
    if ((completed || completedRef.current) && !refreshedOnCloseRef.current && onCompleted) {
      refreshedOnCloseRef.current = true;
      void onCompleted(task || undefined);
    }
  }, [confirming, completed, onCompleted, task, handleCloseCleanup]);

  const patchEntries = useMemo(() => {
    if (!session?.extractedPatch) return [];
    return Object.entries(session.extractedPatch).filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim() !== ""
    );
  }, [session?.extractedPatch]);

  const reasoningSteps = useMemo(() => {
    return (session?.turns || []).filter((t) => Boolean(t.reasoning));
  }, [session?.turns]);

  const contactDisplay = task?.maskedContact?.trim() || "{{PHONE_NUMBER_1}}";
  const isErrorWithoutSession = Boolean(errorMsg && !session);

  const statusMeta = useMemo(() => {
    if (errorMsg && !session) {
      return {
        label: "无法发起外呼",
        cls: "bg-rose-50 text-rose-700 border-rose-200",
      };
    }
    const st = session?.status || (task?.status === "EXECUTED" ? "COMPLETED" : "RINGING");
    if (st === "RINGING") {
      return {
        label: "正在呼叫用户端（等待对方接听）",
        cls: "bg-amber-50 text-amber-800 border-amber-200",
      };
    }
    if (st === "IN_CALL") {
      return {
        label: session?.processing ? "对方已回答 · AI 正在推理…" : "通话中 · 实时监听用户端应答",
        cls: "bg-blue-50 text-blue-700 border-blue-200",
      };
    }
    if (st === "COMPLETED") {
      return {
        label: "外呼已完成 · 结果已写回数据库",
        cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
      };
    }
    if (st === "REJECTED") {
      return {
        label: "用户端暂未接听 / 已拒接",
        cls: "bg-rose-50 text-rose-700 border-rose-200",
      };
    }
    return {
      label: "通话已结束 / 已取消",
      cls: "bg-slate-100 text-slate-700 border-slate-200",
    };
  }, [errorMsg, session, task?.status]);

  return (
    <>
      <style>{`
        .civic-voice-dialog:modal {
          overscroll-behavior: contain;
        }
        .civic-voice-dialog::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgba(15, 23, 42, 0.56);
          backdrop-filter: blur(4px);
        }
        .civic-voice-dialog[open] {
          display: flex;
        }
      `}</style>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        {...({ closedby: "any" } as Record<string, string>)}
        onPointerDown={(e) => {
          validBackdropClickRef.current = false;
          if (e.pointerType === "mouse" && e.button !== 0) {
            pointerDownOnBackdropRef.current = false;
            return;
          }
          pointerDownOnBackdropRef.current = isOutsidePanel(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          const startedOutside = pointerDownOnBackdropRef.current;
          pointerDownOnBackdropRef.current = false;
          if (!startedOutside) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          if (!isOutsidePanel(e.clientX, e.clientY)) return;
          validBackdropClickRef.current = true;
        }}
        onClick={(e) => {
          const shouldClose = validBackdropClickRef.current;
          validBackdropClickRef.current = false;
          if (!shouldClose) return;
          if (!isOutsidePanel(e.clientX, e.clientY)) return;
          const supportsClosedBy =
            typeof HTMLDialogElement !== "undefined" &&
            "closedBy" in HTMLDialogElement.prototype;
          if (!supportsClosedBy) {
            dialogRef.current?.close();
          }
        }}
        onPointerCancel={() => {
          pointerDownOnBackdropRef.current = false;
          validBackdropClickRef.current = false;
        }}
        onClose={() => {
          handleCloseCleanup();
        }}
        className="civic-voice-dialog w-[calc(100vw-1rem)] max-w-4xl max-h-[90dvh] m-auto flex-col rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl overflow-hidden"
      >
        {task ? (
          <div ref={panelRef} data-voice-dialog-panel="true" className="w-full flex flex-col max-h-[90dvh] min-h-0">
            {/* Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50/90 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    <PhoneCall className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>
                      {task.taskType === "REOPEN_CALLBACK"
                        ? "管理端实时监听 · 48h 满意度回访"
                        : "管理端实时监听 · 缺失要素语音外呼"}
                    </span>
                  </span>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium border ${statusMeta.cls}`}>
                    {(session?.status === "RINGING" || session?.processing || loading) &&
                      !isErrorWithoutSession && (
                        <Loader2 className="w-3 h-3 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                      )}
                    <span>{statusMeta.label}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 truncate">
                    #{task.targetId}
                  </span>
                </div>
                <h1 id={titleId} className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
                  {task.targetTitle}
                </h1>
                <p id={descId} className="text-[11px] text-slate-600 leading-relaxed flex items-center gap-2 flex-wrap">
                  <span>
                    {isEcommerce ? "电商用户端实时直连外呼" : "市民用户端实时直连外呼"} · 气隙脱敏号码：
                  </span>
                  <code className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                    {contactDisplay}
                  </code>
                  <span className="inline-flex items-center gap-1 text-slate-600">
                    <UserCheck className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                    {session?.targetUserName
                      ? `对应用户端账号：${session.targetUserName}（在线窗口：${session.onlineTargetCount ?? 0}）`
                      : "未绑定用户端账号"}
                  </span>
                </p>
              </div>
              <button
                ref={closeButtonRef}
                type="button"
                autoFocus
                aria-label="关闭外呼监听窗口"
                onClick={() => dialogRef.current?.close()}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors shrink-0 cursor-pointer min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {/* Body: 只读实时监控（左：双方对话流；右：AI 实时推理与写库结果） */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5 space-y-3">
              {/* 只读说明与核实目标 */}
              <div className="rounded-xl border border-slate-200 bg-slate-50/80 px-3.5 py-2.5 text-xs space-y-1">
                <div className="flex items-center justify-between gap-2 flex-wrap">
                  <div className="font-semibold text-slate-800 flex items-center gap-1.5 flex-wrap">
                    <span>巡检核实目标：</span>
                    {task.missingSlots?.length > 0 ? (
                      task.missingSlots.map((slot) => (
                        <span
                          key={slot}
                          className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-800 border border-amber-200 text-[11px]"
                        >
                          缺失 {slot}
                        </span>
                      ))
                    ) : (
                      <span className="text-slate-600 font-normal">{task.reason}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-slate-500">
                    管理端仅实时展示对方回答与 AI 推理，请在用户端完成接听与应答
                  </span>
                </div>
                {task.missingSlots?.length > 0 && task.reason && (
                  <p className="text-[11px] text-slate-500">{task.reason}</p>
                )}
              </div>

              {isErrorWithoutSession && !loading ? (
                <div
                  role="alert"
                  className="rounded-xl border border-rose-200 bg-rose-50/80 p-4 sm:p-5 space-y-3"
                >
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" aria-hidden="true" />
                    <div className="min-w-0 space-y-1.5">
                      <h2 className="text-sm font-bold text-rose-900">
                        当前无法建立实时 AI 语音外呼
                      </h2>
                      <p className="text-[13px] text-rose-800 leading-relaxed break-words">
                        {errorMsg}
                      </p>
                      <p className="text-xs text-rose-700/90 leading-relaxed">
                        可能原因：该任务关联的用户端账号不在线、存在未结束的外呼会话，或当前任务状态已变更。您可以重试发起外呼，或关闭窗口后前往对应工单/专题详情页进行人工电话回访。
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap pt-1">
                    {task.status !== "EXECUTED" && (
                      <button
                        type="button"
                        disabled={loading}
                        onClick={() => void startOrLoadSession(false, false)}
                        className="btn btn--default min-h-[44px] sm:min-h-[38px] text-[13px] text-rose-800 border-rose-300 bg-white hover:bg-rose-50"
                      >
                        <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>重试发起外呼</span>
                      </button>
                    )}
                    <Link
                      href={
                        task.targetType === "THEME"
                          ? `/themes/${encodeURIComponent(task.targetId)}`
                          : `/tickets/${encodeURIComponent(task.targetId)}`
                      }
                      className="btn btn--default min-h-[44px] sm:min-h-[38px] text-[13px] text-slate-700 border-slate-300 bg-white hover:bg-slate-50"
                    >
                      <span>前往对象详情人工核查</span>
                      <ExternalLink className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    </Link>
                  </div>
                </div>
              ) : (
                <>
                  {errorMsg && (
                    <div
                      role="alert"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                    >
                      {errorMsg}
                    </div>
                  )}

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 items-start">
                    {/* 左列：用户端与 AI 外呼实时通话内容（只读展示） */}
                    <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                          <PhoneCall className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                          <span>实时通话记录（用户端应答同步）</span>
                        </h2>
                        <span className="text-[11px] font-mono text-slate-400">
                          {session?.turns?.length || 0} 轮
                        </span>
                      </div>

                      <div
                        role="log"
                        aria-live="polite"
                        tabIndex={0}
                        aria-label="外呼通话实时对话记录"
                        className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 h-[280px] sm:h-[320px] overflow-y-auto overscroll-contain space-y-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        {loading && !session ? (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-4 justify-center">
                            <Loader2 className="w-4 h-4 motion-safe:animate-spin text-blue-600" aria-hidden="true" />
                            <span>正在建立外呼会话并推送到用户端…</span>
                          </div>
                        ) : (
                          (session?.turns || []).map((turn) => (
                            <div
                              key={turn.id}
                              className={`flex flex-col ${
                                turn.role === "citizen" ? "items-end" : "items-start"
                              }`}
                            >
                              <div
                                className={`max-w-[90%] rounded-xl px-3 py-2 text-xs leading-relaxed break-words ${
                                  turn.role === "citizen"
                                    ? "bg-blue-600 text-white rounded-br-none"
                                    : "bg-white text-slate-800 border border-slate-200 rounded-bl-none shadow-2xs"
                                }`}
                              >
                                <div
                                  className={`text-[10px] mb-0.5 font-medium flex items-center justify-between gap-2 ${
                                    turn.role === "citizen" ? "text-blue-100" : "text-slate-500"
                                  }`}
                                >
                                  <span>
                                    {turn.role === "agent"
                                      ? "AI 外呼专员"
                                      : isEcommerce
                                        ? "用户端（买家实答）"
                                        : "用户端（来电人实答）"}
                                  </span>
                                  <span>{formatTimeLabel(turn.createdAt)}</span>
                                </div>
                                <div>{turn.text}</div>
                              </div>
                            </div>
                          ))
                        )}

                        {session?.status === "RINGING" && (
                          <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-[11px] text-amber-800 flex items-center gap-2">
                            <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                            <span>
                              来电已自动推送至用户端，正在等待对方点击「接听通话」…
                            </span>
                          </div>
                        )}

                        {session?.processing && (
                          <div className="flex items-center gap-2 text-xs text-blue-700 bg-blue-50/80 border border-blue-200 rounded-lg px-3 py-2">
                            <Loader2 className="w-3.5 h-3.5 motion-safe:animate-spin shrink-0" aria-hidden="true" />
                            <span>已收到用户端回答，AI 正在解析语义要素并生成回应…</span>
                          </div>
                        )}
                        <div ref={transcriptEndRef} />
                      </div>
                    </section>

                    {/* 右列：AI 实时推理过程 + 抽取落库结果 */}
                    <section className="rounded-xl border border-slate-200 bg-white p-3.5 space-y-3">
                      <h2 className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                        <Brain className="w-3.5 h-3.5 text-indigo-600" aria-hidden="true" />
                        <span>AI 实时推理与研判过程</span>
                      </h2>

                      <div className="space-y-2 max-h-[220px] overflow-y-auto overscroll-contain pr-0.5">
                        {reasoningSteps.length === 0 ? (
                          <p className="text-xs text-slate-500 py-3">
                            等待发起会话与用户端应答后，这里将实时展示每一轮的脱敏抽取、语义研判与处置依据。
                          </p>
                        ) : (
                          reasoningSteps.map((step, idx) => {
                            const sentimentMeta = step.sentiment
                              ? SENTIMENT_LABELS[step.sentiment]
                              : null;
                            return (
                              <div
                                key={`${step.id}-reason`}
                                className="rounded-lg bg-slate-50/90 px-3 py-2 text-xs space-y-1"
                              >
                                <div className="flex items-center justify-between gap-2 flex-wrap">
                                  <span className="font-semibold text-slate-700 text-[11px]">
                                    推理步骤 #{idx + 1}
                                  </span>
                                  <div className="flex items-center gap-1.5">
                                    {sentimentMeta && (
                                      <span
                                        className={`px-1.5 py-0.5 rounded border text-[10px] font-medium ${sentimentMeta.cls}`}
                                      >
                                        {sentimentMeta.label}
                                      </span>
                                    )}
                                    <span className="text-[10px] text-slate-400">
                                      {formatTimeLabel(step.createdAt)}
                                    </span>
                                  </div>
                                </div>
                                <p className="text-[11px] text-slate-700 whitespace-pre-line leading-relaxed">
                                  {step.reasoning}
                                </p>
                              </div>
                            );
                          })
                        )}
                      </div>

                      {session?.triggeredFakeClosure && (
                        <div className="rounded-xl bg-rose-50 p-3 text-xs text-rose-900 space-y-1.5">
                          <div className="flex items-center justify-between gap-2 flex-wrap">
                            <div className="flex items-center gap-1.5 font-bold text-rose-700">
                              <AlertTriangle className="w-4 h-4 shrink-0" />
                              <span>触发假闭环复核告警 · 已重开督办</span>
                            </div>
                            {session.reopenedThemeId && (
                              <Link
                                href={`/themes/${encodeURIComponent(session.reopenedThemeId)}`}
                                className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 underline"
                              >
                                <span>查看重开专题</span>
                                <ExternalLink className="w-3 h-3" />
                              </Link>
                            )}
                          </div>
                          <p className="text-[11px] text-rose-800 leading-relaxed">
                            用户端反馈问题仍未妥善解决，系统已将关联工单及专题标记为疑似假闭环（REOPENED）并写入处置审计日志。
                          </p>
                        </div>
                      )}

                      {patchEntries.length > 0 && (
                        <div className="rounded-xl bg-emerald-50/80 p-3 text-xs text-emerald-900 space-y-2">
                          <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                            <CheckCircle2 className="w-4 h-4 shrink-0" />
                            <span>AI 结构化抽取补全结果（已写回数据库）</span>
                          </div>
                          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                            {patchEntries.map(([key, val]) => (
                              <div
                                key={key}
                                className="rounded-lg bg-white/90 px-2.5 py-1.5"
                              >
                                <dt className="text-[10px] text-emerald-700">
                                  {PATCH_FIELD_LABELS[key] || key}
                                </dt>
                                <dd className="text-xs font-semibold text-slate-900 break-words mt-0.5">
                                  {String(val)}
                                </dd>
                              </div>
                            ))}
                          </dl>
                        </div>
                      )}
                    </section>
                  </div>
                </>
              )}
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between gap-2 flex-wrap shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-600">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                <span>
                  {isErrorWithoutSession
                    ? "实时外呼未建立 · 可重试或关闭后转为人工回访"
                    : completed
                      ? "用户端外呼结果已落库，可确认关闭并刷新待办队列"
                      : "全程双向实时同步 · 管理端只读监听，不替用户代答"}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-auto flex-wrap">
                {(session?.status === "RINGING" || session?.status === "IN_CALL") && (
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void handleCancelCall()}
                    className="btn btn--default min-h-[44px] sm:min-h-[38px] text-[13px] text-rose-700 border-rose-200 hover:bg-rose-50 disabled:opacity-50"
                  >
                    <PhoneOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>取消/挂断外呼</span>
                  </button>
                )}

                {(session?.status === "REJECTED" || session?.status === "CANCELLED") &&
                  task.status !== "EXECUTED" && (
                    <button
                      type="button"
                      disabled={loading}
                      onClick={() => void startOrLoadSession(true)}
                      className="btn btn--default min-h-[44px] sm:min-h-[38px] text-[13px] text-blue-700 border-blue-200 hover:bg-blue-50 disabled:opacity-50"
                    >
                      <RefreshCw className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>重新发起外呼</span>
                    </button>
                  )}

                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="btn btn--default min-h-[44px] sm:min-h-[38px] text-[13px]"
                >
                  {completed || isErrorWithoutSession ? "关闭" : "后台监听并退出"}
                </button>
                {completed && (
                  <button
                    type="button"
                    disabled={confirming}
                    onClick={handleConfirmAndRefresh}
                    className="btn btn--primary min-h-[44px] sm:min-h-[38px] text-[13px] disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    确认完成并刷新队列
                  </button>
                )}
              </div>
            </div>
          </div>
        ) : null}
      </dialog>
    </>
  );
}
