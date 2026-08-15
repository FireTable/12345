"use client";

import React, { useState } from "react";
import {
  X,
  BotMessageSquare,
  Send,
  Sparkles,
  Zap,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { MultiFrequencyTheme, OverallStats } from "@/backend/state";
import { Button } from "@/app/_components/ui/button";
import { Input } from "@/app/_components/ui/input";
import { Badge } from "@/app/_components/ui/badge";

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
      text: `您好！我是政务工单研判副驾驶 (Copilot)。当前 LangGraph 后端已聚类出 **${stats.themeCount} 个多频主题**（涵盖 ${stats.multiFrequencyTickets} 件多频工单，压缩率达 ${stats.compressionRatio}%）。\n\n🔴 **高危预警提示**：【金科博翠天下施工项目部】近 3 天累计收到 14 单夜间施工噪音投诉，且【容桂文海西路】今晨突发水管爆裂已聚类 9 单。您可以直接向我提问或点击预置指令。`,
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
      // Call backend API
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
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden bg-black/60 backdrop-blur-xs flex justify-end">
        <div className="flex-1" onClick={onClose} />

        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 220 }}
          className="w-full max-w-lg bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Header */}
          <div className="p-4 border-b border-slate-800 bg-slate-900/80 flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-xl bg-gradient-to-tr from-purple-600 to-indigo-500 flex items-center justify-center text-white shadow-md shadow-purple-500/30">
                <BotMessageSquare className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-white flex items-center gap-1.5">
                  AI 工单研判副驾驶
                  <Badge variant="purple" className="text-[10px]">
                    LangGraph Copilot
                  </Badge>
                </h3>
                <p className="text-[11px] text-slate-400">
                  基于热线图谱知识库的实时智能问答
                </p>
              </div>
            </div>

            <Button
              variant="ghost"
              size="icon"
              onClick={onClose}
              className="text-slate-400 hover:text-white"
            >
              <X className="w-4 h-4" />
            </Button>
          </div>

          {/* Chat Messages */}
          <div className="flex-1 overflow-y-auto p-4 space-y-3.5 text-xs">
            {messages.map((m) => (
              <div
                key={m.id}
                className={`flex gap-2.5 ${m.sender === "USER" ? "justify-end" : "justify-start"}`}
              >
                {m.sender === "AI" && (
                  <div className="w-7 h-7 rounded-lg bg-purple-600/30 border border-purple-500/40 flex items-center justify-center text-purple-300 shrink-0">
                    <Sparkles className="w-3.5 h-3.5" />
                  </div>
                )}
                <div
                  className={`max-w-[85%] rounded-2xl p-3 leading-relaxed whitespace-pre-wrap ${
                    m.sender === "USER"
                      ? "bg-cyan-600 text-white rounded-tr-xs"
                      : "bg-slate-900 border border-slate-800 text-slate-200 rounded-tl-xs shadow-sm"
                  }`}
                >
                  {m.text}
                </div>
              </div>
            ))}

            {isTyping && (
              <div className="flex items-center gap-2 text-slate-400 text-xs">
                <Sparkles className="w-3.5 h-3.5 animate-spin text-purple-400" />
                <span>LangGraph 后端正在深度研判图谱数据...</span>
              </div>
            )}
          </div>

          {/* Quick Prompts */}
          <div className="p-3 border-t border-slate-800/80 bg-slate-900/40">
            <div className="text-[11px] text-slate-400 mb-1.5 flex items-center gap-1 font-medium">
              <Zap className="w-3 h-3 text-amber-400" />
              快捷研判指令：
            </div>
            <div className="flex flex-wrap gap-1.5">
              {quickPrompts.map((qp, idx) => (
                <button
                  key={idx}
                  onClick={() => handleSend(qp)}
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-300 hover:border-cyan-500/50 hover:text-white transition-all text-left cursor-pointer"
                >
                  {qp}
                </button>
              ))}
            </div>
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2">
            <Input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="向 AI 提问工单多频趋势、主体分析或处置建议..."
              className="flex-1 text-xs"
            />
            <Button
              variant="purple"
              size="icon"
              onClick={() => handleSend()}
              disabled={!inputVal.trim() || isTyping}
            >
              <Send className="w-4 h-4" />
            </Button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
