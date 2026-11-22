"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { toast } from "sonner";
import {
  X,
  Send,
  Sparkles,
  BotMessageSquare,
  Brain,
  CheckCircle2,
  AlertCircle,
  ExternalLink,
  Play,
  Loader2,
  Mic,
  MicOff,
  Volume2,
  RotateCcw,
} from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/app/_components/ui/tooltip";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { appendRecognizedText, useStreamAsr } from "@/app/_hooks/use-stream-asr";
import { XiaochunStage, type XiaochunStageHandle } from "@/app/_components/agent/xiaochun-stage";
import { copilotGreeting, splitCopilotStream } from "@/lib/copilot-protocol";
import "./copilot-md.css";

interface CivicActionProposal {
  themeId: string;
  themeTitle?: string;
  action: "DISPATCH" | "ESCALATE" | "RESOLVE" | "REOPEN" | "ADVANCE" | string;
  owner?: string;
  eta?: string;
  note?: string;
}

const COPILOT_ACTION_LABELS: Record<string, string> = {
  DISPATCH: "采纳并派单",
  ESCALATE: "升级督办",
  RESOLVE: "办结归档",
  REOPEN: "重开督办",
  ADVANCE: "推进阶段",
};

function extractCivicActions(
  raw: string,
  streaming: boolean
): {
  cleanText: string;
  actions: CivicActionProposal[];
  pendingBlock: boolean;
} {
  const actions: CivicActionProposal[] = [];
  let text = raw.replace(/```civic-action\s*\n([\s\S]*?)```/gi, (full, jsonBody: string) => {
    try {
      const parsed = JSON.parse(jsonBody.trim()) as Partial<CivicActionProposal>;
      if (parsed && typeof parsed.themeId === "string" && typeof parsed.action === "string") {
        actions.push({
          themeId: parsed.themeId,
          themeTitle: typeof parsed.themeTitle === "string" ? parsed.themeTitle : undefined,
          action: parsed.action.toUpperCase(),
          owner: typeof parsed.owner === "string" ? parsed.owner : undefined,
          eta: typeof parsed.eta === "string" ? parsed.eta : undefined,
          note: typeof parsed.note === "string" ? parsed.note : undefined,
        });
        return "";
      }
    } catch {
      // Keep original block if JSON cannot be parsed
    }
    return full;
  });

  let pendingBlock = false;
  if (streaming) {
    const unclosedIdx = text.search(/```civic-action\b/i);
    if (unclosedIdx !== -1) {
      pendingBlock = true;
      text = text.slice(0, unclosedIdx);
    }
  }

  return {
    cleanText: text.replace(/\n{3,}/g, "\n\n").trim(),
    actions,
    pendingBlock,
  };
}

interface LightCopilotProps {
  isOpen: boolean;
  onClose: () => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  // ponytail: 模型 ``...`` 块里的思考过程独立存,渲染时折叠在答案上方,不污染正文区。
  think?: string;
  status?: string;
}

export const LightCopilot: React.FC<LightCopilotProps> = ({
  isOpen,
  onClose,
}) => {
  const titleId = useId();
  const inputId = useId();
  const prefersReducedMotion = useReducedMotion();
  const dialogRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);
  const openerWasFabRef = useRef(false);
  const wasOpenRef = useRef(false);
  const backdropPointerDownRef = useRef(false);
  const copilotAbortRef = useRef<AbortController | null>(null);
  const { activeRegion } = useRegion();
  const { isAdmin } = useAuthRole();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [showStage, setShowStage] = useState(false);
  const [stageCaption, setStageCaption] = useState("");
  const stageRef = useRef<XiaochunStageHandle>(null);
  // 宽屏时 3D 形象站在抽屉左侧的遮罩留白里；窄屏（抽屉占满）时收回抽屉内的小卡片
  const [stageOnBackdrop, setStageOnBackdrop] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const sync = () => setStageOnBackdrop(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);
  const lastSpokenIdRef = useRef<string | null>(null);
  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const regionKey = `${activeRegion?.id || ""}|${activeRegion?.city || ""}|${activeRegion?.name || ""}|${activeRegion?.domainProfile?.domainType || ""}`;

  const createGreetingMessage = (): Message => ({
    id: "m-init",
    role: "assistant",
    content: activeRegion
      ? copilotGreeting(activeRegion)
      : "尚未确定当前工作区。请先在顶栏选择站点，再提问。",
    timestamp: new Date().toLocaleTimeString(),
  });

  const asr = useStreamAsr({
    onFinalResult: (text) => {
      const clean = text.trim();
      if (!clean) return;
      setInput((prev) => appendRecognizedText(prev, clean));
      inputRef.current?.focus();
    },
  });

  useEffect(() => {
    copilotAbortRef.current?.abort();
    copilotAbortRef.current = null;
    setIsTyping(false);
    setStreamingId(null);
    setMessages([createGreetingMessage()]);
    setActionStates({});
    lastSpokenIdRef.current = "m-init";
    // regionKey 已经覆盖 id / 城市 / 区名 / 业务域。不要把 activeRegion 对象放进依赖，避免同区重绘清空对话。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [regionKey]);

  useEffect(() => {
    return () => {
      copilotAbortRef.current?.abort();
      copilotAbortRef.current = null;
    };
  }, []);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [actionStates, setActionStates] = useState<
    Record<string, { status: "idle" | "pending" | "done" | "error"; error?: string }>
  >({});
  const listRef = useRef<HTMLDivElement>(null);

  const handleExecuteAction = async (cardKey: string, proposal: CivicActionProposal) => {
    if (!isAdmin) {
      toast.error("仅管理员可执行主题处置操作");
      return;
    }
    const current = actionStates[cardKey];
    if (current?.status === "pending" || current?.status === "done") return;

    setActionStates((prev) => ({ ...prev, [cardKey]: { status: "pending" } }));
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch(`/api/clusters/${encodeURIComponent(proposal.themeId)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          action: proposal.action,
          ...(proposal.owner ? { owner: proposal.owner } : {}),
          ...(proposal.eta ? { eta: proposal.eta } : {}),
          ...(proposal.note ? { note: proposal.note } : {}),
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `执行失败 (${res.status})`);
      }
      setActionStates((prev) => ({ ...prev, [cardKey]: { status: "done" } }));
      const label = COPILOT_ACTION_LABELS[proposal.action] || proposal.action;
      toast.success(`已执行「${label}」：${proposal.themeTitle || proposal.themeId}`);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "操作执行失败";
      setActionStates((prev) => ({ ...prev, [cardKey]: { status: "error", error: msg } }));
      toast.error(msg);
    }
  };

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Modal focus management, background inert, Esc + Tab containment, focus return & ASR/TTS cleanup
  React.useEffect(() => {
    if (!isOpen) {
      asr.stop();
      stageRef.current?.stop();
      if (wasOpenRef.current) {
        wasOpenRef.current = false;
        const opener = openerRef.current;
        const shouldFallbackToFab = openerWasFabRef.current;
        openerRef.current = null;
        openerWasFabRef.current = false;
        if (opener && opener !== document.body && opener.isConnected) {
          opener.focus({ preventScroll: true });
        } else if (shouldFallbackToFab) {
          document.querySelector<HTMLElement>(".chat-fab")?.focus({ preventScroll: true });
        }
      }
      return;
    }

    if (!wasOpenRef.current) {
      const active = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      openerRef.current = active && active !== document.body ? active : null;
      // CivicNav unmounts .chat-fab as soon as copilotOpen flips true, which drops activeElement to body
      openerWasFabRef.current =
        !active || active === document.body || active.classList.contains("chat-fab");
      wasOpenRef.current = true;
    }

    const backgroundNodes = Array.from(
      document.querySelectorAll<HTMLElement>("nav.navbar, nav.page-nav, main.main")
    );
    const modifiedInert: HTMLElement[] = [];
    for (const node of backgroundNodes) {
      if (!node.inert) {
        node.inert = true;
        modifiedInert.push(node);
      }
    }

    const dialogEl = dialogRef.current;
    if (dialogEl && !dialogEl.contains(document.activeElement)) {
      dialogEl.focus({ preventScroll: true });
    }

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (e.isComposing || e.keyCode === 229) return;
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && dialogRef.current) {
        const focusables = Array.from(
          dialogRef.current.querySelectorAll<HTMLElement>(
            'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])'
          )
        ).filter(
          (el) => el.getClientRects().length > 0 && getComputedStyle(el).visibility !== "hidden"
        );
        if (focusables.length === 0) {
          e.preventDefault();
          dialogRef.current.focus({ preventScroll: true });
          return;
        }
        const first = focusables[0];
        const last = focusables[focusables.length - 1];
        const active = document.activeElement;
        if (e.shiftKey) {
          if (active === first || active === dialogRef.current || !dialogRef.current.contains(active)) {
            e.preventDefault();
            last.focus({ preventScroll: true });
          }
        } else if (active === last || !dialogRef.current.contains(active)) {
          e.preventDefault();
          first.focus({ preventScroll: true });
        }
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
      for (const node of modifiedInert) {
        node.inert = false;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, onClose]);

  // 折叠展开 3D 语音助手时，自动播报最新 AI 回复
  useEffect(() => {
    if (!isOpen || !showStage) {
      stageRef.current?.stop();
      return;
    }
    if (isTyping || streamingId) return;
    const latestAssistant = [...messages]
      .reverse()
      .find((m) => m.role === "assistant" && m.content.trim());
    if (!latestAssistant || latestAssistant.id === lastSpokenIdRef.current) return;

    const spoken = extractCivicActions(latestAssistant.content, false)
      .cleanText.replace(/[#*`>_~|[\]]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 180);
    if (!spoken) return;

    lastSpokenIdRef.current = latestAssistant.id;
    setStageCaption(spoken);
    stageRef.current?.activate();
    void stageRef.current?.say(spoken).catch(() => {});
  }, [isOpen, showStage, isTyping, streamingId, messages]);

  const handleClearChat = () => {
    copilotAbortRef.current?.abort();
    copilotAbortRef.current = null;
    setIsTyping(false);
    setStreamingId(null);
    asr.stop();
    stageRef.current?.stop();
    lastSpokenIdRef.current = "m-init";
    setActionStates({});
    setInput("");
    setStageCaption("");
    setMessages([createGreetingMessage()]);
  };

  const handleSend = async (customText?: string) => {
    const rawText =
      customText ??
      (asr.isRecording && asr.interimText.trim()
        ? appendRecognizedText(input, asr.interimText)
        : input);
    if (isTyping || !rawText.trim()) return;
    const text = rawText.trim();
    if (asr.isRecording || asr.status === "initializing" || asr.status === "downloading") {
      asr.reset();
    }

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };

    const aiId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg]);
    if (customText === undefined) setInput("");
    setIsTyping(true);
    setStreamingId(aiId);
    setMessages((prev) => [
      ...prev,
      {
        id: aiId,
        role: "assistant",
        content: "",
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
    requestAnimationFrame(scrollToBottom);

    copilotAbortRef.current?.abort();
    const controller = new AbortController();
    copilotAbortRef.current = controller;

    try {
      const history = [...messages, userMsg]
        .filter((item) => item.content.trim())
        .slice(-8)
        .map((item) => ({ role: item.role, content: item.content }));
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers,
        signal: controller.signal,
        body: JSON.stringify({ messages: history }),
      });

      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error || `HTTP ${res.status}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (controller.signal.aborted) return;
        acc += decoder.decode(value, { stream: true });
        const split = splitCopilotStream(acc);
        const visible = split.text;
        // ponytail: 流式累积时,`` 未闭合 → 全部算 think(用户看到思考中实时滚动);
        // `` 闭合后 → think 内容冻结,正文 content 只放 `` 之后的文本。
        const thinkOpenIdx = visible.indexOf("<think>");
        const thinkCloseIdx = visible.indexOf("</think>");
        let think: string | undefined;
        let content: string;
        if (thinkOpenIdx === -1) {
          content = visible;
        } else if (thinkCloseIdx === -1 || thinkCloseIdx < thinkOpenIdx) {
          // think 块还没闭合,持续累积到 think
          think = visible.slice(thinkOpenIdx + 7);
          content = visible.slice(0, thinkOpenIdx);
        } else {
          think = visible.slice(thinkOpenIdx + 7, thinkCloseIdx).trim();
          content = visible.slice(thinkCloseIdx + 8);
        }
        const status = content.trim() ? undefined : split.status;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, think: think ?? m.think, content, status }
              : m
          )
        );
        scrollToBottom();
      }
      if (controller.signal.aborted) return;
      acc += decoder.decode();
      const finalSplit = splitCopilotStream(acc);
      const finalVisible = finalSplit.text;
      const finalOpen = finalVisible.indexOf("<think>");
      const finalClose = finalVisible.indexOf("</think>");
      let finalThink: string | undefined;
      let finalContent: string;
      if (finalOpen === -1) {
        finalContent = finalVisible;
      } else if (finalClose === -1 || finalClose < finalOpen) {
        finalThink = finalVisible.slice(finalOpen + 7).trim();
        finalContent = finalVisible.slice(0, finalOpen);
      } else {
        finalThink = finalVisible.slice(finalOpen + 7, finalClose).trim();
        finalContent = finalVisible.slice(finalClose + 8).trim();
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? {
                ...m,
                think: finalThink ?? m.think,
                status: undefined,
                content: finalContent.trim() || m.content || "（空回复）",
              }
            : m
        )
      );
    } catch (err) {
      if (controller.signal.aborted || (err instanceof DOMException && err.name === "AbortError")) {
        return;
      }
      // ponytail: 401/超时/LLM 报错都会落到这里,把真实错误塞进 UI 而不是统一说「超时」,便于排查。
      const msg = err instanceof Error ? err.message : String(err);
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? { ...m, content: m.content || `研判失败:${msg || "未知错误"}` }
            : m
        )
      );
    } finally {
      if (copilotAbortRef.current === controller) {
        copilotAbortRef.current = null;
        setIsTyping(false);
        setStreamingId(null);
        requestAnimationFrame(scrollToBottom);
      }
    }
  };

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
    <AnimatePresence>
      {isOpen && (
      <motion.div
        key="copilot-backdrop"
        className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/50 backdrop-blur-xs overflow-hidden overscroll-contain"
        onPointerDown={(e) => {
          backdropPointerDownRef.current = e.target === e.currentTarget;
        }}
        onClick={(e) => {
          if (e.target === e.currentTarget && backdropPointerDownRef.current) {
            onClose();
          }
          backdropPointerDownRef.current = false;
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: prefersReducedMotion ? 0 : 0.2, ease: "easeOut" }}
      >
        {showStage && stageOnBackdrop && (
          <div className="flex-1 min-w-0 h-full relative pointer-events-none">
            <XiaochunStage
              variant="stage"
              backdropTone="dark"
              width="100%"
              height="100%"
              ref={stageRef}
              outfit="xiaochun_civic"
              lazy={false}
              title={isEcommerce ? "AI 客诉助手" : "AI 研判助手"}
              caption={stageCaption}
            />
          </div>
        )}
        <motion.div
          ref={dialogRef}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="w-full max-w-lg shrink-0 h-full bg-white sm:border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden overscroll-contain text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
          onClick={(e) => e.stopPropagation()}
          initial={prefersReducedMotion ? { x: 0 } : { x: "100%" }}
          animate={{ x: 0 }}
          exit={prefersReducedMotion ? { x: 0 } : { x: "100%" }}
          transition={{ duration: prefersReducedMotion ? 0 : 0.28, ease: [0.32, 0.72, 0.18, 1] }}
        >
        {/* Header */}
        <div className="p-3 sm:p-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <BotMessageSquare className="w-4 h-4" aria-hidden="true" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 min-w-0">
                <h2 id={titleId} className="text-[13px] sm:text-xs font-bold text-slate-900 leading-tight">
                  {isEcommerce ? "AI 客诉研判副驾驶" : "AI 智能研判副驾驶"}
                </h2>
                <span className="hidden sm:inline-flex text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium shrink-0">
                  {isEcommerce ? "本站检索" : "本区检索"}
                </span>
              </div>
              <p className="text-[11px] text-slate-600 truncate whitespace-nowrap">
                {activeRegion ? (
                  <>
                    <span className="hidden sm:inline">
                      {isEcommerce ? "当前电商站点 · " : "当前辖区 · "}
                    </span>
                    {activeRegion.city} · {activeRegion.name}
                  </>
                ) : (
                  "正在确认当前工作站点"
                )}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={isTyping || (messages.length <= 1 && !input.trim())}
              onClick={handleClearChat}
              aria-label="清空对话"
              title="清空当前对话并重新提问"
              className="relative inline-flex items-center justify-center gap-1 px-2 py-1 rounded-md text-[11px] font-medium border border-slate-200 bg-white text-slate-600 hover:bg-slate-100 hover:text-slate-900 disabled:opacity-45 disabled:cursor-not-allowed transition-colors cursor-pointer whitespace-nowrap min-h-[34px] min-w-[34px] sm:min-w-0 sm:min-h-8 after:content-[''] after:absolute after:-inset-[5px]"
            >
              <RotateCcw className="w-3.5 h-3.5 sm:w-3 sm:h-3 shrink-0" aria-hidden="true" />
              <span className="hidden sm:inline">清空对话</span>
            </button>
            <button
              type="button"
              aria-expanded={showStage}
              onClick={() => {
                setShowStage((prev) => {
                  const next = !prev;
                  if (next) {
                    lastSpokenIdRef.current = null;
                  }
                  return next;
                });
              }}
              className={`relative inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-[11px] font-medium border transition-colors cursor-pointer whitespace-nowrap min-h-[34px] sm:min-h-8 after:content-[''] after:absolute after:-inset-y-[5px] after:inset-x-0 ${
                showStage
                  ? "bg-blue-50 text-blue-700 border-blue-200"
                  : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
              }`}
            >
              <Volume2 className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>
                3D 语音<span className="hidden sm:inline">助手</span>
              </span>
            </button>
            <button
              type="button"
              aria-label="关闭 AI 研判副驾驶"
              onClick={onClose}
              className="relative p-1.5 rounded-md text-slate-500 hover:text-slate-800 hover:bg-slate-100 transition-colors cursor-pointer min-h-[34px] min-w-[34px] sm:min-h-8 sm:min-w-8 inline-flex items-center justify-center after:content-[''] after:absolute after:-inset-[5px]"
            >
              <X className="w-5 h-5" aria-hidden="true" />
            </button>
          </div>
        </div>

        {/* Preset Prompt Pills */}
        <div className="px-3 sm:px-4 py-2 bg-white border-b border-slate-100 grid grid-cols-2 sm:flex sm:flex-wrap gap-1.5 sm:gap-2 text-xs shrink-0">
          {(isEcommerce
            ? [
                {
                  label: "生成客诉简报",
                  prompt: "生成今日电商客诉研判简报，汇总客诉总量、高危专题与挽回建议",
                  toneClass:
                    "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 border-slate-200",
                },
                {
                  label: "食安与12315红线预警",
                  prompt: "排查当前有哪些食品安全、12315投诉或人身伤害红线预警客诉？",
                  toneClass:
                    "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200",
                },
                {
                  label: "渠道与SKU分布",
                  prompt: "梳理各购买渠道/仓网及重点涉事商品 SKU 的客诉分布",
                  toneClass:
                    "bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200",
                },
                {
                  label: "待办与假闭环排查",
                  prompt: "查询当前主动待办任务、待回访工单与假闭环重开排查情况",
                  toneClass:
                    "bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200",
                },
              ]
            : [
                {
                  label: "生成研判简报",
                  prompt: "生成今日多频工单研判简报，汇总总量、高危主题与处置建议",
                  toneClass:
                    "bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 border-slate-200",
                },
                {
                  label: "高危多频预警",
                  prompt: "分析当前有哪些高危多频预警与紧急督办事项？",
                  toneClass:
                    "bg-rose-50 text-rose-700 hover:bg-rose-100 border-rose-200",
                },
                {
                  label: "重点镇街分布",
                  prompt: "梳理重点镇街的诉求分布、待处置量与突出问题",
                  toneClass:
                    "bg-amber-50 text-amber-800 hover:bg-amber-100 border-amber-200",
                },
                {
                  label: "待办与红线核查",
                  prompt: "查询当前主动待办任务与 L3 红线拦截核查情况",
                  toneClass:
                    "bg-blue-50 text-blue-700 hover:bg-blue-100 border-blue-200",
                },
              ]
          ).map((chip) => (
            <button
              key={chip.label}
              type="button"
              disabled={isTyping}
              onClick={() => void handleSend(chip.prompt)}
              className={`min-h-[44px] sm:min-h-[32px] min-w-0 px-2.5 py-1.5 rounded-lg sm:rounded-full border text-center leading-snug text-[11px] font-medium cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${chip.toneClass}`}
            >
              {chip.label}
            </button>
          ))}
        </div>

        {/* 按需展开的紧凑 3D 语音助手 */}
        {showStage && !stageOnBackdrop && (
          <div className="px-3 py-2 bg-slate-50/90 border-b border-slate-200 flex items-center justify-center shrink-0">
            <XiaochunStage
              width="100%"
              height="clamp(170px, 24dvh, 220px)"
              scene="light"
              ref={stageRef}
              outfit="xiaochun_civic"
              lazy={false}
              title={isEcommerce ? "AI 客诉助手" : "AI 研判助手"}
              caption={stageCaption}
            />
          </div>
        )}

        {/* Message History */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {messages.map((m) => {
            const streaming = streamingId === m.id;
            const parsed =
              m.role === "assistant" && m.content
                ? extractCivicActions(m.content, streaming)
                : { cleanText: m.content || "", actions: [], pendingBlock: false };
            const hasVisibleBody = Boolean(parsed.cleanText || parsed.actions.length > 0 || parsed.pendingBlock);

            return (
              <div
                key={m.id}
                className={`flex flex-col ${
                  m.role === "user" ? "items-end" : "items-start"
                }`}
              >
                <div
                  className={`max-w-[88%] rounded-xl p-3.5 text-xs leading-relaxed ${
                    m.role === "user"
                      ? "bg-blue-600 text-white rounded-br-none shadow-xs"
                      : "bg-slate-100 text-slate-900 border border-slate-200 rounded-bl-none shadow-2xs"
                  }`}
                >
                  {m.content || streaming || m.think ? (
                    <div>
                      {/* ponytail: think 块独立展示在答案上方,折叠面板 + 「思考中」提示。 */}
                      {m.think ? (
                        // ponytail: 流式思考中(<details> 自动 open)展示实时推理;
                        // 答案出正文后,<details> 折叠,hover summary 用 shadcn Tooltip(Portal 渲染)
                        // 弹 think 浮层,绕开父级 overflow/z-index 遮挡。
                        <div className="mb-2 copilot-think-panel">
                          <details
                            className="group"
                            open={streaming && !m.content}
                          >
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <summary className="cursor-pointer text-[10px] font-medium text-slate-600 hover:text-slate-800 select-none flex items-center gap-1.5 list-none">
                                  <Brain
                                    size={11}
                                    aria-hidden="true"
                                    className={
                                      streaming && !m.content
                                        ? `text-blue-500${prefersReducedMotion ? "" : " animate-pulse"}`
                                        : "text-slate-500 group-open:text-blue-500"
                                    }
                                  />
                                  <span>{streaming && !m.content ? "思考中…" : "查看思考过程"}</span>
                                </summary>
                              </TooltipTrigger>
                              {/* 流式时浮层不弹(已经有 <details open> 实时显示),非流式才弹 */}
                              {!(streaming && !m.content) ? (
                                <TooltipContent
                                  side="bottom"
                                  align="start"
                                  sideOffset={6}
                                  className="copilot-think-tooltip max-w-sm max-h-48 overflow-y-auto whitespace-pre-wrap text-left"
                                >
                                  {m.think}
                                </TooltipContent>
                              ) : null}
                            </Tooltip>
                            <div className="mt-1.5 px-2.5 py-2 rounded-md bg-slate-50 border border-slate-200/70 text-[11px] text-slate-500 leading-relaxed max-h-40 overflow-y-auto whitespace-pre-wrap">
                              {m.think}
                              {streaming && !m.content ? <span className="copilot-caret" aria-hidden /> : null}
                            </div>
                          </details>
                        </div>
                      ) : null}
                      {hasVisibleBody || streaming ? (
                        <div className={m.role === "user" ? "copilot-md copilot-md--user" : "copilot-md"}>
                          {streaming && !m.content ? (
                            // ponytail: 答案还没产出时主气泡显示循环 loading,三个点从小到大错峰缩放。
                            <span className="inline-flex items-center gap-2 py-1" aria-label={m.status || "生成中"}>
                              <span className="inline-flex items-center gap-1">
                                <span className="copilot-dot copilot-dot--1" />
                                <span className="copilot-dot copilot-dot--2" />
                                <span className="copilot-dot copilot-dot--3" />
                              </span>
                              {m.status ? <span className="text-[11px] text-slate-500">{m.status}</span> : null}
                            </span>
                          ) : (
                            <>
                              {parsed.cleanText ? (
                                <ReactMarkdown remarkPlugins={[remarkGfm]}>{parsed.cleanText}</ReactMarkdown>
                              ) : null}
                              {streaming && !parsed.pendingBlock ? <span className="copilot-caret" aria-hidden /> : null}
                              {parsed.pendingBlock ? (
                                <div className="mt-2 rounded-lg border border-blue-200 bg-white px-3 py-2.5 text-[11px] text-slate-600 flex items-center gap-2">
                                  <Loader2
                                    className={`w-3.5 h-3.5 text-blue-600${prefersReducedMotion ? "" : " animate-spin"}`}
                                    aria-hidden="true"
                                  />
                                  <span>正在生成待确认执行操作卡片…</span>
                                </div>
                              ) : null}
                              {parsed.actions.length > 0 ? (
                                <div className="mt-2.5 space-y-2">
                                  {parsed.actions.map((act, idx) => {
                                    const cardKey = `${m.id}-${idx}`;
                                    const state = actionStates[cardKey]?.status || "idle";
                                    const errorMsg = actionStates[cardKey]?.error;
                                    const actionLabel = COPILOT_ACTION_LABELS[act.action] || act.action;
                                    return (
                                      <div
                                        key={cardKey}
                                        className="rounded-lg border border-blue-200/90 bg-white p-3 shadow-2xs text-slate-800 space-y-2"
                                      >
                                        <div className="flex items-center justify-between gap-2 pb-1.5 border-b border-slate-100">
                                          <span className="text-[11px] font-bold text-slate-900">
                                            待确认执行操作
                                          </span>
                                          <span className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                                            {actionLabel}
                                          </span>
                                        </div>
                                        <div className="space-y-1 text-[11px]">
                                          <div className="flex items-start justify-between gap-2">
                                            <span className="text-slate-500 shrink-0">目标群组</span>
                                            <Link
                                              href={`/themes/${encodeURIComponent(act.themeId)}`}
                                              onClick={onClose}
                                              className="font-semibold text-blue-600 hover:underline text-right inline-flex items-center gap-1"
                                            >
                                              <span>{act.themeTitle || act.themeId}</span>
                                              <ExternalLink className="w-3 h-3 shrink-0" aria-hidden="true" />
                                            </Link>
                                          </div>
                                          {act.owner && (
                                            <div className="flex items-start justify-between gap-2">
                                              <span className="text-slate-500 shrink-0">建议部门</span>
                                              <span className="font-medium text-slate-800 text-right">{act.owner}</span>
                                            </div>
                                          )}
                                          {act.eta && (
                                            <div className="flex items-start justify-between gap-2">
                                              <span className="text-slate-500 shrink-0">预计时限</span>
                                              <span className="font-mono text-slate-700 text-right">{act.eta}</span>
                                            </div>
                                          )}
                                          {act.note && (
                                            <div className="mt-1 rounded bg-slate-50 border border-slate-200/70 px-2 py-1.5 text-[11px] text-slate-600 leading-relaxed">
                                              {act.note}
                                            </div>
                                          )}
                                        </div>
                                        {state === "error" && errorMsg && (
                                          <div className="flex items-center gap-1.5 text-[11px] text-rose-600 bg-rose-50 border border-rose-200 rounded px-2 py-1">
                                            <AlertCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                                            <span className="break-all">{errorMsg}</span>
                                          </div>
                                        )}
                                        <div className="pt-1 flex items-center justify-between gap-2">
                                          {!isAdmin ? (
                                            <span className="text-[11px] text-amber-700 font-medium">
                                              仅管理员可处置
                                            </span>
                                          ) : (
                                            <span />
                                          )}
                                          {state === "done" ? (
                                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-1 rounded-md">
                                              <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                                              <span>已执行落库</span>
                                            </span>
                                          ) : (
                                            <button
                                              type="button"
                                              disabled={!isAdmin || state === "pending" || streaming}
                                              title={!isAdmin ? "仅管理员可执行处置" : undefined}
                                              onClick={() => void handleExecuteAction(cardKey, act)}
                                              className="inline-flex min-h-[44px] sm:min-h-[30px] items-center gap-1.5 px-3 py-1.5 rounded-md text-[11px] font-semibold bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer transition-colors"
                                            >
                                              {state === "pending" ? (
                                                <>
                                                  <Loader2
                                                    className={`w-3 h-3${prefersReducedMotion ? "" : " animate-spin"}`}
                                                    aria-hidden="true"
                                                  />
                                                  <span>执行中…</span>
                                                </>
                                              ) : (
                                                <>
                                                  <Play className="w-3 h-3" aria-hidden="true" />
                                                  <span>{state === "error" ? "重试执行" : "确认执行"}</span>
                                                </>
                                              )}
                                            </button>
                                          )}
                                        </div>
                                      </div>
                                    );
                                  })}
                                </div>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-500">…</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-500 mt-1 px-1 font-mono">
                  {m.timestamp}
                </span>
              </div>
            );
          })}

          {isTyping && !streamingId && (
            <div className="flex items-center gap-2 text-slate-600 text-xs py-2">
              <Sparkles
                className={`w-3.5 h-3.5 text-blue-600${prefersReducedMotion ? "" : " animate-spin"}`}
                aria-hidden="true"
              />
              <span>
                {isEcommerce
                  ? "正在检索当前电商站点客诉与专题并研判..."
                  : "正在检索当前辖区工单与专题并研判..."}
              </span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-slate-200 bg-white space-y-1.5 shrink-0">
          {(asr.isRecording || asr.status === "downloading" || asr.status === "initializing" || asr.error) && (
            <div
              role={asr.error ? "status" : undefined}
              aria-live={asr.error ? "polite" : undefined}
              className="flex items-center justify-between gap-2 px-1 text-[11px] text-slate-600"
            >
              <span className={`truncate ${asr.error ? "text-amber-700" : "text-blue-700"}`}>
                {asr.error
                  ? `语音提示：${asr.error}`
                  : asr.interimText
                  ? `识别中：${asr.interimText}`
                  : asr.statusHint || "语音识别就绪"}
              </span>
              {asr.status === "downloading" && (
                <span className="font-mono tabular-nums shrink-0 text-blue-600">
                  {Math.round(asr.downloadPercent)}%
                </span>
              )}
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSend();
            }}
            className="flex items-center gap-2"
          >
            <Button
              type="button"
              size="icon"
              variant="outline"
              disabled={isTyping}
              aria-label={
                asr.isRecording || asr.status === "initializing" || asr.status === "downloading"
                  ? "停止语音输入"
                  : "开始语音输入"
              }
              aria-pressed={asr.isRecording}
              onClick={() => {
                if (asr.isRecording || asr.status === "initializing" || asr.status === "downloading") {
                  asr.stop();
                } else {
                  stageRef.current?.stop();
                  void asr.start();
                }
              }}
              className={`h-11 w-11 sm:h-9 sm:w-9 shrink-0 ${
                asr.isRecording
                  ? "bg-rose-50 border-rose-300 text-rose-600 hover:bg-rose-100"
                  : "bg-slate-50 border-slate-200 text-slate-600 hover:text-blue-600"
              }`}
            >
              {asr.isRecording ? (
                <MicOff className="w-4 h-4" aria-hidden="true" />
              ) : (
                <Mic className="w-4 h-4" aria-hidden="true" />
              )}
            </Button>
            <label htmlFor={inputId} className="sr-only">
              输入研判提问
            </label>
            <Input
              ref={inputRef}
              id={inputId}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  if (e.nativeEvent.isComposing || e.keyCode === 229) {
                    e.preventDefault();
                    return;
                  }
                  e.preventDefault();
                  if (!isTyping && (input.trim() || (asr.isRecording && asr.interimText.trim()))) {
                    void handleSend();
                  }
                }
              }}
              placeholder={
                isEcommerce
                  ? "询问客诉态势、渠道/SKU 或红线…"
                  : "询问工单态势、镇街或处置建议…"
              }
              className="text-base sm:text-xs min-h-11 h-auto sm:h-9 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-500 focus-visible:ring-blue-500"
            />
            <Button
              type="submit"
              size="sm"
              aria-label="发送提问"
              disabled={isTyping || !(input.trim() || (asr.isRecording && asr.interimText.trim()))}
              className="h-11 min-w-11 px-3 sm:h-9 sm:min-w-0 bg-blue-600 text-white hover:bg-blue-700 shrink-0 shadow-xs"
            >
              <Send className="w-3.5 h-3.5" aria-hidden="true" />
            </Button>
          </form>
        </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>
    </TooltipProvider>
  );
};
