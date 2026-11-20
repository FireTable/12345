"use client";

import React, { useMemo } from "react";
import { AlertTriangle, Layers, Radio, Store, Warehouse } from "lucide-react";
import type { DomainProfile } from "./region-context";

export interface DomainChannelMatrixProps {
  counts: Record<string, number>;
  clusterCounts?: Record<string, number>;
  regionCategory?: Record<string, Record<string, number>>;
  selected?: string;
  onSelect?: (channel: string) => void;
  domainProfile?: DomainProfile | null;
  variant?: "light" | "dark";
  compact?: boolean;
  loading?: boolean;
}

const HIGH_RISK_CATEGORIES = new Set([
  "食安与合规红线",
  "假冒伪劣与欺诈",
  "食品安全",
  "合规投诉",
]);

function inferNodeType(name: string): { label: string; kind: "store" | "warehouse" | "live" } {
  if (name.includes("仓") || name.includes("分拨") || name.includes("冷链")) {
    return { label: "仓配节点", kind: "warehouse" };
  }
  if (name.includes("直播")) {
    return { label: "直播渠道", kind: "live" };
  }
  return { label: "平台店铺", kind: "store" };
}

function NodeIcon({ kind, className }: { kind: "store" | "warehouse" | "live"; className?: string }) {
  if (kind === "warehouse") return <Warehouse className={className} aria-hidden="true" />;
  if (kind === "live") return <Radio className={className} aria-hidden="true" />;
  return <Store className={className} aria-hidden="true" />;
}

export function DomainChannelMatrix({
  counts,
  clusterCounts = {},
  regionCategory,
  selected = "",
  onSelect,
  domainProfile,
  variant = "light",
  compact = false,
  loading = false,
}: DomainChannelMatrixProps) {
  const isDark = variant === "dark";
  const unitLabel = domainProfile?.terminology?.regionUnit || "渠道/仓网";
  const ticketNoun = domainProfile?.terminology?.ticketNoun || "客诉工单";

  const rows = useMemo(() => {
    const map = new Map<string, number>();
    for (const [k, v] of Object.entries(counts || {})) {
      if (k && typeof v === "number") map.set(k, v);
    }
    if (map.size === 0 && domainProfile?.channels?.length) {
      for (const ch of domainProfile.channels) map.set(ch, 0);
    }

    const total = Array.from(map.values()).reduce((sum, n) => sum + n, 0);
    const list = Array.from(map.entries())
      .sort((a, b) => {
        if (a[0] === "未知" && b[0] !== "未知") return 1;
        if (b[0] === "未知" && a[0] !== "未知") return -1;
        return b[1] - a[1];
      })
      .map(([name, count]) => {
        const sharePct = total > 0 ? (count / total) * 100 : 0;
        const clusters = clusterCounts[name] || 0;

        let topCategory: string | null = null;
        let topCatCount = 0;
        let highRiskCount = 0;
        const catMap = regionCategory?.[name];
        if (catMap) {
          for (const [cat, catCount] of Object.entries(catMap)) {
            if (catCount > topCatCount) {
              topCatCount = catCount;
              topCategory = cat;
            }
            if (HIGH_RISK_CATEGORIES.has(cat)) {
              highRiskCount += catCount;
            }
          }
        }

        const highRiskShare = count > 0 ? highRiskCount / count : 0;
        const isHighRisk =
          name !== "未知" && (sharePct >= 18 || clusters >= 4 || highRiskShare >= 0.25);
        const isWatch =
          !isHighRisk && name !== "未知" && (sharePct >= 11 || clusters >= 2 || highRiskShare >= 0.12);

        return {
          name,
          count,
          sharePct,
          clusters,
          topCategory,
          isHighRisk,
          isWatch,
          nodeMeta: inferNodeType(name),
        };
      });

    const maxCount = Math.max(1, ...list.map((r) => r.count));
    return { list, total, maxCount };
  }, [counts, clusterCounts, regionCategory, domainProfile?.channels]);

  if (rows.list.length === 0) {
    return (
      <div
        className={
          isDark
            ? "h-full flex items-center justify-center text-xs text-slate-400 font-mono"
            : "empty-hint"
        }
      >
        {loading ? `正在读取${unitLabel}分布...` : `暂无${unitLabel}分布数据。`}
      </div>
    );
  }

  const topRow = rows.list[0];
  const highRiskCount = rows.list.filter((r) => r.isHighRisk).length;

  return (
    <div
      className={
        isDark
          ? "cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 overflow-hidden min-h-0"
          : "w-full flex flex-col gap-3 min-w-0"
      }
    >
      {isDark && (
        <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={15} className="text-blue-400 shrink-0" aria-hidden="true" />
            <h3 className="text-xs font-semibold text-slate-100 tracking-wider whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
              {unitLabel}客诉热度与高风险分布矩阵
            </h3>
          </div>
          <span className="text-[10px] font-mono text-slate-400 uppercase tabular-nums whitespace-nowrap shrink-0">
            {rows.list.length} NODES · {rows.total.toLocaleString("zh-CN")} {ticketNoun}
          </span>
        </div>
      )}

      {/* 顶部高密度概览条 */}
      <div
        className={
          isDark
            ? "mt-2 grid grid-cols-2 sm:grid-cols-3 gap-2 shrink-0"
            : "grid grid-cols-2 sm:grid-cols-3 gap-2"
        }
      >
        <div
          className={
            isDark
              ? "rounded-xl bg-white/[0.035] border border-white/[0.08] px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-0"
              : "rounded-xl border border-slate-900/[0.08] bg-slate-50/80 px-3 py-2.5 min-w-0"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400 whitespace-nowrap truncate" : "text-[11px] text-[var(--c-ink-3)] whitespace-nowrap truncate"}>
            覆盖{unitLabel}
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-slate-100 tabular-nums mt-0.5 whitespace-nowrap"
                : "text-sm font-semibold text-[var(--c-ink)] tabular-nums mt-0.5 whitespace-nowrap"
            }
          >
            {rows.list.length} 节点
          </div>
        </div>

        <div
          className={
            isDark
              ? "rounded-xl bg-white/[0.035] border border-white/[0.08] px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-0"
              : "rounded-xl border border-slate-900/[0.08] bg-slate-50/80 px-3 py-2.5 min-w-0"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400 whitespace-nowrap truncate" : "text-[11px] text-[var(--c-ink-3)] whitespace-nowrap truncate"}>
            高热预警节点
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-amber-300 tabular-nums mt-0.5 whitespace-nowrap"
                : "text-sm font-semibold text-amber-700 tabular-nums mt-0.5 whitespace-nowrap"
            }
          >
            {highRiskCount} 个预警
          </div>
        </div>

        <div
          className={
            isDark
              ? "col-span-2 sm:col-span-1 rounded-xl bg-white/[0.035] border border-white/[0.08] px-2.5 py-1.5 sm:px-3 sm:py-2 min-w-0"
              : "col-span-2 sm:col-span-1 rounded-xl border border-slate-900/[0.08] bg-slate-50/80 px-3 py-2.5 min-w-0"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400 whitespace-nowrap truncate" : "text-[11px] text-[var(--c-ink-3)] whitespace-nowrap truncate"}>
            最热风险节点
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-blue-300 tabular-nums whitespace-nowrap overflow-hidden text-ellipsis min-w-0 mt-0.5"
                : "text-sm font-semibold text-[#1565D8] tabular-nums whitespace-nowrap overflow-hidden text-ellipsis min-w-0 mt-0.5"
            }
            title={topRow.name}
          >
            {topRow.name} ({topRow.sharePct.toFixed(1)}%)
          </div>
        </div>
      </div>

      {/* 渠道/仓网矩阵网格（滚动壳与 Grid 分离，避免受限高容器压扁网格行） */}
      <div
        className={
          isDark
            ? "flex-1 min-h-0 overflow-y-auto mt-2.5 pr-1 custom-cockpit-scrollbar"
            : "w-full"
        }
      >
        <div
          className={[
            "grid gap-2.5 auto-rows-max content-start",
            compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
          ].join(" ")}
        >
          {rows.list.map((item, idx) => {
            const isSelected = Boolean(selected) && selected === item.name;
            const barWidth = item.count > 0 ? Math.max(6, Math.round((item.count / rows.maxCount) * 100)) : 0;
            const barColor = item.isHighRisk
              ? "#E11D48"
              : item.isWatch
              ? "#D97706"
              : isDark
              ? "#3B82F6"
              : "#1677FF";

            if (isDark) {
              return (
                <button
                  key={item.name}
                  type="button"
                  onClick={() => onSelect?.(item.name)}
                  className={`block w-full h-auto min-h-[76px] text-left rounded-xl p-3 border transition-all cursor-pointer min-w-0 ${
                    isSelected
                      ? "bg-blue-500/15 border-blue-400/55 ring-1 ring-blue-400/25"
                      : "bg-white/[0.03] border-white/[0.08] hover:bg-white/[0.06] hover:border-white/[0.16]"
                  }`}
                >
                <div className="flex items-start justify-between gap-2 min-w-0">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-white/[0.06] border border-white/[0.08] text-blue-300 shrink-0">
                      <NodeIcon kind={item.nodeMeta.kind} className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="text-xs font-semibold text-slate-100 whitespace-nowrap overflow-hidden text-ellipsis">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400 whitespace-nowrap overflow-hidden text-ellipsis">
                        {item.nodeMeta.label}
                        {item.topCategory ? ` · ${item.topCategory}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.isHighRisk && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-500/15 text-rose-300 border border-rose-400/35 whitespace-nowrap">
                        <AlertTriangle className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                        高风险
                      </span>
                    )}
                    {!item.isHighRisk && item.isWatch && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/15 text-amber-300 border border-amber-400/35 whitespace-nowrap">
                        关注
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 flex items-baseline justify-between gap-2 text-xs tabular-nums">
                  <span className="font-bold text-slate-100 whitespace-nowrap">
                    {item.count.toLocaleString("zh-CN")}{" "}
                    <span className="text-[10px] font-normal text-slate-400">件</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-300 whitespace-nowrap">
                    {item.sharePct.toFixed(1)}%
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 w-full rounded-full bg-white/[0.08] overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                  />
                </div>
              </button>
            );
          }

          return (
            <button
              key={item.name}
              type="button"
              onClick={() => onSelect?.(item.name)}
              className={`block w-full h-auto text-left rounded-xl border p-3 transition-all cursor-pointer min-w-0 ${
                isSelected
                  ? "border-blue-600 bg-blue-50/60 ring-1 ring-blue-600/25 shadow-xs"
                  : "border-slate-900/[0.08] bg-white shadow-[0_1px_2px_rgba(15,23,42,0.03)] hover:border-blue-500/35 hover:bg-slate-50/70 hover:shadow-[0_4px_12px_rgba(15,23,42,0.06)]"
              }`}
            >
              <div className="flex items-center justify-between gap-2 min-w-0">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold tabular-nums shrink-0"
                    style={{
                      backgroundColor: idx < 3 ? barColor : "#F1F5F9",
                      color: idx < 3 ? "#FFFFFF" : "#475569",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <NodeIcon kind={item.nodeMeta.kind} className="w-3.5 h-3.5 text-[var(--c-ink-3)] shrink-0" />
                  <span className="text-[13px] font-semibold text-[var(--c-ink)] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                    {item.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.clusters > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-[#1D4ED8] border border-blue-200 tabular-nums whitespace-nowrap">
                      {item.clusters} 案卷
                    </span>
                  )}
                  {item.isHighRisk && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-rose-50 text-[#BE123C] border border-rose-200 whitespace-nowrap">
                      <AlertTriangle className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                      高风险
                    </span>
                  )}
                  {!item.isHighRisk && item.isWatch && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-[#B45309] border border-amber-200 whitespace-nowrap">
                      关注
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-xs min-w-0">
                <span className="text-[11px] text-[var(--c-ink-3)] whitespace-nowrap overflow-hidden text-ellipsis min-w-0">
                  {item.nodeMeta.label}
                  {item.topCategory ? ` · 主诉：${item.topCategory}` : ""}
                </span>
                <span className="font-semibold text-[var(--c-ink)] tabular-nums whitespace-nowrap shrink-0">
                  {item.count.toLocaleString("zh-CN")}{" "}
                  <span className="font-normal text-[var(--c-ink-3)]">
                    ({item.sharePct.toFixed(1)}%)
                  </span>
                </span>
              </div>

              <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-100 overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-300"
                  style={{ width: `${barWidth}%`, backgroundColor: barColor }}
                />
              </div>
            </button>
          );
        })}
        </div>
      </div>
    </div>
  );
}
