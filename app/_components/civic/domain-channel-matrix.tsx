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
  if (kind === "warehouse") return <Warehouse className={className} />;
  if (kind === "live") return <Radio className={className} />;
  return <Store className={className} />;
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
          ? "cockpit-glass-card w-full h-full flex flex-col rounded-2xl p-4 overflow-hidden"
          : "w-full flex flex-col gap-3"
      }
    >
      {isDark && (
        <div className="cockpit-glass-header flex items-center justify-between pb-2.5 shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <Layers size={15} className="text-[#4096ff] shrink-0" />
            <h3 className="text-xs font-semibold text-slate-100 tracking-wider truncate">
              {unitLabel}客诉热度与高风险分布矩阵
            </h3>
          </div>
          <span className="text-[10px] font-mono text-[#4096ff]/85 uppercase shrink-0">
            {rows.list.length} NODES · {rows.total.toLocaleString("zh-CN")} {ticketNoun}
          </span>
        </div>
      )}

      {/* 顶部高密度概览条 */}
      <div
        className={
          isDark
            ? "mt-2.5 grid grid-cols-3 gap-2 shrink-0"
            : "grid grid-cols-3 gap-2"
        }
      >
        <div
          className={
            isDark
              ? "rounded-xl bg-[#04102b]/80 border border-[#1677FF]/25 px-3 py-2"
              : "rounded-lg border border-[var(--c-border-soft)] bg-[var(--c-surface-subtle,#F8FAFC)] px-3 py-2"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400" : "text-[11px] text-[var(--c-ink-3)]"}>
            覆盖{unitLabel}
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-slate-100 tabular-nums mt-0.5"
                : "text-sm font-semibold text-[var(--c-ink)] tabular-nums mt-0.5"
            }
          >
            {rows.list.length} 节点
          </div>
        </div>

        <div
          className={
            isDark
              ? "rounded-xl bg-[#04102b]/80 border border-[#1677FF]/25 px-3 py-2"
              : "rounded-lg border border-[var(--c-border-soft)] bg-[var(--c-surface-subtle,#F8FAFC)] px-3 py-2"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400" : "text-[11px] text-[var(--c-ink-3)]"}>
            最热风险节点
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-[#69b1ff] truncate mt-0.5"
                : "text-sm font-semibold text-[#1677FF] truncate mt-0.5"
            }
            title={topRow.name}
          >
            {topRow.name} ({topRow.sharePct.toFixed(1)}%)
          </div>
        </div>

        <div
          className={
            isDark
              ? "rounded-xl bg-[#04102b]/80 border border-[#1677FF]/25 px-3 py-2"
              : "rounded-lg border border-[var(--c-border-soft)] bg-[var(--c-surface-subtle,#F8FAFC)] px-3 py-2"
          }
        >
          <div className={isDark ? "text-[10px] text-slate-400" : "text-[11px] text-[var(--c-ink-3)]"}>
            高热预警节点
          </div>
          <div
            className={
              isDark
                ? "text-sm font-bold text-amber-300 tabular-nums mt-0.5"
                : "text-sm font-semibold text-[#D97706] tabular-nums mt-0.5"
            }
          >
            {highRiskCount} 个预警
          </div>
        </div>
      </div>

      {/* 渠道/仓网矩阵网格 */}
      <div
        className={[
          "grid gap-2.5",
          compact ? "grid-cols-1" : "grid-cols-1 sm:grid-cols-2",
          isDark ? "flex-1 min-h-0 overflow-y-auto mt-2.5 pr-1 custom-cockpit-scrollbar content-start" : "",
        ]
          .filter(Boolean)
          .join(" ")}
      >
        {rows.list.map((item, idx) => {
          const isSelected = Boolean(selected) && selected === item.name;
          const barWidth = item.count > 0 ? Math.max(6, Math.round((item.count / rows.maxCount) * 100)) : 0;
          const barColor = item.isHighRisk
            ? "#EF4444"
            : item.isWatch
            ? "#F59E0B"
            : isDark
            ? "#3B82F6"
            : "#1677FF";

          if (isDark) {
            return (
              <button
                key={item.name}
                type="button"
                onClick={() => onSelect?.(item.name)}
                className={`text-left rounded-xl p-3 border transition-all cursor-pointer ${
                  isSelected
                    ? "bg-[#0c285e]/90 border-white shadow-[0_0_16px_rgba(64,150,255,0.45)]"
                    : "cockpit-glass-subcard hover:bg-[#0c285e]/60 hover:border-[#4096ff]/60"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="inline-flex items-center justify-center w-6 h-6 rounded-lg bg-[#1677FF]/20 text-[#69b1ff] shrink-0">
                      <NodeIcon kind={item.nodeMeta.kind} className="w-3.5 h-3.5" />
                    </span>
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-slate-100 truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-slate-400">
                        {item.nodeMeta.label}
                        {item.topCategory ? ` · ${item.topCategory}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    {item.isHighRisk && (
                      <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-500/20 text-red-300 border border-red-400/40">
                        <AlertTriangle className="w-2.5 h-2.5" />
                        高风险
                      </span>
                    )}
                    {!item.isHighRisk && item.isWatch && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-500/20 text-amber-300 border border-amber-400/40">
                        关注
                      </span>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 flex items-baseline justify-between text-xs tabular-nums">
                  <span className="font-bold text-slate-100">
                    {item.count.toLocaleString("zh-CN")}{" "}
                    <span className="text-[10px] font-normal text-slate-400">件</span>
                  </span>
                  <span className="text-[11px] font-mono text-slate-300">
                    {item.sharePct.toFixed(1)}%
                  </span>
                </div>

                <div className="mt-1.5 h-1.5 w-full rounded-full bg-slate-800/90 overflow-hidden">
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
              className={`text-left rounded-lg border p-2.5 transition-colors cursor-pointer ${
                isSelected
                  ? "border-[#1677FF] bg-blue-50/70 ring-1 ring-[#1677FF]"
                  : "border-[var(--c-border-soft)] bg-white hover:border-[#93C5FD] hover:bg-slate-50/80"
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span
                    className="inline-flex items-center justify-center w-5 h-5 rounded text-[11px] font-semibold shrink-0"
                    style={{
                      backgroundColor: idx < 3 ? barColor : "var(--c-border-soft)",
                      color: idx < 3 ? "#FFFFFF" : "var(--c-ink-3)",
                    }}
                  >
                    {idx + 1}
                  </span>
                  <NodeIcon kind={item.nodeMeta.kind} className="w-3.5 h-3.5 text-[var(--c-ink-3)] shrink-0" />
                  <span className="text-[13px] font-semibold text-[var(--c-ink)] truncate">
                    {item.name}
                  </span>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  {item.clusters > 0 && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-[#1D4ED8] border border-blue-200 tabular-nums">
                      {item.clusters} 案卷
                    </span>
                  )}
                  {item.isHighRisk && (
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-red-50 text-[#DC2626] border border-red-200">
                      <AlertTriangle className="w-2.5 h-2.5" />
                      高风险
                    </span>
                  )}
                  {!item.isHighRisk && item.isWatch && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-amber-50 text-[#B45309] border border-amber-200">
                      关注
                    </span>
                  )}
                </div>
              </div>

              <div className="mt-2 flex items-center justify-between gap-2 text-xs">
                <span className="text-[11px] text-[var(--c-ink-3)] truncate">
                  {item.nodeMeta.label}
                  {item.topCategory ? ` · 主诉：${item.topCategory}` : ""}
                </span>
                <span className="font-semibold text-[var(--c-ink)] tabular-nums shrink-0">
                  {item.count.toLocaleString("zh-CN")}{" "}
                  <span className="font-normal text-[var(--c-ink-3)]">
                    ({item.sharePct.toFixed(1)}%)
                  </span>
                </span>
              </div>

              <div className="mt-1.5 h-1.5 w-full rounded-full bg-[var(--c-border-soft)] overflow-hidden">
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
  );
}
