"use client";

import React from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import Link from "next/link";
import {
  Send,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FolderKanban,
  ClipboardCheck,
} from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";

export type DisposalNodeData = {
  pendingThemes: number;
  inProgressThemes: number;
  resolvedThemes: number;
  fakeClosureTickets: number;
  pendingReviewCount: number;
  status: "idle" | "running" | "completed";
  statusText?: string;
};

export type DisposalNodeType = Node<DisposalNodeData, "disposal">;

export function DisposalNode({ data }: NodeProps<DisposalNodeType>) {
  const totalThemes =
    (data.pendingThemes || 0) +
    (data.inProgressThemes || 0) +
    (data.resolvedThemes || 0);
  const resolvedPct =
    totalThemes > 0 ? Math.round(((data.resolvedThemes || 0) / totalThemes) * 100) : 0;

  return (
    <PipelineNodeShell
      stepNumber="06"
      title="协同处置与闭环回流"
      icon={<Send size={15} />}
      iconGradient="linear-gradient(135deg, #2563EB 0%, #4F46E5 100%)"
      themeColor="#2563EB"
      status={data.status}
      statusText={
        data.statusText ||
        (data.fakeClosureTickets > 0
          ? `拦截假闭环 ${data.fakeClosureTickets} 件`
          : totalThemes > 0
            ? `办结率 ${resolvedPct}%`
            : "待派单")
      }
      hasTargetHandle={true}
      targetHandlePosition={Position.Right}
      targetHandleColor="#059669"
      hasSourceHandle={true}
      sourceHandlePosition={Position.Bottom}
      sourceHandleColor="#F59E0B"
    >
      {/* 三态处置分布 */}
      <div className="grid grid-cols-3 gap-1.5">
        <div className="bg-slate-50 border border-slate-200/80 rounded-lg p-2">
          <div className="text-[10px] text-slate-500 flex items-center gap-1 whitespace-nowrap">
            <Clock size={10} className="text-amber-500 shrink-0" aria-hidden="true" />
            待派单
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-slate-900 mt-0.5">
            {(data.pendingThemes || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-blue-50/70 border border-blue-200/70 rounded-lg p-2">
          <div className="text-[10px] text-blue-700 flex items-center gap-1 whitespace-nowrap">
            <Send size={10} className="text-blue-600 shrink-0" aria-hidden="true" />
            处理中
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-blue-900 mt-0.5">
            {(data.inProgressThemes || 0).toLocaleString()}
          </div>
        </div>
        <div className="bg-emerald-50/70 border border-emerald-200/70 rounded-lg p-2">
          <div className="text-[10px] text-emerald-700 flex items-center gap-1 whitespace-nowrap">
            <CheckCircle2 size={10} className="text-emerald-600 shrink-0" aria-hidden="true" />
            已办结
          </div>
          <div className="text-base font-bold font-mono tabular-nums text-emerald-900 mt-0.5">
            {(data.resolvedThemes || 0).toLocaleString()}
          </div>
        </div>
      </div>

      {/* 假闭环与复核哨兵 */}
      <div className="grid grid-cols-2 gap-2">
        <div className="bg-rose-50/80 border border-rose-200/80 rounded-lg p-2 flex items-center justify-between">
          <span className="text-[10px] text-rose-700 font-medium flex items-center gap-1">
            <AlertTriangle size={11} className="text-rose-600 shrink-0" aria-hidden="true" />
            假闭环拦截
          </span>
          <span className="font-mono tabular-nums text-sm font-bold text-rose-900">
            {(data.fakeClosureTickets || 0).toLocaleString()}
          </span>
        </div>
        <div className="bg-amber-50/80 border border-amber-200/80 rounded-lg p-2 flex items-center justify-between">
          <span className="text-[10px] text-amber-800 font-medium flex items-center gap-1">
            <ClipboardCheck size={11} className="text-amber-600 shrink-0" aria-hidden="true" />
            待复核队列
          </span>
          <span className="font-mono tabular-nums text-sm font-bold text-amber-950">
            {(data.pendingReviewCount || 0).toLocaleString()}
          </span>
        </div>
      </div>

      {/* 直达操作出口 */}
      <div className="pipeline-snippet-box">
        <div className="grid grid-cols-2 gap-2">
          <Link
            href="/themes"
            className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-blue-500 hover:text-blue-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <FolderKanban size={12} className="text-blue-600" aria-hidden="true" />
            群组协同处置
          </Link>
          <Link
            href="/tickets?tab=fake_closure"
            className="flex items-center justify-center gap-1.5 min-h-[44px] sm:min-h-0 py-1.5 px-2 rounded-md bg-white border border-slate-200 hover:border-rose-500 hover:text-rose-600 text-[11px] font-medium text-slate-700 transition-colors shadow-2xs"
          >
            <AlertTriangle size={12} className="text-rose-600" aria-hidden="true" />
            核查假闭环
          </Link>
        </div>
      </div>
    </PipelineNodeShell>
  );
}
