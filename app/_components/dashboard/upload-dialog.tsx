"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  ArrowRight,
  ShieldCheck,
  Database,
  Bot,
  RefreshCw,
  Clock,
  ClipboardPaste,
  Minimize2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import type { MultiFrequencyTheme, OverallStats, GraphData } from "@/backend/state";
import type { TaskProgress } from "@/lib/task-progress";
import { claimClusterTask, releaseClusterTask } from "@/lib/cluster-client";
import { resolveApiError } from "@/lib/api-codes";
import { PipelineFlowView } from "./pipeline-flow-view";
import { FloatingProgressPill } from "./floating-progress-pill";

interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess: (data: {
    themes: MultiFrequencyTheme[];
    stats: OverallStats;
    graphData: GraphData;
  }) => void;
  onDatabaseUpdated?: () => void;
  /** 右上角「启动 Agent 研判」：跳过选文件，直接进入研判进度条 */
  autoStartCluster?: boolean;
  onClusteringChange?: (running: boolean) => void;
  /** 刷新后弹窗是关的，点右下角胶囊时要把它打开 */
  onShowProgress?: () => void;
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
  onShowProgress,
}) => {
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "CLUSTERING" | "ERROR">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [ingestTab, setIngestTab] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState<string>("");

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
  const pollGenRef = useRef(0);
  const clusterStartedRef = useRef(false);
  const startClusterRef = useRef<() => Promise<void>>(async () => {});
  const startProgressPollRef = useRef<(taskId: string) => void>(() => {});

  const [isMinimized, setIsMinimized] = useState(false);

  const startProgressPoll = (taskId: string) => {
    if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    const generation = ++pollGenRef.current;

    const tick = async () => {
      if (generation !== pollGenRef.current) return;
      try {
        const res = await fetch(`/api/cluster/progress?taskId=${encodeURIComponent(taskId)}`, {
          cache: "no-store",
        });
        const json = await res.json();
        if (generation !== pollGenRef.current || !json.success || !json.data) return;
        const data = json.data as TaskProgress;
        setTaskProgress((prev) => ({ ...prev, ...data, taskId: data.taskId || taskId }));

        if (data.status !== "COMPLETED" && data.status !== "FAILED") return;

        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        pollTimerRef.current = null;
        pollGenRef.current += 1;
        releaseClusterTask(data.taskId || taskId);
        onClusteringChange?.(false);

        if (data.status === "FAILED") {
          setErrorMessage(data.error || "研判失败");
          setStep("ERROR");
          setIsMinimized(false);
          toast.error(data.error || "研判失败");
          return;
        }

        const [cl, ov] = await Promise.all([
          fetch("/api/clusters", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
          fetch("/api/overview", { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null),
        ]);
        const list = Array.isArray(cl?.topClusters) ? cl.topClusters : [];
        const themes: MultiFrequencyTheme[] = list.map((c: {
          id: string;
          title?: string;
          region?: string;
          type?: string;
          count?: number;
          urgency?: string;
          first_date?: string;
          last_date?: string;
        }) => ({
          id: c.id,
          title: c.title || "",
          canonicalSubject: c.title || "",
          canonicalLocation: c.region || "",
          eventType: c.type || "",
          category: c.type || "",
          riskLevel: c.urgency === "urgent" ? "HIGH" : "LOW",
          riskReason: "",
          ticketCount: c.count || 0,
          timeSpanHours: 0,
          firstOccurrence: c.first_date || "",
          lastOccurrence: c.last_date || "",
          aiSummary: "",
          recommendedAction: "",
          tickets: [],
          relatedSubjects: [],
          relatedLocations: [],
          status: "UNCHECKED" as const,
        }));
        setStep("SELECT");
        setIsMinimized(false);
        onUploadSuccess({
          themes,
          stats: {
            totalTickets: Number(ov?.totalWorkorders || 0),
            multiFrequencyTickets: Number(ov?.multiFreqCount || cl?.totalMultiFreq || 0),
            multiFrequencyRate: 0,
            themeCount: Number(ov?.multiFreqClusters || cl?.totalClusters || themes.length),
            highRiskCount: themes.filter((t) => t.riskLevel === "HIGH").length,
            mediumRiskCount: 0,
            lowRiskCount: 0,
            compressionRatio: 0,
            topSubject: themes[0]?.title || "",
            avgResponseTimeSavedHours: 0,
          },
          graphData: { nodes: [], links: [] },
        });
      } catch {
        // 下一拍再试，队列进程还在跑
      }
    };

    void tick();
    pollTimerRef.current = setInterval(() => void tick(), 2000);
  };
  startProgressPollRef.current = startProgressPoll;

  // Stop polling on unmount
  useEffect(() => {
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current);
    };
  }, []);

  // 断点续播感知：刷新页面后接着看队列里的任务，并继续轮询
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/cluster/progress?taskId=latest", { cache: "no-store" })
      .then((r) => r.json())
      .then((j) => {
        const data = j.data as TaskProgress | null;
        const resumable =
          data?.taskId &&
          data.taskId !== "latest" &&
          (data.status === "RUNNING" || data.status === "PENDING");
        if (!cancelled && j.success && resumable && data) {
          setTaskProgress((prev) => ({ ...prev, ...data }));
          setStep("CLUSTERING");
          setIsMinimized(true);
          onClusteringChange?.(true);
          startProgressPollRef.current(data.taskId);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [onClusteringChange]);

  // Lock background body scroll when open and not minimized
  useEffect(() => {
    if (isOpen && !isMinimized) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen, isMinimized]);

  useEffect(() => {
    if (!isOpen) {
      clusterStartedRef.current = false;
      setStep((current) => (current === "CLUSTERING" ? current : "SELECT"));
      return;
    }
    // 打开时若已处于最小化态，则还原
    setIsMinimized(false);
    if (autoStartCluster) {
      setStep("CLUSTERING");
      if (!clusterStartedRef.current) {
        clusterStartedRef.current = true;
        void startClusterRef.current();
      }
    }
  }, [isOpen, autoStartCluster]);

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
        const errorText = resolveApiError(json, "后端解析失败，请检查文件格式");
        setErrorMessage(errorText);
        setStep("ERROR");
        toast.error(`上传入库失败: ${errorText}`);
      }
    } catch (err: any) {
      setErrorMessage(err.message || "网络通信异常，请重试");
      setStep("ERROR");
      toast.error(`网络或处理异常: ${err.message}`);
    }
  };

  // 阶段 1'：粘贴文本入库,首句作标题其余作内容,缺失字段由后端自动补齐。
  const handlePasteAndIngest = async () => {
    const texts = pasteText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (texts.length === 0) {
      toast.error("请先粘贴至少一条工单文本");
      return;
    }

    setStep("INGESTING");
    toast.info(`正在将 ${texts.length} 条粘贴文本提交后端入库...`);

    try {
      const res = await fetch("/api/tickets/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts }),
      });
      const json = await res.json();

      if (json.success && json.data) {
        setReport(json.data);
        setStep("REPORT");
        if (onDatabaseUpdated) onDatabaseUpdated();
        toast.success(`粘贴入库完成！共处理 ${json.data.totalParsed} 条工单`);
      } else {
        const errorText = resolveApiError(json, "后端粘贴解析失败");
        setErrorMessage(errorText);
        setStep("ERROR");
        toast.error(`粘贴入库失败: ${errorText}`);
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
    const isOwner = claimed.claimed;
    setStep("CLUSTERING");
    onClusteringChange?.(true);

    if (isOwner) {
      setTaskProgress({
        taskId,
        status: "RUNNING",
        stage: "EXTRACTING",
        stageText: "正在初始化 Agent 多频研判流水线...",
        percent: 0,
        total: report?.insertedCount || 0,
        processed: 0,
        extractedCount: 0,
        themeCount: 0,
        reviewCount: 0,
        failedCount: 0,
        updatedAt: Date.now(),
      });
      void fetch("/api/overview")
        .then((r) => r.json())
        .then((j) => {
          const n = Number(j.totalWorkorders || 0);
          if (n > 0) {
            setTaskProgress((prev) => ({ ...prev, total: prev.total || n }));
          }
        })
        .catch(() => {});
    }

    startProgressPoll(taskId);

    if (!isOwner) {
      return;
    }

    toast.info("研判已进入队列，刷新页面也会继续");

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

      if (!clusterJson.success) {
        if (pollTimerRef.current) clearInterval(pollTimerRef.current);
        onClusteringChange?.(false);
        releaseClusterTask(taskId);
        const errorText = resolveApiError(clusterJson, "Agent 智能聚类失败");
        setErrorMessage(errorText);
        setStep("ERROR");
        toast.error(errorText);
        return;
      }

      const queuedId = clusterJson.data?.taskId || taskId;
      if (queuedId !== taskId) startProgressPoll(queuedId);
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
    setPasteText("");
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
  };

  return (
    <>
      <AnimatePresence>
        {isOpen && !isMinimized && (
          <motion.div
            key="upload-backdrop"
            className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
            onClick={() => {
              if (step === "CLUSTERING") {
                setIsMinimized(true);
              } else if (step !== "INGESTING") {
                onClose();
              }
            }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18, ease: "easeOut" }}
          >
            <motion.div
              className="w-full max-w-2xl bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col text-foreground"
              onClick={(e) => e.stopPropagation()}
              initial={{ opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 8 }}
              transition={{ duration: 0.2, ease: [0.32, 0.72, 0.18, 1] }}
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
                  ? "Agent 智能研判中"
                  : step === "INGESTING"
                  ? "数据表格解析入库"
                  : step === "ERROR"
                  ? "处理异常"
                  : "工单表格上传与入库"}
              </h2>
            </div>
          </div>

          <div className="flex items-center gap-1">
            {step === "CLUSTERING" && (
              <button
                type="button"
                onClick={() => setIsMinimized(true)}
                title="收起至右下角悬浮窗"
                className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              >
                <Minimize2 className="w-4 h-4" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              disabled={step === "INGESTING" || step === "CLUSTERING"}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
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
                {/* Tabs */}
                <div className="inline-flex p-0.5 rounded-lg border border-border bg-muted/40">
                  <button
                    type="button"
                    onClick={() => setIngestTab("file")}
                    className={`h-7 px-3 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      ingestTab === "file"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" />
                    上传文件
                  </button>
                  <button
                    type="button"
                    onClick={() => setIngestTab("paste")}
                    className={`h-7 px-3 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      ingestTab === "paste"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    粘贴文本
                  </button>
                </div>

                {ingestTab === "file" ? (
                  !file ? (
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
                  )
                ) : (
                  <div className="space-y-3">
                    <textarea
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={`每行粘贴一条工单文本,系统会自动取首句作为标题、余下作为内容,缺失字段自动补齐。\n\n示例 (摘自真实 12345 工单格式):\n（城管）商业噪音\n市民致电反映某街道碧桂园西苑翠堤岸10号民宿,在2024年12月31日23:59:39,客人的喧哗声严重的噪音扰民,影响附近居民的正常休息,希望相关部门介入要求制止噪音影响。\n\n举报燃放烟花\n市民致电反映某镇万象美食城附近空地每晚都有人在此燃放烟花,非常扰民,希望部门介入处理,依法处罚违法行为。\n\n（急）噪声扰民\n市民来电反映某街道新桂北路29号116号铺悠闲体验馆依然传出打鼓唱歌的声音,非常扰民,希望部门介入处理。`}
                      rows={10}
                      className="w-full rounded-lg border border-border bg-card text-xs leading-relaxed p-3 resize-y focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary/60"
                    />
                    <div className="flex items-center justify-between text-[11px] text-muted-foreground">
                      <span>
                        已粘贴 {pasteText.split(/\r?\n/).filter((s) => s.trim()).length} 条 · 单次最多 2000 条
                      </span>
                      <button
                        type="button"
                        onClick={() => setPasteText("")}
                        className="hover:text-foreground transition-colors cursor-pointer"
                      >
                        清空
                      </button>
                    </div>
                    <div className="p-3 rounded-lg border border-border bg-muted/20 text-[11.5px] text-muted-foreground flex items-center gap-2">
                      <ShieldCheck className="w-4 h-4 text-primary shrink-0" />
                      <span>
                        粘贴文本与上传文件走同一份入库管线,统一去重、补缺、批量落库。
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

            {/* STEP 3: CLUSTERING (V2 PIPELINE FLOW VIEW) */}
            {step === "CLUSTERING" && (
              <motion.div
                key="clustering"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="py-1"
              >
                <PipelineFlowView progress={taskProgress} />
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
                onClick={ingestTab === "file" ? handleUploadAndIngest : handlePasteAndIngest}
                disabled={
                  (ingestTab === "file" && !file) ||
                  (ingestTab === "paste" &&
                    pasteText.split(/\r?\n/).filter((s) => s.trim()).length === 0) ||
                  step === "INGESTING"
                }
                className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" />
                {ingestTab === "file" ? "上传并流式入库" : "粘贴文本入库"}
              </Button>
            </>
          )}
        </div>
        </motion.div>
      </motion.div>
      )}
    </AnimatePresence>

    {/* 任务在后台运行时，可收起为右下角轻量悬浮胶囊 */}
    <FloatingProgressPill
      progress={taskProgress}
      isVisible={isMinimized && (step === "CLUSTERING" || taskProgress.status === "RUNNING")}
      onExpand={() => {
        setIsMinimized(false);
        onShowProgress?.();
      }}
    />
  </>
  );
};
