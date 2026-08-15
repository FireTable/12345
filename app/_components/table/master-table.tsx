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
import { Badge } from "@/app/_components/ui/badge";
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
          <span className="text-zinc-500 font-mono text-xs">{row.index + 1}</span>
        ),
        size: 50,
      },
      {
        accessorKey: "riskLevel",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-medium text-zinc-400 hover:text-zinc-200"
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
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-red-950/60 text-red-400 border border-red-900/60">
                紧急督办
              </span>
            );
          }
          if (risk === "MEDIUM") {
            return (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-amber-950/60 text-amber-400 border border-amber-900/60">
                重点跟进
              </span>
            );
          }
          return (
            <span className="inline-flex items-center px-2 py-0.5 rounded text-[11px] font-medium bg-zinc-800 text-zinc-300 border border-zinc-700">
              常规流转
            </span>
          );
        },
      },
      {
        accessorKey: "title",
        header: "多频主题名称",
        cell: ({ row }) => (
          <div className="space-y-0.5">
            <div className="font-medium text-zinc-100">{row.original.title}</div>
            <div className="text-[11px] text-zinc-500 line-clamp-1">
              {row.original.aiSummary}
            </div>
          </div>
        ),
      },
      {
        accessorKey: "canonicalSubject",
        header: "规范被诉主体",
        cell: ({ row }) => (
          <span className="text-zinc-300 font-medium">{row.original.canonicalSubject}</span>
        ),
      },
      {
        accessorKey: "canonicalLocation",
        header: "发生地点",
        cell: ({ row }) => (
          <span className="text-zinc-400">{row.original.canonicalLocation}</span>
        ),
      },
      {
        accessorKey: "ticketCount",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-medium text-zinc-400 hover:text-zinc-200"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            工单件数
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono font-semibold text-zinc-200 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
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
            className="p-0 h-auto font-medium text-zinc-400 hover:text-zinc-200"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            时间跨度
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-zinc-400 text-xs">
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
            className="h-7 text-xs border-zinc-800 bg-zinc-900 text-zinc-200 hover:bg-zinc-800"
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
      <div className="flex flex-col md:flex-row items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-xl border border-zinc-800/80">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-200">
            <FileSpreadsheet className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-sm font-semibold text-zinc-100 tracking-tight">
              多频工单核查总表 (Master Data Table)
            </h2>
            <p className="text-xs text-zinc-400">
              采用标准 Shadcn Data Table，支持多列排序、检索与批量核查导出
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={handleExportAll}
          className="text-xs border-zinc-700 bg-zinc-800 text-zinc-100 hover:bg-zinc-700"
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
        pageSize={8}
      />
    </div>
  );
};
