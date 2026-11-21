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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/app/_components/ui/dialog";
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
    if (
      !name.endsWith(".xlsx") &&
      !name.endsWith(".xls") &&
      !name.endsWith(".csv") &&
      !name.endsWith(".zip")
    ) {
      toast.error("请上传 .xlsx, .xls, .csv 或 .zip 格式的工单文件");
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
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && step !== "INGESTING") {
          onClose();
        }
      }}
    >
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(e) => {
          if (step === "INGESTING") e.preventDefault();
        }}
        onPointerDownOutside={(e) => {
          if (step === "INGESTING") e.preventDefault();
        }}
        className="!w-[calc(100vw-1.5rem)] !max-w-2xl !max-h-[90dvh] !p-0 !gap-0 bg-card border border-border rounded-xl shadow-xl overflow-hidden !flex !flex-col text-foreground"
      >
        {/* Modal Header */}
        <div className="px-4 sm:px-5 py-3.5 sm:py-4 border-b border-border flex items-center justify-between gap-2 bg-muted/20 shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center text-primary shrink-0" aria-hidden="true">
              <Database className="w-4 h-4 text-primary" />
            </div>
            <div className="min-w-0">
              <DialogTitle className="text-sm font-semibold text-foreground">
                {step === "REPORT"
                  ? "入库校验报告"
                  : step === "INGESTING"
                  ? "数据表格解析入库"
                  : step === "ERROR"
                  ? "处理异常"
                  : "工单表格上传与入库"}
              </DialogTitle>
              <DialogDescription className="sr-only">
                上传工单表格文件或粘贴工单文本进行流式解析与入库
              </DialogDescription>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            disabled={step === "INGESTING"}
            aria-label="关闭上传弹窗"
            className="min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer disabled:opacity-30 shrink-0"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        {/* Modal Body */}
        <div className="p-4 sm:p-5 space-y-4 overflow-y-auto flex-1">
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
                <div
                  role="tablist"
                  aria-label="数据录入方式"
                  className="inline-flex p-0.5 rounded-lg border border-border bg-muted/40"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ingestTab === "file"}
                    onClick={() => setIngestTab("file")}
                    className={`min-h-[44px] sm:min-h-0 sm:h-7 px-3 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      ingestTab === "file"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <FileSpreadsheet className="w-3.5 h-3.5" aria-hidden="true" />
                    上传文件
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={ingestTab === "paste"}
                    onClick={() => setIngestTab("paste")}
                    className={`min-h-[44px] sm:min-h-0 sm:h-7 px-3 text-xs font-medium rounded-md flex items-center gap-1.5 transition-colors cursor-pointer ${
                      ingestTab === "paste"
                        ? "bg-card text-foreground shadow-2xs"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" aria-hidden="true" />
                    粘贴文本
                  </button>
                </div>

                {ingestTab === "file" ? (
                  !file ? (
                    <>
                      <input
                        ref={fileInputRef}
                        type="file"
                        accept=".xlsx, .xls, .csv, .zip"
                        className="hidden"
                        aria-label="选择工单表格文件"
                        onChange={(e) => {
                          if (e.target.files && e.target.files[0]) {
                            handleFileSelect(e.target.files[0]);
                          }
                        }}
                      />
                      <div
                        role="button"
                        tabIndex={0}
                        aria-label="点击上传或将工单表格文件拖拽至此"
                        onDragOver={handleDragOver}
                        onDragLeave={handleDragLeave}
                        onDrop={handleDrop}
                        onClick={() => fileInputRef.current?.click()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            fileInputRef.current?.click();
                          }
                        }}
                        className={`border-2 border-dashed rounded-xl p-6 sm:p-8 flex flex-col items-center justify-center text-center cursor-pointer transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${
                          isDragging
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50 hover:bg-muted/40"
                        }`}
                      >
                        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-3" aria-hidden="true">
                          <Upload className="w-5 h-5" />
                        </div>
                        <p className="text-xs font-medium text-foreground">
                          点击上传或将工单表格文件拖拽至此
                        </p>
                        <p className="text-[11px] text-muted-foreground mt-1">
                          支持 Excel (.xlsx, .xls)、CSV (.csv) 或数据压缩包 (.zip)
                        </p>
                      </div>
                    </>
                  ) : (
                    <div className="border border-border rounded-xl p-4 flex items-center justify-between gap-2 bg-muted/20">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0" aria-hidden="true">
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
                        aria-label="移除已选文件"
                        onClick={() => {
                          setFile(null);
                          if (fileInputRef.current) fileInputRef.current.value = "";
                        }}
                        className="min-h-[44px] min-w-[44px] sm:min-h-0 sm:min-w-0 sm:h-8 sm:w-8 p-0 text-muted-foreground hover:text-destructive cursor-pointer shrink-0"
                      >
                        <Trash2 className="w-4 h-4" aria-hidden="true" />
                      </Button>
                    </div>
                  )
                ) : (
                  <div className="space-y-1.5">
                    <label htmlFor="upload-paste-textarea" className="sr-only">
                      粘贴工单诉求文本
                    </label>
                    <textarea
                      id="upload-paste-textarea"
                      value={pasteText}
                      onChange={(e) => setPasteText(e.target.value)}
                      placeholder={`在此直接输入或粘贴工单诉求文本...\n\n支持单条输入或每行一条批量录入，例如：\n【城管】大良街道清晖园附近商铺夜间高音喇叭噪音扰民\n市民反映容桂街道容里村路段有占道经营违规摆卖`}
                      rows={7}
                      className="w-full text-xs font-mono p-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-y"
                    />
                    <div className="flex items-center justify-between gap-2 flex-wrap text-[11px] text-muted-foreground px-0.5">
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
                <Loader2 className="w-6 h-6 animate-spin text-primary" aria-hidden="true" />
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
                {report.insertedCount > 0 ? (
                  <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold">
                          {report.failedCount > 0 ? "部分工单入库成功" : "工单入库成功"}
                        </h3>
                        <p className="text-[11px] text-emerald-700">
                          解析 {report.totalParsed} 条，成功入库 {report.insertedCount} 条，耗时 {(report.durationMs / 1000).toFixed(2)} 秒
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold bg-emerald-100 text-emerald-800 px-2 py-0.5 rounded border border-emerald-300 shrink-0">
                      {report.insertedCount} 条已入库
                    </span>
                  </div>
                ) : (
                  <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-amber-900 flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-2 min-w-0">
                      <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0" aria-hidden="true" />
                      <div className="min-w-0">
                        <h3 className="text-xs font-semibold">未成功入库任何工单</h3>
                        <p className="text-[11px] text-amber-700">
                          解析 {report.totalParsed} 条，成功 0 条（数据可能被截断、格式异常或重复过滤）
                        </p>
                      </div>
                    </div>
                    <span className="font-mono text-xs font-semibold bg-amber-100 text-amber-800 px-2 py-0.5 rounded border border-amber-300 shrink-0">
                      0 条入库
                    </span>
                  </div>
                )}

                {/* 3 Metrics Cards */}
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
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
                <AlertTriangle className="w-6 h-6 text-destructive" aria-hidden="true" />
                <div className="space-y-0.5 max-w-md">
                  <p className="text-xs font-semibold text-foreground">处理中断</p>
                  <p className="text-[11px] text-muted-foreground">{errorMessage}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  className="mt-2 min-h-[44px] sm:min-h-0 sm:h-7 text-xs cursor-pointer"
                >
                  <RefreshCw className="w-3 h-3 mr-1" aria-hidden="true" />
                  返回重试
                </Button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Modal Footer */}
        <div className="px-4 sm:px-5 py-3.5 border-t border-border bg-muted/10 flex items-center justify-between gap-2 flex-wrap shrink-0">
          {step === "REPORT" ? (
            <div className="w-full flex items-center justify-end">
              <Button
                variant="default"
                size="sm"
                onClick={handleFinishAndClose}
                className="min-h-[44px] sm:min-h-0 sm:h-8 px-6 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer"
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
                className="min-h-[44px] sm:min-h-0 sm:h-8 text-xs cursor-pointer"
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
                className="min-h-[44px] sm:min-h-0 sm:h-8 text-xs border-border bg-card text-foreground hover:bg-muted cursor-pointer"
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
                className="min-h-[44px] sm:min-h-0 sm:h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer disabled:opacity-50"
              >
                <Database className="w-3.5 h-3.5 mr-1.5" aria-hidden="true" />
                {ingestTab === "file" ? "上传并流式入库" : "粘贴文本入库"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// 保持别名向下兼容
export { UploadDialog as DataEntryDialog };
export type { UploadDialogProps as DataEntryDialogProps };
