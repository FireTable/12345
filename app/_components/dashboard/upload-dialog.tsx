"use client";

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertCircle,
  X,
  Loader2,
  Sparkles,
} from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { toast } from "sonner";
import type { RawTicket, MultiFrequencyTheme, OverallStats, GraphData } from "@/backend/state";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (data: {
    themes: MultiFrequencyTheme[];
    stats: OverallStats;
    graphData: GraphData;
  }) => void;
}

const HEADER_MAP: Record<string, string> = {
  序号: "index",
  工单编号: "ticketNo",
  单号: "ticketNo",
  标题: "title",
  工单标题: "title",
  内容: "content",
  工单内容: "content",
  诉求内容: "content",
  诉求人: "citizenName",
  联系电话: "citizenPhone",
  电话: "citizenPhone",
  登记时间: "createTime",
  所属区域: "district",
  区: "district",
  所属镇街: "subdistrict",
  街道: "subdistrict",
  镇街: "subdistrict",
  诉求渠道: "channel",
};

export const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedTickets, setParsedTickets] = useState<RawTicket[]>([]);
  const [isParsing, setIsParsing] = useState(false);
  const [isClustering, setIsClustering] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const processRowsToTickets = (rows: Record<string, any>[]): RawTicket[] => {
    return rows.map((r, idx) => {
      const normalized: Record<string, any> = {};
      for (const [k, v] of Object.entries(r)) {
        const trimmedKey = k.trim();
        const mappedKey = HEADER_MAP[trimmedKey] || trimmedKey;
        normalized[mappedKey] = typeof v === "string" ? v.replace(/12345/g, "市民服务热线") : v;
      }

      const content = String(normalized.content || normalized.title || "").trim();
      const title = String(normalized.title || "").trim();
      const ticketNo = String(normalized.ticketNo || `GD-UPLOAD-${String(idx + 1).padStart(4, "0")}`);

      let subdistrict = normalized.subdistrict || "大良街道";
      const towns = ["大良", "容桂", "伦教", "勒流", "陈村", "北滘", "乐从", "龙江", "杏坛", "均安"];
      for (const t of towns) {
        if (content.includes(t) || title.includes(t)) {
          subdistrict = t.endsWith("街道") || t.endsWith("镇") ? t : `${t}街道`;
          break;
        }
      }

      let channel = normalized.channel || "市民服务热线";
      if (title.includes("小程序")) channel = "微信小程序";
      else if (title.includes("公众号")) channel = "微信公众号";

      return {
        id: `upload-${Date.now()}-${idx + 1}`,
        ticketNo,
        title,
        content,
        citizenName: normalized.citizenName || `市民*`,
        citizenPhone: normalized.citizenPhone || `138****${String((idx * 137) % 10000).padStart(4, "0")}`,
        district: normalized.district || "顺德区",
        subdistrict,
        channel,
        status: "PENDING",
        createTime: normalized.createTime || new Date().toISOString().slice(0, 19).replace("T", " "),
      };
    });
  };

  const handleFileChange = async (selectedFile: File) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error("请上传 .xlsx, .xls 或 .csv 格式的工单文件");
      return;
    }

    setFile(selectedFile);
    setIsParsing(true);

    try {
      if (name.endsWith(".csv")) {
        Papa.parse(selectedFile, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const tickets = processRowsToTickets(results.data as any[]);
            setParsedTickets(tickets);
            setIsParsing(false);
            toast.success(`成功解析 CSV 文件，共识别 ${tickets.length} 条工单`);
          },
          error: (err) => {
            toast.error(`CSV 解析失败: ${err.message}`);
            setIsParsing(false);
          },
        });
      } else {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: "" });
        const tickets = processRowsToTickets(rows);
        setParsedTickets(tickets);
        setIsParsing(false);
        toast.success(`成功解析 Excel 文件，共识别 ${tickets.length} 条工单`);
      }
    } catch (err: any) {
      toast.error(`文件解析失败: ${err.message}`);
      setIsParsing(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const handleConfirmAndCluster = async () => {
    if (parsedTickets.length === 0) return;

    setIsClustering(true);
    toast.info("正在将新工单提交至 LangGraph Agent 聚类引擎...");

    try {
      // 1. Post to tickets ingestion endpoint
      fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedTickets),
      }).catch(console.warn);

      // 2. Run LangGraph pipeline on the uploaded tickets
      const res = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets: parsedTickets,
          threadId: `upload-session-${Date.now()}`,
        }),
      });

      const json = await res.json();

      if (json.success) {
        toast.success(`聚类分析完成！聚合生成 ${json.data.themes.length} 个多频治理主题！`);
        onUploadSuccess(json.data);
        onClose();
      } else {
        toast.error("智能聚类失败，请重试");
      }
    } catch (err: any) {
      toast.error(`提交失败: ${err.message}`);
    } finally {
      setIsClustering(false);
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedTickets([]);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              <Upload className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                上传工单表格并即时重聚类
              </h2>
              <p className="text-[11px] text-muted-foreground">
                支持 .xlsx / .xls / .csv 格式，自动识别字段并由 Agent 执行图聚类
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={isClustering}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {!file ? (
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                isDragging
                  ? "border-primary bg-primary/5"
                  : "border-border hover:border-primary/60 hover:bg-muted/30"
              }`}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={(e) => {
                  if (e.target.files && e.target.files[0]) {
                    handleFileChange(e.target.files[0]);
                  }
                }}
              />
              <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center text-muted-foreground">
                <FileSpreadsheet className="w-6 h-6 text-primary" />
              </div>
              <div className="text-center">
                <p className="text-xs font-bold text-foreground">
                  点击选择文件 或 将表格拖拽至此区域
                </p>
                <p className="text-[11px] text-muted-foreground mt-1">
                  支持政数局热线工单导出表格 (.xlsx / .csv)
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {/* File Info Card */}
              <div className="p-4 rounded-xl border border-border bg-muted/40 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <FileSpreadsheet className="w-6 h-6 text-primary shrink-0" />
                  <div>
                    <p className="text-xs font-bold text-foreground truncate max-w-xs">
                      {file.name}
                    </p>
                    <p className="text-[11px] text-muted-foreground">
                      {(file.size / 1024).toFixed(1)} KB · 已解析{" "}
                      <strong className="text-foreground">{parsedTickets.length}</strong> 条工单
                    </p>
                  </div>
                </div>

                {!isClustering && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleReset}
                    className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  >
                    更换文件
                  </Button>
                )}
              </div>

              {/* Parsed Sample Preview */}
              {parsedTickets.length > 0 && (
                <div className="space-y-1.5">
                  <div className="text-[11px] font-semibold text-muted-foreground flex items-center justify-between">
                    <span>解析数据样例预览 (前 2 条)：</span>
                    <span className="text-emerald-700 bg-emerald-50 border border-emerald-200 px-1.5 py-0.2 rounded text-[10px] font-mono">
                      格式有效
                    </span>
                  </div>
                  <div className="max-h-36 overflow-y-auto space-y-2 pr-1">
                    {parsedTickets.slice(0, 2).map((t, idx) => (
                      <div
                        key={idx}
                        className="p-2.5 rounded-lg border border-border bg-card text-[11px] space-y-1"
                      >
                        <div className="flex items-center justify-between font-mono text-muted-foreground">
                          <span className="font-bold text-foreground">{t.ticketNo}</span>
                          <span>{t.subdistrict} · {t.channel}</span>
                        </div>
                        <p className="text-foreground/80 line-clamp-2 leading-relaxed">
                          {t.content}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
          <Button
            variant="outline"
            size="sm"
            onClick={onClose}
            disabled={isClustering}
            className="text-xs border-border bg-card text-foreground hover:bg-muted"
          >
            取消
          </Button>

          <Button
            variant="default"
            size="sm"
            onClick={handleConfirmAndCluster}
            disabled={parsedTickets.length === 0 || isParsing || isClustering}
            className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
          >
            {isClustering ? (
              <>
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                正在执行智能图聚类...
              </>
            ) : (
              <>
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                确认并启动智能重聚类 ({parsedTickets.length}条)
              </>
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
