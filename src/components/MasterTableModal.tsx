import React, { useState } from "react";
import {
  FileSpreadsheet,
  Search,
  CheckCircle2,
  AlertTriangle,
  Flame,
  ArrowUpDown,
  Download,
  ExternalLink,
} from "lucide-react";
import type { MultiFrequencyTheme } from "../types";
import { exportThemesToCSV } from "../lib/export-csv";
import { toast } from "sonner";

interface MasterTableModalProps {
  themes: MultiFrequencyTheme[];
  onSelectTheme: (theme: MultiFrequencyTheme) => void;
}

export const MasterTableModal: React.FC<MasterTableModalProps> = ({
  themes,
  onSelectTheme,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [sortField, setSortField] = useState<"count" | "time" | "risk">("risk");

  const filtered = themes.filter(
    (t) =>
      t.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.canonicalSubject.toLowerCase().includes(searchTerm.toLowerCase()) ||
      t.canonicalLocation.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const handleExportAll = () => {
    exportThemesToCSV(themes);
    toast.success("已成功导出多频工单核查总表 CSV！");
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-4">
      <div className="glass-panel rounded-2xl border-slate-800 overflow-hidden flex flex-col">
        {/* Table Top Controls */}
        <div className="p-4 border-b border-slate-800 bg-slate-900/70 flex flex-col md:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <FileSpreadsheet className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">
                多频工单核查总表 (Master Verification Table)
              </h2>
              <p className="text-[11px] text-slate-400">
                支持全量多频主题核查、风险定级与批量导出
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 w-full md:w-auto">
            <div className="relative flex-1 md:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-slate-500" />
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索多频主题/主体/地点..."
                className="w-full bg-slate-950 border border-slate-800 rounded-lg pl-8 pr-3 py-1.5 text-xs text-slate-200 outline-none focus:border-cyan-500"
              />
            </div>

            <button
              onClick={handleExportAll}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-emerald-600 hover:bg-emerald-500 text-white transition-all shadow-md shadow-emerald-600/20"
            >
              <Download className="w-3.5 h-3.5" />
              导出全量核查报表 (CSV)
            </button>
          </div>
        </div>

        {/* Table Main */}
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/90 border-b border-slate-800 text-slate-400 font-semibold">
                <th className="p-3.5 w-14 text-center">序号</th>
                <th className="p-3.5 w-24">风险等级</th>
                <th className="p-3.5">多频主题名称</th>
                <th className="p-3.5 w-44">规范被诉主体</th>
                <th className="p-3.5 w-40">发生地点</th>
                <th className="p-3.5 w-24 text-center">工单件数</th>
                <th className="p-3.5 w-28 text-center">时间跨度</th>
                <th className="p-3.5 w-28 text-center">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60">
              {filtered.map((t, idx) => {
                const isHighRisk = t.riskLevel === "HIGH";
                const isMedRisk = t.riskLevel === "MEDIUM";
                return (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => onSelectTheme(t)}
                  >
                    <td className="p-3.5 text-center text-slate-500 font-mono">
                      {idx + 1}
                    </td>
                    <td className="p-3.5">
                      {isHighRisk && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-500/20 text-rose-300 border border-rose-500/40">
                          <Flame className="w-3 h-3 text-rose-400" /> 高危
                        </span>
                      )}
                      {isMedRisk && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-amber-500/20 text-amber-300 border border-amber-500/40">
                          <AlertTriangle className="w-3 h-3 text-amber-400" /> 中危
                        </span>
                      )}
                      {!isHighRisk && !isMedRisk && (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-500/20 text-emerald-300 border border-emerald-500/30">
                          关注
                        </span>
                      )}
                    </td>
                    <td className="p-3.5 font-semibold text-white">
                      <div>{t.title}</div>
                      <div className="text-[11px] text-slate-400 font-normal line-clamp-1 mt-0.5">
                        {t.aiSummary}
                      </div>
                    </td>
                    <td className="p-3.5 text-cyan-300 font-medium truncate">
                      {t.canonicalSubject}
                    </td>
                    <td className="p-3.5 text-purple-300 truncate">
                      {t.canonicalLocation}
                    </td>
                    <td className="p-3.5 text-center">
                      <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-white font-extrabold">
                        {t.ticketCount}
                      </span>
                    </td>
                    <td className="p-3.5 text-center text-slate-400 font-mono text-[11px]">
                      {t.timeSpanHours} 小时
                    </td>
                    <td className="p-3.5 text-center">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTheme(t);
                        }}
                        className="px-2.5 py-1 rounded bg-cyan-950 text-cyan-400 border border-cyan-800/60 hover:bg-cyan-900/60 text-xs font-semibold transition-all inline-flex items-center gap-1"
                      >
                        下钻核查
                        <ExternalLink className="w-3 h-3" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
