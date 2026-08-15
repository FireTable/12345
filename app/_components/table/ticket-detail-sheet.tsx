"use client";

import React, { useState } from "react";
import {
  Building2,
  MapPin,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  AlertTriangle,
  Flame,
  Send,
  Sparkles,
  ShieldCheck,
  Search,
} from "lucide-react";
import type { MultiFrequencyTheme } from "@/backend/state";
import { exportSingleThemeTicketsToCSV } from "@/lib/export-csv";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/app/_components/ui/sheet";
import { Button } from "@/app/_components/ui/button";
import { Badge } from "@/app/_components/ui/badge";
import { Input } from "@/app/_components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/app/_components/ui/table";
import { toast } from "sonner";

interface TicketDetailSheetProps {
  theme: MultiFrequencyTheme | null;
  onClose: () => void;
}

export const TicketDetailSheet: React.FC<TicketDetailSheetProps> = ({
  theme,
  onClose,
}) => {
  if (!theme) return null;

  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>(
    theme.tickets.map((t) => t.id)
  );
  const [tableSearch, setTableSearch] = useState("");

  const filteredTickets = theme.tickets.filter(
    (t) =>
      t.ticketNo.toLowerCase().includes(tableSearch.toLowerCase()) ||
      t.content.toLowerCase().includes(tableSearch.toLowerCase()) ||
      t.citizenName.includes(tableSearch)
  );

  const toggleSelectAll = () => {
    if (selectedTicketIds.length === theme.tickets.length) {
      setSelectedTicketIds([]);
    } else {
      setSelectedTicketIds(theme.tickets.map((t) => t.id));
    }
  };

  const toggleTicket = (id: string) => {
    if (selectedTicketIds.includes(id)) {
      setSelectedTicketIds(selectedTicketIds.filter((t) => t !== id));
    } else {
      setSelectedTicketIds([...selectedTicketIds, id]);
    }
  };

  const handleBatchVerify = () => {
    toast.success(`已成功批量核查 ${selectedTicketIds.length} 张工单，标记为多频诉求已确认！`);
  };

  const handleBatchDispatch = () => {
    toast.success(`已将该多频事件（含 ${selectedTicketIds.length} 单）协同派发至责任部门！`);
  };

  const handleExportCSV = () => {
    exportSingleThemeTicketsToCSV(theme);
    toast.success("多频主题明细表格已成功导出！");
  };

  const isHighRisk = theme.riskLevel === "HIGH";

  return (
    <Sheet open={!!theme} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex flex-col w-full sm:max-w-5xl p-0 bg-slate-950 border-slate-800">
        {/* Header */}
        <div className="p-6 border-b border-slate-800/80 bg-slate-900/60">
          <SheetHeader className="space-y-2">
            <div className="flex items-center gap-2">
              {isHighRisk ? (
                <Badge variant="destructive">
                  <Flame className="w-3.5 h-3.5 text-rose-400" />
                  🔴 高危多频事件
                </Badge>
              ) : (
                <Badge variant="warning">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />
                  🟡 中度多频事件
                </Badge>
              )}

              <Badge variant="cyan">
                {theme.category}
              </Badge>

              <span className="text-xs text-slate-400">
                工单聚合量：<strong className="text-white font-bold">{theme.ticketCount}</strong> 单
              </span>
            </div>

            <SheetTitle className="text-lg font-bold text-white tracking-tight">
              {theme.title}
            </SheetTitle>

            <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300 pt-1">
              <div className="flex items-center gap-1 text-cyan-300">
                <Building2 className="w-3.5 h-3.5 text-cyan-400" />
                <span>规范主体：<strong>{theme.canonicalSubject}</strong></span>
              </div>
              <div className="flex items-center gap-1 text-purple-300">
                <MapPin className="w-3.5 h-3.5 text-purple-400" />
                <span>发生地点：<strong>{theme.canonicalLocation}</strong></span>
              </div>
              <div className="flex items-center gap-1 text-slate-400">
                <Clock className="w-3.5 h-3.5" />
                <span>时间跨度：{theme.timeSpanHours} 小时 ({theme.firstOccurrence.slice(5)} ~ {theme.lastOccurrence.slice(11)})</span>
              </div>
            </div>
          </SheetHeader>
        </div>

        {/* AI Analysis Banner */}
        <div className="px-6 py-4 bg-slate-900/40 border-b border-slate-800/80 space-y-3">
          <div className="p-3.5 rounded-xl bg-cyan-950/30 border border-cyan-500/30 text-xs text-slate-200 flex items-start gap-2.5">
            <Sparkles className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
            <div>
              <strong className="text-cyan-300 font-semibold">GraphRAG 多频研判报告：</strong>
              <p className="mt-1 leading-relaxed text-slate-300">{theme.aiSummary}</p>
              <div className="mt-2 text-amber-300/90 font-medium">
                <strong>建议处置策略：</strong> {theme.recommendedAction}
              </div>
            </div>
          </div>
        </div>

        {/* Table Controls & Batch Actions */}
        <div className="px-6 py-3 border-b border-slate-800 flex flex-col md:flex-row items-center justify-between gap-3 bg-slate-950">
          <div className="relative w-full md:w-64">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
            <Input
              type="text"
              value={tableSearch}
              onChange={(e) => setTableSearch(e.target.value)}
              placeholder="筛选工单编号/诉求关键词..."
              className="pl-8 text-xs h-8"
            />
          </div>

          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="text-xs h-8"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
              导出该主题明细表
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={handleBatchVerify}
              className="text-xs h-8"
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              批量核查确认 ({selectedTicketIds.length})
            </Button>

            <Button
              variant="purple"
              size="sm"
              onClick={handleBatchDispatch}
              className="text-xs h-8"
            >
              <Send className="w-3.5 h-3.5" />
              一键协同督办
            </Button>
          </div>
        </div>

        {/* Ticket Table View */}
        <div className="flex-1 overflow-y-auto p-6">
          <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50">
            <Table>
              <TableHeader>
                <TableRow className="bg-slate-900 border-slate-800 text-slate-400 font-semibold">
                  <TableHead className="w-10 text-center">
                    <input
                      type="checkbox"
                      checked={selectedTicketIds.length === theme.tickets.length && theme.tickets.length > 0}
                      onChange={toggleSelectAll}
                      className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 cursor-pointer"
                    />
                  </TableHead>
                  <TableHead className="w-36">工单编号</TableHead>
                  <TableHead className="w-36">诉求登记时间</TableHead>
                  <TableHead className="w-28">诉求人</TableHead>
                  <TableHead className="w-24">渠道</TableHead>
                  <TableHead>原始诉求内容与市民表述</TableHead>
                  <TableHead className="w-32">抽取对齐实体</TableHead>
                  <TableHead className="w-24 text-center">核查状态</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTickets.map((tk) => {
                  const isSelected = selectedTicketIds.includes(tk.id);
                  return (
                    <TableRow
                      key={tk.id}
                      className={`hover:bg-slate-800/40 transition-colors ${
                        isSelected ? "bg-cyan-950/10" : ""
                      }`}
                    >
                      <TableCell className="text-center">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleTicket(tk.id)}
                          className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0 cursor-pointer"
                        />
                      </TableCell>
                      <TableCell className="font-mono font-medium text-cyan-300">
                        {tk.ticketNo}
                      </TableCell>
                      <TableCell className="text-slate-400 font-mono text-[11px]">
                        {tk.createTime}
                      </TableCell>
                      <TableCell className="text-slate-300">
                        <div>{tk.citizenName}</div>
                        <div className="text-[10px] text-slate-500 font-mono">{tk.citizenPhone}</div>
                      </TableCell>
                      <TableCell className="text-slate-400">
                        <Badge variant="secondary" className="text-[10px]">
                          {tk.channel}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-slate-200 leading-relaxed max-w-md">
                        {tk.content}
                      </TableCell>
                      <TableCell className="space-y-1">
                        <div className="text-[10.5px] text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40 truncate">
                          主体: {tk.canonicalSubject}
                        </div>
                        <div className="text-[10.5px] text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/40 truncate">
                          地点: {tk.canonicalLocation}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant="success" className="text-[10px]">
                          <ShieldCheck className="w-3 h-3" />
                          已归纳
                        </Badge>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
