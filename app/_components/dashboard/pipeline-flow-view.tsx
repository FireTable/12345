"use client";

import React, { useMemo } from "react";
import {
  FileText,
  Zap,
  Cpu,
  GitMerge,
  Sparkles,
  CheckCircle2,
  AlertCircle,
  Network,
  Layers,
  ArrowRight,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { TaskProgress, ActiveCategoryStats, ActiveClusterSpotlight } from "@/lib/task-progress";

interface PipelineFlowViewProps {
  progress: TaskProgress;
}

interface StepDef {
  key: string;
  number: number;
  title: string;
  sub: string;
  icon: React.ElementType;
}

const STEPS: StepDef[] = [
  {
    key: "INGEST",
    number: 1,
    title: "数据入库校验",
    sub: "清洗 · 排重 · 事务落库",
    icon: FileText,
  },
  {
    key: "SYSTEM1",
    number: 2,
    title: "⚡快思考分流",
    sub: "<1ms 神经分派 · 0-Token",
    icon: Zap,
  },
  {
    key: "EXTRACTION",
    number: 3,
    title: "时空要素抽取",
    sub: "主体 · 微观点位 · 行政区划",
    icon: Cpu,
  },
  {
    key: "ABSORPTION",
    number: 4,
    title: "同一事件归并",
    sub: "同类诉求 · 时间只记节奏",
    icon: GitMerge,
  },
  {
    key: "SYSTEM2",
    number: 5,
    title: "🧠深度慢思考",
    sub: "System-2 · CoT公文研判",
    icon: Sparkles,
  },
];

export const PipelineFlowView: React.FC<PipelineFlowViewProps> = ({ progress }) => {
  const {
    stage,
    status,
    percent,
    total,
    processed,
    fastTrackCount = 0,
    absorbedCount = 0,
    themeCount = 0,
    activeCategories = [],
    recentClusters = [],
    currentReasoning,
    stageText,
  } = progress;

  const isCompleted = status === "COMPLETED";
  const isFailed = status === "FAILED";

  // 计算当前流水线各节点状态
  const activeStepIdx = useMemo(() => {
    if (isCompleted) return 5;
    if (stage === "PARSING") return 0;
    if (stage === "EXTRACTING") {
      // 抽取阶段前期为快思考(0~10%)，后进入要素抽取
      return percent < 12 ? 1 : 2;
    }
    if (stage === "CLUSTERING") return 3;
    if (stage === "SYNTHESIZING") return 4;
    return 0;
  }, [stage, percent, isCompleted]);

  // 各板块预设色调
  const categoryPalette = (cat: string) => {
    if (cat.includes("城管") || cat.includes("市容") || cat.includes("城市管理")) {
      return "from-blue-500/20 to-indigo-500/20 border-blue-500/30 text-blue-400";
    }
    if (cat.includes("市场") || cat.includes("物价") || cat.includes("消费")) {
      return "from-amber-500/20 to-orange-500/20 border-amber-500/30 text-amber-400";
    }
    if (cat.includes("环保") || cat.includes("生态") || cat.includes("噪音")) {
      return "from-emerald-500/20 to-teal-500/20 border-emerald-500/30 text-emerald-400";
    }
    if (cat.includes("交通") || cat.includes("路况") || cat.includes("违停")) {
      return "from-purple-500/20 to-pink-500/20 border-purple-500/30 text-purple-400";
    }
    return "from-slate-500/20 to-zinc-500/20 border-slate-500/30 text-slate-300";
  };

  return (
    <div className="space-y-4 w-full">
      {/* 顶部总览进度与状态文字 */}
      <div className="flex items-center justify-between">
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            {!isCompleted && !isFailed ? (
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-primary"></span>
              </span>
            ) : isCompleted ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-500" />
            )}
            <span className="text-xs font-semibold text-foreground tracking-tight">
              {stageText || "流水线正在运行..."}
            </span>
          </div>
          <p className="text-[11px] text-muted-foreground pl-4.5">
            {isCompleted
              ? `研判流水线已完工 · 共聚合 ${themeCount} 个重点多频主题`
              : "双系统分流 · 同一事件归并 · 本地端侧慢思考推理"}
          </p>
        </div>

        <div className="text-right">
          <div className="flex items-baseline justify-end gap-1 font-mono">
            <span className="text-2xl font-black tracking-tight text-primary">
              {percent}
            </span>
            <span className="text-xs text-muted-foreground font-semibold">%</span>
          </div>
        </div>
      </div>

      {/* 流畅主进度条 */}
      <div className="w-full bg-muted/40 rounded-full h-1.5 overflow-hidden border border-border/40 relative">
        <motion.div
          className="bg-gradient-to-r from-blue-500 via-indigo-500 to-emerald-400 h-full rounded-full relative"
          style={{ width: `${percent}%` }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        >
          {/* 光子掠过动效 */}
          {!isCompleted && !isFailed && (
            <motion.div
              className="absolute top-0 right-0 bottom-0 w-8 bg-white/40 blur-xs"
              animate={{ opacity: [0.3, 1, 0.3] }}
              transition={{ repeat: Infinity, duration: 1.2, ease: "easeInOut" }}
            />
          )}
        </motion.div>
      </div>

      {/* 5 阶段工作流流水线卡片 (Pipeline Step Cards) */}
      <div className="grid grid-cols-5 gap-1.5 pt-1 select-none">
        {STEPS.map((step, idx) => {
          const Icon = step.icon;
          const isDone = isCompleted || activeStepIdx > idx;
          const isCurrent = !isCompleted && activeStepIdx === idx;
          const isUpcoming = !isCompleted && activeStepIdx < idx;

          return (
            <motion.div
              key={step.key}
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, delay: idx * 0.04 }}
              className={`relative flex flex-col justify-between p-2 rounded-lg border transition-all duration-300 min-h-[92px] ${
                isDone
                  ? "border-emerald-500/30 bg-emerald-500/5 shadow-2xs"
                  : isCurrent
                  ? "border-primary/60 bg-primary/10 shadow-[0_0_12px_rgba(59,130,246,0.18)] ring-1 ring-primary/40"
                  : "border-border/30 bg-muted/15 opacity-40 grayscale"
              }`}
            >
              {/* 顶部序号与状态点 */}
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono text-[9px] px-1 py-0.2 rounded bg-muted/60 text-muted-foreground font-semibold">
                  0{step.number}
                </span>
                {isDone ? (
                  <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                ) : isCurrent ? (
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                  </span>
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-muted-foreground/30" />
                )}
              </div>

              {/* 步骤图标与名称 */}
              <div>
                <div className="flex items-center gap-1 mb-0.5">
                  <Icon
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isDone ? "text-emerald-500" : isCurrent ? "text-primary" : "text-muted-foreground"
                    }`}
                  />
                  <span
                    className={`text-[11px] font-bold truncate ${
                      isCurrent ? "text-primary" : isDone ? "text-foreground" : "text-muted-foreground"
                    }`}
                  >
                    {step.title}
                  </span>
                </div>
                <p className="text-[9.5px] text-muted-foreground line-clamp-1 leading-tight">
                  {step.sub}
                </p>
              </div>

              {/* 动态核心指标数 */}
              <div className="mt-1.5 pt-1 border-t border-border/30 flex items-center justify-between">
                <span className="text-[9px] text-muted-foreground">产出</span>
                <span className="font-mono text-xs font-bold text-foreground">
                  {idx === 0 && (total > 0 ? `${total}件` : "--")}
                  {idx === 1 && (fastTrackCount > 0 ? `${fastTrackCount}直通` : "0")}
                  {idx === 2 && (processed > 0 ? `${processed}/${total || "--"}` : "--")}
                  {idx === 3 && (absorbedCount > 0 ? `${absorbedCount}吸附` : "0")}
                  {idx === 4 && (themeCount > 0 ? `${themeCount}主题` : isCompleted ? `${themeCount}主题` : "--")}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>

      {/* 中部：知识图谱板块流转 & 增量主题涌现雷达 */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5 pt-1">
        {/* 左侧：分类流转与知识板块 (Knowledge Sectors) */}
        <div className="p-3 rounded-lg border border-border/50 bg-card/60 backdrop-blur-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Layers className="w-3.5 h-3.5 text-primary" />
              <span>知识图谱板块分流</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              已分流 {activeCategories.reduce((acc, c) => acc + c.count, 0)} 条
            </span>
          </div>

          {activeCategories.length > 0 ? (
            <div className="grid grid-cols-2 gap-1.5">
              {activeCategories.map((cat, i) => (
                <motion.div
                  key={cat.category}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.18, delay: i * 0.03 }}
                  className={`px-2 py-1.5 rounded-md border bg-gradient-to-br flex items-center justify-between ${categoryPalette(
                    cat.category
                  )}`}
                >
                  <span className="text-[11px] font-medium truncate max-w-[85px]">
                    {cat.category}
                  </span>
                  <span className="font-mono text-[11px] font-bold ml-1">
                    {cat.count}
                  </span>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-md">
              <span className="animate-pulse">正在提取工单所属业务板块知识映射...</span>
            </div>
          )}
        </div>

        {/* 右侧：72h 增量时空吸附 / 涌现主题聚落 (Cluster Spotlight) */}
        <div className="p-3 rounded-lg border border-border/50 bg-card/60 backdrop-blur-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
              <Network className="w-3.5 h-3.5 text-indigo-400" />
              <span>多频事件簇涌现与吸附</span>
            </div>
            <span className="text-[10px] text-muted-foreground font-mono">
              {themeCount > 0 ? `${themeCount} 个主题就绪` : "连通子图计算中"}
            </span>
          </div>

          {recentClusters.length > 0 ? (
            <div className="space-y-1.5 max-h-[105px] overflow-y-auto pr-0.5 scrollbar-thin">
              {recentClusters.map((cluster) => (
                <motion.div
                  key={cluster.id}
                  initial={{ opacity: 0, x: 5 }}
                  animate={{ opacity: 1, x: 0 }}
                  className="px-2 py-1 rounded bg-muted/40 border border-border/40 flex items-center justify-between text-xs"
                >
                  <div className="flex items-center gap-1.5 truncate max-w-[190px]">
                    <span className="w-1.5 h-1.5 rounded-full bg-indigo-500 shrink-0" />
                    <span className="text-[11px] text-foreground truncate font-medium">
                      {cluster.name}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded shrink-0">
                    {cluster.ticketCount} 件聚合
                  </span>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="py-4 text-center text-xs text-muted-foreground border border-dashed border-border/40 rounded-md">
              <span className="animate-pulse">
                {stage === "SYNTHESIZING"
                  ? "System-2 正在将时空连通子图聚合成案..."
                  : "正在按同一事件归并..."}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* 底部：System-2 慢思考思维链 (CoT Reasoning Preview) */}
      {currentReasoning && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: "auto" }}
          className="p-2.5 rounded-lg border border-primary/20 bg-primary/5 text-xs space-y-1"
        >
          <div className="flex items-center gap-1.5 text-primary font-semibold text-[11px]">
            <Sparkles className="w-3 h-3 text-primary animate-spin" />
            <span>System-2 深度思考思维链实时反馈</span>
          </div>
          <p className="text-[11px] text-muted-foreground font-mono italic leading-relaxed line-clamp-2">
            "{currentReasoning}"
          </p>
        </motion.div>
      )}
    </div>
  );
};
