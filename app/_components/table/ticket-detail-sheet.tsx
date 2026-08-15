"use client";

import React, { useState, useMemo, useRef } from "react";
import {
  ColumnDef,
  flexRender,
  getCoreRowModel,
  getSortedRowModel,
  useReactTable,
  SortingState,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import {
  Building2,
  MapPin,
  Clock,
  CheckCircle2,
  FileSpreadsheet,
  Send,
  Sparkles,
  ArrowUpDown,
} from "lucide-react";
import type { MultiFrequencyTheme, EnrichedTicket } from "@/backend/state";
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

  const [tableSearch, setTableSearch] = useState("");
  const [rowSelection, setRowSelection] = useState<Record<string, boolean>>({});
  const [sorting, setSorting] = useState<SortingState>([]);

  const filteredTickets = useMemo(() => {
    return theme.tickets.filter(
      (t) =>
        t.ticketNo.toLowerCase().includes(tableSearch.toLowerCase()) ||
        t.content.toLowerCase().includes(tableSearch.toLowerCase()) ||
        t.citizenName.includes(tableSearch)
    );
  }, [theme.tickets, tableSearch]);

  const columns: ColumnDef<EnrichedTicket>[] = useMemo(
    () => [
      {
        id: "select",
        header: ({ table }) => (
          <input
            type="checkbox"
            checked={table.getIsAllPageRowsSelected()}
            onChange={table.getToggleAllPageRowsSelectedHandler()}
            className="rounded border-zinc-700 bg-zinc-800 text-zinc-200 focus:ring-0 cursor-pointer"
          />
        ),
        cell: ({ row }) => (
          <input
            type="checkbox"
            checked={row.getIsSelected()}
            disabled={!row.getCanSelect()}
            onChange={row.getToggleSelectedHandler()}
            className="rounded border-zinc-700 bg-zinc-800 text-zinc-200 focus:ring-0 cursor-pointer"
          />
        ),
        size: 36,
      },
      {
        accessorKey: "ticketNo",
        header: "工单编号",
        cell: ({ row }) => (
          <span className="font-mono text-zinc-200 font-medium">
            {row.original.ticketNo}
          </span>
        ),
        size: 130,
      },
      {
        accessorKey: "createTime",
        header: ({ column }) => (
          <Button
            variant="ghost"
            size="sm"
            className="p-0 h-auto font-medium text-zinc-400"
            onClick={() => column.toggleSorting(column.getIsSorted() === "asc")}
          >
            登记时间
            <ArrowUpDown className="ml-1 h-3 w-3" />
          </Button>
        ),
        cell: ({ row }) => (
          <span className="font-mono text-zinc-400 text-[11px]">
            {row.original.createTime}
          </span>
        ),
        size: 140,
      },
      {
        accessorKey: "citizenName",
        header: "诉求人",
        cell: ({ row }) => (
          <div>
            <div className="text-zinc-300">{row.original.citizenName}</div>
            <div className="text-[10px] text-zinc-500 font-mono">
              {row.original.citizenPhone}
            </div>
          </div>
        ),
        size: 100,
      },
      {
        accessorKey: "channel",
        header: "渠道",
        cell: ({ row }) => (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700">
            {row.original.channel}
          </span>
        ),
        size: 90,
      },
      {
        accessorKey: "content",
        header: "诉求原文与市民表述",
        cell: ({ row }) => (
          <div className="text-zinc-300 leading-relaxed text-xs">
            {row.original.content}
          </div>
        ),
      },
      {
        id: "canonical",
        header: "识别对齐实体",
        cell: ({ row }) => (
          <div className="space-y-1">
            <div className="text-[10px] text-zinc-300 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 truncate">
              主体: {row.original.canonicalSubject}
            </div>
            <div className="text-[10px] text-zinc-400 bg-zinc-900 px-1.5 py-0.5 rounded border border-zinc-800 truncate">
              地点: {row.original.canonicalLocation}
            </div>
          </div>
        ),
        size: 180,
      },
    ],
    []
  );

  const table = useReactTable({
    data: filteredTickets,
    columns,
    state: {
      rowSelection,
      sorting,
    },
    onSortingChange: setSorting,
    getSortedRowModel: getSortedRowModel(),
    enableRowSelection: true,
    onRowSelectionChange: setRowSelection,
    getCoreRowModel: getCoreRowModel(),
  });

  const { rows } = table.getRowModel();

  // Virtualizer for smooth long-list scrolling
  const tableContainerRef = useRef<HTMLDivElement>(null);
  const rowVirtualizer = useVirtualizer({
    count: rows.length,
    getScrollElement: () => tableContainerRef.current,
    estimateSize: () => 64,
    overscan: 10,
  });

  const selectedCount = Object.keys(rowSelection).filter(
    (k) => rowSelection[k]
  ).length;

  const handleBatchVerify = () => {
    toast.success(`已完成 ${selectedCount || rows.length} 张工单的批量核查！`);
  };

  const handleBatchDispatch = () => {
    toast.success(`已将该多频事件（含 ${rows.length} 单）协同派发至责任部门！`);
  };

  const handleExportCSV = () => {
    exportSingleThemeTicketsToCSV(theme);
    toast.success("多频主题明细表格已成功导出！");
  };

  const isHighRisk = theme.riskLevel === "HIGH";

  return (
    <Sheet open={!!theme} onOpenChange={(open) => !open && onClose()}>
      <SheetContent
        side="right"
        className="flex flex-col w-full sm:max-w-5xl p-0 bg-zinc-950 border-zinc-800 text-zinc-100"
      >
        {/* Header */}
        <div className="p-5 border-b border-zinc-800 bg-zinc-900/50">
          <SheetHeader className="space-y-2">
            <div className="flex items-center gap-2">
              {isHighRisk ? (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-red-950/80 text-red-400 border border-red-900/60">
                  紧急督办
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded text-[11px] font-semibold bg-amber-950/80 text-amber-400 border border-amber-900/60">
                  重点跟进
                </span>
              )}

              <Badge variant="secondary">{theme.category}</Badge>

              <span className="text-xs text-zinc-400">
                工单聚合量：
                <strong className="text-zinc-100 font-semibold">
                  {theme.ticketCount}
                </strong>{" "}
                单
              </span>
            </div>

            <SheetTitle className="text-base font-semibold text-zinc-100 tracking-tight">
              {theme.title}
            </SheetTitle>

            <div className="flex flex-wrap items-center gap-4 text-xs text-zinc-400 pt-1">
              <div className="flex items-center gap-1.5 text-zinc-300">
                <Building2 className="w-3.5 h-3.5 text-zinc-400" />
                <span>规范主体：{theme.canonicalSubject}</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-400">
                <MapPin className="w-3.5 h-3.5" />
                <span>地点：{theme.canonicalLocation}</span>
              </div>
              <div className="flex items-center gap-1.5 text-zinc-500 font-mono">
                <Clock className="w-3.5 h-3.5" />
                <span>跨度 {theme.timeSpanHours} 小时</span>
              </div>
            </div>
          </SheetHeader>
        </div>

        {/* AI Analysis Summary */}
        <div className="px-5 py-3.5 bg-zinc-900/30 border-b border-zinc-800 space-y-2">
          <div className="p-3 rounded-lg bg-zinc-900/80 border border-zinc-800 text-xs text-zinc-300 space-y-1.5">
            <div className="flex items-center gap-1.5 font-medium text-zinc-200">
              <Sparkles className="w-3.5 h-3.5 text-zinc-400" />
              LangGraph 多频研判报告
            </div>
            <p className="leading-relaxed text-zinc-400 text-xs">
              {theme.aiSummary}
            </p>
            <div className="text-zinc-300 font-medium text-xs pt-0.5">
              <span className="text-zinc-500">建议举措：</span>{" "}
              {theme.recommendedAction}
            </div>
          </div>
        </div>

        {/* Filter and Action Bar */}
        <div className="px-5 py-3 border-b border-zinc-800 flex flex-col md:flex-row items-center justify-between gap-3 bg-zinc-950">
          <Input
            type="text"
            value={tableSearch}
            onChange={(e) => setTableSearch(e.target.value)}
            placeholder="筛选单号/诉求内容..."
            className="w-full md:w-60 h-8 text-xs bg-zinc-900 border-zinc-800"
          />

          <div className="flex items-center gap-2 w-full md:w-auto justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCSV}
              className="text-xs h-8 border-zinc-800 bg-zinc-900 text-zinc-300 hover:bg-zinc-800"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 mr-1" />
              导出明细 CSV
            </Button>

            <Button
              variant="default"
              size="sm"
              onClick={handleBatchVerify}
              className="text-xs h-8 bg-zinc-100 text-zinc-900 hover:bg-zinc-200 font-medium"
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-1" />
              批量核查确认 ({selectedCount || rows.length})
            </Button>

            <Button
              variant="secondary"
              size="sm"
              onClick={handleBatchDispatch}
              className="text-xs h-8 border-zinc-800 text-zinc-300"
            >
              <Send className="w-3.5 h-3.5 mr-1" />
              协同派发
            </Button>
          </div>
        </div>

        {/* Virtualized Ticket Table */}
        <div
          ref={tableContainerRef}
          className="flex-1 overflow-auto p-5 relative"
        >
          <div className="rounded-lg border border-zinc-800 bg-zinc-950 overflow-hidden">
            <Table>
              <TableHeader className="sticky top-0 bg-zinc-900 z-10">
                {table.getHeaderGroups().map((headerGroup) => (
                  <TableRow
                    key={headerGroup.id}
                    className="border-zinc-800 hover:bg-transparent"
                  >
                    {headerGroup.headers.map((header) => (
                      <TableHead
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className="text-zinc-400 font-medium text-xs h-9 bg-zinc-900"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(
                              header.column.columnDef.header,
                              header.getContext()
                            )}
                      </TableHead>
                    ))}
                  </TableRow>
                ))}
              </TableHeader>
              <TableBody>
                {rows.length > 0 ? (
                  rows.map((row) => (
                    <TableRow
                      key={row.id}
                      data-state={row.getIsSelected() && "selected"}
                      className="border-zinc-800/60 hover:bg-zinc-900/40"
                    >
                      {row.getVisibleCells().map((cell) => (
                        <TableCell
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="py-2.5 px-3 text-xs align-top"
                        >
                          {flexRender(
                            cell.column.columnDef.cell,
                            cell.getContext()
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell
                      colSpan={columns.length}
                      className="h-24 text-center text-zinc-500 text-xs"
                    >
                      暂无匹配工单
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
};
