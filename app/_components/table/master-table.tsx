"use client";

import React, { useMemo } from "react";
import { ColumnDef } from "@tanstack/react-table";
import {
  FileSpreadsheet,
  Download,
  ArrowUpDown,
  ExternalLink,
} from "lucide-react";
import type { MultiFrequencyTheme } from "@/backend/state";
import { exportThemesToCSV } from "@/lib/export-csv";
import { Button } from "@/app/_components/ui/button";
import { DataTable } from "./data-table";
import { toast } from "sonner";

interface MasterTableProps {
  themes: MultiFrequencyTheme[];
  onSelectTheme: (theme: MultiFrequencyTheme) => void;
}

export const MasterTable: React.FC<MasterTableProps> = ({
  themes,
  onSelectTheme,
}) => {
  const columns: ColumnDef<MultiFrequencyTheme>[] = useMemo(
    () => [
      {
        id: "index",
        header: "序号",
        cell: ({ row }) => (
          <span className="text-slate-400 font-mono text-xs">{row.index + 1}</span>
        ),
        size: 50,
      },
      {
        accessorKey: "riskLevel",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-bold text-slate-700 hover:text-slate-900"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            风险等级
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => {
          const risk = row.original.riskLevel;
          if (risk === "HIGH") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-rose-50 text-rose-700 border border-rose-200">
                🔴 紧急督办
              </span>
            );
          }
          if (risk === "MEDIUM") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-bold bg-amber-50 text-amber-700 border border-amber-200">
                🟡 重点跟进
              </span>
            );
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-slate-100 text-slate-700 border border-slate-200">
              ⚪ 常规流转
            </span>
          );
        },
      },
      {
        accessorKey: "title",
        header: "多频主题名称",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-bold text-slate-900">{row.original.title}</div>
            <div className="text-[11.5px] text-slate-500 line-clamp-1">
              {row.original.aiSummary}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "canonicalSubject",
        header: "规范被诉主体",
        cell: ({ row }) => (
          <span className="text-slate-800 font-semibold">{row.original.canonicalSubject}</span>
        ),
      },
      {
        accessorKey: "canonicalLocation",
        header: "发生地点",
        cell: ({ row }) => (
          <span className="text-slate-600">{row.original.canonicalLocation}</span>
        ),
      },
      {
        accessorKey: "ticketCount",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-bold text-slate-700 hover:text-slate-900"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            工单件数
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono font-bold text-slate-900 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
            {row.original.ticketCount} 单
          </span>
        ),
      },
      {
        accessorKey: "timeSpanHours",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-bold text-slate-700 hover:text-slate-900"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            时间跨度
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-slate-600 text-xs">
            {row.original.timeSpanHours} 小时
          </span>
        ),
      },
      {
        id: "actions",
        header: "操作",
        cell: ({ row }) => (
          <Button
            variant="outline"
            size="sm"
            onClick={(e) => {
              e.stopPropagation();
              onSelectTheme(row.original);
            }}
            className="h-7 text-xs border-slate-200 bg-white text-blue-600 hover:bg-blue-50 font-semibold"
          >
            下钻核查
            <ExternalLink className="w-3 h-3 ml-1" />
          </Button>
        ),
      },
    ],
    [onSelectTheme]
  );

  const handleExportAll = () => {
    exportThemesToCSV(themes);
    toast.success("已成功导出多频工单核查总表 CSV！");
  };

  return (
    <div className="max-w-7xl mx-auto px-6 py-4 space-y-4">
      {/* Top Controls */}
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-white p-4 rounded-xl border border-slate-200 shadow-2xs">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-blue-50 border border-blue-200 flex items-center justify-center text-blue-600">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-bold text-slate-900 tracking-tight">
              多频工单核查总表 (Master Data Table)
            </h2>
            <p className="text-xs text-slate-500">
              基于 PostgreSQL 支撑，支持全量字段排序、搜索与批量报表导出
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportAll}
          className="text-xs border-slate-200 bg-white text-slate-700 hover:bg-slate-50 font-medium"
        >
          <Download className="w-3.5 h-3.5 mr-1.5" />
          导出核查报表 (CSV)
        </Button>
      </div>

      {/* TanStack Data Table */}
      <DataTable
        columns={columns}
        data={themes}
        searchKey="title"
        searchPlaceholder="检索多频主题名称或主体..."
        onRowClick={onSelectTheme}
        pageSize={10}
      />
    </div>
  );
};
