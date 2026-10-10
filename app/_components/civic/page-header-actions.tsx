"use client";

import React, { useState } from "react";
import { Download, RotateCw } from "lucide-react";

export interface PageHeaderActionsProps {
  /** 页面特定的筛选器、选择器或业务操作按钮 (靠左展示) */
  children?: React.ReactNode;
  /** 刷新回调函数 */
  onRefresh?: () => void | Promise<void>;
  /** 外部控制的刷新加载状态 */
  refreshing?: boolean;
  /** 刷新按钮文案，默认为 "刷新" */
  refreshText?: string;
  /** 导出回调函数 */
  onExport?: () => void | Promise<void>;
  /** 外部控制的导出加载状态 */
  exporting?: boolean;
  /** 导出按钮文案，默认为 "导出" */
  exportText?: string;
  /** 容器额外样式类 */
  className?: string;
}

/**
 * 全站统一步调的页面 Header 操作栏组件
 * 统一所有页面的筛选扩展区、导出按钮与刷新按钮的样式、位置与交互规范
 */
export function PageHeaderActions({
  children,
  onRefresh,
  refreshing: externalRefreshing,
  refreshText = "刷新",
  onExport,
  exporting: externalExporting,
  exportText = "导出",
  className = "",
}: PageHeaderActionsProps) {
  const [internalRefreshing, setInternalRefreshing] = useState(false);
  const [internalExporting, setInternalExporting] = useState(false);

  const isRefreshing = externalRefreshing ?? internalRefreshing;
  const isExporting = externalExporting ?? internalExporting;

  const handleRefresh = async () => {
    if (!onRefresh || isRefreshing) return;
    try {
      const res = onRefresh();
      if (res instanceof Promise) {
        setInternalRefreshing(true);
        await res;
      }
    } finally {
      setInternalRefreshing(false);
    }
  };

  const handleExport = async () => {
    if (!onExport || isExporting) return;
    try {
      const res = onExport();
      if (res instanceof Promise) {
        setInternalExporting(true);
        await res;
      }
    } finally {
      setInternalExporting(false);
    }
  };

  return (
    <div className={`page-hero__actions flex items-center gap-2 ${className}`}>
      {/* 页面专属筛选器或业务操作 */}
      {children}

      {/* 统一规范的导出按钮 */}
      {onExport && (
        <button
          type="button"
          className="btn btn--default group inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-xs font-medium shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleExport}
          disabled={isExporting}
          title={exportText}
        >
          <Download
            size={13}
            className={`shrink-0 text-slate-500 group-hover:text-[var(--c-brand)] transition-colors ${
              isExporting ? "animate-bounce text-[var(--c-brand)]" : ""
            }`}
          />
          <span>{isExporting ? "导出中…" : exportText}</span>
        </button>
      )}

      {/* 统一规范的刷新按钮 */}
      {onRefresh && (
        <button
          type="button"
          className="btn btn--default group inline-flex items-center gap-1.5 h-[34px] px-3 rounded-lg text-xs font-medium shadow-2xs hover:shadow-xs transition-all disabled:opacity-50 disabled:cursor-not-allowed"
          onClick={handleRefresh}
          disabled={isRefreshing}
          title={refreshText}
        >
          <RotateCw
            size={13}
            className={`shrink-0 text-slate-500 group-hover:text-[var(--c-brand)] transition-colors ${
              isRefreshing ? "animate-spin text-[var(--c-brand)]" : ""
            }`}
          />
          <span>{isRefreshing ? "刷新中…" : refreshText}</span>
        </button>
      )}
    </div>
  );
}
