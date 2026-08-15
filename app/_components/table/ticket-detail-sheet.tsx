"use client";

import React, { useRef, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  X,
  Building2,
  MapPin,
  Clock,
  Sparkles,
  CheckCircle2,
  FileSpreadsheet,
  Loader2,
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
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl h-full bg-card border-l border-border shadow-2xl flex flex-col overflow-hidden text-foreground"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Sheet Header */}
        <div className="p-6 border-b border-border space-y-3 bg-muted/30">
          <div className="flex items-start justify-between gap-4">
            <div className="flex flex-wrap items-center gap-2">
              {isHighRisk && (
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-rose-50 text-rose-700 border border-rose-200">
                  🔴 紧急督办
                </span>
              )}
              {isMedRisk && (
                <span className="px-2.5 py-0.5 rounded text-xs font-bold bg-amber-50 text-amber-700 border border-amber-200">
                  🟡 重点跟进
                </span>
              )}
              {!isHighRisk && !isMedRisk && (
                <span className="px-2.5 py-0.5 rounded text-xs font-medium bg-muted text-muted-foreground border border-border">
                  ⚪ 常规流转
                </span>
              )}

              <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground border border-border">
                {theme.category}
              </span>

              <span className="font-mono text-xs font-bold text-primary bg-primary/10 px-2 py-0.5 rounded border border-primary/20">
                {theme.ticketCount} 件关联工单
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-base font-bold text-foreground leading-snug">
            {theme.title}
          </h2>

          <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground pt-1">
            <div className="flex items-center gap-1.5 truncate">
              <Building2 className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate font-semibold text-foreground">{theme.canonicalSubject}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <MapPin className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              <span className="truncate text-muted-foreground">{theme.canonicalLocation}</span>
            </div>
          </div>

          {/* AI Risk Reason Card */}
          <div className="p-3 rounded-lg bg-blue-50/60 border border-blue-100 text-xs text-slate-700 space-y-1.5">
            <div className="flex items-center gap-1.5 font-bold text-blue-800">
              <Sparkles className="w-3.5 h-3.5 text-blue-600" />
              LangGraph 智能研判与处置建议
            </div>
            <p className="text-slate-600 leading-relaxed">{theme.riskReason}</p>
            <p className="text-[11.5px] text-blue-900 font-medium pt-1 border-t border-blue-100/80">
              📌 <span className="font-bold">建议举措：</span>{theme.recommendedAction}
            </p>
          </div>

          {/* Batch Action Toolbar */}
          <div className="flex items-center justify-between pt-1 text-xs">
            <div className="flex items-center gap-3">
              <button
                onClick={handleSelectAll}
                className="text-muted-foreground hover:text-foreground font-medium cursor-pointer"
              >
                {selectedTicketIds.size === tickets.length ? "取消全选" : "全选全部"}
              </button>
              <span className="text-border">|</span>
              <span className="text-muted-foreground">
                已勾选 <strong className="text-foreground">{selectedTicketIds.size}</strong> 件
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportThemeTickets}
                className="h-7 text-xs border-border bg-card text-foreground hover:bg-muted"
              >
                <FileSpreadsheet className="w-3 h-3 mr-1" />
                导出本案明细
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleBatchVerify}
                className="h-7 text-xs bg-primary text-primary-foreground hover:bg-primary/90 font-semibold"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                批量核查确认
              </Button>
            </div>
          </div>
        </div>

        {/* Ticket List Body */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          {isLoadingTickets ? (
            <div className="h-64 flex flex-col items-center justify-center gap-2 text-muted-foreground text-xs">
              <Loader2 className="w-6 h-6 animate-spin text-primary" />
              <span>正在从 PostgreSQL 按需查询工单明细...</span>
            </div>
          ) : tickets.length > 0 ? (
            <VirtualTicketList
              tickets={tickets}
              selectedIds={selectedTicketIds}
              onToggle={handleToggleSelect}
            />
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

interface VirtualTicketListProps {
  tickets: RawTicket[];
  selectedIds: Set<string>;
  onToggle: (id: string) => void;
}

const VirtualTicketList: React.FC<VirtualTicketListProps> = ({
  tickets,
  selectedIds,
  onToggle,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);

  const rowVirtualizer = useVirtualizer({
    count: tickets.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => 140,
    overscan: 5,
  });

  return (
    <div
      ref={parentRef}
      className="h-[520px] overflow-y-auto pr-1 space-y-3"
    >
      <div
        style={{
          height: `${rowVirtualizer.getTotalSize()}px`,
          width: "100%",
          position: "relative",
        }}
      >
        {rowVirtualizer.getVirtualItems().map((virtualRow) => {
          const ticket = tickets[virtualRow.index];
          const isSelected = selectedIds.has(ticket.id);

          return (
            <div
              key={ticket.id}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="pb-3"
            >
              <div
                onClick={() => onToggle(ticket.id)}
                className={`p-3.5 rounded-lg border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-primary/5 border-primary shadow-xs"
                    : "bg-card border-border hover:border-border/80 shadow-2xs"
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between text-xs pb-2 border-b border-border/40">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(ticket.id)}
                      className="rounded text-primary focus:ring-primary border-input cursor-pointer"
                    />
                    <span className="font-mono font-bold text-foreground">
                      {ticket.ticketNo}
                    </span>
                    <span className="text-[11px] px-1.5 py-0.2 rounded bg-muted text-muted-foreground">
                      {ticket.subdistrict}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-muted-foreground font-mono text-[11px]">
                    <Clock className="w-3 h-3" />
                    <span>{ticket.createTime}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="pt-2 text-xs text-foreground leading-relaxed font-normal">
                  {ticket.content}
                </div>

                {/* Citizen Info Footer */}
                <div className="pt-2 mt-2 border-t border-border/30 flex items-center justify-between text-[11px] text-muted-foreground">
                  <span>诉求人: {ticket.citizenName} ({ticket.citizenPhone})</span>
                  <span className="text-muted-foreground/80">渠道: {ticket.channel}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
