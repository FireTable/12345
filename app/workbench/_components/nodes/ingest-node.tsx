"use client";

import React, { useState } from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Inbox, Upload, Clock } from "lucide-react";
import { PipelineNodeShell } from "./pipeline-node-shell";
import { useCivicWorkflow } from "@/app/_components/civic/civic-workflow";

export type IngestNodeData = {
  totalTickets: number;
  unprocessedTickets: number;
  recentTickets: Array<{
    ticketNo: string;
    title?: string | null;
    content: string;
    subdistrict?: string | null;
    createTime?: string | null;
  }>;
  status: "idle" | "running" | "completed";
  onIngestSuccess?: () => void;
};

export type IngestNodeType = Node<IngestNodeData, "ingest">;

export function IngestNode({ data }: NodeProps<IngestNodeType>) {
  const [isDragging, setIsDragging] = useState(false);
  const { openUpload } = useCivicWorkflow();

  const isActive = data.status === "running" && data.unprocessedTickets > 0;
  const isAllReady = data.unprocessedTickets === 0 && data.totalTickets > 0;

  return (
    <PipelineNodeShell
      stepNumber="01"
      title="工单接收与导入"
      icon={<Inbox size={15} />}
      iconGradient="linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)"
      status={data.status}
      statusText={isActive ? "接收处理中" : isAllReady ? "导入完成" : "等待导入"}
      hasTargetHandle={false}
      hasSourceHandle={true}
      sourceHandleColor="#1677FF"
      sourceHandlePosition={Position.Right}
    >
      {/* 指标看板 */}
      <div className="grid grid-cols-2 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
        <div>
          <div className="pipeline-metric-label">工单总数</div>
          <div className="pipeline-metric-value text-blue-600 mt-1">{data.totalTickets}</div>
        </div>
        <div>
          <div className="pipeline-metric-label">待处理工单</div>
          <div className={`pipeline-metric-value mt-1 ${data.unprocessedTickets > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {data.unprocessedTickets}
          </div>
        </div>
      </div>

      {/* 快捷点击或拖拽触发工单导入弹窗 */}
      <div
        className={`pipeline-drop-zone cursor-pointer transition-colors ${isDragging ? "is-dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setIsDragging(false);
          openUpload();
        }}
        onClick={() => openUpload()}
        title="点击打开工单导入与追加"
      >
        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700">
          <Upload size={13} className="text-blue-600" />
          <span>点击或拖入文件追加导入工单</span>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">支持 Excel/CSV 批量导入与单条录入</div>
      </div>

      {/* 最新导入工单预览 */}
      {data.recentTickets && data.recentTickets.length > 0 && (
        <div className="pipeline-snippet-box">
          <div className="pipeline-snippet-title">
            <span className="flex items-center gap-1.5 text-slate-700">
              <Clock size={11} className="shrink-0 text-blue-500" />
              最新导入工单
              {data.recentTickets[0]?.subdistrict && (
                <span className="text-[9px] px-1.5 py-0.2 rounded bg-slate-200 text-slate-600 font-medium">
                  {data.recentTickets[0].subdistrict}
                </span>
              )}
            </span>
            <span className="font-mono text-[10px] text-slate-400">
              {data.recentTickets[0]?.ticketNo}
            </span>
          </div>
          <div className="mt-1 text-[11.5px] text-slate-700 leading-snug line-clamp-2">
            {data.recentTickets[0]?.title || data.recentTickets[0]?.content || "--"}
          </div>
        </div>
      )}
    </PipelineNodeShell>
  );
}
