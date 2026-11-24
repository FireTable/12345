"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  CheckCircle2,
  Loader2,
  Mic,
  PhoneCall,
  PhoneIncoming,
  PhoneOff,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useAuthRole } from "@/lib/auth/use-role";
import { useRegion } from "@/app/_components/civic/region-context";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { appendRecognizedText, useStreamAsr } from "@/app/_hooks/use-stream-asr";
import { XiaochunStage, type XiaochunStageHandle } from "@/app/_components/agent/xiaochun-stage";

interface CitizenOutreachTurn {
  id: string;
  role: "agent" | "citizen";
  text: string;
  spokenText?: string;
  createdAt: string;
}

interface CitizenOutreachSession {
  id: string;
  regionId: string;
  taskId: string;
  taskType: string;
  targetType: string;
  targetId: string;
  targetTitle: string;
  domainType: "GOV_12345" | "ECOMMERCE_CS";
  status: "RINGING" | "IN_CALL" | "COMPLETED" | "REJECTED" | "CANCELLED";
  missingSlots: string[];
  turns: CitizenOutreachTurn[];
  completed: boolean;
  createdAt: string;
  answeredAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

interface QuickReplyOption {
  label: string;
  text: string;
  tone?: "default" | "danger" | "success";
}

function getQuickReplies(session: CitizenOutreachSession | null): QuickReplyOption[] {
  if (!session) return [];
  const isEcommerce = session.domainType === "ECOMMERCE_CS";

  if (session.taskType === "REOPEN_CALLBACK") {
    return isEcommerce
      ? [
          {
            label: "反馈未解决（申请重开复核）",
            text: "根本没解决，也没有退款或客服联系我们，问题还是照样存在",
            tone: "danger",
          },
          {
            label: "确认已妥善解决（满意）",
            text: "已整改解决，售后已补发并退款，表示满意",
            tone: "success",
          },
        ]
      : [
          {
            label: "反馈未整改（申请重开复核）",
            text: "根本没整改，昨晚还是照样吵，也没人联系我们",
            tone: "danger",
          },
          {
            label: "确认已整改解决（满意）",
            text: "已整改解决，表示满意",
            tone: "success",
          },
        ];
  }

  return isEcommerce
    ? [
        {
          label: "补充店铺 + SKU 编号",
          text: "天猫旗舰店买的SKU-GD2026-881冷链礼盒化冻发臭",
        },
        {
          label: "补充发货仓与破损情况",
          text: "华南冷链仓发出的订单，外箱压扁冷媒失效导致生鲜变质",
        },
      ]
    : session.regionId.includes("shunde")
      ? [
          {
            label: "补充镇街路名门牌与主体",
            text: "大良街道清晖路88号老广烧烤档，每天凌晨一点还在排油烟",
          },
          {
            label: "补充路段与施工信息",
            text: "容桂街道文华路12号临街工地，夜间23点后仍违规打桩施工",
          },
        ]
      : [
          {
            label: "补充路名门牌与涉事商铺",
            text: "天河南一路88号老广烧烤档，每天凌晨一点还在排油烟",
          },
          {
            label: "补充路段与噪音情况",
            text: "体育西横街12号临街工地，夜间23点后仍违规打桩施工",
          },
        ];
}

export function UserOutreachReceiver() {
  const { isCitizen, isAuthenticated, isPending: authPending } = useAuthRole();
  const { activeRegion } = useRegion();

  const dialogRef = useRef<HTMLDialogElement>(null);
  const stageRef = useRef<XiaochunStageHandle>(null);
  const answerButtonRef = useRef<HTMLButtonElement>(null);
  const micButtonRef = useRef<HTMLButtonElement>(null);
  const textInputRef = useRef<HTMLInputElement>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const lastSpokenTurnIdRef = useRef<string>("");
  const dismissedIdsRef = useRef<Set<string>>(new Set());
  const submittingRef = useRef(false);
  const lastCompositionEndAtRef = useRef<number | null>(null);
  const asrResetRef = useRef<() => void>(() => {});
  const asrActiveRef = useRef(false);

  const titleId = useId();
  const descId = useId();
  const inputId = useId();

  const [session, setSession] = useState<CitizenOutreachSession | null>(null);
  const currentSessionIdRef = useRef<string | null>(null);
  currentSessionIdRef.current = session?.id ?? null;
  const [textInput, setTextInput] = useState("");
  const [sending, setSending] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [caption, setCaption] = useState("");
  const [turnError, setTurnError] = useState<string | null>(null);

  const shouldListen = !authPending && isAuthenticated && isCitizen;

  const asr = useStreamAsr({
    onFinalResult: (finalText) => {
      const clean = finalText.trim();
      if (!clean) return;
      setTextInput((prev) => appendRecognizedText(prev, clean));
      textInputRef.current?.focus();
    },
  });

  asrResetRef.current = asr.reset;
  asrActiveRef.current =
    asr.isRecording || asr.status === "initializing" || asr.status === "downloading";

  const speakTurnIfNeeded = useCallback((nextSession: CitizenOutreachSession) => {
    if (nextSession.status !== "IN_CALL" && nextSession.status !== "COMPLETED") return;
    const lastAgent = [...nextSession.turns].reverse().find((t) => t.role === "agent");
    if (!lastAgent) return;
    if (lastSpokenTurnIdRef.current === lastAgent.id) return;
    lastSpokenTurnIdRef.current = lastAgent.id;
    const spoken = lastAgent.spokenText || lastAgent.text;
    setCaption(spoken);
    window.setTimeout(() => {
      stageRef.current?.activate();
      void stageRef.current?.say(spoken).catch(() => {});
    }, 100);
  }, []);

  const acceptIncomingSession = useCallback(
    (incoming: CitizenOutreachSession | null) => {
      if (!incoming) return;
      if (dismissedIdsRef.current.has(incoming.id)) return;
      if (currentSessionIdRef.current !== incoming.id) {
        lastSpokenTurnIdRef.current = "";
        setTextInput("");
        setTurnError(null);
      }
      currentSessionIdRef.current = incoming.id;
      setSession(incoming);
      speakTurnIfNeeded(incoming);
    },
    [speakTurnIfNeeded]
  );

  // 拉取当前挂起的来电（页面刚打开 / 断线重连兜底）
  const pollActiveSession = useCallback(async () => {
    if (!shouldListen) return;
    try {
      const res = await fetch("/api/outreach/active", { cache: "no-store" });
      if (!res.ok) return;
      const json = await res.json().catch(() => ({}));
      if (json.success && json.session) {
        acceptIncomingSession(json.session as CitizenOutreachSession);
      }
    } catch {
      /* ignore */
    }
  }, [shouldListen, acceptIncomingSession]);

  useEffect(() => {
    if (!shouldListen) {
      setSession(null);
      return;
    }
    void pollActiveSession();
    // 有活跃来电时 4s 同步一次详情；空闲时仅做 30s 兜底轮询（实时来电依赖 SSE 推送）
    const intervalMs =
      session && (session.status === "RINGING" || session.status === "IN_CALL") ? 4000 : 30000;
    const timer = window.setInterval(() => {
      if (session && (session.status === "RINGING" || session.status === "IN_CALL")) {
        void (async () => {
          try {
            const res = await fetch(
              `/api/outreach/sessions/${encodeURIComponent(session.id)}`,
              { cache: "no-store" }
            );
            if (res.status === 403 || res.status === 404) {
              // 会话已不属于当前用户或已被清理：关闭来电弹窗，避免卡死
              dismissedIdsRef.current.add(session.id);
              setSession((prev) => (prev?.id === session.id ? null : prev));
              return;
            }
            if (!res.ok) return;
            const json = await res.json().catch(() => ({}));
            if (json.success && json.session) {
              const updated = json.session as CitizenOutreachSession;
              setSession(updated);
              speakTurnIfNeeded(updated);
              if (updated.status === "CANCELLED" || updated.status === "REJECTED") {
                dismissedIdsRef.current.add(updated.id);
              }
            }
          } catch {
            /* ignore */
          }
        })();
      } else {
        void pollActiveSession();
      }
    }, intervalMs);
    return () => window.clearInterval(timer);
  }, [shouldListen, session?.id, session?.status, pollActiveSession, speakTurnIfNeeded]);

  // 实时 SSE 接收来电推送与状态更新
  useCivicSse(shouldListen ? activeRegion?.id : undefined, (msg) => {
    if (!shouldListen) return;
    if (msg.type === "outreach-incoming" && msg.session && typeof msg.session === "object") {
      acceptIncomingSession(msg.session as CitizenOutreachSession);
      return;
    }
    if (msg.type === "outreach-update" && msg.session && typeof msg.session === "object") {
      const updated = msg.session as CitizenOutreachSession;
      setSession((prev) => {
        if (!prev || prev.id !== updated.id) return prev;
        return updated;
      });
      speakTurnIfNeeded(updated);
      if (updated.status === "COMPLETED") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
      return;
    }
    if (msg.type === "outreach-dismissed") {
      dismissedIdsRef.current.add(msg.sessionId);
      setSession((prev) => (prev?.id === msg.sessionId ? null : prev));
    }
  });

  // 控制原生 <dialog> 打开/关闭与焦点管理
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    const visible =
      Boolean(session) &&
      session?.status !== "REJECTED" &&
      session?.status !== "CANCELLED";

    if (visible && session) {
      if (!dialogEl.open) {
        dialogEl.showModal();
        if (session.status === "RINGING") {
          answerButtonRef.current?.focus({ preventScroll: true });
        } else {
          micButtonRef.current?.focus({ preventScroll: true });
        }
      }
    } else if (dialogEl.open) {
      asr.stop();
      stageRef.current?.stop();
      dialogEl.close();
    }
  }, [session?.id, session?.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!session?.turns?.length) return;
    const prefersReducedMotion =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    transcriptEndRef.current?.scrollIntoView({
      behavior: prefersReducedMotion ? "auto" : "smooth",
      block: "nearest",
    });
  }, [session?.turns?.length, sending]);

  const performAction = useCallback(
    async (action: "ANSWER" | "REJECT" | "HANGUP") => {
      if (!session || actionBusy) return;
      setActionBusy(true);
      setTurnError(null);
      try {
        const res = await fetch(
          `/api/outreach/sessions/${encodeURIComponent(session.id)}/action`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !json.session) {
          throw new Error(json.error || `操作失败 (${res.status})`);
        }
        const updated = json.session as CitizenOutreachSession;
        if (action === "REJECT" || action === "HANGUP") {
          dismissedIdsRef.current.add(updated.id);
          asr.stop();
          stageRef.current?.stop();
          setSession(null);
          return;
        }
        setSession(updated);
        speakTurnIfNeeded(updated);
        window.setTimeout(() => micButtonRef.current?.focus({ preventScroll: true }), 80);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "操作失败";
        setTurnError(msg);
        toast.error(msg);
      } finally {
        setActionBusy(false);
      }
    },
    [session, actionBusy, asr, speakTurnIfNeeded]
  );

  const submitReply = useCallback(
    async (rawText: string) => {
      const transcript = rawText.trim();
      if (!transcript || !session || submittingRef.current) return;
      if (asrActiveRef.current) {
        asrResetRef.current();
      }

      submittingRef.current = true;
      setSending(true);
      setTurnError(null);
      setTextInput("");

      try {
        const res = await fetch(
          `/api/outreach/sessions/${encodeURIComponent(session.id)}/reply`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ transcript }),
          }
        );
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success || !json.session) {
          throw new Error(json.error || `提交应答失败 (${res.status})`);
        }
        const updated = json.session as CitizenOutreachSession;
        setSession(updated);
        speakTurnIfNeeded(updated);
        if (updated.completed) {
          window.dispatchEvent(new Event("civic-data-refresh"));
          toast.success("感谢您的配合，补充信息已同步至办理中心");
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "发送回答失败";
        // 失败时恢复用户输入，服务端已回滚该轮记录，可直接重发
        setTextInput((prev) => (prev.trim() ? prev : transcript));
        setTurnError(msg);
        toast.error(msg);
      } finally {
        submittingRef.current = false;
        setSending(false);
      }
    },
    [session, speakTurnIfNeeded]
  );

  const quickReplies = useMemo(() => getQuickReplies(session), [session]);

  if (!shouldListen) return null;

  const isEcommerce = session?.domainType === "ECOMMERCE_CS";
  const isRinging = session?.status === "RINGING";
  const isCompleted = session?.status === "COMPLETED" || Boolean(session?.completed);

  return (
    <>
      <style>{`
        .civic-user-outreach-dialog:modal {
          overscroll-behavior: contain;
        }
        .civic-user-outreach-dialog::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgba(15, 23, 42, 0.62);
          backdrop-filter: blur(5px);
        }
        .civic-user-outreach-dialog[open] {
          display: flex;
        }
      `}</style>
      <dialog
        ref={dialogRef}
        aria-labelledby={titleId}
        aria-describedby={descId}
        {...({ closedby: "closerequest" } as Record<string, string>)}
        onCancel={(e) => {
          if (isRinging) {
            e.preventDefault();
            void performAction("REJECT");
          } else if (session?.status === "IN_CALL") {
            e.preventDefault();
            void performAction("HANGUP");
          }
        }}
        onClose={() => {
          asr.stop();
          stageRef.current?.stop();
          if (session) {
            dismissedIdsRef.current.add(session.id);
          }
          setSession(null);
        }}
        className="civic-user-outreach-dialog w-[calc(100vw-1rem)] max-w-2xl max-h-[90dvh] m-auto flex-col rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl overflow-hidden"
      >
        {session ? (
          <div className="w-full flex flex-col max-h-[90dvh] min-h-0">
            {/* Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    {isRinging ? (
                      <PhoneIncoming className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    ) : (
                      <PhoneCall className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    )}
                    <span>
                      {isRinging
                        ? isEcommerce
                          ? "售后 AI 智能来电"
                          : "12345 AI 智能回访来电"
                        : isCompleted
                          ? "通话已完成"
                          : "正在通话中"}
                    </span>
                  </span>
                  <span className="text-[11px] text-slate-500">
                    {session.taskType === "REOPEN_CALLBACK"
                      ? "办理满意度回访核查"
                      : "工单缺失信息核实"}
                  </span>
                </div>
                <h1 id={titleId} className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
                  {session.targetTitle}
                </h1>
                <p id={descId} className="text-[11px] text-slate-600">
                  {isRinging
                    ? "工作人员发起智能核实通话，请接听后通过语音或文字说明情况"
                    : "请用语音或文字直接回答 AI 专员的问题，回答将实时同步给办理端"}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭通话弹窗"
                onClick={() => {
                  if (isRinging) {
                    void performAction("REJECT");
                  } else if (session.status === "IN_CALL") {
                    void performAction("HANGUP");
                  } else {
                    dialogRef.current?.close();
                  }
                }}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors shrink-0 cursor-pointer min-h-[44px] min-w-[44px] sm:min-h-[36px] sm:min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            {isRinging ? (
              <div className="p-5 sm:p-6 space-y-5 bg-white">
                <div className="rounded-xl border border-blue-200 bg-blue-50/70 p-4 space-y-2">
                  <div className="text-xs font-semibold text-blue-900 flex items-center gap-2">
                    <PhoneIncoming className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
                    <span>
                      {isEcommerce
                        ? "售后智能客服邀请您进行语音信息核实"
                        : "12345 民声智能专席来电邀您核实工单详情"}
                    </span>
                  </div>
                  <p className="text-xs text-slate-700 leading-relaxed">
                    {session.turns[0]?.text}
                  </p>
                  {session.missingSlots?.length > 0 && (
                    <div className="flex items-center gap-1.5 flex-wrap pt-1">
                      <span className="text-[11px] text-slate-600">需确认：</span>
                      {session.missingSlots.map((slot) => (
                        <span
                          key={slot}
                          className="px-2 py-0.5 rounded bg-white text-amber-800 border border-amber-200 text-[11px]"
                        >
                          {slot}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div className="flex items-center justify-end gap-3 flex-wrap">
                  <button
                    type="button"
                    disabled={actionBusy}
                    onClick={() => void performAction("REJECT")}
                    className="btn btn--default min-h-[44px] px-4 text-xs text-slate-700"
                  >
                    <PhoneOff className="w-4 h-4 shrink-0" aria-hidden="true" />
                    <span>暂不接听</span>
                  </button>
                  <button
                    ref={answerButtonRef}
                    type="button"
                    autoFocus
                    disabled={actionBusy}
                    onClick={() => void performAction("ANSWER")}
                    className="btn btn--primary min-h-[44px] px-5 text-xs"
                  >
                    {actionBusy ? (
                      <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                    ) : (
                      <PhoneCall className="w-4 h-4 shrink-0" aria-hidden="true" />
                    )}
                    <span>接听通话</span>
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
                  <div className="grid grid-cols-1 md:grid-cols-[210px_minmax(0,1fr)] gap-4 items-start">
                    {/* Left: 3D Xiaochun Stage + Voice Button */}
                    <div className="flex flex-col items-center gap-3 w-full">
                      <XiaochunStage
                        ref={stageRef}
                        outfit="xiaochun_civic"
                        lazy={false}
                        width="100%"
                        height={220}
                        scene="light"
                        title={isEcommerce ? "售后回访专员" : "12345 回访专员"}
                        subtitle={
                          session.taskType === "REOPEN_CALLBACK"
                            ? "48h 满意度回访"
                            : "要素核实通话"
                        }
                        caption={caption}
                      />

                      <button
                        ref={micButtonRef}
                        type="button"
                        disabled={sending || isCompleted}
                        aria-pressed={asr.isRecording}
                        onClick={() => {
                          if (
                            asr.isRecording ||
                            asr.status === "initializing" ||
                            asr.status === "downloading"
                          ) {
                            asr.stop();
                          } else {
                            stageRef.current?.stop();
                            void asr.start();
                          }
                        }}
                        className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
                          asr.isRecording
                            ? "bg-rose-600 text-white hover:bg-rose-700"
                            : "bg-blue-600 text-white hover:bg-blue-700"
                        }`}
                      >
                        {asr.isRecording ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                            <span>正在聆听，点击停止…</span>
                          </>
                        ) : asr.status === "initializing" || asr.status === "downloading" ? (
                          <>
                            <Loader2 className="w-4 h-4 animate-spin shrink-0" aria-hidden="true" />
                            <span>准备语音识别中…</span>
                          </>
                        ) : (
                          <>
                            <Mic className="w-4 h-4 shrink-0" aria-hidden="true" />
                            <span>{isCompleted ? "通话已完成" : "点击语音回答"}</span>
                          </>
                        )}
                      </button>

                      {asr.error && (
                        <p className="text-[11px] text-amber-700 w-full break-words">
                          语音提示：{asr.error}（可用下方文字输入或快捷回答）
                        </p>
                      )}
                    </div>

                    {/* Right: Transcript + User Input */}
                    <div className="min-w-0 flex flex-col gap-3">
                      <div
                        role="log"
                        aria-live="polite"
                        tabIndex={0}
                        aria-label="通话对话记录"
                        className="rounded-xl border border-slate-200 bg-slate-50/70 p-3 max-h-[240px] overflow-y-auto overscroll-contain space-y-2.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                      >
                        {session.turns.map((turn) => (
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
                                className={`text-[10px] mb-0.5 font-medium ${
                                  turn.role === "citizen" ? "text-blue-100" : "text-slate-500"
                                }`}
                              >
                                {turn.role === "agent" ? "AI 专员" : "我的回答"}
                              </div>
                              <div>{turn.text}</div>
                            </div>
                          </div>
                        ))}
                        {sending && (
                          <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                            <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" aria-hidden="true" />
                            <span>AI 专员正在记录并回复…</span>
                          </div>
                        )}
                        <div ref={transcriptEndRef} />
                      </div>

                      {!isCompleted && (
                        <>
                          <div className="space-y-1.5">
                            <div className="text-[11px] font-medium text-slate-600 flex items-center gap-1">
                              <Sparkles className="w-3 h-3 text-blue-600" aria-hidden="true" />
                              <span>快捷回答选项</span>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                              {quickReplies.map((qr) => (
                                <button
                                  key={qr.label}
                                  type="button"
                                  disabled={sending || isCompleted}
                                  onClick={() => void submitReply(qr.text)}
                                  className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-50 min-h-[44px] ${
                                    qr.tone === "danger"
                                      ? "bg-rose-50/70 border-rose-200 text-rose-800 hover:bg-rose-100/80"
                                      : qr.tone === "success"
                                        ? "bg-emerald-50/70 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80"
                                        : "bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50"
                                  }`}
                                >
                                  <div className="font-semibold text-[11px] mb-0.5">{qr.label}</div>
                                  <div className="text-[11px] opacity-90 line-clamp-2 break-words">
                                    “{qr.text}”
                                  </div>
                                </button>
                              ))}
                            </div>
                          </div>

                          <form
                            onSubmit={(e) => {
                              e.preventDefault();
                              const pendingText =
                                asr.isRecording && asr.interimText.trim()
                                  ? appendRecognizedText(textInput, asr.interimText)
                                  : textInput;
                              if (sending || isCompleted || !pendingText.trim()) return;
                              void submitReply(pendingText);
                            }}
                            className="space-y-1.5"
                          >
                            <label htmlFor={inputId} className="block text-[11px] font-medium text-slate-600">
                              我的语音 / 文字回答
                            </label>
                            <div className="flex items-center gap-2">
                              <input
                                ref={textInputRef}
                                id={inputId}
                                type="text"
                                value={textInput}
                                disabled={sending || isCompleted}
                                onChange={(e) => setTextInput(e.target.value)}
                                onCompositionEnd={(e) => {
                                  lastCompositionEndAtRef.current = e.timeStamp;
                                }}
                                onKeyDown={(e) => {
                                  if (e.key === "Enter") {
                                    e.preventDefault();
                                    const recentCompositionEnd =
                                      lastCompositionEndAtRef.current !== null &&
                                      Math.abs(e.timeStamp - lastCompositionEndAtRef.current) < 50;
                                    if (
                                      e.nativeEvent.isComposing ||
                                      e.keyCode === 229 ||
                                      recentCompositionEnd
                                    ) {
                                      return;
                                    }
                                    e.currentTarget.form?.requestSubmit();
                                  }
                                }}
                                placeholder={
                                  asr.isRecording
                                    ? asr.interimText
                                      ? `实时转写：${asr.interimText}`
                                      : "正在聆听，请直接说话…"
                                    : isEcommerce
                                      ? "请输入补充的商品/SKU、仓网或反馈…"
                                      : "请输入具体路名门牌、商铺名称或问题解决情况…"
                                }
                                className="flex-1 min-w-0 min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
                              />
                              <button
                                type="submit"
                                disabled={
                                  sending ||
                                  isCompleted ||
                                  !(textInput.trim() || (asr.isRecording && asr.interimText.trim()))
                                }
                                aria-label="发送回答"
                                className="btn btn--primary min-h-[44px] px-3.5 shrink-0 disabled:opacity-50"
                              >
                                <Send className="w-4 h-4 shrink-0" aria-hidden="true" />
                                <span className="text-xs">发送</span>
                              </button>
                            </div>
                          </form>
                        </>
                      )}

                      {isCompleted && (
                        <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-900 flex items-start gap-2">
                          <CheckCircle2 className="w-4 h-4 text-emerald-700 shrink-0 mt-0.5" aria-hidden="true" />
                          <div className="space-y-0.5">
                            <div className="font-semibold">本次外呼核实已完成</div>
                            <p className="text-[11px] text-emerald-800">
                              感谢配合，您的回答已同步回写至对应工单与处理专班。
                            </p>
                          </div>
                        </div>
                      )}

                      {turnError && (
                        <div
                          role="alert"
                          className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                        >
                          {turnError}
                        </div>
                      )}
                    </div>
                  </div>
                </div>

                {/* Footer */}
                <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50 flex items-center justify-between gap-2 shrink-0">
                  <span className="text-xs text-slate-600">
                    {isCompleted ? "您可以安全关闭此窗口" : "通话过程已做隐私保护"}
                  </span>
                  {isCompleted ? (
                    <button
                      type="button"
                      onClick={() => dialogRef.current?.close()}
                      className="btn btn--primary min-h-[44px] sm:min-h-[38px] text-xs"
                    >
                      完成并关闭
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={actionBusy}
                      onClick={() => void performAction("HANGUP")}
                      className="btn btn--default min-h-[44px] sm:min-h-[38px] text-xs text-rose-700 border-rose-200 hover:bg-rose-50"
                    >
                      <PhoneOff className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>挂断通话</span>
                    </button>
                  )}
                </div>
              </>
            )}
          </div>
        ) : null}
      </dialog>
    </>
  );
}
