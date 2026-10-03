"use client";

import React, { useState, useRef, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  FileSpreadsheet,
  CheckCircle2,
  AlertTriangle,
  X,
  Loader2,
  Database,
  ClipboardPaste,
  Sparkles,
  ArrowRight,
  Upload,
  FileText,
  Trash2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import { Button } from "@/app/_components/ui/button";
import { Card } from "@/app/_components/ui/card";
import { toast } from "sonner";
import { resolveApiError } from "@/lib/api-codes";

export interface DataEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onDatabaseUpdated?: () => void;
  // 向下兼容旧签名（忽略内部不需要的参数）
  onUploadSuccess?: (data?: any) => void;
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

export const DataEntryDialog: React.FC<DataEntryDialogProps> = ({
  isOpen,
  onClose,
  onDatabaseUpdated,
}) => {
  const router = useRouter();
  const [tab, setTab] = useState<"file" | "paste">("file");
  const [file, setFile] = useState<File | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [isDragging, setIsDragging] = useState(false);
  const [isIngesting, setIsIngesting] = useState(false);
  const [report, setReport] = useState<IngestionReport | null>(null);
  const [errorMessage, setErrorMessage] = useState("");

  const fileInputRef = useRef<HTMLInputElement>(null);

  // 每次打开重置状态
  useEffect(() => {
    if (isOpen) {
      setFile(null);
      setPasteText("");
      setReport(null);
      setErrorMessage("");
      setIsIngesting(false);
    }
  }, [isOpen]);

  // 锁定背景滚动
  useEffect(() => {
    if (isOpen) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = prev;
      };
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleFileSelect = (selectedFile: File) => {
    if (!selectedFile) return;
    const name = selectedFile.name.toLowerCase();
    if (!name.endsWith(".xlsx") && !name.endsWith(".xls") && !name.endsWith(".csv")) {
      toast.error("请上传 .xlsx, .xls 或 .csv 格式的工单文件");
      return;
    }
    setFile(selectedFile);
    setErrorMessage("");
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

  // 1. 上传文件入库
  const handleUploadFile = async () => {
    if (!file || isIngesting) return;

    setIsIngesting(true);
    setErrorMessage("");
    toast.info("正在上传解析并导入工单...");

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
        onDatabaseUpdated?.();
        window.dispatchEvent(new CustomEvent("civic-data-refresh"));
        toast.success(`成功入库 ${json.data.insertedCount} 条工单`);
      } else {
        const err = resolveApiError(json, "文件解析入库失败，请检查文件格式");
        setErrorMessage(err);
        toast.error(err);
      }
    } catch (err: any) {
      const msg = err.message || "网络异常，请重试";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsIngesting(false);
    }
  };

  // 2. 粘贴或手动填写文本入库
  const handlePasteText = async () => {
    const lines = pasteText
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);

    if (lines.length === 0 || isIngesting) {
      toast.error("请先输入或粘贴至少一条工单内容");
      return;
    }

    setIsIngesting(true);
    setErrorMessage("");
    toast.info(`正在解析并导入 ${lines.length} 条工单...`);

    try {
      const res = await fetch("/api/tickets/paste", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: lines }),
      });
      const json = await res.json();

      if (json.success && json.data) {
        setReport(json.data);
        onDatabaseUpdated?.();
        window.dispatchEvent(new CustomEvent("civic-data-refresh"));
        toast.success(`成功入库 ${json.data.insertedCount} 条工单`);
      } else {
        const err = resolveApiError(json, "工单文本解析失败");
        setErrorMessage(err);
        toast.error(err);
      }
    } catch (err: any) {
      const msg = err.message || "网络异常，请重试";
      setErrorMessage(msg);
      toast.error(msg);
    } finally {
      setIsIngesting(false);
    }
  };

  const handleGoToWorkbench = () => {
    onClose();
    router.push("/workbench");
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[2000] flex items-center justify-center p-4">
        {/* 背景遮罩 */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={() => {
            if (!isIngesting) onClose();
          }}
          className="fixed inset-0 bg-black/45 backdrop-blur-xs"
        />

        {/* 弹窗主体 */}
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: 12 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.95, y: 12 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
          className="relative w-full max-w-xl bg-card border border-border rounded-xl shadow-2xl overflow-hidden z-10 flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-border/80 bg-muted/20">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-primary/10 text-primary flex items-center justify-center shrink-0">
                <FileSpreadsheet className="w-4 h-4" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-foreground tracking-tight">
                  工单数据录入
                </h3>
                <p className="text-xs text-muted-foreground">
                  支持 Excel / CSV 批量导入与多条文本快速录入
                </p>
              </div>
            </div>

            <button
              onClick={onClose}
              disabled={isIngesting}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 transition-colors disabled:opacity-40 cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          {/* Body */}
          <div className="p-5 overflow-y-auto space-y-4">
            {report ? (
              /* 入库成功报告视图 */
              <div className="py-2 space-y-4">
                <div className="flex items-center gap-3 p-3.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-800 dark:text-emerald-300">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
                  <div>
                    <div className="text-xs font-semibold">工单入库成功！</div>
                    <div className="text-[11px] opacity-90">
                      数据已安全存入本地专属数据表，已就绪供全流程 AI 流水线调用。
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-4 gap-2.5">
                  <div className="p-2.5 rounded-lg border border-border/70 bg-muted/30 text-center">
                    <div className="text-[10.5px] text-muted-foreground">解析总数</div>
                    <div className="text-base font-bold font-mono text-foreground mt-0.5">
                      {report.totalParsed}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border/70 bg-emerald-500/5 text-center">
                    <div className="text-[10.5px] text-emerald-600 dark:text-emerald-400 font-medium">
                      成功入库
                    </div>
                    <div className="text-base font-bold font-mono text-emerald-600 dark:text-emerald-400 mt-0.5">
                      {report.insertedCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border/70 bg-muted/30 text-center">
                    <div className="text-[10.5px] text-muted-foreground">重复过滤</div>
                    <div className="text-base font-bold font-mono text-muted-foreground mt-0.5">
                      {report.duplicateCount}
                    </div>
                  </div>
                  <div className="p-2.5 rounded-lg border border-border/70 bg-muted/30 text-center">
                    <div className="text-[10.5px] text-muted-foreground">耗时</div>
                    <div className="text-base font-bold font-mono text-foreground mt-0.5">
                      {report.durationMs}ms
                    </div>
                  </div>
                </div>

                <div className="text-xs text-muted-foreground bg-muted/20 p-3 rounded-lg border border-border/50">
                  💡 提示：前往全工序智能研判工作台，可直观查看工单接入、分类初筛、要素提取与微观空间聚类流向。
                </div>
              </div>
            ) : (
              /* 数据录入表单 */
              <>
                {/* 选项卡切换 */}
                <div className="flex p-0.5 rounded-lg bg-muted/60 border border-border/60">
                  <button
                    type="button"
                    onClick={() => setTab("file")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                      tab === "file"
                        ? "bg-card text-foreground shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Upload className="w-3.5 h-3.5" />
                    文件批量导入 (.xlsx / .csv)
                  </button>
                  <button
                    type="button"
                    onClick={() => setTab("paste")}
                    className={`flex-1 flex items-center justify-center gap-1.5 py-1.5 text-xs font-medium rounded-md transition-all cursor-pointer ${
                      tab === "paste"
                        ? "bg-card text-foreground shadow-2xs font-semibold"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <ClipboardPaste className="w-3.5 h-3.5" />
                    手动填写 / 文本批量录入
                  </button>
                </div>

                {errorMessage && (
                  <div className="flex items-center gap-2 p-2.5 text-xs rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-600 dark:text-rose-400">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                )}

                {tab === "file" ? (
                  /* Tab 1: 文件上传 */
                  <div className="space-y-3">
                    <div
                      onDragOver={handleDragOver}
                      onDragLeave={handleDragLeave}
                      onDrop={handleDrop}
                      onClick={() => fileInputRef.current?.click()}
                      className={`relative flex flex-col items-center justify-center p-6 border-2 border-dashed rounded-xl transition-all cursor-pointer ${
                        isDragging
                          ? "border-primary bg-primary/5"
                          : file
                          ? "border-emerald-500/60 bg-emerald-500/5"
                          : "border-border hover:border-primary/50 hover:bg-muted/30"
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

                      {file ? (
                        <div className="flex flex-col items-center text-center">
                          <div className="w-10 h-10 rounded-full bg-emerald-500/15 text-emerald-600 flex items-center justify-center mb-2">
                            <FileSpreadsheet className="w-5 h-5" />
                          </div>
                          <span className="text-xs font-medium text-foreground max-w-[280px] truncate">
                            {file.name}
                          </span>
                          <span className="text-[11px] text-muted-foreground mt-0.5">
                            {(file.size / 1024).toFixed(1)} KB · 点击可重新选择
                          </span>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center text-center">
                          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-muted-foreground mb-2">
                            <Upload className="w-5 h-5" />
                          </div>
                          <p className="text-xs font-medium text-foreground">
                            点击选择文件，或将表格拖拽至此
                          </p>
                          <p className="text-[11px] text-muted-foreground mt-0.5">
                            支持 Excel (.xlsx, .xls) 与 CSV (.csv) 格式
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="text-[11px] text-muted-foreground space-y-1 bg-muted/20 p-2.5 rounded-lg border border-border/40">
                      <div className="font-medium text-foreground/80 flex items-center gap-1">
                        <Sparkles className="w-3 h-3 text-primary" /> 表格字段自适应机制：
                      </div>
                      <p>
                        系统自动匹配常见表头（工单编号、工单标题、诉求正文、所属镇街、工单类型等），无需固化模板；缺失字段由系统结合语义自动识别补全。
                      </p>
                    </div>
                  </div>
                ) : (
                  /* Tab 2: 文本粘贴录入 */
                  <div className="space-y-2.5">
                    <textarea
                      value={pasteText}
                      onChange={(e) => {
                        setPasteText(e.target.value);
                        setErrorMessage("");
                      }}
                      placeholder={`在此直接输入或粘贴工单诉求文本...\n\n支持单条输入或每行一条批量录入，例如：\n【城管】大良街道清晖园附近商铺夜间高音喇叭噪音扰民\n市民反映容桂街道容里村路段有占道经营违规摆卖`}
                      rows={7}
                      className="w-full text-xs p-3 rounded-lg border border-border bg-card text-foreground placeholder:text-muted-foreground/60 focus:outline-hidden focus:ring-1 focus:ring-primary focus:border-primary resize-none leading-relaxed font-mono"
                    />

                    <div className="flex items-center justify-between text-[11px] text-muted-foreground px-1">
                      <span>
                        当前已识别：
                        <strong className="text-foreground ml-1">
                          {
                            pasteText
                              .split(/\r?\n/)
                              .map((s) => s.trim())
                              .filter(Boolean).length
                          }
                        </strong>{" "}
                        条
                      </span>
                      {pasteText && (
                        <button
                          type="button"
                          onClick={() => setPasteText("")}
                          className="hover:text-rose-500 transition-colors cursor-pointer flex items-center gap-1"
                        >
                          <Trash2 className="w-3 h-3" /> 清空输入
                        </button>
                      )}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>

          {/* Footer */}
          <div className="flex items-center justify-between px-5 py-3 border-t border-border/80 bg-muted/20">
            {report ? (
              /* 入库成功后的动作 */
              <div className="flex items-center justify-end w-full gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  className="h-8 text-xs cursor-pointer"
                >
                  完成并关闭
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={handleGoToWorkbench}
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer shadow-sm"
                >
                  进入 AI 研判工作台
                  <ArrowRight className="w-3.5 h-3.5 ml-1.5" />
                </Button>
              </div>
            ) : (
              /* 录入中的动作 */
              <div className="flex items-center justify-end w-full gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  disabled={isIngesting}
                  className="h-8 text-xs cursor-pointer"
                >
                  取消
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={tab === "file" ? handleUploadFile : handlePasteText}
                  disabled={
                    isIngesting ||
                    (tab === "file" && !file) ||
                    (tab === "paste" &&
                      pasteText.split(/\r?\n/).filter((s) => s.trim()).length === 0)
                  }
                  className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-medium cursor-pointer disabled:opacity-50"
                >
                  {isIngesting ? (
                    <>
                      <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                      正在导入入库...
                    </>
                  ) : (
                    <>
                      <Database className="w-3.5 h-3.5 mr-1.5" />
                      {tab === "file" ? "导入工单表格" : "提交录入工单"}
                    </>
                  )}
                </Button>
              </div>
            )}
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
