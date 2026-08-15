"use client";

import React, { useState, useRef } from "react";
import {
  Upload,
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Sparkles,
  ArrowRight,
  ShieldCheck,
  Database,
  Bot,
} from "lucide-react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import type { MultiFrequencyTheme, OverallStats, GraphData } from "@/backend/state";

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

export const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  onUploadSuccess,
  onDatabaseUpdated,
}) => {
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "CLUSTERING">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lock background body scroll when Upload Dialog is open
  React.useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  // 1. Instant file selection: No browser parsing, no UI freezing!
  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error("请上传 .xlsx, .xls 或 .csv 格式的工单文件");
      return;
    }
    setFile(selectedFile);
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
      handleFileSelect(e.dataTransfer.files[0]);
    }
  };

  // 阶段 1：流式直传后端解析并批量入库（按钮 1）
  const handleUploadAndIngest = async () => {
    if (!file) return;

    setStep("INGESTING");
    toast.info("正在上传至后端服务器流式解析并入库...");

    const formData = new FormData();
    formData.append("file", file);

    try {
      const res = await fetch("/api/tickets/upload", {
        method: "POST",
        body: formData,
      });
      const json = await res.json();

      if (json.success && json.data) {
        setReport(json.data);
        setStep("REPORT");
        if (onDatabaseUpdated) onDatabaseUpdated();
        toast.success(`后端解析入库完成！共处理 ${json.data.totalParsed} 条工单`);
      } else {
        toast.error(`上传入库失败: ${json.error || "未知错误"}`);
        setStep("SELECT");
      }
    } catch (err: any) {
      toast.error(`网络或处理异常: ${err.message}`);
      setStep("SELECT");
    }
  };

  // 阶段 2：启动 LangGraph Agent 智能聚类（按钮 2）
  const handleStartAgentClustering = async () => {
    setStep("CLUSTERING");
    toast.info("正在唤起 LangGraph JS 引擎进行知识图谱聚类...");

    try {
      const clusterRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
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
    setReport(null);
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (step !== "INGESTING" && step !== "CLUSTERING") {
          onClose();
        }
      }}
    >
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
                  ? "第一阶段：后端入库与防重校验报告"
                  : "工单表格上传与后端入库"}
              </h2>
              <p className="text-[11px] text-muted-foreground">
                {step === "REPORT"
                  ? "数据已安全写入 PostgreSQL，可按需启动 Agent 研判"
                  : "文件直接交付后端流式解析入库，前端 0 卡顿、0 内存占用"}
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
                        handleFileSelect(e.target.files[0]);
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
                      支持政数局热线工单导出表格 (.xlsx / .csv)，支持百兆海量大文件
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
                          文件大小：{(file.size / (1024 * 1024)).toFixed(2)} MB · 准备上传至后端解析
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

                  <div className="p-3.5 rounded-lg border border-blue-100 bg-blue-50/50 text-[11.5px] text-blue-900 flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                    <span>
                      文件将直接交由后端高性能 Node 引擎流式解析入库，前端不执行内存解压，保持极致流畅。
                    </span>
                  </div>
                </div>
              )}
            </>
          )}

          {/* STEP 2: INGESTING ANIMATION */}
          {step === "INGESTING" && (
            <div className="py-12 flex flex-col items-center justify-center gap-4 text-center">
              <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
                <Loader2 className="w-7 h-7 animate-spin text-primary" />
              </div>
              <div className="space-y-1">
                <p className="text-xs font-bold text-foreground">
                  后端正在流式解析表格并写入 PostgreSQL...
                </p>
                <p className="text-[11px] text-muted-foreground">
                  执行单号防重校验、镇街与发生地实体标准化、批量入库
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
                    <h3 className="text-xs font-bold">工单数据后端入库成功</h3>
                    <p className="text-[11px] text-emerald-700">
                      成功解析 {report.totalParsed} 条数据，耗时 {(report.durationMs / 1000).toFixed(2)} 秒
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
                      {report.insertedCount.toLocaleString()}
                    </span>
                    <span className="text-[10px] text-emerald-600">条</span>
                  </div>
                  <div className="text-[10px] text-emerald-600/80">
                    写入数据库
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
                      {report.duplicateCount.toLocaleString()}
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
                    第二阶段：是否立即启动 AI Agent 进行多频图谱聚类？
                  </h4>
                  <p className="text-[11px] text-blue-700 leading-relaxed">
                    点击「启动 Agent 智能聚类研判」，系统将自动对库内工单进行多频归因并刷新看板；您也可以选择仅完成入库，稍后随时在顶部导航栏启动。
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
                onClick={handleUploadAndIngest}
                disabled={!file || step === "INGESTING" || step === "CLUSTERING"}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" />
                第 1 步：上传至后端流式入库
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
