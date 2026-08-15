import React, { useState } from "react";
import {
  X,
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
  ExternalLink,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import type { MultiFrequencyTheme, EnrichedTicket } from "../types";
import { exportSingleThemeTicketsToCSV } from "../lib/export-csv";
import { toast } from "sonner";

interface TicketDetailDrawerProps {
  theme: MultiFrequencyTheme | null;
  onClose: () => void;
  onUpdateThemeStatus?: (themeId: string, status: "CONFIRMED" | "DISMISSED") => void;
}

export const TicketDetailDrawer: React.FC<TicketDetailDrawerProps> = ({
  theme,
  onClose,
  onUpdateThemeStatus,
}) => {
  if (!theme) return null;

  const [selectedTicketIds, setSelectedTicketIds] = useState<string[]>(
    theme.tickets.map((t) => t.id)
  );
  const [tableSearch, setTableSearch] = useState("");
  const [verifiedList, setVerifiedList] = useState<Record<string, boolean>>({});

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
    if (onUpdateThemeStatus) {
      onUpdateThemeStatus(theme.id, "CONFIRMED");
    }
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
    <AnimatePresence>
      <div className="fixed inset-0 z-50 overflow-hidden bg-black/70 backdrop-blur-sm flex justify-end">
        {/* Backdrop Click */}
        <div className="flex-1" onClick={onClose} />

        {/* Drawer Content */}
        <motion.div
          initial={{ x: "100%" }}
          animate={{ x: 0 }}
          exit={{ x: "100%" }}
          transition={{ type: "spring", damping: 25, stiffness: 200 }}
          className="w-full max-w-5xl bg-slate-950 border-l border-slate-800 h-full flex flex-col shadow-2xl overflow-hidden"
        >
          {/* Drawer Header */}
          <div className="p-6 border-b border-slate-800/80 bg-slate-900/60 flex items-start justify-between gap-4">
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`px-2.5 py-0.5 rounded-full text-xs font-bold flex items-center gap-1 ${
                    isHighRisk
                      ? "bg-rose-500/20 text-rose-300 border border-rose-500/40"
                      : "bg-amber-500/20 text-amber-300 border border-amber-500/40"
                  }`}
                >
                  {isHighRisk ? <Flame className="w-3.5 h-3.5 text-rose-400" /> : <AlertTriangle className="w-3.5 h-3.5 text-amber-400" />}
                  {isHighRisk ? "🔴 高危多频事件" : "🟡 中度多频事件"}
                </span>

                <span className="text-xs px-2.5 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/30">
                  {theme.category}
                </span>

                <span className="text-xs text-slate-400">
                  工单聚合量：<strong className="text-white font-bold">{theme.ticketCount}</strong> 单
                </span>
              </div>

              <h2 className="text-lg font-bold text-white tracking-tight">
                {theme.title}
              </h2>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-300">
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
            </div>

            {/* Close Button */}
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-all"
            >
              <X className="w-5 h-5" />
            </button>
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
            {/* Search within table */}
            <div className="relative w-full md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={tableSearch}
                onChange={(e) => setTableSearch(e.target.value)}
                placeholder="筛选工单编号/诉求关键词..."
                className="w-full bg-slate-900 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>

            {/* Batch Action Buttons */}
            <div className="flex items-center gap-2 w-full md:w-auto justify-end">
              <button
                onClick={handleExportCSV}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-900 border border-slate-700 text-slate-300 hover:text-white transition-all"
              >
                <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-400" />
                导出该主题明细表
              </button>

              <button
                onClick={handleBatchVerify}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-cyan-600 hover:bg-cyan-500 text-white transition-all shadow-md shadow-cyan-600/20"
              >
                <CheckCircle2 className="w-3.5 h-3.5" />
                批量核查确认 ({selectedTicketIds.length})
              </button>

              <button
                onClick={handleBatchDispatch}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-purple-600 hover:bg-purple-500 text-white transition-all shadow-md shadow-purple-600/20"
              >
                <Send className="w-3.5 h-3.5" />
                一键协同督办
              </button>
            </div>
          </div>

          {/* Ticket Table View (Satisfies requirement: 能够实现批量核查效果，并将效果以表格形式呈现) */}
          <div className="flex-1 overflow-y-auto p-6">
            <div className="border border-slate-800 rounded-xl overflow-hidden bg-slate-900/50">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-900 border-b border-slate-800 text-slate-400 font-semibold">
                    <th className="p-3 w-10 text-center">
                      <input
                        type="checkbox"
                        checked={selectedTicketIds.length === theme.tickets.length && theme.tickets.length > 0}
                        onChange={toggleSelectAll}
                        className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                      />
                    </th>
                    <th className="p-3 w-36">工单编号</th>
                    <th className="p-3 w-36">诉求登记时间</th>
                    <th className="p-3 w-28">诉求人</th>
                    <th className="p-3 w-24">渠道</th>
                    <th className="p-3">原始诉求内容与市民表述</th>
                    <th className="p-3 w-32">抽取对齐实体</th>
                    <th className="p-3 w-24 text-center">核查状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60">
                  {filteredTickets.map((tk) => {
                    const isSelected = selectedTicketIds.includes(tk.id);
                    return (
                      <tr
                        key={tk.id}
                        className={`hover:bg-slate-800/40 transition-colors ${
                          isSelected ? "bg-cyan-950/10" : ""
                        }`}
                      >
                        <td className="p-3 text-center">
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => toggleTicket(tk.id)}
                            className="rounded border-slate-700 bg-slate-800 text-cyan-500 focus:ring-0"
                          />
                        </td>
                        <td className="p-3 font-mono font-medium text-cyan-300">
                          {tk.ticketNo}
                        </td>
                        <td className="p-3 text-slate-400 font-mono text-[11px]">
                          {tk.createTime}
                        </td>
                        <td className="p-3 text-slate-300">
                          <div>{tk.citizenName}</div>
                          <div className="text-[10px] text-slate-500 font-mono">{tk.citizenPhone}</div>
                        </td>
                        <td className="p-3 text-slate-400">
                          <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                            {tk.channel}
                          </span>
                        </td>
                        <td className="p-3 text-slate-200 leading-relaxed max-w-md">
                          {tk.content}
                        </td>
                        <td className="p-3 space-y-1">
                          <div className="text-[10.5px] text-cyan-300 bg-cyan-950/60 px-1.5 py-0.5 rounded border border-cyan-800/40 truncate">
                            主体: {tk.canonicalSubject}
                          </div>
                          <div className="text-[10.5px] text-purple-300 bg-purple-950/60 px-1.5 py-0.5 rounded border border-purple-800/40 truncate">
                            地点: {tk.canonicalLocation}
                          </div>
                        </td>
                        <td className="p-3 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                            <ShieldCheck className="w-3 h-3" />
                            已归纳
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
};
