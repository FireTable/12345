"use client";

import React, { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  X,
  Send,
  Sparkles,
  BotMessageSquare,
  Brain,
} from "lucide-react";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/app/_components/ui/tooltip";
import "./copilot-md.css";

interface LightCopilotProps {
  isOpen: boolean;
  onClose: () => void;
  themes: MultiFrequencyTheme[];
  stats: OverallStats;
  onSelectTheme: (theme: MultiFrequencyTheme) => void;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  content: string;
  timestamp: string;
  themeSuggestions?: MultiFrequencyTheme[];
  // ponytail: 模型 ``...`` 块里的思考过程独立存,渲染时折叠在答案上方,不污染正文区。
  think?: string;
}

export const LightCopilot: React.FC<LightCopilotProps> = ({
  isOpen,
  onClose,
  themes,
  stats,
  onSelectTheme,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  // ponytail: 招呼消息依赖 stats,但 stats 在父组件 openCopilot 异步加载后才到位,
  // useState 初值只跑一次 → 改成 useEffect 监听 stats 后再注入,避免显示「0 件工单」。
  useEffect(() => {
    if (messages.length > 0) return;
    if (!stats || stats.totalTickets === 0) return;
    setMessages([
      {
        id: "m-init",
        role: "assistant",
        content: `您好！我是 **民声智理 12345 智能研判副驾驶**。\n\n当前已全量接入 **${stats.totalTickets.toLocaleString()}** 件工单，系统识别出 **${stats.themeCount}** 个多频治理主题，其中包含 **${stats.highRiskCount}** 项紧急督办事件。\n\n您可以随时让我生成研判简报、查找高危事件或分析特定街道的重点责任主体。`,
        timestamp: new Date().toLocaleTimeString(),
      },
    ]);
  }, [stats, messages.length]);
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const threadIdRef = useRef<string | null>(null);

  function scrollToBottom() {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Lock background body scroll when Copilot drawer is open
  React.useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  const handleSend = async (customText?: string) => {
    const text = customText || input;
    if (!text.trim()) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };

    const aiId = `a-${Date.now()}`;
    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput("");
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

    try {
      // ponytail: 每个会话实例首次打开时生成 threadId,后续发送复用,直到组件卸载。
      // 关闭再开会拿到新 threadId —— 自然切分对话上下文。
      if (!threadIdRef.current) {
        threadIdRef.current = `copilot-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      }
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, threadId: threadIdRef.current }),
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
        acc += decoder.decode(value, { stream: true });
        // ponytail: 流式累积时,`` 未闭合 → 全部算 think(用户看到思考中实时滚动);
        // `` 闭合后 → think 内容冻结,正文 content 只放 `` 之后的文本。
        const thinkOpenIdx = acc.indexOf("<think>");
        const thinkCloseIdx = acc.indexOf("</think>");
        let think: string | undefined;
        let content: string;
        if (thinkOpenIdx === -1) {
          content = acc;
        } else if (thinkCloseIdx === -1 || thinkCloseIdx < thinkOpenIdx) {
          // think 块还没闭合,持续累积到 think
          think = acc.slice(thinkOpenIdx + 7);
          content = acc.slice(0, thinkOpenIdx);
        } else {
          think = acc.slice(thinkOpenIdx + 7, thinkCloseIdx).trim();
          content = acc.slice(thinkCloseIdx + 8);
        }
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiId
              ? { ...m, think: think ?? m.think, content }
              : m
          )
        );
        scrollToBottom();
      }
      acc += decoder.decode();
      const finalOpen = acc.indexOf("<think>");
      const finalClose = acc.indexOf("</think>");
      let finalThink: string | undefined;
      let finalContent: string;
      if (finalOpen === -1) {
        finalContent = acc;
      } else if (finalClose === -1 || finalClose < finalOpen) {
        finalThink = acc.slice(finalOpen + 7).trim();
        finalContent = acc.slice(0, finalOpen);
      } else {
        finalThink = acc.slice(finalOpen + 7, finalClose).trim();
        finalContent = acc.slice(finalClose + 8).trim();
      }
      setMessages((prev) =>
        prev.map((m) =>
          m.id === aiId
            ? {
                ...m,
                think: finalThink ?? m.think,
                content: finalContent || m.content || "（空回复）",
              }
            : m
        )
      );
    } catch (err) {
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
      setIsTyping(false);
      setStreamingId(null);
      requestAnimationFrame(scrollToBottom);
    }
  };

  return (
    <TooltipProvider delayDuration={150} skipDelayDuration={300}>
    <AnimatePresence>
      {isOpen && (
      <motion.div
        key="copilot-backdrop"
        className="fixed inset-0 z-[1000] flex justify-end bg-slate-900/50 backdrop-blur-xs overscroll-contain"
        onClick={onClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2, ease: "easeOut" }}
      >
        <motion.div
          className="w-full max-w-lg h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-900"
          onClick={(e) => e.stopPropagation()}
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ duration: 0.28, ease: [0.32, 0.72, 0.18, 1] }}
        >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between gap-2 bg-slate-50">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs shrink-0">
              <BotMessageSquare className="w-4 h-4" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-bold text-slate-900">
                  AI 智能研判副驾驶
                </h2>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                  GraphRAG
                </span>
              </div>
              <p className="text-[11px] text-slate-500 truncate">
                实时多频态势感知 · 智能归因分析 · 简报生成
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Preset Prompt Pills */}
        <div className="px-4 py-2 bg-white border-b border-slate-100 flex items-center gap-2 overflow-x-auto text-xs">
          <button
            onClick={() => handleSend("生成今日多频工单研判日报")}
            className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-700 hover:bg-blue-50 hover:text-blue-700 border border-slate-200 whitespace-nowrap text-[11px] cursor-pointer transition-colors"
          >
            📋 生成研判简报
          </button>
          <button
            onClick={() => handleSend("分析当前有哪些高危紧急督办事项？")}
            className="px-2.5 py-1 rounded-full bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 whitespace-nowrap text-[11px] cursor-pointer transition-colors"
          >
            🔴 高危多频预警
          </button>
          <button
            onClick={() => handleSend("梳理重点镇街的主体投诉分布")}
            className="px-2.5 py-1 rounded-full bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200 whitespace-nowrap text-[11px] cursor-pointer transition-colors"
          >
            🏢 重点主体分布
          </button>
        </div>

        {/* Message History */}
        <div ref={listRef} className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {messages.map((m) => {
            const streaming = streamingId === m.id;
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
                                <summary className="cursor-pointer text-[10px] font-medium text-slate-400 hover:text-slate-600 select-none flex items-center gap-1.5 list-none">
                                  <Brain size={11} className={streaming && !m.content ? "text-blue-500 animate-pulse" : "text-slate-400 group-open:text-blue-500"} />
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
                      {m.content || streaming ? (
                        <div className={m.role === "user" ? "copilot-md copilot-md--user" : "copilot-md"}>
                          {streaming && !m.content ? (
                            // ponytail: 答案还没产出时主气泡显示循环 loading,三个点从小到大错峰缩放。
                            <span className="inline-flex items-center gap-1 py-1" aria-label="生成中">
                              <span className="copilot-dot copilot-dot--1" />
                              <span className="copilot-dot copilot-dot--2" />
                              <span className="copilot-dot copilot-dot--3" />
                            </span>
                          ) : (
                            <>
                              <ReactMarkdown remarkPlugins={[remarkGfm]}>{m.content || ""}</ReactMarkdown>
                              {streaming ? <span className="copilot-caret" aria-hidden /> : null}
                            </>
                          )}
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <span className="text-slate-400">…</span>
                  )}
                </div>
                <span className="text-[10px] text-slate-400 mt-1 px-1 font-mono">
                  {m.timestamp}
                </span>
              </div>
            );
          })}

          {isTyping && !streamingId && (
            <div className="flex items-center gap-2 text-slate-500 text-xs py-2">
              <Sparkles className="w-3.5 h-3.5 text-blue-600 animate-spin" />
              <span>Agent 正在遍历图谱进行归因研判...</span>
            </div>
          )}
        </div>

        {/* Input Bar */}
        <div className="p-3 border-t border-slate-200 bg-white">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleSend();
            }}
            className="flex items-center gap-2"
          >
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="向 AI 副驾驶提问多频工单态势、归因或处置建议..."
              className="text-xs h-9 bg-slate-50 border-slate-200 text-slate-900 placeholder:text-slate-400 focus-visible:ring-blue-500"
            />
            <Button
              type="submit"
              size="sm"
              disabled={isTyping || !input.trim()}
              className="h-9 px-3 bg-blue-600 text-white hover:bg-blue-700 shrink-0 shadow-xs"
            >
              <Send className="w-3.5 h-3.5" />
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
