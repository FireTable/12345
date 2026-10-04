"use client";

import React from "react";
import { Sparkles, Brain, Lightbulb, Compass } from "lucide-react";
import type { CockpitInsightItem } from "./cockpit-types";

interface CockpitInsightsProps {
  insights: CockpitInsightItem[];
}

export function CockpitInsights({ insights }: CockpitInsightsProps) {
  const items =
    insights.length > 0
      ? insights
      : [
          {
            id: "def-ins-1",
            title: "夜间流动餐饮油烟与占道扰民复合诉求",
            category: "城市管理",
            ticketCount: 86,
            trendPct: 24,
            canonicalLocation: "金榜上街 / 容桂大道",
            advice: "建议区城管局会同街道办，采取“疏堵结合+分时柔性外摆”试点，协同降噪环保巡查。",
          },
          {
            id: "def-ins-2",
            title: "工业园区早晚高峰网约车违停占道拥堵",
            category: "交通秩序",
            ticketCount: 62,
            trendPct: -8,
            canonicalLocation: "五沙工业园 / 顺德新城",
            advice: "联动交警科技科增设即停即走专属泊位，优化早晚高峰潮汐信号灯时长。",
          },
        ];

  return (
    <div className="w-full h-full flex flex-col rounded-2xl border border-purple-500/30 bg-[#051129]/80 backdrop-blur-xl overflow-hidden p-4 shadow-[0_8px_32px_rgba(0,0,0,0.6)]">
      <div className="flex items-center justify-between pb-2.5 border-b border-purple-500/20 shrink-0">
        <div className="flex items-center gap-2">
          <Brain size={15} className="text-purple-400" />
          <h3 className="text-xs font-semibold text-slate-100 tracking-wider">
            AI 慢思考共性诉求穿透研判
          </h3>
        </div>
        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-purple-950/80 border border-purple-500/40 text-purple-300">
          SYSTEM-2 决策
        </span>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-2 pr-1 custom-cockpit-scrollbar">
        {items.map((item) => (
          <div
            key={item.id}
            className="p-2.5 rounded-xl border border-purple-500/20 bg-purple-950/20 hover:border-purple-400/40 transition-all"
          >
            <div className="flex items-center justify-between text-xs mb-1">
              <div className="flex items-center gap-1.5 font-medium text-slate-100">
                <Sparkles size={12} className="text-purple-400" />
                <span className="line-clamp-1">{item.title}</span>
              </div>
              <span className="text-[11px] font-mono font-bold text-cyan-300 shrink-0">
                {item.ticketCount}件
              </span>
            </div>

            {item.canonicalLocation && (
              <div className="text-[10px] text-slate-300 flex items-center gap-1 mb-1">
                <Compass size={11} className="text-cyan-400" />
                <span>高发点位：{item.canonicalLocation}</span>
              </div>
            )}

            {item.advice && (
              <div className="p-2 rounded-lg bg-black/40 border border-purple-500/20 text-[11px] text-purple-200/90 leading-snug flex items-start gap-1.5">
                <Lightbulb size={13} className="text-amber-400 shrink-0 mt-0.5" />
                <span className="line-clamp-2">{item.advice}</span>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
