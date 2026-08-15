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
  Layers,
} from "lucide-react";
import type { MultiFrequencyTheme, RawTicket } from "@/backend/state";
import { exportThemeTicketsToCSV } from "@/lib/export-csv";
import { Button } from "@/app/_components/ui/button";
import { toast } from "sonner";

interface TicketDetailSheetProps {
  theme: MultiFrequencyTheme | null;
  onClose: () => void;
}

export const TicketDetailSheet: React.FC<TicketDetailSheetProps> = ({
  theme,
  onClose,
}) => {
  const [selectedTicketIds, setSelectedTicketIds] = useState<Set<string>>(new Set());

  if (!theme) return null;

  const tickets = theme.tickets;
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
    toast.success(`已导出主题「${theme.title}」下全部 ${tickets.length} 条工单明细！`);
  };

  const handleBatchVerify = () => {
    const count = selectedTicketIds.size || tickets.length;
    toast.success(`已成功批量核查确认 ${count} 件多频工单，已生成协同督办派单流转记录！`);
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-slate-900/40 backdrop-blur-xs animate-in fade-in duration-200">
      <div
        className="w-full max-w-2xl h-full bg-white border-l border-slate-200 shadow-2xl flex flex-col overflow-hidden text-slate-900"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Sheet Header */}
        <div className="p-6 border-b border-slate-200 space-y-3 bg-slate-50/50">
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
                <span className="px-2.5 py-0.5 rounded text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200">
                  ⚪ 常规流转
                </span>
              )}

              <span className="text-xs px-2 py-0.5 rounded bg-slate-100 text-slate-600 border border-slate-200">
                {theme.category}
              </span>

              <span className="font-mono text-xs font-bold text-blue-700 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                {tickets.length} 件关联工单
              </span>
            </div>

            <button
              onClick={onClose}
              className="p-1 rounded-md text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition-colors cursor-pointer"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <h2 className="text-base font-bold text-slate-900 leading-snug">
            {theme.title}
          </h2>

          <div className="grid grid-cols-2 gap-2 text-xs text-slate-600 pt-1">
            <div className="flex items-center gap-1.5 truncate">
              <Building2 className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate font-semibold text-slate-800">{theme.canonicalSubject}</span>
            </div>
            <div className="flex items-center gap-1.5 truncate">
              <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
              <span className="truncate text-slate-600">{theme.canonicalLocation}</span>
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
                className="text-slate-600 hover:text-slate-900 font-medium cursor-pointer"
              >
                {selectedTicketIds.size === tickets.length ? "取消全选" : "全选全部"}
              </button>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">
                已勾选 <strong className="text-slate-800">{selectedTicketIds.size}</strong> 件
              </span>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={handleExportThemeTickets}
                className="h-7 text-xs border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
              >
                <FileSpreadsheet className="w-3 h-3 mr-1" />
                导出本案明细
              </Button>
              <Button
                variant="default"
                size="sm"
                onClick={handleBatchVerify}
                className="h-7 text-xs bg-blue-600 text-white hover:bg-blue-700 font-semibold"
              >
                <CheckCircle2 className="w-3 h-3 mr-1" />
                批量核查确认
              </Button>
            </div>
          </div>
        </div>

        {/* Ticket List Body with Virtualization for Large Datasets */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3">
          <VirtualTicketList
            tickets={tickets}
            selectedIds={selectedTicketIds}
            onToggle={handleToggleSelect}
          />
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
                    ? "bg-blue-50/70 border-blue-400 shadow-xs"
                    : "bg-white border-slate-200 hover:border-slate-300 shadow-2xs"
                }`}
              >
                {/* Header */}
                <div className="flex items-center justify-between text-xs pb-2 border-b border-slate-100">
                  <div className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => onToggle(ticket.id)}
                      className="rounded text-blue-600 focus:ring-blue-500 border-slate-300 cursor-pointer"
                    />
                    <span className="font-mono font-bold text-slate-800">
                      {ticket.ticketNo}
                    </span>
                    <span className="text-[11px] px-1.5 py-0.2 rounded bg-slate-100 text-slate-600">
                      {ticket.subdistrict}
                    </span>
                  </div>

                  <div className="flex items-center gap-1.5 text-slate-400 font-mono text-[11px]">
                    <Clock className="w-3 h-3" />
                    <span>{ticket.createTime}</span>
                  </div>
                </div>

                {/* Content */}
                <div className="pt-2 text-xs text-slate-700 leading-relaxed font-normal">
                  {ticket.content}
                </div>

                {/* Citizen Info Footer */}
                <div className="pt-2 mt-2 border-t border-slate-50 flex items-center justify-between text-[11px] text-slate-500">
                  <span>诉求人: {ticket.citizenName} ({ticket.citizenPhone})</span>
                  <span className="text-slate-400">渠道: {ticket.channel}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
