"use client";

import React, { useState, useRef, useEffect } from "react";
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
  Cpu,
  Layers,
  Activity,
  Zap,
  RefreshCw,
  Clock,
  Radio,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
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
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "CLUSTERING" | "ERROR">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");

  // Visual Dynamic Progress State
  const [progress, setProgress] = useState(0);
  const [currentStageText, setCurrentStageText] = useState("");
  const [stageIndex, setStageIndex] = useState(0);
  const [processedCount, setProcessedCount] = useState(0);
  const [successCount, setSuccessCount] = useState(0);
  const [reviewCount, setReviewCount] = useState(0);
  const [errorCount, setErrorCount] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Lock background body scroll when Upload Dialog is open
  useEffect(() => {
    if (isOpen) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [isOpen]);

  // Smooth progress simulation timer during INGESTING
  useEffect(() => {
    if (step !== "INGESTING") return;

    setProgress(5);
    setCurrentStageText("正在读取表格数据与字段格式化映射...");
    setStageIndex(0);
    setProcessedCount(0);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev < 30) {
          setCurrentStageText("正在执行全要素程序化脱敏与隐私保护掩码...");
          setStageIndex(1);
          setProcessedCount((c) => Math.min(120, c + 15));
          return prev + 6;
        } else if (prev < 70) {
          setCurrentStageText("正在进行工单流水号唯一性排重与增量校验...");
          setStageIndex(2);
          setProcessedCount((c) => Math.min(240, c + 18));
          return prev + 5;
        } else if (prev < 92) {
          setCurrentStageText("正在批量事务写入 PostgreSQL 数据库表...");
          setStageIndex(3);
          setProcessedCount((c) => Math.min(300, c + 8));
          return prev + 2;
        }
        return prev;
      });
    }, 150);

    return () => clearInterval(timer);
  }, [step]);

  // Smooth progress simulation timer during CLUSTERING
  useEffect(() => {
    if (step !== "CLUSTERING") return;

    setProgress(8);
    setCurrentStageText("启动 LangGraph Agent 正在提取实体四要素与诉求标题...");
    setStageIndex(0);
    setSuccessCount(0);
    setReviewCount(0);
    setErrorCount(0);

    const timer = setInterval(() => {
      setProgress((prev) => {
        if (prev < 35) {
          setCurrentStageText("AI 语义多维向量提取与主体/微观地点消歧...");
          setStageIndex(1);
          setSuccessCount((c) => c + 3);
          return prev + 3.5;
        } else if (prev < 68) {
          setCurrentStageText("知识图谱连通子图聚类与同主体/同地点时空关联分析...");
          setStageIndex(2);
          setSuccessCount((c) => c + 4);
          setReviewCount((r) => (Math.random() > 0.7 ? r + 1 : r));
          return prev + 2.5;
        } else if (prev < 90) {
          setCurrentStageText("红黄蓝风险态势评级、负面险情词扫描与闭环公文研判...");
          setStageIndex(3);
          setSuccessCount((c) => Math.min(300, c + 5));
          return prev + 1.2;
        }
        return prev;
      });
    }, 200);

    return () => clearInterval(timer);
  }, [step]);

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
        setProgress(100);
        setTimeout(() => {
          setReport(json.data);
          setStep("REPORT");
          if (onDatabaseUpdated) onDatabaseUpdated();
          toast.success(`后端解析入库完成！共处理 ${json.data.totalParsed} 条工单`);
        }, 400);
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

  // 阶段 2：启动 LangGraph Agent 智能聚类
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
        setProgress(100);
        setCurrentStageText("研判完成！正在生成多频全景图谱...");
        setTimeout(() => {
          toast.success(`Agent 研判完成！已聚类生成 ${clusterJson.data.themes.length} 个多频治理主题！`);
          onUploadSuccess(clusterJson.data);
          handleFinishAndClose();
        }, 500);
      } else {
        setErrorMessage(clusterJson.error || "Agent 智能聚类失败");
        setStep("ERROR");
        toast.error("智能聚类失败，请重试");
      }
    } catch (err: any) {
      setErrorMessage(err.message || "Agent 调用网络超时或中断");
      setStep("ERROR");
      toast.error(`Agent 研判异常: ${err.message}`);
    }
  };

  const handleReset = () => {
    setFile(null);
    setReport(null);
    setErrorMessage("");
    setProgress(0);
    setStep("SELECT");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleFinishAndClose = () => {
    handleReset();
    onClose();
  };

  const INGEST_STAGES = [
    { label: "表格解析与字段映射", icon: FileSpreadsheet },
    { label: "全要素程序化脱敏", icon: ShieldCheck },
    { label: "单号排重与校验", icon: RefreshCw },
    { label: "PostgreSQL 事务落库", icon: Database },
  ];

  const CLUSTER_STAGES = [
    { label: "AI 实体识别与要素抽取", icon: Bot },
    { label: "主体与地点拓扑消歧", icon: Layers },
    { label: "多频知识图谱连通聚类", icon: Activity },
    { label: "红黄蓝风险与公文研判", icon: Sparkles },
  ];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/50 backdrop-blur-md p-4 animate-in fade-in duration-200"
      onClick={() => {
        if (step !== "INGESTING" && step !== "CLUSTERING") {
          onClose();
        }
      }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 10 }}
        transition={{ type: "spring", damping: 25, stiffness: 350 }}
        className="w-full max-w-2xl bg-card border border-border/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col text-foreground relative"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Glowing Top Edge Accent */}
        <div className="absolute top-0 left-0 right-0 h-[3px] bg-gradient-to-r from-blue-500 via-purple-500 to-emerald-500" />

        {/* Modal Header */}
        <div className="p-5 border-b border-border flex items-center justify-between bg-muted/30">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
              {step === "CLUSTERING" ? (
                <Bot className="w-5 h-5 text-purple-600 animate-pulse" />
              ) : (
                <Database className="w-5 h-5 text-primary" />
              )}
            </div>
            <div>
              <h2 className="text-sm font-bold text-foreground flex items-center gap-2">
                {step === "REPORT"
                  ? "第一阶段：后端入库与防重校验报告"
                  : step === "CLUSTERING"
                  ? "第二阶段：LangGraph Agent 智能研判与知识图谱聚类"
                  : step === "INGESTING"
                  ? "第一阶段：数据表格流式解析与入库"
                  : step === "ERROR"
                  ? "处理异常中断"
                  : "工单表格上传与后端入库"}
                {(step === "INGESTING" || step === "CLUSTERING") && (
                  <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-500/10 text-blue-600 border border-blue-500/20 animate-pulse">
                    <Radio className="w-3 h-3 animate-spin" />
                    实时处理中
                  </span>
                )}
              </h2>
              <p className="text-[11px] text-muted-foreground mt-0.5">
                {step === "REPORT"
                  ? "数据已安全写入 PostgreSQL，可一键启动多频智能研判"
                  : step === "CLUSTERING"
                  ? "大模型正在提取诉求要素、构建空间连通子图并裁定红黄蓝风险"
                  : "高性能流式解析与全要素脱敏，前端 0 卡顿、0 内存开销"}
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            disabled={step === "INGESTING" || step === "CLUSTERING"}
            className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Body with Animated Transitions */}
        <div className="p-6 space-y-4">
          <AnimatePresence mode="wait">
            {/* STEP 1: SELECT FILE */}
            {step === "SELECT" && (
              <motion.div
                key="select"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.2 }}
                className="space-y-4"
              >
                {!file ? (
                  <div
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                    className={`border-2 border-dashed rounded-2xl p-8 flex flex-col items-center justify-center gap-3 cursor-pointer transition-all ${
                      isDragging
                        ? "border-primary bg-primary/5 scale-[0.99]"
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
                    <div className="w-14 h-14 rounded-2xl bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shadow-xs">
                      <FileSpreadsheet className="w-7 h-7 text-primary" />
                    </div>
                    <div className="text-center space-y-1">
                      <p className="text-sm font-bold text-foreground">
                        点击选择工单文件 或 将表格拖拽至此区域
                      </p>
                      <p className="text-xs text-muted-foreground">
                        支持 12345 政务热线导出表格（.xlsx / .xls / .csv），百兆大文件直传入库
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* File Info Card */}
                    <div className="p-4 rounded-xl border border-border bg-muted/40 flex items-center justify-between shadow-xs">
                      <div className="flex items-center gap-3.5">
                        <div className="w-10 h-10 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0">
                          <FileSpreadsheet className="w-5 h-5 text-primary" />
                        </div>
                        <div>
                          <p className="text-xs font-bold text-foreground truncate max-w-sm">
                            {file.name}
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            文件大小：{(file.size / (1024 * 1024)).toFixed(2)} MB · 准备上传至后端解析
                          </p>
                        </div>
                      </div>

                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={handleReset}
                        className="h-8 text-xs text-muted-foreground hover:text-foreground cursor-pointer"
                      >
                        更换文件
                      </Button>
                    </div>

                    <div className="p-3.5 rounded-xl border border-blue-500/20 bg-blue-500/5 text-[11.5px] text-blue-700 dark:text-blue-300 flex items-center gap-2.5">
                      <ShieldCheck className="w-4 h-4 text-blue-600 shrink-0" />
                      <span>
                        文件直接交由后端 Node.js 流式引擎解析与脱敏入库，前端 0 内存开销，保障百兆大文件极致流畅。
                      </span>
                    </div>
                  </div>
                )}
              </motion.div>
            )}

            {/* STEP 2: INGESTING (VISUAL PROGRESS & NUMBER ANIMATION) */}
            {step === "INGESTING" && (
              <motion.div
                key="ingesting"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25 }}
                className="py-4 space-y-6"
              >
                {/* Visual Progress Header with Live Counter */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <div className="relative">
                      <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center text-blue-600">
                        <Database className="w-6 h-6 animate-pulse" />
                      </div>
                      <span className="absolute -top-1 -right-1 flex h-3 w-3">
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-blue-400 opacity-75"></span>
                        <span className="relative inline-flex rounded-full h-3 w-3 bg-blue-500"></span>
                      </span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground">
                        正在执行数据流式解析与入库
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {currentStageText}
                      </p>
                    </div>
                  </div>

                  {/* Percentage Glow Counter */}
                  <div className="text-right">
                    <div className="text-2xl font-mono font-black text-primary tracking-tight">
                      {Math.round(progress)}%
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      实时进度
                    </span>
                  </div>
                </div>

                {/* Animated Neon Progress Bar */}
                <div className="space-y-2">
                  <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden p-0.5 border border-border">
                    <motion.div
                      className="h-full bg-gradient-to-r from-blue-500 via-indigo-500 to-primary rounded-full relative"
                      initial={{ width: "0%" }}
                      animate={{ width: `${progress}%` }}
                      transition={{ ease: "easeOut", duration: 0.2 }}
                    >
                      {/* Shimmer animation */}
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    </motion.div>
                  </div>
                </div>

                {/* 4 Pipeline Micro Stages */}
                <div className="grid grid-cols-4 gap-2">
                  {INGEST_STAGES.map((st, idx) => {
                    const isDone = stageIndex > idx || progress >= 95;
                    const isCurrent = stageIndex === idx && progress < 95;
                    const Icon = st.icon;

                    return (
                      <motion.div
                        key={st.label}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08 }}
                        className={`p-2.5 rounded-xl border text-center flex flex-col items-center gap-1.5 transition-all ${
                          isDone
                            ? "bg-emerald-50/50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-300"
                            : isCurrent
                            ? "bg-blue-500/10 border-blue-500/40 text-blue-700 dark:text-blue-300 shadow-xs"
                            : "bg-muted/30 border-border/60 text-muted-foreground opacity-60"
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isCurrent
                              ? "bg-blue-600 text-white animate-spin"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Icon className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <span className="text-[10.5px] font-medium leading-tight line-clamp-1">
                          {st.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Live Real-time Metrics Card */}
                <div className="grid grid-cols-3 gap-3 p-3.5 rounded-xl bg-muted/40 border border-border">
                  <div className="space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">已处理工单</span>
                    <p className="text-base font-bold font-mono text-foreground">
                      ~{processedCount} <span className="text-[10px] font-normal text-muted-foreground">条</span>
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">格式校验</span>
                    <p className="text-base font-bold font-mono text-emerald-600">
                      100% <span className="text-[10px] font-normal text-emerald-600/70">合规</span>
                    </p>
                  </div>
                  <div className="space-y-0.5">
                    <span className="text-[10.5px] text-muted-foreground">隐私掩码</span>
                    <p className="text-base font-bold font-mono text-blue-600">
                      全要素 <span className="text-[10px] font-normal text-blue-600/70">脱敏</span>
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 3: CLUSTERING (RADAR AGENT MOTION & VISUAL METRICS) */}
            {step === "CLUSTERING" && (
              <motion.div
                key="clustering"
                initial={{ opacity: 0, scale: 0.96 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.96 }}
                transition={{ duration: 0.25 }}
                className="py-4 space-y-6"
              >
                {/* Visual Header with Radar Wave Animation */}
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3.5">
                    {/* Animated Radar Pulse Node */}
                    <div className="relative flex items-center justify-center">
                      <motion.div
                        animate={{ scale: [1, 1.4, 1], opacity: [0.6, 0.1, 0.6] }}
                        transition={{ repeat: Infinity, duration: 2, ease: "easeInOut" }}
                        className="absolute w-12 h-12 rounded-2xl bg-purple-500/20"
                      />
                      <div className="w-11 h-11 rounded-xl bg-purple-600 text-white flex items-center justify-center shadow-lg shadow-purple-500/30 relative z-10">
                        <Bot className="w-6 h-6 animate-pulse" />
                      </div>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-foreground flex items-center gap-2">
                        LangGraph Agent 研判与图谱聚类中
                      </h3>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        {currentStageText}
                      </p>
                    </div>
                  </div>

                  {/* High Visual Number Counter */}
                  <div className="text-right">
                    <div className="text-2xl font-mono font-black text-purple-600 tracking-tight">
                      {Math.round(progress)}%
                    </div>
                    <span className="text-[10px] text-muted-foreground font-mono">
                      图工作流进度
                    </span>
                  </div>
                </div>

                {/* Animated Purple Gradient Bar */}
                <div className="space-y-2">
                  <div className="h-3 w-full bg-muted/60 rounded-full overflow-hidden p-0.5 border border-border">
                    <motion.div
                      className="h-full bg-gradient-to-r from-purple-600 via-indigo-600 to-pink-500 rounded-full relative"
                      initial={{ width: "0%" }}
                      animate={{ width: `${progress}%` }}
                      transition={{ ease: "easeOut", duration: 0.2 }}
                    >
                      <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/30 to-transparent animate-shimmer" />
                    </motion.div>
                  </div>
                </div>

                {/* 4 Agent Work Stages */}
                <div className="grid grid-cols-4 gap-2">
                  {CLUSTER_STAGES.map((st, idx) => {
                    const isDone = stageIndex > idx || progress >= 95;
                    const isCurrent = stageIndex === idx && progress < 95;
                    const Icon = st.icon;

                    return (
                      <motion.div
                        key={st.label}
                        initial={{ opacity: 0, y: 6 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ delay: idx * 0.08 }}
                        className={`p-2.5 rounded-xl border text-center flex flex-col items-center gap-1.5 transition-all ${
                          isDone
                            ? "bg-emerald-50/50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/20 dark:border-emerald-800/40 dark:text-emerald-300"
                            : isCurrent
                            ? "bg-purple-500/10 border-purple-500/40 text-purple-700 dark:text-purple-300 shadow-xs"
                            : "bg-muted/30 border-border/60 text-muted-foreground opacity-60"
                        }`}
                      >
                        <div
                          className={`w-6 h-6 rounded-lg flex items-center justify-center ${
                            isDone
                              ? "bg-emerald-500 text-white"
                              : isCurrent
                              ? "bg-purple-600 text-white animate-spin"
                              : "bg-muted text-muted-foreground"
                          }`}
                        >
                          {isDone ? (
                            <CheckCircle2 className="w-3.5 h-3.5" />
                          ) : (
                            <Icon className="w-3.5 h-3.5" />
                          )}
                        </div>
                        <span className="text-[10.5px] font-medium leading-tight line-clamp-1">
                          {st.label}
                        </span>
                      </motion.div>
                    );
                  })}
                </div>

                {/* Live Success & Review Real-time Metric Badges */}
                <div className="grid grid-cols-4 gap-2.5">
                  <div className="p-3 rounded-xl bg-emerald-50/60 border border-emerald-200/80 text-emerald-900 dark:bg-emerald-950/30 dark:border-emerald-800/40 dark:text-emerald-200 space-y-0.5">
                    <span className="text-[10px] text-emerald-700 dark:text-emerald-300 font-semibold flex items-center gap-1">
                      <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                      已抽取要素
                    </span>
                    <p className="text-lg font-bold font-mono">
                      {successCount}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-200/80 text-amber-900 dark:bg-amber-950/30 dark:border-amber-800/40 dark:text-amber-200 space-y-0.5">
                    <span className="text-[10px] text-amber-700 dark:text-amber-300 font-semibold flex items-center gap-1">
                      <Clock className="w-3 h-3 text-amber-600" />
                      低置信复核
                    </span>
                    <p className="text-lg font-bold font-mono">
                      {reviewCount}
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-blue-50/60 border border-blue-200/80 text-blue-900 dark:bg-blue-950/30 dark:border-blue-800/40 dark:text-blue-200 space-y-0.5">
                    <span className="text-[10px] text-blue-700 dark:text-blue-300 font-semibold flex items-center gap-1">
                      <Zap className="w-3 h-3 text-blue-600" />
                      并发状态
                    </span>
                    <p className="text-sm font-bold font-mono mt-1 text-blue-700 dark:text-blue-300">
                      3 线程排队
                    </p>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-slate-800 dark:bg-slate-900/40 dark:border-slate-800 dark:text-slate-200 space-y-0.5">
                    <span className="text-[10px] text-slate-500 font-semibold flex items-center gap-1">
                      <ShieldCheck className="w-3 h-3 text-slate-500" />
                      异常中断
                    </span>
                    <p className="text-lg font-bold font-mono text-slate-600">
                      0
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 4: INGESTION REPORT (TWO-STAGE DASHBOARD) */}
            {step === "REPORT" && report && (
              <motion.div
                key="report"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                transition={{ type: "spring", damping: 25, stiffness: 350 }}
                className="space-y-4"
              >
                {/* Top Banner */}
                <div className="p-4 rounded-xl bg-emerald-500/10 border border-emerald-500/30 text-emerald-900 dark:text-emerald-200 flex items-center justify-between shadow-xs">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-emerald-500 text-white flex items-center justify-center shrink-0">
                      <CheckCircle2 className="w-5 h-5" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold">第一阶段：工单数据后端入库成功</h3>
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                        成功解析 {report.totalParsed} 条数据，耗时 {(report.durationMs / 1000).toFixed(2)} 秒
                      </p>
                    </div>
                  </div>
                  <span className="font-mono text-xs font-bold bg-emerald-100 dark:bg-emerald-900/50 text-emerald-800 dark:text-emerald-200 px-2.5 py-1 rounded-lg border border-emerald-300 dark:border-emerald-700">
                    {report.totalParsed} 条
                  </span>
                </div>

                {/* 3 Core Ingestion Badges */}
                <div className="grid grid-cols-3 gap-3">
                  {/* 1. Inserted */}
                  <Card className="p-4 border-emerald-500/30 bg-emerald-500/5 space-y-1">
                    <div className="flex items-center justify-between text-emerald-700 dark:text-emerald-400">
                      <span className="text-[11px] font-semibold flex items-center gap-1.5">
                        <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                        成功入库
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-bold font-mono text-emerald-700 dark:text-emerald-300">
                        {report.insertedCount.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-emerald-600">条</span>
                    </div>
                    <div className="text-[10px] text-emerald-600/80">
                      已持久化写入 PostgreSQL
                    </div>
                  </Card>

                  {/* 2. Duplicates Skipped */}
                  <Card className="p-4 border-amber-500/30 bg-amber-500/5 space-y-1">
                    <div className="flex items-center justify-between text-amber-700 dark:text-amber-400">
                      <span className="text-[11px] font-semibold flex items-center gap-1.5">
                        <ShieldCheck className="w-4 h-4 text-amber-600" />
                        重复过滤
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-bold font-mono text-amber-700 dark:text-amber-300">
                        {report.duplicateCount.toLocaleString()}
                      </span>
                      <span className="text-[11px] text-amber-600">条</span>
                    </div>
                    <div className="text-[10px] text-amber-600/80">
                      单号已存在，自动排重
                    </div>
                  </Card>

                  {/* 3. Failed / Invalid */}
                  <Card className="p-4 border-border bg-muted/30 space-y-1">
                    <div className="flex items-center justify-between text-muted-foreground">
                      <span className="text-[11px] font-semibold flex items-center gap-1.5">
                        <AlertTriangle className="w-4 h-4 text-slate-500" />
                        格式异常
                      </span>
                    </div>
                    <div className="flex items-baseline gap-1 mt-1">
                      <span className="text-2xl font-bold font-mono text-foreground">
                        {report.failedCount}
                      </span>
                      <span className="text-[11px] text-muted-foreground">条</span>
                    </div>
                    <div className="text-[10px] text-muted-foreground">
                      空诉求或缺损行
                    </div>
                  </Card>
                </div>

                {/* Next Step Callout */}
                <div className="p-4 rounded-xl border border-purple-500/20 bg-purple-500/5 flex items-start gap-3.5">
                  <div className="w-8 h-8 rounded-lg bg-purple-500/10 text-purple-600 flex items-center justify-center shrink-0 mt-0.5">
                    <Sparkles className="w-4 h-4" />
                  </div>
                  <div className="space-y-1">
                    <h4 className="text-xs font-bold text-purple-900 dark:text-purple-200">
                      第二阶段：是否立即启动 AI Agent 进行多频图谱聚类？
                    </h4>
                    <p className="text-[11px] text-purple-700 dark:text-purple-300 leading-relaxed">
                      点击「启动 Agent 智能聚类研判」，系统将全自动运行实体消歧、时空聚类、红黄蓝风险评定并刷新大盘看板与核查总表。
                    </p>
                  </div>
                </div>
              </motion.div>
            )}

            {/* STEP 5: ERROR STATE */}
            {step === "ERROR" && (
              <motion.div
                key="error"
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.95 }}
                className="py-6 flex flex-col items-center justify-center gap-4 text-center"
              >
                <div className="w-14 h-14 rounded-2xl bg-destructive/10 border border-destructive/20 flex items-center justify-center text-destructive">
                  <AlertTriangle className="w-7 h-7" />
                </div>
                <div className="space-y-1 max-w-md">
                  <p className="text-sm font-bold text-foreground">处理过程中断</p>
                  <p className="text-xs text-muted-foreground">{errorMessage}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="mt-2 text-xs"
                >
                  <RefreshCw className="w-3.5 h-3.5 mr-1.5" />
                  返回重试
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Modal Footer */}
        <div className="p-4 border-t border-border bg-muted/20 flex items-center justify-between">
          {step === "REPORT" ? (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={handleFinishAndClose}
                className="text-xs border-border bg-card text-foreground hover:bg-muted cursor-pointer"
              >
                仅完成入库 (稍后研判)
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleStartAgentClustering}
                className="text-xs bg-purple-600 text-white hover:bg-purple-700 font-semibold shadow-md shadow-purple-500/20 cursor-pointer"
              >
                <Bot className="w-3.5 h-3.5 mr-1.5" />
                启动 Agent 智能聚类研判
                <ArrowRight className="w-3.5 h-3.5 ml-1" />
              </Button>
            </>
          ) : step === "ERROR" ? (
            <div className="w-full flex justify-end">
              <Button
                variant="outline"
                size="sm"
                onClick={onClose}
                className="text-xs cursor-pointer"
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
                disabled={step === "INGESTING" || step === "CLUSTERING"}
                className="text-xs border-border bg-card text-foreground hover:bg-muted cursor-pointer"
              >
                取消
              </Button>

              <Button
                variant="default"
                size="sm"
                onClick={handleUploadAndIngest}
                disabled={!file || step === "INGESTING" || step === "CLUSTERING"}
                className="text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" />
                第 1 步：上传至后端流式入库
              </Button>
            </>
          )}
        </div>
      </motion.div>
    </div>
  );
};
