"use client";

import React, { useState, useRef } from "react";
import { type NodeProps, type Node, Position } from "@xyflow/react";
import { Inbox, Upload, FileSpreadsheet, CheckCircle2, Clock } from "lucide-react";
import { toast } from "sonner";
import { PipelineNodeShell } from "./pipeline-node-shell";

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
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    if (!file) return;
    const name = file.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error("仅支持上传 .xlsx, .xls 或 .csv 格式工单表格");
      return;
    }

    setUploading(true);
    toast.info(`正在解析并接入「${file.name}」...`);

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/tickets/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();
      if (json.success) {
        toast.success(`工单接入成功！新增 ${json.data?.insertedCount || 0} 条工单`);
        if (data.onIngestSuccess) data.onIngestSuccess();
      } else {
        toast.error(json.error || "工单解析入库失败");
      }
    } catch (err: any) {
      toast.error(`上传通信异常: ${err.message}`);
    } finally {
      setUploading(false);
      setIsDragging(false);
    }
  };

  const isActive = data.status === "running" && data.unprocessedTickets > 0;
  const isAllReady = data.unprocessedTickets === 0 && data.totalTickets > 0;

  return (
    <PipelineNodeShell
      stepNumber="01"
      title="诉求受理与接入台"
      icon={<Inbox size={15} />}
      iconGradient="linear-gradient(135deg, #2563EB 0%, #1D4ED8 100%)"
      status={data.status}
      statusText={uploading ? "正在入库" : isActive ? "持续接入" : isAllReady ? "入库就绪" : "待命中"}
      hasTargetHandle={false}
      hasSourceHandle={true}
      sourceHandleColor="#1677FF"
      sourceHandlePosition={Position.Right}
    >
      {/* 指标看板 */}
      <div className="grid grid-cols-3 gap-2 bg-slate-50 p-2.5 rounded-lg border border-slate-100">
        <div>
          <div className="pipeline-metric-label">辖区在库总量</div>
          <div className="pipeline-metric-value text-blue-600 mt-1">{data.totalTickets}</div>
        </div>
        <div>
          <div className="pipeline-metric-label">待研判积压</div>
          <div className={`pipeline-metric-value mt-1 ${data.unprocessedTickets > 0 ? "text-amber-600" : "text-emerald-600"}`}>
            {data.unprocessedTickets}
          </div>
        </div>
        <div className="border-l border-slate-200 pl-2 flex flex-col justify-center">
          <div className="text-[10px] text-slate-400 font-medium">接入渠道</div>
          <div className="text-[11px] font-semibold text-slate-700 mt-0.5">热线 · 微信 · 网格</div>
        </div>
      </div>

      {/* 快捷拖拽/点击上传工单区 */}
      <input
        type="file"
        ref={fileInputRef}
        style={{ display: "none" }}
        accept=".xlsx,.xls,.csv"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFileUpload(f);
        }}
      />
      <div
        className={`pipeline-drop-zone ${isDragging ? "is-dragover" : ""}`}
        onDragOver={(e) => {
          e.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          const f = e.dataTransfer.files?.[0];
          if (f) handleFileUpload(f);
        }}
        onClick={() => fileInputRef.current?.click()}
      >
        <div className="flex items-center justify-center gap-1.5 text-xs font-semibold text-slate-700">
          <Upload size={13} className="text-blue-600" />
          <span>{uploading ? "正在解析导入..." : "拖入表格或点击追加工单"}</span>
        </div>
        <div className="text-[10px] text-slate-400 mt-0.5">支持 .xlsx / .xls / .csv 批量入库</div>
      </div>

      {/* 最新入库诉求滚动预览 */}
      {data.recentTickets && data.recentTickets.length > 0 && (
        <div className="pipeline-snippet-box">
          <div className="pipeline-snippet-title">
            <span className="flex items-center gap-1.5 text-slate-700">
              <Clock size={11} className="shrink-0 text-blue-500" />
              最新接入流水
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
