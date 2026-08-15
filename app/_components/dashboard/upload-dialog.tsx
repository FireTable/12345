"use client";

import React, { useState, useRef } from "react";
import * as XLSX from "xlsx";
import Papa from "papaparse";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Sparkles,
  ArrowRight,
  Clock,
  ShieldCheck,
  Database,
  Bot,
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
  onDatabaseUpdated?: () => void;
}

interface IngestionReport {
  totalParsed: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  durationMs: number;
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
  onDatabaseUpdated,
}) => {
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "CLUSTERING">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [parsedTickets, setParsedTickets] = useState<RawTicket[]>([]);
  const [report, setReport] = useState<IngestionReport | null>(null);
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

  // 阶段 1：只执行数据入库（按钮 1）
  const handleOnlyIngestToDB = async () => {
    if (parsedTickets.length === 0) return;

    setStep("INGESTING");
    const startTime = Date.now();

    try {
      const ticketsRes = await fetch("/api/tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsedTickets),
      });
      const ticketsJson = await ticketsRes.json();

      const durationMs = Date.now() - startTime;
      const statsInfo = ticketsJson.data || {
        totalParsed: parsedTickets.length,
        insertedCount: parsedTickets.length,
        duplicateCount: 0,
        failedCount: 0,
      };

      setReport({
        totalParsed: statsInfo.totalParsed,
        insertedCount: statsInfo.insertedCount,
        duplicateCount: statsInfo.duplicateCount,
        failedCount: statsInfo.failedCount,
        durationMs,
      });

      setStep("REPORT");
      if (onDatabaseUpdated) onDatabaseUpdated();
      toast.success("工单数据已成功入库！");
    } catch (err: any) {
      toast.error(`入库失败: ${err.message}`);
      setStep("SELECT");
    }
  };

  // 阶段 2：执行 Agent 智能聚类研判（按钮 2）
  const handleStartAgentClustering = async () => {
    if (parsedTickets.length === 0) return;

    setStep("CLUSTERING");
    toast.info("正在调用 LangGraph Agent 进行四要素抽取与图谱聚类...");

    try {
      const clusterRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tickets: parsedTickets,
          threadId: `upload-session-${Date.now()}`,
        }),
      });
      const clusterJson = await clusterRes.json();

      if (clusterJson.success) {
        toast.success(`Agent 研判完成！已聚类生成 ${clusterJson.data.themes.length} 个多频治理主题！`);
        onUploadSuccess(clusterJson.data);
        handleFinishAndClose();
      } else {
        toast.error("智能聚类失败，请重试");
        setStep("REPORT");
      }
    } catch (err: any) {
      toast.error(`Agent 研判异常: ${err.message}`);
      setStep("REPORT");
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
              <Database className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground">
                {step === "REPORT"
                  ? "第一阶段：工单数据入库检验报告"
                  : "工单数据文件上传与入库"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {step === "REPORT"
                  ? "已完成数据库写入与防重校验，可按需启动 AI Agent 研判"
                  : "支持 .xlsx / .xls / .csv 格式，先入库存储，后按需启动 Agent 分析"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={step === "INGESTING" || step === "CLUSTERING"}
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

          {/* STEP 2: INGESTING ANIMATION */}
          {step === "INGESTING" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Database className="w-7 h-7 animate-pulse text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">
                  正在批量写入 PostgreSQL 数据库...
                </p>
                <p className="text-[11px] text-muted-foreground">
                  执行单号防重校验与字段结构化存储
                </p>
              </div>
            </div>
          )}

          {/* STEP 3: CLUSTERING ANIMATION */}
          {step === "CLUSTERING" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-purple-50 border border-purple-200 flex items-center justify-center text-purple-600">
                <Bot className="w-7 h-7 animate-bounce text-purple-600" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">
                  LangGraph Agent 正在执行多频实体抽取与图谱聚类...
                </p>
                <p className="text-[11px] text-muted-foreground">
                  构建连通子图 · 识别多频高危警报 · 生成处置摘要
                </p>
              </div>
            </div>
          )}

          {/* STEP 4: INGESTION REPORT (TWO-STAGE DASHBOARD) */}
          {step === "REPORT" && report && (
            <div className="space-y-4 animate-in fade-in zoom-in-95 duration-200">
              {/* Top Banner */}
              <div className="p-3.5 rounded-xl bg-emerald-50/70 border border-emerald-200 text-emerald-900 flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0" />
                  <div>
                    <h3 className="text-xs font-bold">工单数据入库成功</h3>
                    <p className="text-[11px] text-emerald-700">
                      本次检验 {report.totalParsed} 条数据，入库耗时 {report.durationMs}ms
                    </p>
                  </div>
                </div>
                <span className="font-mono text-xs font-bold bg-emerald-100/80 px-2 py-0.5 rounded border border-emerald-300">
                  {report.totalParsed} 条
                </span>
              </div>

              {/* 3 Core Ingestion Badges */}
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
                    新写入数据库
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
                    单号已存在/跳过
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
                    空诉求或缺损
                  </div>
                </Card>
              </div>

              {/* Next Step Callout */}
              <div className="p-4 rounded-xl border border-blue-100 bg-blue-50/60 flex items-start gap-3">
                <Sparkles className="w-4 h-4 text-blue-600 shrink-0 mt-0.5" />
                <div className="space-y-1">
                  <h4 className="text-xs font-bold text-blue-900">
                    第二阶段：是否立即对这批数据进行 AI Agent 智能聚类研判？
                  </h4>
                  <p className="text-[11px] text-blue-700 leading-relaxed">
                    点击下方「启动 Agent 智能聚类研判」按钮，Agent 将自动提取商户主体、地点与多频风险，生成治理主题看板；您也可以选择先仅入库，稍后再统一研判。
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Modal Footer (Distinct Dual Buttons) */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
          {step === "REPORT" ? (
            <>
              {/* 仅完成入库按钮 */}
              <Button
                variant="outline"
                size="sm"
                onClick={handleFinishAndClose}
                className="text-xs border-border bg-card text-foreground hover:bg-muted"
              >
                仅完成入库 (稍后研判)
              </Button>

              {/* 启动 Agent 处理按钮 (按钮 2) */}
              <Button
                variant="default"
                size="sm"
                onClick={handleStartAgentClustering}
                className="text-xs bg-purple-600 text-white hover:bg-purple-700 font-semibold shadow-xs"
              >
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                启动 Agent 智能聚类研判
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={step === "INGESTING" || step === "CLUSTERING"}
                className="text-xs border-border bg-card text-foreground hover:bg-muted"
              >
                取消
              </Button>

              {/* 仅导入入库按钮 (按钮 1) */}
              <Button
                variant="default"
                size="sm"
                onClick={handleOnlyIngestToDB}
                disabled={parsedTickets.length === 0 || step === "INGESTING" || step === "CLUSTERING"}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" />
                第 1 步：导入入库并核验 ({parsedTickets.length}条)
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
