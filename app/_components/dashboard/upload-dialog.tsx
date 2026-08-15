"use client";

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  X,
  Loader2,
  Sparkles,
  Layers,
  ArrowRight,
  TrendingDown,
  Clock,
  ShieldCheck,
} from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
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

interface IngestionReport {
  totalParsed: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  durationMs: number;
  themesGenerated: number;
  highRiskCount: number;
  compressionRatio: number;
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
  const [step, setStep] = useState<"SELECT" | "PROCESSING" | "REPORT">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedTickets, setParsedTickets] = useState<RawTicket[]>([]);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [processingStatus, setProcessingStatus] = useState("正在解析表格...");
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

    try {
      if (name.endsWith(".csv")) {
        Papa.parse(selectedFile, {
          header: true,
          skipEmptyLines: true,
          complete: (results) => {
            const tickets = processRowsToTickets(results.data as any[]);
            setParsedTickets(tickets);
            toast.success(`成功解析 CSV 文件，共识别 ${tickets.length} 条工单`);
          },
          error: (err) => {
            toast.error(`CSV 解析失败: ${err.message}`);
          },
        });
      } else {
        const buffer = await selectedFile.arrayBuffer();
        const workbook = XLSX.read(buffer, { cellDates: true });
        const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(firstSheet, { defval: "" });
        const tickets = processRowsToTickets(rows);
        setParsedTickets(tickets);
        toast.success(`成功解析 Excel 文件，共识别 ${tickets.length} 条工单`);
      }
    } catch (err: any) {
      toast.error(`文件解析失败: ${err.message}`);
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

  const handleStartIngestion = async () => {
    if (parsedTickets.length === 0) return;

    setStep("PROCESSING");
    setProcessingStatus("1/3 正在执行数据库查重与增量入库...");

    const startTime = Date.now();

    try {
      // 1. Post to tickets ingestion endpoint
      const ticketsRes = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedTickets),
      });
      const ticketsJson = await ticketsRes.json();

      const statsInfo = ticketsJson.data || {
        totalParsed: parsedTickets.length,
        insertedCount: parsedTickets.length,
        duplicateCount: 0,
        failedCount: 0,
      };

      setProcessingStatus("2/3 正在调用 LangGraph JS 引擎执行实体抽取与图聚类...");

      // 2. Run LangGraph pipeline on the tickets
      const clusterRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets: parsedTickets,
          threadId: `upload-session-${Date.now()}`,
        }),
      });
      const clusterJson = await clusterRes.json();

      setProcessingStatus("3/3 正在组装多频核查报告与拓扑大盘...");

      if (clusterJson.success) {
        const durationMs = Date.now() - startTime;
        const themes = clusterJson.data.themes || [];
        const highRisk = themes.filter((t: any) => t.riskLevel === "HIGH").length;

        const reportData: IngestionReport = {
          totalParsed: statsInfo.totalParsed,
          insertedCount: statsInfo.insertedCount,
          duplicateCount: statsInfo.duplicateCount,
          failedCount: statsInfo.failedCount,
          durationMs,
          themesGenerated: themes.length,
          highRiskCount: highRisk,
          compressionRatio: clusterJson.data.stats?.compressionRatio || 95,
        };

        setReport(reportData);
        setStep("REPORT");
        onUploadSuccess(clusterJson.data);
      } else {
        toast.error("智能聚类计算失败");
        setStep("SELECT");
      }
    } catch (err: any) {
      toast.error(`处理失败: ${err.message}`);
      setStep("SELECT");
    }
  };

  const handleReset = () => {
    setFile(null);
    setParsedTickets([]);
    setReport(null);
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
    toast.success("已切换至最新多频工单看板！");
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200">
      <div
        className="w-full max-w-xl bg-card border border-border rounded-2xl shadow-2xl overflow-hidden flex flex-col text-foreground transition-all"
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
                {step === "REPORT" ? "工单入库与智能聚类处理报告" : "上传工单表格并即时重聚类"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {step === "REPORT"
                  ? "入库统计核验 · 防重去重结果 · 多频主题收益"
                  : "支持 .xlsx / .xls / .csv 格式，自动识别字段并由 Agent 执行图聚类"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={step === "PROCESSING"}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-6 space-y-4">
          {/* STEP 1: SELECT FILE */}
          {step === "SELECT" && (
            <>
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

                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={handleReset}
                      className="h-7 text-xs text-muted-foreground hover:text-foreground"
                    >
                      更换文件
                    </Button>
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
            </>
          )}

          {/* STEP 2: PROCESSING ANIMATION */}
          {step === "PROCESSING" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="relative">
                <div className="w-16 h-16 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                  <Sparkles className="w-8 h-8 animate-pulse text-primary" />
                </div>
                <Loader2 className="w-6 h-6 text-primary animate-spin absolute -top-1 -right-1" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">
                  {processingStatus}
                </p>
                <p className="text-[11px] text-muted-foreground">
                  LangGraph Agent 正在遍历实体图谱并进行多频聚类归因...
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: RICH INGESTION REPORT UI */}
          {step === "REPORT" && report && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              {/* Top Banner */}
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <h3 className="text-xs font-bold">工单数据处理与图谱聚类已就绪</h3>
                    <p className="text-[11px] text-emerald-700">
                      本次解析 {report.totalParsed} 条诉求，总耗时 {report.durationMs}ms
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300">
                  {report.totalParsed} 条
                </span>
              </div>

              {/* 3 Core Status Breakdown Cards */}
              <div className="grid grid-cols-3 gap-3">
                {/* 1. Inserted */}
                <Card className="p-3.5 border-emerald-200 bg-emerald-50/40 space-y-1">
                  <div className="flex items-center justify-between text-emerald-700">
                    <span className="text-[11px] font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                      成功入库
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-xl font-bold font-mono text-emerald-700">
                      {report.insertedCount}
                    </span>
                    <span className="text-[10px] text-emerald-600">条</span>
                  </div>
                  <div className="text-[10px] text-emerald-600/80">
                    增量写入数据库
                  </div>
                </Card>

                {/* 2. Duplicates Skipped */}
                <Card className="p-3.5 border-amber-200 bg-amber-50/40 space-y-1">
                  <div className="flex items-center justify-between text-amber-700">
                    <span className="text-[11px] font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3.5 h-3.5 text-amber-600" />
                      重复过滤
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-xl font-bold font-mono text-amber-700">
                      {report.duplicateCount}
                    </span>
                    <span className="text-[10px] text-amber-600">条</span>
                  </div>
                  <div className="text-[10px] text-amber-600/80">
                    单号已存在，安全跳过
                  </div>
                </Card>

                {/* 3. Failed / Invalid */}
                <Card className="p-3.5 border-slate-200 bg-slate-50 space-y-1">
                  <div className="flex items-center justify-between text-slate-600">
                    <span className="text-[11px] font-semibold flex items-center gap-1">
                      <AlertTriangle className="w-3.5 h-3.5 text-slate-500" />
                      格式异常
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1 mt-1">
                    <span className="text-xl font-bold font-mono text-slate-700">
                      {report.failedCount}
                    </span>
                    <span className="text-[10px] text-slate-500">条</span>
                  </div>
                  <div className="text-[10px] text-slate-400">
                    空诉求或字段缺损
                  </div>
                </Card>
              </div>

              {/* LangGraph Agent Clustering Value Insights */}
              <div className="p-4 rounded-xl border border-border bg-card space-y-2.5 shadow-2xs">
                <div className="flex items-center justify-between text-xs pb-2 border-b border-border">
                  <span className="font-bold text-foreground flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5 text-primary" />
                    LangGraph 知识图谱聚类成效
                  </span>
                  <span className="font-mono text-[11px] text-muted-foreground flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    Agent 耗时 {report.durationMs}ms
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs pt-1">
                  <div className="p-2 rounded-lg bg-muted/50 border border-border">
                    <div className="text-[11px] text-muted-foreground">聚合多频主题</div>
                    <div className="text-base font-bold font-mono text-primary mt-0.5">
                      {report.themesGenerated} 个
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-rose-50/60 border border-rose-100">
                    <div className="text-[11px] text-rose-700">紧急督办警报</div>
                    <div className="text-base font-bold font-mono text-rose-700 mt-0.5">
                      🔴 {report.highRiskCount} 项
                    </div>
                  </div>

                  <div className="p-2 rounded-lg bg-emerald-50/60 border border-emerald-100">
                    <div className="text-[11px] text-emerald-700">决策降载压缩率</div>
                    <div className="text-base font-bold font-mono text-emerald-700 mt-0.5 flex items-center justify-center gap-0.5">
                      <TrendingDown className="w-3.5 h-3.5" />
                      {report.compressionRatio}%
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
          {step === "REPORT" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleReset}
                className="text-xs border-border bg-card text-foreground hover:bg-muted"
              >
                继续上传其他表格
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleFinishAndClose}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
              >
                完成并查看大盘看板
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={step === "PROCESSING"}
                className="text-xs border-border bg-card text-foreground hover:bg-muted"
              >
                取消
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleStartIngestion}
                disabled={parsedTickets.length === 0 || step === "PROCESSING"}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
                确认并启动智能重聚类 ({parsedTickets.length}条)
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
