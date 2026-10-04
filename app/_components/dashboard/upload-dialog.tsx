"use client";

import React, { useState, useRef, useEffect } from "react";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Database,
  ClipboardPaste,
  RefreshCw,
  Upload,
  FileText,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import { resolveApiError } from "@/lib/api-codes";

export interface UploadDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onUploadSuccess?: (data?: any) => void;
  onDatabaseUpdated?: () => void;
  autoStartCluster?: boolean;
  onClusteringChange?: (running: boolean) => void;
  onShowProgress?: () => void;
}

export interface IngestionReport {
  totalParsed: number;
  insertedCount: number;
  duplicateCount: number;
  failedCount: number;
  durationMs: number;
}

export const UploadDialog: React.FC<UploadDialogProps> = ({
  isOpen,
  onClose,
  onDatabaseUpdated,
}) => {
  const [step, setStep] = useState<"SELECT" | "INGESTING" | "REPORT" | "ERROR">("SELECT");
  const [isDragging, setIsDragging] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [ingestTab, setIngestTab] = useState<"file" | "paste">("file");
  const [pasteText, setPasteText] = useState<string>("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!isOpen) {
      setStep("SELECT");
      setFile(null);
      setReport(null);
      setErrorMessage("");
      setPasteText("");
    }
  }, [isOpen]);

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

    try {
      // 采用 application/octet-stream 直传二进制流，规避 Next.js/Undici 在大文件或中文文件名下解析 FormData 的报错
      const res = await fetch("/api/tickets/upload", {
        method: "POST",
        headers: {
          "Content-Type": "application/octet-stream",
          "X-File-Name": encodeURIComponent(file.name),
        },
        body: file,
      });
      const json = await res.json();

      if (json.success && json.data) {
        setReport(json.data);
        setStep("REPORT");
        if (onDatabaseUpdated) onDatabaseUpdated();
        window.dispatchEvent(new CustomEvent("civic-data-refresh"));
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

  // 阶段 1'：粘贴文本入库
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
        window.dispatchEvent(new CustomEvent("civic-data-refresh"));
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

  const handleReset = () => {
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
          className="fixed inset-0 z-[2000] flex items-center justify-center bg-slate-900/50 backdrop-blur-xs p-4"
          onClick={() => {
            if (step !== "INGESTING") {
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
                  <Database className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold text-foreground">
                    {step === "REPORT"
                      ? "入库校验报告"
                      : step === "INGESTING"
                      ? "数据表格解析入库"
                      : step === "ERROR"
                      ? "处理异常"
                      : "工单表格上传与入库"}
                  </h2>
                </div>
              </div>

              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={onClose}
                  disabled={step === "INGESTING"}
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
                          className={`border-2 border-dashed rounded-xl p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors ${
                            isDragging
                              ? "border-primary bg-primary/5"
                              : "border-border hover:border-primary/50 hover:bg-muted/40"
                          }`}
                        >
                          <input
                            ref={fileInputRef}
                            type="file"
                            accept=".xlsx, .xls, .csv"
                            className="hidden"
                            onChange={(e) => {
                              if (e.target.files && e.target.files[0]) {
                                handleFileSelect(e.target.files[0]);
                              }
                            }}
                          />
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3">
                            <Upload className="w-5 h-5" />
                          </div>
                          <p className="text-xs font-medium text-foreground">
                            点击上传或将工单表格文件拖拽至此
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            支持 Excel (.xlsx, .xls) 与 CSV (.csv) 格式
                          </p>
                        </div>
                      ) : (
                        <div className="border border-border rounded-xl p-4 flex items-center justify-between bg-muted/20">
                          <div className="flex items-center gap-3 min-w-0">
                            <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                              <FileSpreadsheet className="w-5 h-5" />
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-medium text-foreground truncate">
                                {file.name}
                              </p>
                              <p className="text-[10px] text-muted-foreground">
                                {file.size >= 1024 * 1024
                                  ? `${(file.size / (1024 * 1024)).toFixed(2)} MB`
                                  : `${(file.size / 1024).toFixed(1)} KB`}{" "}
                                · 待流式解析入库
                              </p>
                            </div>
                          </div>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => {
                              setFile(null);
                              if (fileInputRef.current) fileInputRef.current.value = "";
                            }}
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>
                      )
                    ) : (
                      <div className="space-y-1.5">
                        <textarea
                          value={pasteText}
                          onChange={(e) => setPasteText(e.target.value)}
                          placeholder={`在此直接输入或粘贴工单诉求文本...\n\n支持单条输入或每行一条批量录入，例如：\n【城管】大良街道清晖园附近商铺夜间高音喇叭噪音扰民\n市民反映容桂街道容里村路段有占道经营违规摆卖`}
                          rows={7}
                          className="w-full text-xs font-mono p-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                        />
                        <div className="flex items-center justify-between text-[11px] text-muted-foreground px-0.5">
                          <span>每行一条诉求，缺失单号将由系统自动分配</span>
                          <span>
                            已识别{" "}
                            {
                              pasteText
                                .split(/\r?\n/)
                                .map((s) => s.trim())
                                .filter(Boolean).length
                            }{" "}
                            条
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

                {/* STEP 3: INGESTION REPORT (完全复用原版经典进度报告样式) */}
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
                          {report.insertedCount.toLocaleString()}{" "}
                          <span className="text-[10px] font-normal text-muted-foreground">条</span>
                        </p>
                      </Card>

                      <Card className="p-3 border-border bg-muted/20 space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">重复过滤</span>
                        <p className="text-base font-bold font-mono text-foreground">
                          {report.duplicateCount.toLocaleString()}{" "}
                          <span className="text-[10px] font-normal text-muted-foreground">条</span>
                        </p>
                      </Card>

                      <Card className="p-3 border-border bg-muted/20 space-y-0.5">
                        <span className="text-[11px] text-muted-foreground">格式异常</span>
                        <p className="text-base font-bold font-mono text-foreground">
                          {report.failedCount}{" "}
                          <span className="text-[10px] font-normal text-muted-foreground">条</span>
                        </p>
                      </Card>
                    </div>
                  </motion.div>
                )}

                {/* STEP 4: ERROR STATE */}
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
                      className="mt-2 h-7 text-xs cursor-pointer"
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
                /* 成功报告步骤：仅保留完成按钮，不需要蓝色跳转按钮 */
                <div className="w-full flex items-center justify-end">
                  <Button
                    variant="default"
                    size="sm"
                    onClick={handleFinishAndClose}
                    className="h-8 px-6 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer"
                  >
                    完成
                  </Button>
                </div>
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

// 保持别名向下兼容
export { UploadDialog as DataEntryDialog };
export type { UploadDialogProps as DataEntryDialogProps };
