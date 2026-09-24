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
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import type { MultiFrequencyTheme, OverallStats, GraphData } from "@/backend/state";
import type { TaskProgress } from "@/lib/task-progress";
import { claimClusterTask, releaseClusterTask } from "@/lib/cluster-client";
import { resolveApiError } from "@/lib/api-codes";

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

    // 进度轮询：读内存与DB进度，6s 请求一次，结束即停。
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
            total: pJson.data.total || prev.total,
            processed: pJson.data.processed || prev.processed,
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
    }, 6000);

    if (!isOwner) {
      // 任务已在后台运行中，直接连上轮询监听
      return;
    }

    toast.info("正在唤起 Agent 执行知识图谱聚类...");

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
        const errorText = resolveApiError(clusterJson, "Agent 智能聚类失败");
        setErrorMessage(errorText);
        setStep("ERROR");
        toast.error(errorText);
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
    setPasteText("");
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
  };

  return (
    <AnimatePresence>
      {isOpen && (
      <motion.div
        key="upload-backdrop"
        className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
        onClick={() => {
          if (step !== "INGESTING" && step !== "CLUSTERING") {
            onClose();
          }
        }}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <motion.div
          className="w-full max-w-xl bg-card border border-border rounded-xl shadow-xl overflow-hidden flex flex-col text-foreground"
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
                      placeholder={`每行粘贴一条工单文本,系统会自动取首句作为标题、余下作为内容,缺失字段自动补齐。\n\n示例 (摘自真实 12345 工单):\n（城管）商业噪音\n市民致电反映顺德区北滘镇碧桂园西苑翠堤岸10号民宿,在2024年12月31日23:59:39,客人的喧哗声严重的噪音扰民,影响附近居民的正常休息,希望相关部门介入要求制止噪音影响。\n\n举报燃放烟花\n市民致电反映顺德区龙江镇万象美食城附近空地每晚都有人在此燃放烟花,非常扰民,希望部门介入处理,依法处罚违法行为。\n\n（急）噪声扰民\n市民来电反映顺德区大良街道新桂北路29号116号铺的恒艺音乐悠闲体验馆2025年1月1日00:19:22依然传出打鼓唱歌的声音,非常扰民,希望部门介入处理。`}
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
                      多线程并发处理 · 实体抽取与连通图谱聚类
                    </p>
                  </div>

                  <div className="text-right">
                    {taskProgress.total > 0 || taskProgress.percent > 0 ? (
                      <span className="text-lg font-bold font-mono text-primary">
                        {taskProgress.percent}%
                      </span>
                    ) : (
                      <Loader2 className="w-5 h-5 animate-spin text-primary ml-auto" />
                    )}
                  </div>
                </div>

                {/* Clean Professional Progress Bar */}
                <div className="w-full bg-muted rounded-full h-2 overflow-hidden border border-border/50">
                  <motion.div
                    className="bg-primary h-full rounded-full transition-all duration-300"
                    style={{ width: `${taskProgress.percent}%` }}
                  />
                </div>

                {/* Real Pipeline Flow Metrics */}
                {(() => {
                  const totalTickets = taskProgress.total || report?.insertedCount || 0;
                  const processedTickets = taskProgress.processed || 0;
                  const themeCount = taskProgress.themeCount || 0;
                  const reviewCount = taskProgress.reviewCount || 0;
                  const isDone = taskProgress.status === "COMPLETED";
                  const stageText = taskProgress.stageText || "";
                  const percent = taskProgress.percent || 0;
                  const awaiting = !isDone && totalTickets === 0;
                  const metricOrWait = (n: number) =>
                    awaiting ? (
                      <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                    ) : (
                      n.toLocaleString("zh-CN")
                    );

                  const step1Done = totalTickets > 0;

                  // 步骤 2: 要素抽取
                  const step2Active = taskProgress.status === "RUNNING" && (processedTickets < totalTickets && !stageText.includes("仲裁") && !stageText.includes("聚类") && percent < 55);
                  const step2Done = isDone || processedTickets >= totalTickets || stageText.includes("仲裁") || stageText.includes("复核") || stageText.includes("聚类") || percent >= 55;

                  // 步骤 3: 低置信复核 (二级 AI 仲裁纠偏)
                  const step3Active = taskProgress.status === "RUNNING" && (stageText.includes("仲裁") || stageText.includes("复核") || (percent >= 55 && percent < 70 && themeCount === 0 && !stageText.includes("图谱") && !stageText.includes("聚类")));
                  const step3Done = isDone || themeCount > 0 || stageText.includes("图谱") || stageText.includes("聚类") || percent >= 70;

                  // 步骤 4: 多频主题聚类
                  const step4Active = taskProgress.status === "RUNNING" && (stageText.includes("图谱") || stageText.includes("聚类") || percent >= 70) && !isDone && themeCount === 0;
                  const step4Done = isDone || themeCount > 0;

                  return (
                    <div className="flex items-center justify-between gap-1 pt-1 select-none">
                      {/* Step 1: 总工单量 */}
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2 }}
                        className={`flex-1 p-2.5 rounded-lg border transition-all duration-300 ${
                          step1Done
                            ? "border-emerald-500/30 bg-emerald-500/5 shadow-xs"
                            : "border-border/40 bg-muted/20 opacity-50"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span className="text-[10.5px] font-medium text-muted-foreground">总工单量</span>
                          {step1Done ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                          )}
                        </div>
                        <p className="text-sm font-bold font-mono text-foreground min-h-5 flex items-center">
                          {metricOrWait(totalTickets)}
                        </p>
                      </motion.div>

                      {/* Flowing Connector 1 -> 2 */}
                      <div className="flex items-center justify-center gap-1 px-1 shrink-0">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                              step2Done
                                ? "bg-emerald-500 shadow-[0_0_3px_rgba(16,185,129,0.3)]"
                                : step2Active
                                ? "bg-primary"
                                : "bg-muted-foreground/30"
                            }`}
                            animate={
                              step2Active
                                ? {
                                    scale: [0.8, 1.35, 0.8],
                                    opacity: [0.35, 1, 0.35],
                                  }
                                : {
                                    scale: 1,
                                    opacity: step2Done ? 1 : 0.35,
                                  }
                            }
                            transition={
                              step2Active
                                ? {
                                    repeat: Infinity,
                                    duration: 1.1,
                                    delay: i * 0.22,
                                    ease: "easeInOut",
                                  }
                                : {
                                    duration: 0.2,
                                  }
                            }
                          />
                        ))}
                      </div>

                      {/* Step 2: 已抽取工单 */}
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: 0.05 }}
                        className={`flex-1 p-2.5 rounded-lg border transition-all duration-300 ${
                          step2Active
                            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/40 shadow-[0_0_12px_rgba(59,130,246,0.14)]"
                            : step2Done
                            ? "border-emerald-500/30 bg-emerald-500/5 shadow-xs"
                            : "border-border/40 bg-muted/15 opacity-40 grayscale"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-[10.5px] font-medium transition-colors ${
                              step2Active ? "text-primary font-semibold" : "text-muted-foreground"
                            }`}
                          >
                            已抽取工单
                          </span>
                          {step2Active ? (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                            </span>
                          ) : step2Done ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                          )}
                        </div>
                        <p
                          className={`text-sm font-bold font-mono transition-colors ${
                            step2Active ? "text-primary" : "text-foreground"
                          }`}
                        >
                          {metricOrWait(processedTickets)}
                        </p>
                      </motion.div>

                      {/* Flowing Connector 2 -> 3 */}
                      <div className="flex items-center justify-center gap-1 px-1 shrink-0">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                              step3Done
                                ? "bg-emerald-500 shadow-[0_0_3px_rgba(16,185,129,0.3)]"
                                : step3Active
                                ? "bg-amber-500"
                                : "bg-muted-foreground/30"
                            }`}
                            animate={
                              step3Active
                                ? {
                                    scale: [0.8, 1.35, 0.8],
                                    opacity: [0.35, 1, 0.35],
                                  }
                                : {
                                    scale: 1,
                                    opacity: step3Done ? 1 : 0.35,
                                  }
                            }
                            transition={
                              step3Active
                                ? {
                                    repeat: Infinity,
                                    duration: 1.1,
                                    delay: i * 0.22,
                                    ease: "easeInOut",
                                  }
                                : {
                                    duration: 0.2,
                                  }
                            }
                          />
                        ))}
                      </div>

                      {/* Step 3: 低置信复核 (二级 AI 仲裁纠偏) */}
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: 0.1 }}
                        className={`flex-1 p-2.5 rounded-lg border transition-all duration-300 ${
                          step3Active
                            ? "border-amber-500/50 bg-amber-500/5 ring-1 ring-amber-500/40 shadow-[0_0_12px_rgba(245,158,11,0.15)]"
                            : step3Done
                            ? "border-emerald-500/30 bg-emerald-500/5 shadow-xs"
                            : "border-border/40 bg-muted/15 opacity-40 grayscale"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-[10.5px] font-medium transition-colors ${
                              step3Active ? "text-amber-600 dark:text-amber-400 font-semibold" : "text-muted-foreground"
                            }`}
                          >
                            低置信复核
                          </span>
                          {step3Active ? (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-500 opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-amber-500"></span>
                            </span>
                          ) : step3Done ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                          )}
                        </div>
                        <p
                          className={`text-sm font-bold font-mono transition-colors ${
                            step3Active || reviewCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground"
                          }`}
                        >
                          {awaiting ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            reviewCount.toLocaleString("zh-CN")
                          )}
                        </p>
                      </motion.div>

                      {/* Flowing Connector 3 -> 4 */}
                      <div className="flex items-center justify-center gap-1 px-1 shrink-0">
                        {[0, 1, 2].map((i) => (
                          <motion.div
                            key={i}
                            className={`w-1.5 h-1.5 rounded-full transition-colors duration-300 ${
                              step4Done
                                ? "bg-emerald-500 shadow-[0_0_3px_rgba(16,185,129,0.3)]"
                                : step4Active
                                ? "bg-primary"
                                : "bg-muted-foreground/30"
                            }`}
                            animate={
                              step4Active
                                ? {
                                    scale: [0.8, 1.35, 0.8],
                                    opacity: [0.35, 1, 0.35],
                                  }
                                : {
                                    scale: 1,
                                    opacity: step4Done ? 1 : 0.35,
                                  }
                            }
                            transition={
                              step4Active
                                ? {
                                    repeat: Infinity,
                                    duration: 1.1,
                                    delay: i * 0.22,
                                    ease: "easeInOut",
                                  }
                                : {
                                    duration: 0.2,
                                  }
                            }
                          />
                        ))}
                      </div>

                      {/* Step 4: 已聚类主题 */}
                      <motion.div
                        initial={{ opacity: 0, y: 5 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.2, delay: 0.15 }}
                        className={`flex-1 p-2.5 rounded-lg border transition-all duration-300 ${
                          step4Active
                            ? "border-primary/50 bg-primary/5 ring-1 ring-primary/40 shadow-[0_0_12px_rgba(59,130,246,0.14)]"
                            : step4Done
                            ? "border-emerald-500/30 bg-emerald-500/5 shadow-xs"
                            : "border-border/40 bg-muted/15 opacity-40 grayscale"
                        }`}
                      >
                        <div className="flex items-center justify-between mb-1">
                          <span
                            className={`text-[10.5px] font-medium transition-colors ${
                              step4Active ? "text-primary font-semibold" : "text-muted-foreground"
                            }`}
                          >
                            已聚类主题
                          </span>
                          {step4Active ? (
                            <span className="relative flex h-2 w-2">
                              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75"></span>
                              <span className="relative inline-flex rounded-full h-2 w-2 bg-primary"></span>
                            </span>
                          ) : step4Done ? (
                            <CheckCircle2 className="w-3 h-3 text-emerald-500 shrink-0" />
                          ) : (
                            <Clock className="w-3 h-3 text-muted-foreground/40 shrink-0" />
                          )}
                        </div>
                        <p
                          className={`text-sm font-bold font-mono transition-colors ${
                            step4Active ? "text-primary" : step4Done ? "text-primary" : "text-muted-foreground"
                          }`}
                        >
                          {awaiting ? (
                            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
                          ) : (
                            themeCount.toLocaleString("zh-CN")
                          )}
                        </p>
                      </motion.div>
                    </div>
                  );
                })()}
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
  );
};
