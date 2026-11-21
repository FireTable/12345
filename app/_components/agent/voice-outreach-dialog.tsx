"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  AlertTriangle,
  CheckCircle2,
  ExternalLink,
  Loader2,
  Mic,
  MicOff,
  PhoneCall,
  Send,
  ShieldCheck,
  Sparkles,
  Volume2,
  X,
} from "lucide-react";
import { useStreamAsr } from "@/app/_hooks/use-stream-asr";
import { XiaochunStage, type XiaochunStageHandle } from "@/app/_components/agent/xiaochun-stage";

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

interface ConversationTurn {
  id: string;
  role: "agent" | "citizen";
  text: string;
  time: string;
}

interface QuickReplyOption {
  label: string;
  text: string;
  tone?: "default" | "danger" | "success";
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

function getQuickReplies(
  task: AgentTaskItem | null,
  isEcommerce: boolean
): QuickReplyOption[] {
  if (!task) return [];

  if (task.taskType === "REOPEN_CALLBACK") {
    return isEcommerce
      ? [
          {
            label: "演示负反馈（未处理/假完结）",
            text: "根本没解决，也没有退款或客服联系我们，问题还是照样存在",
            tone: "danger",
          },
          {
            label: "演示正反馈（已妥善解决）",
            text: "已整改解决，售后已补发并退款，表示满意",
            tone: "success",
          },
        ]
      : [
          {
            label: "演示负反馈（未整改/复发）",
            text: "根本没整改，昨晚还是照样吵，也没人联系我们",
            tone: "danger",
          },
          {
            label: "演示正反馈（已整改满意）",
            text: "已整改解决，表示满意",
            tone: "success",
          },
        ];
  }

  return isEcommerce
    ? [
        {
          label: "演示补全（店铺 + SKU 信息）",
          text: "天猫旗舰店买的SKU-GD2026-881冷链礼盒化冻发臭",
        },
        {
          label: "演示补全（仓网 + 破损情况）",
          text: "华南冷链仓发出的订单，外箱压扁冷媒失效导致生鲜变质",
        },
      ]
    : [
        {
          label: "演示补全（路名门牌 + 主体）",
          text: "天河南一路88号老广烧烤档，每天凌晨一点还在排油烟",
        },
        {
          label: "演示补全（小区楼栋 + 噪音）",
          text: "体育西横街12号临街工地，夜间23点后仍违规打桩施工",
        },
      ];
}

/** 剥离气隙脱敏占位符，避免数字人播报与电影字幕念出 `{{PHONE_NUMBER_1}}`。 */
function toSpokenOutreachText(raw: string): string {
  return raw
    .replace(/[（(]\s*(?:来电号码|联系方式|联系电话|手机号|号码)?\s*[:：]?\s*\{\{[A-Z0-9_]+\}\}\s*[）)]/g, "")
    .replace(/\{\{[A-Z0-9_]+\}\}/g, "")
    .replace(/\s*([，,。！？?!；;])\s*/g, "$1")
    .replace(/([，,]){2,}/g, "$1")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/^[,，、\s]+/, "")
    .trim();
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
  const stageRef = useRef<XiaochunStageHandle>(null);
  const transcriptEndRef = useRef<HTMLDivElement>(null);
  const submittingRef = useRef(false);
  const completedRef = useRef(false);
  const refreshedOnCloseRef = useRef(false);

  const titleId = useId();
  const descId = useId();
  const inputId = useId();

  const [turns, setTurns] = useState<ConversationTurn[]>([]);
  const [textInput, setTextInput] = useState("");
  const [sending, setSending] = useState(false);
  const [caption, setCaption] = useState("");
  const [completed, setCompleted] = useState(false);
  const [extractedPatch, setExtractedPatch] = useState<Record<string, unknown> | null>(null);
  const [triggeredFakeClosure, setTriggeredFakeClosure] = useState(false);
  const [reopenedThemeId, setReopenedThemeId] = useState<string | null>(null);
  const [updatedTask, setUpdatedTask] = useState<AgentTaskItem | null>(null);
  const [turnError, setTurnError] = useState<string | null>(null);
  // 宽屏时 3D 形象放在左侧遮罩区域；窄屏收回弹窗内紧凑卡片
  const [stageOnBackdrop, setStageOnBackdrop] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setStageOnBackdrop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const quickReplies = useMemo(
    () => getQuickReplies(task, isEcommerce),
    [task, isEcommerce]
  );

  const submitTranscript = useCallback(
    async (rawText: string) => {
      const transcript = rawText.trim();
      if (!transcript || !task || submittingRef.current) return;

      submittingRef.current = true;
      setSending(true);
      setTurnError(null);

      const userTurnId = `u-${Date.now()}`;
      setTurns((prev) => [
        ...prev,
        {
          id: userTurnId,
          role: "citizen",
          text: transcript,
          time: new Date().toLocaleTimeString(),
        },
      ]);
      setTextInput("");

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };
        if (regionId) headers["x-region-id"] = regionId;

        const res = await fetch("/api/agent/outreach/voice-turn", {
          method: "POST",
          headers,
          body: JSON.stringify({
            taskId: task.id,
            transcript,
            turnIndex: turns.filter((t) => t.role === "citizen").length + 1,
          }),
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok || !json.success) {
          throw new Error(json.error || `外呼交互失败 (${res.status})`);
        }

        const aiReply =
          typeof json.reply === "string" && json.reply.trim()
            ? json.reply.trim()
            : "已记录您的反馈信息，感谢配合。";

        const spokenReply = toSpokenOutreachText(aiReply);
        setTurns((prev) => [
          ...prev,
          {
            id: `a-${Date.now()}`,
            role: "agent",
            text: aiReply,
            time: new Date().toLocaleTimeString(),
          },
        ]);
        setCaption(spokenReply);
        void stageRef.current?.say(spokenReply).catch(() => {});

        if (json.extractedPatch && typeof json.extractedPatch === "object") {
          setExtractedPatch(json.extractedPatch as Record<string, unknown>);
        }
        if (json.triggeredFakeClosure) {
          setTriggeredFakeClosure(true);
        }
        if (typeof json.reopenedThemeId === "string" && json.reopenedThemeId) {
          setReopenedThemeId(json.reopenedThemeId);
        }
        if (json.task) {
          setUpdatedTask(json.task as AgentTaskItem);
        }
        if (json.completed) {
          setCompleted(true);
          completedRef.current = true;
          toast.success(
            json.triggeredFakeClosure
              ? "回访识别负反馈，已触发假闭环核查重开！"
              : "AI 外呼要素核实已完成并写回业务库"
          );
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : "外呼交互请求失败";
        setTurnError(msg);
        toast.error(msg);
      } finally {
        submittingRef.current = false;
        setSending(false);
      }
    },
    [task, regionId, turns]
  );

  const asr = useStreamAsr({
    onFinalResult: (finalText) => {
      const clean = finalText.trim();
      if (!clean) return;
      if (submittingRef.current) {
        setTextInput((prev) => (prev ? `${prev} ${clean}` : clean));
        return;
      }
      void submitTranscript(clean);
    },
  });

  // 弹窗打开时初始化外呼话术并唤醒 3D 语音形象
  useEffect(() => {
    const dialogEl = dialogRef.current;
    if (!dialogEl) return;

    if (open && task) {
      if (!dialogEl.open) {
        dialogEl.showModal();
      }
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [open, task]);

  useEffect(() => {
    if (!open || !task) return;
    const greeting =
      task.draftMessage?.trim() ||
      (task.taskType === "REOPEN_CALLBACK"
        ? `您好，这里是${isEcommerce ? "售后质检回访专席" : "12345 政务回访专席"}，请问您此前反映的「${task.targetTitle}」是否已妥善解决？`
        : `您好，这里是${isEcommerce ? "售后信息核实专席" : "12345 政务热线智能专席"}，为尽快为您派单处置「${task.targetTitle}」，请补充具体地点或关键要素。`);

    const spokenGreeting = toSpokenOutreachText(greeting);
    setTurns([
      {
        id: `init-${task.id}`,
        role: "agent",
        text: greeting,
        time: new Date().toLocaleTimeString(),
      },
    ]);
    setTextInput("");
    setCaption(spokenGreeting);
    setCompleted(task.status === "EXECUTED");
    completedRef.current = task.status === "EXECUTED";
    refreshedOnCloseRef.current = false;
    setExtractedPatch(null);
    setTriggeredFakeClosure(false);
    setReopenedThemeId(null);
    setUpdatedTask(null);
    setTurnError(null);
    asr.reset();

    const timer = window.setTimeout(() => {
      stageRef.current?.activate();
      void stageRef.current?.say(spokenGreeting).catch(() => {});
    }, 120);

    return () => {
      window.clearTimeout(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, task?.id]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [turns.length]);

  const handleCloseCleanup = useCallback(() => {
    asr.stop();
    stageRef.current?.stop();
    if (dialogRef.current) {
      dialogRef.current.returnValue = "";
    }
    onOpenChange(false);
    if (completedRef.current && !refreshedOnCloseRef.current && onCompleted) {
      refreshedOnCloseRef.current = true;
      void onCompleted(updatedTask || task || undefined);
    }
  }, [asr, onOpenChange, onCompleted, updatedTask, task]);

  const handleConfirmAndRefresh = useCallback(async () => {
    const latest = updatedTask || task || undefined;
    if (completed && !refreshedOnCloseRef.current && onCompleted) {
      refreshedOnCloseRef.current = true;
      await onCompleted(latest);
    }
    if (dialogRef.current?.open) {
      dialogRef.current.close("confirmed");
    } else {
      handleCloseCleanup();
    }
  }, [completed, onCompleted, updatedTask, task, handleCloseCleanup]);

  const patchEntries = useMemo(() => {
    if (!extractedPatch) return [];
    return Object.entries(extractedPatch).filter(
      ([, v]) => v !== null && v !== undefined && String(v).trim() !== ""
    );
  }, [extractedPatch]);

  const contactDisplay = task?.maskedContact?.trim() || "{{PHONE_NUMBER_1}}";

  const micControlBlock = (
    <div className="w-full space-y-2">
      <button
        type="button"
        disabled={sending || completed}
        onClick={() => {
          if (asr.isRecording) {
            asr.stop();
          } else {
            void asr.start();
          }
        }}
        className={`w-full min-h-[44px] px-3 py-2 rounded-xl text-xs font-semibold inline-flex items-center justify-center gap-2 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed ${
          asr.isRecording
            ? "bg-rose-600 text-white hover:bg-rose-700 shadow-xs"
            : "bg-blue-600 text-white hover:bg-blue-700 shadow-xs"
        }`}
      >
        {asr.isRecording ? (
          <>
            <MicOff className="w-4 h-4 shrink-0" />
            <span>停止说话并发送</span>
          </>
        ) : (
          <>
            <Mic className="w-4 h-4 shrink-0" />
            <span>{completed ? "外呼已完成" : "点击开始语音应答"}</span>
          </>
        )}
      </button>

      {/* ASR Status & Audio Meter */}
      <div className="rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-2 text-[11px] text-slate-600 space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <span className="inline-flex items-center gap-1 font-medium text-slate-700 truncate">
            <Volume2 className="w-3.5 h-3.5 text-blue-600 shrink-0" />
            <span className="truncate">{asr.statusHint || "语音引擎就绪"}</span>
          </span>
          {asr.status === "downloading" && (
            <span className="font-mono tabular-nums text-blue-600 shrink-0">
              {Math.round(asr.downloadPercent)}%
            </span>
          )}
        </div>
        {asr.isRecording && (
          <div className="space-y-1">
            <div className="h-1.5 w-full rounded-full bg-slate-200 overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-100"
                style={{ width: `${Math.min(100, Math.max(6, Math.round(asr.audioLevel * 100)))}%` }}
              />
            </div>
            {asr.interimText && (
              <p className="text-[11px] text-blue-700 break-words">
                识别中：{asr.interimText}
              </p>
            )}
          </div>
        )}
        {asr.error && (
          <p className="text-[11px] text-amber-700 break-words">
            语音提示：{asr.error}（可使用快捷回复或文字输入）
          </p>
        )}
      </div>
    </div>
  );

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
        onClick={(e) => {
          if (e.target === e.currentTarget) {
            dialogRef.current?.close();
          }
        }}
        onClose={() => {
          handleCloseCleanup();
        }}
        className="civic-voice-dialog w-[calc(100vw-1rem)] max-w-3xl max-h-[90dvh] m-auto flex-col rounded-2xl border border-slate-200 bg-white p-0 text-slate-900 shadow-2xl overflow-hidden lg:w-screen lg:max-w-none lg:h-dvh lg:max-h-dvh lg:m-0 lg:flex-row lg:items-center lg:rounded-none lg:border-0 lg:bg-transparent lg:shadow-none lg:overflow-visible"
      >
        {task ? (
          <>
            {stageOnBackdrop && (
              <div className="flex-1 min-w-0 h-full relative pointer-events-none">
                <XiaochunStage
                  ref={stageRef}
                  variant="stage"
                  backdropTone="dark"
                  width="100%"
                  height="100%"
                  outfit="xiaochun_civic"
                  lazy={false}
                  title={isEcommerce ? "售后回访专员" : "12345 回访专员"}
                  caption={caption}
                />
              </div>
            )}

            <div className="w-full max-h-[90dvh] lg:w-[min(700px,54vw)] lg:mr-6 shrink-0 flex flex-col lg:rounded-2xl lg:border lg:border-slate-200 bg-white text-slate-900 lg:shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-4 sm:px-5 py-3.5 border-b border-slate-200 bg-slate-50/90 flex items-start justify-between gap-3 shrink-0">
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-[11px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                    <PhoneCall className="w-3.5 h-3.5 shrink-0" />
                    <span>{task.taskType === "REOPEN_CALLBACK" ? "48h 满意度回访" : "缺失要素语音外呼"}</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-500 truncate">
                    #{task.targetId}
                  </span>
                </div>
                <h2 id={titleId} className="text-sm sm:text-base font-bold text-slate-900 leading-snug break-words">
                  {task.targetTitle}
                </h2>
                <p id={descId} className="text-[11px] text-slate-500 leading-relaxed">
                  {isEcommerce
                    ? "模拟外呼通道（电商全渠道语音适配器 · 本地沙箱） · 气隙脱敏号码："
                    : "模拟外呼通道（12345 SIP 语音网关适配器 · 本地沙箱） · 气隙脱敏号码："}
                  <code className="font-mono text-slate-700 bg-slate-100 px-1.5 py-0.5 rounded border border-slate-200">
                    {contactDisplay}
                  </code>
                  {contactDisplay !== "{{PHONE_NUMBER_1}}" && (
                    <span className="ml-1 text-slate-400">(气隙占位符 {"{{PHONE_NUMBER_1}}"})</span>
                  )}
                </p>
              </div>
              <button
                type="button"
                aria-label="关闭语音外呼弹窗"
                onClick={() => dialogRef.current?.close()}
                className="p-2 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 transition-colors shrink-0 cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-4 sm:p-5">
              <div className={stageOnBackdrop ? "flex flex-col gap-3" : "grid grid-cols-1 md:grid-cols-[232px_minmax(0,1fr)] gap-4 items-start"}>
                {/* Narrow/Mobile: Xiaochun 3D Card & Mic */}
                {!stageOnBackdrop && (
                  <div className="flex flex-col items-center gap-3 min-w-0 w-full">
                    <XiaochunStage
                      ref={stageRef}
                      outfit="xiaochun_civic"
                      lazy={false}
                      width="100%"
                      height={240}
                      scene="light"
                      title={isEcommerce ? "售后回访专员" : "12345 回访专员"}
                      subtitle={task.taskType === "REOPEN_CALLBACK" ? "48h 满意度回访" : "要素核实外呼"}
                      caption={caption}
                    />
                    {micControlBlock}
                  </div>
                )}

                {/* Call Workspace: Context, Mic (wide), Transcript, Quick Replies, Input, Extraction Result */}
                <div className="min-w-0 flex flex-col gap-3">
                  {stageOnBackdrop && micControlBlock}
                  {/* Missing Slots / Reason Context */}
                  {(task.missingSlots?.length > 0 || task.reason) && (
                    <div className="rounded-xl border border-slate-200 bg-slate-50/70 px-3 py-2.5 text-xs space-y-1">
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
                      {task.missingSlots?.length > 0 && task.reason && (
                        <p className="text-[11px] text-slate-500">{task.reason}</p>
                      )}
                    </div>
                  )}

                  {/* Conversation History */}
                  <div
                    className="rounded-xl border border-slate-200 bg-slate-50/60 p-3 max-h-[220px] sm:max-h-[250px] overflow-y-auto overscroll-contain space-y-2.5"
                    aria-label="外呼对话记录"
                  >
                    {turns.map((turn) => (
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
                          <div className="text-[10px] opacity-75 mb-0.5 font-medium">
                            {turn.role === "agent"
                              ? "AI 外呼专员"
                              : isEcommerce
                              ? "买家应答"
                              : "来电人应答"}
                          </div>
                          <div>{turn.text}</div>
                        </div>
                      </div>
                    ))}
                    {sending && (
                      <div className="flex items-center gap-2 text-xs text-slate-500 py-1">
                        <Loader2 className="w-3.5 h-3.5 animate-spin text-blue-600" />
                        <span>AI 正在解析语义要素并生成回应…</span>
                      </div>
                    )}
                    <div ref={transcriptEndRef} />
                  </div>

                  {/* 2 Dynamic Demo Quick-Reply Buttons */}
                  <div className="space-y-1.5">
                    <div className="text-[11px] font-medium text-slate-500 flex items-center gap-1">
                      <Sparkles className="w-3 h-3 text-blue-600" />
                      <span>现场演示快捷回复（模拟来电人/买家语音输入）</span>
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {quickReplies.map((qr) => (
                        <button
                          key={qr.label}
                          type="button"
                          disabled={sending || completed}
                          onClick={() => void submitTranscript(qr.text)}
                          className={`text-left px-3 py-2 rounded-lg border text-xs transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed min-h-[44px] ${
                            qr.tone === "danger"
                              ? "bg-rose-50/70 border-rose-200 text-rose-800 hover:bg-rose-100/80"
                              : qr.tone === "success"
                              ? "bg-emerald-50/70 border-emerald-200 text-emerald-800 hover:bg-emerald-100/80"
                              : "bg-white border-slate-200 text-slate-700 hover:border-blue-300 hover:bg-blue-50/50"
                          }`}
                        >
                          <div className="font-semibold text-[11px] mb-0.5">{qr.label}</div>
                          <div className="text-[11px] opacity-85 line-clamp-2 break-words">
                            “{qr.text}”
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Text Fallback Input (IME-safe) */}
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      void submitTranscript(textInput);
                    }}
                    className="space-y-1.5"
                  >
                    <label
                      htmlFor={inputId}
                      className="block text-[11px] font-medium text-slate-600"
                    >
                      文字兜底应答（支持中文输入法安全回车）
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        id={inputId}
                        type="text"
                        autoFocus
                        value={textInput}
                        disabled={sending || completed}
                        onChange={(e) => setTextInput(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            if (e.nativeEvent.isComposing || e.keyCode === 229) {
                              e.preventDefault();
                              return;
                            }
                            e.preventDefault();
                            void submitTranscript(textInput);
                          }
                        }}
                        placeholder={
                          completed
                            ? "本次外呼核实已完结"
                            : isEcommerce
                            ? "输入补充的店铺/SKU或满意度反馈…"
                            : "输入补充的门牌地址/主体或满意度反馈…"
                        }
                        className="flex-1 min-w-0 min-h-[44px] px-3 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-500 disabled:bg-slate-50"
                      />
                      <button
                        type="submit"
                        disabled={sending || completed || !textInput.trim()}
                        aria-label="发送文本应答"
                        className="btn btn--primary min-h-[44px] px-3.5 shrink-0 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        <Send className="w-4 h-4 shrink-0" />
                        <span className="text-xs">发送</span>
                      </button>
                    </div>
                  </form>

                  {turnError && (
                    <div
                      role="alert"
                      className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700"
                    >
                      {turnError}
                    </div>
                  )}

                  {/* Extracted Patch & Fake Closure Alert */}
                  {triggeredFakeClosure && (
                    <div className="rounded-xl border border-rose-200 bg-rose-50 p-3 text-xs text-rose-900 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div className="flex items-center gap-1.5 font-bold text-rose-700">
                          <AlertTriangle className="w-4 h-4 shrink-0" />
                          <span>触发假闭环复核告警 · 已重开督办</span>
                        </div>
                        {reopenedThemeId && (
                          <Link
                            href={`/themes/${encodeURIComponent(reopenedThemeId)}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-rose-700 underline"
                          >
                            <span>查看重开专题</span>
                            <ExternalLink className="w-3 h-3" />
                          </Link>
                        )}
                      </div>
                      <p className="text-[11px] text-rose-800 leading-relaxed">
                        回访识别诉求人仍未得到妥善解决，系统已将该工单及关联专题标记为疑似假闭环（REOPENED）并写入处置日志。
                      </p>
                    </div>
                  )}

                  {patchEntries.length > 0 && (
                    <div className="rounded-xl border border-emerald-200 bg-emerald-50/80 p-3 text-xs text-emerald-900 space-y-2">
                      <div className="flex items-center gap-1.5 font-bold text-emerald-800">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        <span>AI 结构化抽取补全结果（已写回数据库）</span>
                      </div>
                      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                        {patchEntries.map(([key, val]) => (
                          <div
                            key={key}
                            className="rounded-lg bg-white/90 border border-emerald-200/70 px-2.5 py-1.5"
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
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="px-4 sm:px-5 py-3 border-t border-slate-200 bg-slate-50/90 flex items-center justify-between gap-2 flex-wrap shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-slate-500">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0" />
                <span>
                  {completed
                    ? "外呼结果已落库，可确认关闭并刷新待办队列"
                    : "全程本地脱敏解析，支持语音与文本双通道"}
                </span>
              </div>
              <div className="flex items-center gap-2 ml-auto">
                <button
                  type="button"
                  onClick={() => dialogRef.current?.close()}
                  className="btn btn--default min-h-[38px] text-xs"
                >
                  {completed ? "关闭" : "暂存退出"}
                </button>
                {completed && (
                  <button
                    type="button"
                    onClick={() => void handleConfirmAndRefresh()}
                    className="btn btn--primary min-h-[38px] text-xs"
                  >
                    确认完成并刷新队列
                  </button>
                )}
              </div>
            </div>
            </div>
          </>
        ) : null}
      </dialog>
    </>
  );
}
