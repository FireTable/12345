"use client";

import React, { useState } from "react";
import {
  X,
  Send,
  Sparkles,
  BotMessageSquare,
  Building2,
  FileSpreadsheet,
  AlertTriangle,
  Lightbulb,
} from "lucide-react";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";

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
}

export const LightCopilot: React.FC<LightCopilotProps> = ({
  isOpen,
  onClose,
  themes,
  stats,
  onSelectTheme,
}) => {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: "m-init",
      role: "assistant",
      content: `您好！我是 **Ticket Radar 智能研判副驾驶**。\n\n当前已全量接入 **${stats.totalTickets.toLocaleString()}** 件工单，系统识别出 **${stats.themeCount}** 个多频治理主题，其中包含 **${stats.highRiskCount}** 项紧急督办事件。\n\n您可以随时让我生成研判简报、查找高危事件或分析特定街道的重点责任主体。`,
      timestamp: new Date().toLocaleTimeString(),
    },
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);

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

  if (!isOpen) return null;

  const handleSend = async (customText?: string) => {
    const text = customText || input;
    if (!text.trim()) return;

    const userMsg: Message = {
      id: `u-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: new Date().toLocaleTimeString(),
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!customText) setInput("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, threadId: "copilot-thread" }),
      });
      const json = await res.json();

      let replyContent =
        json.data?.reply ||
        `基于当前工单图谱，系统已关联到重点多频事件。建议优先处置高风险事件。`;

      const aiMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: replyContent,
        timestamp: new Date().toLocaleTimeString(),
      };

      setMessages((prev) => [...prev, aiMsg]);
    } catch (err) {
      const aiMsg: Message = {
        id: `a-${Date.now()}`,
        role: "assistant",
        content: "抱歉，研判引擎分析超时，请稍后重试。",
        timestamp: new Date().toLocaleTimeString(),
      };
      setMessages((prev) => [...prev, aiMsg]);
    } finally {
      setIsTyping(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-900 animate-in slide-in-from-right duration-250"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 text-white flex items-center justify-center shadow-xs">
              <BotMessageSquare className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-1.5">
                <h2 className="text-xs font-bold text-slate-900">
                  AI 智能研判副驾驶
                </h2>
                <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-blue-50 text-blue-700 border border-blue-200 font-medium">
                  GraphRAG
                </span>
              </div>
              <p className="text-[11px] text-slate-500">
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
        <div className="flex-1 overflow-y-auto p-4 space-y-4 overscroll-contain">
          {messages.map((m) => (
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
                    : "bg-slate-100 text-slate-900 border border-slate-200 rounded-bl-none shadow-2xs whitespace-pre-wrap"
                }`}
              >
                {m.content}
              </div>
              <span className="text-[10px] text-slate-400 mt-1 px-1 font-mono">
                {m.timestamp}
              </span>
            </div>
          ))}

          {isTyping && (
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
      </div>
    </div>
  );
};
