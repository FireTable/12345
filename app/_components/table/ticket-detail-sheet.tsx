"use client";

import React, { useState } from "react";
import {
  X,
  Building2,
  MapPin,
  Clock,
  Sparkles,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
  FileText,
  User,
  Phone,
  Layers,
} from "lucide-react";
import type { MultiFrequencyTheme, RawTicket } from "@/backend/state";
import { exportThemeTicketsToCSV } from "@/lib/export-csv";
import { Button } from "@/app/_components/ui/button";
import { toast } from "sonner";

interface TicketDetailSheetProps {
  theme: MultiFrequencyTheme | null;
  onClose: () => void;
  isLoadingTickets?: boolean;
}

export const TicketDetailSheet: React.FC<TicketDetailSheetProps> = ({
  theme,
  onClose,
  isLoadingTickets = false,
}) => {
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());

  // Lock background body scroll when drawer is open
  React.useEffect(() => {
    if (theme) {
      const originalOverflow = document.body.style.overflow;
      document.body.style.overflow = "hidden";
      return () => {
        document.body.style.overflow = originalOverflow;
      };
    }
  }, [theme]);

  if (!theme) return null;

  const tickets = theme.tickets || [];
  const isHighRisk = theme.riskLevel === "HIGH";
  const isMedRisk = theme.riskLevel === "MEDIUM";

  const handleToggleSelect = (id: string) => {
    const next = new Set(selectedTicketIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedTicketIds(next);
  };

  const handleSelectAll = () => {
    if (selectedTicketIds.size === tickets.length) {
      setSelectedTicketIds(new Set());
    } else {
      setSelectedTicketIds(new Set(tickets.map((t) => t.id)));
    }
  };

  const handleExportThemeTickets = () => {
    exportThemeTicketsToCSV(theme);
    toast.success(`已导出主题「${theme.title}」下工单明细！`);
  };

  const handleBatchVerify = () => {
    const count = selectedTicketIds.size || tickets.length;
    toast.success(`已成功批量核查确认 ${count} 件多频工单，已生成协同督办派单流转记录！`);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200 overscroll-contain"
      onClick={onClose}
    >
      <div
        className="w-full max-w-3xl h-full bg-card border-l border-border shadow-2xl flex flex-col overflow-hidden text-foreground animate-in slide-in-from-right duration-250"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Sheet Header */}
        <div className="p-6 border-b border-border space-y-4 bg-muted/20 shrink-0">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {isHighRisk && (
                <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-rose-600 animate-pulse" />
                  🔴 紧急督办
                </span>
              )}
              {isMedRisk && (
                <span className="px-2.5 py-1 rounded-md text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-600" />
                  🟡 重点跟进
                </span>
              )}
              {!isHighRisk && !isMedRisk && (
                <span className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted text-muted-foreground border border-border">
                  ⚪ 常规流转
                </span>
              )}

              <span className="text-xs px-2.5 py-1 rounded-md bg-muted text-muted-foreground border border-border font-medium">
                {theme.category}
              </span>

              <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2.5 py-1 rounded-md border border-primary/20 flex items-center gap-1">
                <Layers className="w-3.5 h-3.5" />
                {theme.ticketCount} 件关联工单
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
              title="关闭抽屉"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div>
            <h2 className="text-lg font-bold text-foreground leading-snug tracking-tight">
              {theme.title}
            </h2>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-muted-foreground mt-2">
              <div className="flex items-center gap-1.5 font-medium">
                <Building2 className="w-4 h-4 text-primary shrink-0" />
                <span className="text-foreground font-semibold">{theme.canonicalSubject}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <MapPin className="w-4 h-4 text-muted-foreground shrink-0" />
                <span className="text-muted-foreground">{theme.canonicalLocation}</span>
              </div>
            </div>
          </div>

          {/* AI Risk Reason Card */}
          <div className="p-4 rounded-xl bg-blue-50/70 border border-blue-100 text-xs text-slate-700 space-y-2.5">
            <div className="flex items-center gap-2 font-bold text-blue-900 text-xs">
              <Sparkles className="w-4 h-4 text-blue-600 shrink-0" />
              <span>Agent 智能研判与协同处置方案</span>
            </div>
            <p className="text-slate-700 leading-relaxed text-xs text-left">
              {theme.riskReason}
            </p>
            <div className="pt-2.5 border-t border-blue-100/90 text-xs text-left leading-relaxed">
              <span className="font-bold text-blue-800">✨ 协同处置建议：</span>
              <span className="text-slate-800 font-medium">{theme.recommendedAction}</span>
            </div>
          </div>

          {/* Batch Action Toolbar */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSelectAll}
                className="text-muted-foreground hover:text-foreground font-medium cursor-pointer transition-colors"
              >
                {selectedTicketIds.size === tickets.length ? "取消全选" : "全选全部"}
              </button>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">
                已勾选 <strong className="text-primary font-bold">{selectedTicketIds.size}</strong> / {tickets.length} 件
              </span>
            </div>

            <div className="flex items-center gap-2.5">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportThemeTickets}
                className="h-8 text-xs border-border bg-card text-foreground hover:bg-muted font-medium"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 mr-1 text-emerald-600" />
                导出本案明细
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleBatchVerify}
                className="h-8 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold shadow-xs"
              >
                <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
                批量核查确认
              </Button>
            </div>
          </div>
        </div>

        {/* Ticket List Body - Full Height Natural Scroll */}
        <div className="flex-1 overflow-y-auto p-6 overscroll-contain">
          {isLoadingTickets ? (
            <div className="h-64 flex flex-col items-center justify-center gap-3 text-muted-foreground text-xs">
              <Loader2 className="w-7 h-7 animate-spin text-primary" />
              <span>正在从 PostgreSQL 按需查询聚合工单明细...</span>
            </div>
          ) : tickets.length > 0 ? (
            <div className="space-y-3.5 pb-6">
              {tickets.map((ticket, idx) => {
                const isSelected = selectedTicketIds.has(ticket.id);

                return (
                  <div
                    key={ticket.id || `ticket-${idx}`}
                    onClick={() => handleToggleSelect(ticket.id)}
                    className={`w-full p-4 rounded-xl border transition-all cursor-pointer select-none ${
                      isSelected
                        ? "bg-primary/5 border-primary shadow-xs ring-1 ring-primary/30"
                        : "bg-card border-border hover:border-border/80 hover:bg-muted/30 shadow-2xs"
                    }`}
                  >
                    {/* Header Row */}
                    <div className="flex items-center justify-between text-xs pb-2.5 border-b border-border/40">
                      <div className="flex items-center gap-2.5">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => handleToggleSelect(ticket.id)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-4 h-4 rounded text-primary focus:ring-primary border-input cursor-pointer"
                        />
                        <span className="font-mono font-bold text-foreground text-xs">
                          {ticket.ticketNo}
                        </span>
                        {ticket.subdistrict && (
                          <span className="text-[11px] px-2 py-0.5 rounded bg-muted text-muted-foreground font-medium border border-border/50">
                            {ticket.subdistrict}
                          </span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
                        <Clock className="w-3.5 h-3.5 text-muted-foreground/70" />
                        <span>{ticket.createTime}</span>
                      </div>
                    </div>

                    {/* Title / AI Summarize Title Banner */}
                    {(ticket.summarizeTitle || ticket.title) && (
                      <div className="pt-2.5 pb-1">
                        {ticket.summarizeTitle ? (
                          <div className="flex items-start gap-1.5 text-xs font-semibold text-foreground">
                            <span className="inline-flex items-center gap-1 text-[11px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-medium shrink-0">
                              <Sparkles className="w-3 h-3" />
                              AI 提炼
                            </span>
                            <span>{ticket.summarizeTitle}</span>
                          </div>
                        ) : (
                          <div className="text-xs font-semibold text-foreground">
                            {ticket.title}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Ticket Content Full Body */}
                    <div className="pt-2 text-xs text-foreground/90 leading-relaxed font-normal whitespace-pre-wrap">
                      {ticket.content}
                    </div>

                    {/* Citizen & Channel Footer */}
                    <div className="pt-2.5 mt-3 border-t border-border/30 flex items-center justify-between text-[11.5px] text-muted-foreground">
                      <div className="flex items-center gap-3">
                        <span className="flex items-center gap-1">
                          <User className="w-3.5 h-3.5 text-muted-foreground/70" />
                          诉求人: <strong className="font-medium text-foreground/80">{ticket.citizenName && ticket.citizenName !== "市民*" ? ticket.citizenName : "热线市民"}</strong>
                        </span>
                        <span className="flex items-center gap-1 font-mono text-[11px]">
                          <Phone className="w-3.5 h-3.5 text-muted-foreground/70" />
                          {ticket.citizenPhone && !ticket.citizenPhone.includes("****") ? ticket.citizenPhone : "未预留电话"}
                        </span>
                      </div>
                      <span className="text-muted-foreground/80 flex items-center gap-1">
                        <FileText className="w-3 h-3 text-muted-foreground/60" />
                        渠道: {ticket.channel || "市民服务热线"}
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="h-64 flex flex-col items-center justify-center text-muted-foreground text-xs">
              暂无匹配工单记录
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
