"use client";

import React, { useState, useRef, useEffect } from "react";
import {
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
  RefreshCw,
  Clock,
  Layers,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import type { MultiFrequencyTheme, OverallStats, GraphData } from "@/backend/state";
import type { TaskProgress } from "@/lib/task-progress";
import { claimClusterTask, releaseClusterTask } from "@/lib/cluster-client";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (data: {
    themes: MultiFrequencyTheme[];
    stats: OverallStats;
    graphData: GraphData;
  }) => void;
  onDatabaseUpdated?: () => void;
  /** 右上角「启动 AI 聚类」：跳过选文件，直接进入研判进度条 */
  autoStartCluster?: boolean;
  onClusteringChange?: (running: boolean) => void;
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
  autoStartCluster = false,
  onClusteringChange,
}) => {
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "CLUSTERING" | "ERROR">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Real Backend Progress State
  const [taskProgress, setTaskProgress] = useState<TaskProgress>({
    taskId: "",
    status: "PENDING",
    stage: "EXTRACTING",
    stageText: "准备就绪",
    percent: 0,
    total: 0,
    processed: 0,
    extractedCount: 0,
    themeCount: 0,
    reviewCount: 0,
    failedCount: 0,
    updatedAt: Date.now(),
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const pollTimerRef = useRef<NodeJS.Timeout | null>(null);
  const clusterStartedRef = useRef(false);
  const startClusterRef = useRef<() => Promise<void>>(async () => {});

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // Lock background body scroll when open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) {
      clusterStartedRef.current = false;
      setStep("SELECT");
      return;
    }
    if (autoStartCluster) {
      setStep("CLUSTERING");
      if (!clusterStartedRef.current) {
        clusterStartedRef.current = true;
        void startClusterRef.current();
      }
    }
  }, [isOpen, autoStartCluster]);

  if (!isOpen) return null;

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

  // 阶段 1：流式直传后端解析并批量入库
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
        setErrorMessage(json.error || "后端解析失败，请检查文件格式");
        setStep("ERROR");
        toast.error(`上传入库失败: ${json.error || "未知错误"}`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "网络通信异常，请重试");
      setStep("ERROR");
      toast.error(`网络或处理异常: ${err.message}`);
    }
  };

  // 阶段 2：启动 LangGraph Agent 智能聚类（基于后端真实 p-queue 进度轮询）
  const handleStartAgentClustering = async () => {
    const claimed = claimClusterTask(`task-cluster-${Date.now()}`);
    const taskId = claimed.taskId;
    setStep("CLUSTERING");
    onClusteringChange?.(true);

    if (!claimed.claimed) {
      return;
    }

    setTaskProgress({
      taskId,
      status: "RUNNING",
      stage: "EXTRACTING",
      stageText: "正在初始化 LangGraph 多频研判流水线...",
      percent: 5,
      total: report?.insertedCount || 300,
      processed: 0,
      extractedCount: 0,
      themeCount: 0,
      reviewCount: 0,
      failedCount: 0,
      updatedAt: Date.now(),
    });

    // 进度轮询：只读内存进度，不触发 LLM。1.5s 一次，结束即停。
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    let pollInFlight = false;
    pollTimerRef.current = setInterval(async () => {
      if (pollInFlight) return;
      pollInFlight = true;
      try {
        const pRes = await fetch(`/api/cluster/progress?taskId=${taskId}`);
        const pJson = await pRes.json();
        if (pJson.success && pJson.data) {
          setTaskProgress((prev) => ({
            ...prev,
            ...pJson.data,
          }));
          const st = pJson.data.status;
          if (st === "COMPLETED" || st === "FAILED") {
            if (pollTimerRef.current) clearInterval(pollTimerRef.current);
          }
        }
      } catch (e) {
        // Silent poll error
      } finally {
        pollInFlight = false;
      }
    }, 1500);

    toast.info("正在唤起 LangGraph Agent 执行知识图谱聚类...");

    try {
      const clusterRes = await fetch("/api/cluster", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId,
          threadId: taskId,
        }),
      });
      const clusterJson = await clusterRes.json();

      if (pollTimerRef.current) clearInterval(pollTimerRef.current);

      if (clusterJson.success) {
        setTaskProgress((prev) => ({
          ...prev,
          percent: 100,
          status: "COMPLETED",
          stageText: `研判完成！已聚合 ${clusterJson.data.themes.length} 个多频主题`,
        }));
        onClusteringChange?.(false);
        releaseClusterTask(taskId);

        setTimeout(() => {
          toast.success(`Agent 研判完成！已生成 ${clusterJson.data.themes.length} 个多频治理主题！`);
          onUploadSuccess(clusterJson.data);
          handleFinishAndClose();
        }, 500);
      } else {
        onClusteringChange?.(false);
        releaseClusterTask(taskId);
        setErrorMessage(clusterJson.error || "Agent 智能聚类失败");
        setStep("ERROR");
        toast.error("智能聚类失败，请重试");
      }
    } catch (err: any) {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
      onClusteringChange?.(false);
      releaseClusterTask(taskId);
      setErrorMessage(err.message || "Agent 调用网络超时或中断");
      setStep("ERROR");
      toast.error(`Agent 研判异常: ${err.message}`);
    }
  };
  startClusterRef.current = handleStartAgentClustering;

  const handleReset = () => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    setFile(null);
    setReport(null);
    setErrorMessage("");
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 backdrop-blur-xs p-4 animate-in fade-in duration-150"
      onClick={() => {
        if (step !== "INGESTING" && step !== "CLUSTERING") {
          onClose();
        }
      }}
    >
      <div
        className="w-full max-w-xl bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Modal Header */}
        <div className="px-5 py-4 border-b border-border flex items-center justify-between bg-muted/20">
          <div className="flex items-center gap-2.5">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary">
              {step === "CLUSTERING" ? (
                <Bot className="w-4 h-4 text-primary" />
              ) : (
                <Database className="w-4 h-4 text-primary" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-semibold text-foreground">
                {step === "REPORT"
                  ? "入库校验报告"
                  : step === "CLUSTERING"
                  ? "LangGraph Agent 智能研判中"
                  : step === "INGESTING"
                  ? "数据表格解析入库"
                  : step === "ERROR"
                  ? "处理异常"
                  : "工单表格上传与入库"}
              </h2>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={step === "INGESTING" || step === "CLUSTERING"}
            className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-5 space-y-4">
          <AnimatePresence mode="wait">
            {/* STEP 1: SELECT FILE */}
            {step === "SELECT" && (
              <motion.div
                key="select"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {!file ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border border-dashed rounded-xl p-8 flex flex-col items-center justify-center gap-2.5 cursor-pointer transition-colors ${
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
                    <div className="w-10 h-10 rounded-lg bg-muted flex items-center justify-center text-muted-foreground">
                      <FileSpreadsheet className="w-5 h-5 text-primary" />
                    </div>
                    <div className="text-center space-y-0.5">
                      <p className="text-xs font-semibold text-foreground">
                        点击选择工单文件 或 将表格拖拽至此
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        支持 12345 热线工单表格（.xlsx / .xls / .csv），百兆文件直接流式解析入库
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="p-3.5 rounded-lg border border-border bg-muted/30 flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <FileSpreadsheet className="w-5 h-5 text-primary shrink-0" />
                        <div>
                          <p className="text-xs font-semibold text-foreground truncate max-w-sm">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground">
                            大小：{(file.size / (1024 * 1024)).toFixed(2)} MB
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="h-7 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        更换文件
                      </Button>
                    </div>

                    <div className="p-3 rounded-lg border border-border bg-muted/20 text-[11.5px] text-muted-foreground flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                      <span>
                        服务端采用流式解析与批量落库，前端 0 内存开销，保障流畅稳定。
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* STEP 2: INGESTING */}
            {step === "INGESTING" && (
              <motion.div
                key="ingesting"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-6 flex flex-col items-center justify-center gap-3 text-center"
              >
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <div className="space-y-1">
                  <p className="text-xs font-semibold text-foreground">
                    正在执行流式数据解析与 PostgreSQL 入库...
                  </p>
                  <p className="text-[11px] text-muted-foreground">
                    执行流水号唯一性排重与批量事务写入
                  </p>
                </div>
              </motion.div>
            )}

            {/* STEP 3: CLUSTERING (REAL BACKEND P-QUEUE PROGRESS) */}
            {step === "CLUSTERING" && (
              <motion.div
                key="clustering"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-2 space-y-4"
              >
                {/* Header & Percentage */}
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <div className="flex items-center gap-2">
                      <Loader2 className="w-3.5 h-3.5 animate-spin text-primary" />
                      <span className="text-xs font-semibold text-foreground">
                        {taskProgress.stageText || "处理中..."}
                      </span>
                    </div>
                    <p className="text-[11px] text-muted-foreground pl-5.5">
                      P-Queue 3 线程并发处理 · 实体抽取与连通图谱聚类
                    </p>
                  </div>

                  <div className="text-right">
                    <span className="text-lg font-bold font-mono text-primary">
                      {taskProgress.percent}%
                    </span>
                  </div>
                </div>

                {/* Clean Professional Progress Bar */}
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden border border-border/50">
                  <motion.div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${taskProgress.percent}%` }}
                  />
                </div>

                {/* Real Metrics Grid */}
                <div className="grid grid-cols-4 gap-2 pt-1">
                  <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">总工单量</span>
                    <p className="text-sm font-bold font-mono text-foreground">
                      {taskProgress.total || report?.insertedCount || 0}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">已抽取工单</span>
                    <p className="text-sm font-bold font-mono text-foreground">
                      {taskProgress.processed}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">已聚类主题</span>
                    <p className="text-sm font-bold font-mono text-primary">
                      {taskProgress.themeCount}
                    </p>
                  </div>

                  <div className="p-2.5 rounded-lg border border-border bg-muted/20 space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">低置信复核</span>
                    <p className="text-sm font-bold font-mono text-amber-600">
                      {taskProgress.reviewCount}
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 4: INGESTION REPORT */}
            {step === "REPORT" && report && (
              <motion.div
                key="report"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3"
              >
                {/* Banner */}
                <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                    <div>
                      <h3 className="text-xs font-semibold">工单入库成功</h3>
                      <p className="text-[11px] text-emerald-700">
                        解析 {report.totalParsed} 条，耗时 {(report.durationMs / 1000).toFixed(2)} 秒
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-300">
                    {report.totalParsed} 条
                  </span>
                </div>

                {/* 3 Metrics Cards */}
                <div className="grid grid-cols-3 gap-2.5">
                  <Card className="p-3 border-border bg-muted/20 space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">成功入库</span>
                    <p className="text-base font-bold font-mono text-foreground">
                      {report.insertedCount.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">条</span>
                    </p>
                  </Card>

                  <Card className="p-3 border-border bg-muted/20 space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">重复过滤</span>
                    <p className="text-base font-bold font-mono text-foreground">
                      {report.duplicateCount.toLocaleString()} <span className="text-[10px] font-normal text-muted-foreground">条</span>
                    </p>
                  </Card>

                  <Card className="p-3 border-border bg-muted/20 space-y-0.5">
                    <span className="text-[11px] text-muted-foreground">格式异常</span>
                    <p className="text-base font-bold font-mono text-foreground">
                      {report.failedCount} <span className="text-[10px] font-normal text-muted-foreground">条</span>
                    </p>
                  </Card>
                </div>
              </motion.div>
            )}

            {/* STEP 5: ERROR STATE */}
            {step === "ERROR" && (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-4 flex flex-col items-center justify-center gap-2 text-center"
              >
                <AlertTriangle className="w-6 h-6 text-destructive" />
                <div className="space-y-0.5 max-w-md">
                  <p className="text-xs font-semibold text-foreground">处理中断</p>
                  <p className="text-[11px] text-muted-foreground">{errorMessage}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="mt-2 h-7 text-xs"
                >
                  <RefreshCw className="w-3 h-3 mr-1" />
                  返回重试
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Modal Footer */}
        <div className="px-5 py-3.5 border-t border-border bg-muted/10 flex items-center justify-between">
          {step === "REPORT" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFinishAndClose}
                className="h-8 text-xs border-border bg-card text-foreground hover:bg-muted cursor-pointer"
              >
                仅完成入库
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleStartAgentClustering}
                className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                启动 Agent 智能聚类研判
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </>
          ) : step === "CLUSTERING" ? (
            <p className="w-full text-[11px] text-muted-foreground">研判进行中，完成后将自动刷新页面</p>
          ) : step === "ERROR" ? (
            <div className="w-full flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="h-8 text-xs cursor-pointer"
              >
                关闭
              </Button>
            </div>
          ) : (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                disabled={step === "INGESTING"}
                className="h-8 text-xs border-border bg-card text-foreground hover:bg-muted cursor-pointer"
              >
                取消
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleUploadAndIngest}
                disabled={!file || step === "INGESTING"}
                className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" />
                上传并流式入库
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );
};
