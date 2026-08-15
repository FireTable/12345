"use client";

import React, { useState } from "react";
import {
  FileSpreadsheet,
  Search,
  Flame,
  AlertTriangle,
  Download,
  ExternalLink,
} from "lucide-react";
import type { MultiFrequencyTheme } from "@/backend/state";
import { exportThemesToCSV } from "@/lib/export-csv";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";

interface MasterTableProps {
  themes: MultiFrequencyTheme[];
  onSelectTheme: (theme: MultiFrequencyTheme) => void;
}

export const MasterTable: React.FC<MasterTableProps> = ({
  themes,
  onSelectTheme,
}) => {
  const [searchTerm, setSearchTerm] = useState("");

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
      <Card className="border-slate-800 overflow-hidden flex flex-col p-0">
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
              <Input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="搜索多频主题/主体/地点..."
                className="pl-8 text-xs h-8"
              />
            </div>

            <Button
              variant="emerald"
              size="sm"
              onClick={handleExportAll}
              className="text-xs h-8"
            >
              <Download className="w-3.5 h-3.5" />
              导出全量核查报表 (CSV)
            </Button>
          </div>
        </div>

        {/* Table Main */}
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow className="bg-slate-900/90 border-slate-800 text-slate-400 font-semibold">
                <TableHead className="w-14 text-center">序号</TableHead>
                <TableHead className="w-24">风险等级</TableHead>
                <TableHead>多频主题名称</TableHead>
                <TableHead className="w-44">规范被诉主体</TableHead>
                <TableHead className="w-40">发生地点</TableHead>
                <TableHead className="w-24 text-center">工单件数</TableHead>
                <TableHead className="w-28 text-center">时间跨度</TableHead>
                <TableHead className="w-28 text-center">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((t, idx) => {
                const isHighRisk = t.riskLevel === "HIGH";
                const isMedRisk = t.riskLevel === "MEDIUM";
                return (
                  <TableRow
                    key={t.id}
                    className="hover:bg-slate-800/40 transition-colors cursor-pointer"
                    onClick={() => onSelectTheme(t)}
                  >
                    <TableCell className="text-center text-slate-500 font-mono">
                      {idx + 1}
                    </TableCell>
                    <TableCell>
                      {isHighRisk && (
                        <Badge variant="destructive">
                          <Flame className="w-3 h-3 text-rose-400" /> 高危
                        </Badge>
                      )}
                      {isMedRisk && (
                        <Badge variant="warning">
                          <AlertTriangle className="w-3 h-3 text-amber-400" /> 中危
                        </Badge>
                      )}
                      {!isHighRisk && !isMedRisk && (
                        <Badge variant="success">
                          关注
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-semibold text-white">
                      <div>{t.title}</div>
                      <div className="text-[11px] text-slate-400 font-normal line-clamp-1 mt-0.5">
                        {t.aiSummary}
                      </div>
                    </TableCell>
                    <TableCell className="text-cyan-300 font-medium truncate">
                      {t.canonicalSubject}
                    </TableCell>
                    <TableCell className="text-purple-300 truncate">
                      {t.canonicalLocation}
                    </TableCell>
                    <TableCell className="text-center">
                      <span className="px-2 py-0.5 rounded-lg bg-slate-800 text-white font-extrabold text-xs">
                        {t.ticketCount}
                      </span>
                    </TableCell>
                    <TableCell className="text-center text-slate-400 font-mono text-[11px]">
                      {t.timeSpanHours} 小时
                    </TableCell>
                    <TableCell className="text-center">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onSelectTheme(t);
                        }}
                        className="h-7 text-xs text-cyan-400 border-cyan-800/60 hover:bg-cyan-900/40"
                      >
                        下钻核查
                        <ExternalLink className="w-3 h-3 ml-1" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </Card>
    </div>
  );
};
