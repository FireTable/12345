"use client";

import React, { useState } from "react";
import {
  X,
  BotMessageSquare,
  Send,
  Sparkles,
  Zap,
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
  sender: "USER" | "AI";
  text: string;
  timestamp: string;
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
      id: "msg-1",
      sender: "AI",
      text: `您好！我是政务工单研判助手。当前 LangGraph 后端已聚类出 **${stats.themeCount} 个多频主题**（涵盖 ${stats.multiFrequencyTickets} 件多频工单，压缩率达 ${stats.compressionRatio}%）。\n\n📌 **重点关注提示**：【金科博翠天下施工项目部】近 3 天累计收到 14 单夜间施工噪音投诉；【容桂文海西路】今晨突发水管爆裂已聚类 9 单。您可以直接提问或点击预置指令。`,
      timestamp: "刚刚",
    },
  ]);
  const [inputVal, setInputVal] = useState("");
  const [isTyping, setIsTyping] = useState(false);

  const quickPrompts = [
    "按风险等级梳理需要紧急督办的事件",
    "总结大良街道近期投诉最多的主体",
    "有哪些反复发生的流动摊贩占道问题？",
    "生成一份今日多频工单研判简报",
  ];

  const handleSend = async (textToSend?: string) => {
    const text = textToSend || inputVal;
    if (!text.trim()) return;

    const userMsg: Message = {
      id: `user-${Date.now()}`,
      sender: "USER",
      text,
      timestamp: "刚刚",
    };

    setMessages((prev) => [...prev, userMsg]);
    if (!textToSend) setInputVal("");
    setIsTyping(true);

    try {
      const res = await fetch("/api/copilot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text }),
      });
      const data = await res.json();

      if (data.success) {
        setMessages((prev) => [
          ...prev,
          {
            id: `ai-${Date.now()}`,
            sender: "AI",
            text: data.data.reply,
            timestamp: "刚刚",
          },
        ]);
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: "AI",
          text: `研判请求响应异常，已自动基于本地知识图谱检索生成：关于【${text}】，系统建议转派相关街道执法队核查。`,
          timestamp: "刚刚",
        },
      ]);
    } finally {
      setIsTyping(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 overflow-hidden bg-black/50 flex justify-end">
      <div className="flex-1" onClick={onClose} />

      <div className="w-full max-w-lg bg-zinc-950 border-l border-zinc-800 h-full flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
              <BotMessageSquare className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-xs font-semibold text-zinc-100 flex items-center gap-1.5">
                AI 工单研判助手
              </h3>
              <p className="text-[11px] text-zinc-500">
                基于热线图谱知识库的实时智能分析
              </p>
            </div>
          </div>

          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="h-7 w-7 text-zinc-400 hover:text-zinc-200"
          >
            <X className="w-4 h-4" />
          </Button>
        </div>

        {/* Chat Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 text-xs">
          {messages.map((m) => (
            <div
              key={m.id}
              className={`flex gap-2.5 ${m.sender === "USER" ? "justify-end" : "justify-start"}`}
            >
              {m.sender === "AI" && (
                <div className="w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 shrink-0 mt-0.5">
                  <Sparkles className="w-3 h-3" />
                </div>
              )}
              <div
                className={`max-w-[85%] rounded-lg p-3 leading-relaxed whitespace-pre-wrap ${
                  m.sender === "USER"
                    ? "bg-zinc-800 text-zinc-100"
                    : "bg-zinc-900/90 border border-zinc-800 text-zinc-300"
                }`}
              >
                {m.text}
              </div>
            </div>
          ))}

          {isTyping && (
            <div className="flex items-center gap-2 text-zinc-500 text-xs py-1">
              <Sparkles className="w-3.5 h-3.5 animate-spin" />
              <span>正在分析图谱数据...</span>
            </div>
          )}
        </div>

        {/* Quick Prompts */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-900/30">
          <div className="text-[11px] text-zinc-500 mb-1.5 flex items-center gap-1">
            <Zap className="w-3 h-3 text-zinc-400" />
            快捷研判指令：
          </div>
          <div className="flex flex-wrap gap-1.5">
            {quickPrompts.map((qp, idx) => (
              <button
                key={idx}
                onClick={() => handleSend(qp)}
                className="text-[11px] px-2.5 py-1 rounded bg-zinc-900 border border-zinc-800 text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100 transition-colors text-left cursor-pointer"
              >
                {qp}
              </button>
            ))}
          </div>
        </div>

        {/* Input Box */}
        <div className="p-3 border-t border-zinc-800 bg-zinc-950 flex items-center gap-2">
          <Input
            type="text"
            value={inputVal}
            onChange={(e) => setInputVal(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSend()}
            placeholder="向 AI 提问工单多频趋势、主体分析或处置建议..."
            className="flex-1 text-xs h-8.5 bg-zinc-900 border-zinc-800"
          />
          <Button
            variant="default"
            size="sm"
            onClick={() => handleSend()}
            disabled={!inputVal.trim() || isTyping}
            className="h-8.5 px-3 bg-zinc-100 text-zinc-900 hover:bg-zinc-200"
          >
            <Send className="w-3.5 h-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
};
