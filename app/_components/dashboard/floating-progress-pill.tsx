"use client";

import React from "react";
import { Loader2, Maximize2, Sparkles, CheckCircle2, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { TaskProgress } from "@/lib/task-progress";

interface FloatingProgressPillProps {
  progress: TaskProgress;
  isVisible: boolean;
  onExpand: () => void;
}

export const FloatingProgressPill: React.FC<FloatingProgressPillProps> = ({
  progress,
  isVisible,
  onExpand,
}) => {
  if (!isVisible) return null;

  const isCompleted = progress.status === "COMPLETED";
  const isFailed = progress.status === "FAILED";

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, scale: 0.85, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.85, y: 20 }}
        transition={{ duration: 0.22, ease: "easeOut" }}
        className="fixed bottom-6 right-6 z-[280] select-none"
      >
        <button
          onClick={onExpand}
          className="group flex items-center gap-3 px-3.5 py-2 rounded-full border border-border/70 bg-card/90 hover:bg-card text-foreground shadow-xl backdrop-blur-md transition-all hover:scale-[1.02] active:scale-[0.98] cursor-pointer ring-1 ring-primary/20 hover:ring-primary/40"
        >
          {/* 状态动效图标 */}
          <div className="relative flex items-center justify-center">
            {!isCompleted && !isFailed ? (
              <div className="relative flex items-center justify-center w-5 h-5">
                <Loader2 className="w-4 h-4 animate-spin text-primary" />
                <span className="absolute -top-0.5 -right-0.5 flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                </span>
              </div>
            ) : isCompleted ? (
              <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            ) : (
              <AlertTriangle className="w-5 h-5 text-rose-500" />
            )}
          </div>

          {/* 阶段名称与百分比 */}
          <div className="flex flex-col text-left">
            <div className="flex items-center gap-1.5">
              <span className="text-xs font-semibold text-foreground tracking-tight">
                {isCompleted
                  ? "研判流水线已就绪"
                  : isFailed
                  ? "流水线异常"
                  : progress.stage === "SYNTHESIZING"
                  ? "主题建议"
                  : progress.stage === "CLUSTERING"
                  ? "同一事件归并"
                  : "分类与抽取"}
              </span>
              <span className="font-mono text-xs font-bold text-primary">
                {progress.percent}%
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground line-clamp-1 max-w-[140px]">
              {progress.stageText || "后台运行中..."}
            </p>
          </div>

          {/* 悬浮展开提示 */}
          <div className="pl-1 border-l border-border/50 text-muted-foreground group-hover:text-primary transition-colors">
            <Maximize2 className="w-3.5 h-3.5" />
          </div>
        </button>
      </motion.div>
    </AnimatePresence>
  );
};
