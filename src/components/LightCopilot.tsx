import React, { useState } from "react";
import {
  X,
  BotMessageSquare,
  Send,
  Sparkles,
  Zap,
  TrendingUp,
  ShieldAlert,
  Flame,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { MultiFrequencyTheme, OverallStats } from "../types";

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
  suggestedThemeId?: string;
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
      text: `您好！我是政务工单研判副驾驶 (Copilot)。当前系统已为您自动聚类出 **${stats.themeCount} 个多频主题**（涵盖 ${stats.multiFrequencyTickets} 件多频工单，压缩率达 ${stats.compressionRatio}%）。\n\n🔴 **最紧急事项**：【金科博翠天下施工项目部】近 3 天累计收到 14 单夜间噪音投诉，且【容桂文海西路】今晨突发爆管已聚类 9 单。您可以直接向我提问或点击预置指令。`,
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

  const handleSend = (textToSend?: string) => {
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

    // Simulate intelligent analytical response
    setTimeout(() => {
      let aiReply = "";
      let targetTheme: MultiFrequencyTheme | undefined;

      if (text.includes("紧急") || text.includes("风险")) {
        const highRisk = themes.filter((t) => t.riskLevel === "HIGH");
        aiReply = `经过 GraphRAG 拓扑与突发密度分析，当前有 **${highRisk.length} 项高危警报** 需立即协同督办：\n\n1. **${highRisk[0]?.title}**（${highRisk[0]?.ticketCount}单）：${highRisk[0]?.riskReason}\n2. **${highRisk[1]?.title}**（${highRisk[1]?.ticketCount}单）：${highRisk[1]?.riskReason}\n3. **${highRisk[2]?.title}**（${highRisk[2]?.ticketCount}单）：${highRisk[2]?.riskReason}\n\n建议优先对前两项启动跨部门应急联席办理机制。`;
        targetTheme = highRisk[0];
      } else if (text.includes("大良") || text.includes("主体")) {
        aiReply = `统计分析显示，**大良街道** 是多频工单最为集中的区域，主要高频主体为：\n- 🏗️ **金科博翠天下施工项目部** (14单 - 夜间施工噪音)\n- 🏢 **保利中汇物业服务中心** (7单 - 4栋电梯下坠故障)\n- 🍢 **顺峰山南门流动摊区** (8单 - 占道经营油烟)\n- 🏬 **顺德万达广场餐饮区** (6单 - 油烟直排扰民)\n\n建议大良综合执法队重点排查逢沙社区与南国东路商圈。`;
      } else if (text.includes("占道") || text.includes("摊贩")) {
        aiReply = `当前系统识别出 2 处典型的流动摊贩多频占道事件：\n1. **顺峰山公园南门广场**（8单）：晚间油烟弥漫，三轮车堵塞非机动车道\n2. **逢沙大道夜市无证烧烤**（5单）：深夜喧哗，地面油污致小学生滑倒\n\n**建议举措**：由于存在巡查后回潮规律，建议城管部门划定规范便民疏导点并加装高点智慧抓拍球机。`;
      } else if (text.includes("简报") || text.includes("总结")) {
        aiReply = `📋 **今日热线多频工单研判日报**：\n- **总受理量**：${stats.totalTickets} 件（多频占比 ${stats.multiFrequencyRate}%）\n- **压缩提效**：由 ${stats.totalTickets} 单压缩为 ${stats.themeCount} 个治理主题（决策负荷降低 ${stats.compressionRatio}%）\n- **重点聚焦**：突发供水管网爆裂（9单）已联动水务抢修；工地超时施工（14单）已建议停工整顿。\n- **预期成效**：预计缩短处置流转耗时 4.8 小时。`;
      } else {
        aiReply = `收到关于「${text}」的研判需求。基于当前工单图谱，系统已关联到【${themes[0]?.canonicalSubject}】等 ${stats.themeCount} 个多频主题。您可以在左侧看板点击任意卡片查看详细工单明细与市民表述对照。`;
      }

      setMessages((prev) => [
        ...prev,
        {
          id: `ai-${Date.now()}`,
          sender: "AI",
          text: aiReply,
          timestamp: "刚刚",
          suggestedThemeId: targetTheme?.id,
        },
      ]);
      setIsTyping(false);
    }, 600);
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
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-950 text-purple-300 border border-purple-800">
                    Copilot
                  </span>
                </h3>
                <p className="text-[11px] text-slate-400">
                  基于热线图谱知识库的实时智能问答
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-4 h-4" />
            </button>
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
                <span>AI 正在研判热线图谱数据...</span>
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
                  className="text-[11px] px-2.5 py-1 rounded-lg bg-slate-900 border border-slate-700/80 text-slate-300 hover:border-cyan-500/50 hover:text-white transition-all text-left"
                >
                  {qp}
                </button>
              ))}
            </div>
          </div>

          {/* Input Box */}
          <div className="p-3 border-t border-slate-800 bg-slate-950 flex items-center gap-2">
            <input
              type="text"
              value={inputVal}
              onChange={(e) => setInputVal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleSend()}
              placeholder="向 AI 提问工单多频趋势、主体分析或处置建议..."
              className="flex-1 bg-slate-900 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 outline-none focus:border-purple-500/60"
            />
            <button
              onClick={() => handleSend()}
              disabled={!inputVal.trim()}
              className="p-2 rounded-xl bg-purple-600 hover:bg-purple-500 text-white transition-all disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
