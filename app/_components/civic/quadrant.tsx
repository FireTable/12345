"use client";

import React, { useMemo } from "react";
import { useRouter } from "next/navigation";
import type { ClusterUrgency } from "@/lib/civic-cluster";
import { fmtNum } from "@/lib/format-number";

export type QuadCluster = {
  id: string;
  type: string;
  region: string;
  count: number;
  urgency: ClusterUrgency;
  status: { label: string };
};

type Q = "tl" | "tr" | "bl" | "br";

function quadKey(c: QuadCluster): Q {
  const urgent = c.urgency === "urgent" || c.urgency === "medium";
  const important = c.urgency === "urgent" || c.urgency === "high";
  if (urgent && important) return "tr";
  if (!urgent && important) return "tl";
  if (urgent && !important) return "br";
  return "bl";
}

/**
 * Per-quadrant local plot zone inside `.quad__plot` (which sits cleanly BELOW `.quad__head`).
 * Keeping dots within [12%, 88%] horizontally and [18%, 82%] vertically prevents
 * dot centers/edges from colliding with quadrant titles, borders, or crosshairs.
 */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function QuadrantBoard({
  clusters,
  quadrantCounts,
}: {
  clusters: QuadCluster[];
  quadrantCounts?: Record<Q, number>;
}) {
  const router = useRouter();
  const pending = clusters.filter((c) => ((c.status as any)?.code || "PENDING") !== "RESOLVED");

  // 各象限真实总数（宏观角标忠实统计；支持服务端 summary 直接下发精确计数）
  const grouped: Record<Q, number> = quadrantCounts ?? { tl: 0, tr: 0, bl: 0, br: 0 };
  if (!quadrantCounts) {
    pending.forEach((c) => { grouped[quadKey(c)] += 1; });
  }

  // 散点图可视化：保留各象限最具代表性、工单量最高的重点聚类（保证图表优雅高质感，避免数千 DOM 挤压重叠与主线程卡顿）
  const displayPending = useMemo(() => {
    if (pending.length <= 100) return pending;
    const byQ: Record<Q, QuadCluster[]> = { tl: [], tr: [], bl: [], br: [] };
    for (const c of pending) {
      byQ[quadKey(c)].push(c);
    }
    const result: QuadCluster[] = [];
    (Object.keys(byQ) as Q[]).forEach((q) => {
      // 优先按工单量从大到小排序，精选 Top 25
      const sorted = byQ[q].sort((a, b) => (b.count || 0) - (a.count || 0));
      result.push(...sorted.slice(0, 25));
    });
    return result;
  }, [pending]);

  type Dot = { c: QuadCluster; q: Q; left: number; top: number; size: number; cls: string };
  const dotsByQuad: Record<Q, Dot[]> = { tl: [], tr: [], bl: [], br: [] };
  for (const c of displayPending) {
    const q = quadKey(c);
    // Scatter inside each quadrant's dedicated `.quad__plot` box (below `.quad__head`).
    const rx = hash01(c.id, 0xA1);
    const ry = hash01(c.id, 0xB2);
    const left = 12 + rx * 76;
    const top = 18 + ry * 64;
    const size = Math.max(18, Math.min(38, 14 + Math.log10((c.count || 1) + 1) * 9));
    const cls =
      c.urgency === "urgent" ? "quad-dot--urgent"
      : c.urgency === "high" ? "quad-dot--high"
      : c.urgency === "medium" ? "quad-dot--medium"
      : "quad-dot--low";
    dotsByQuad[q].push({ c, q, left, top, size, cls });
  }

  const renderDot = (d: Dot) => (
    <button
      key={d.c.id}
      type="button"
      className={`quad-dot ${d.cls}`}
      aria-label={`${d.c.region} · ${d.c.type}，${fmtNum(d.c.count)} 件工单`}
      title={`${d.c.region}·${d.c.type}`}
      style={{ left: `${d.left}%`, top: `${d.top}%`, width: d.size, height: d.size, fontSize: d.size > 24 ? 10 : 9 }}
      onClick={() => router.push(`/themes/${d.c.id}`)}
    >
      {d.c.count >= 1000 ? `${(d.c.count / 1000).toFixed(1)}k` : d.c.count}
    </button>
  );

  return (
    <div className="quadrant-wrap">
      <div className="quadrant-grid">
        <div className="quad quad--tl">
          <div className="quad__head">
            <div className="quad__head-main">
              <span className="quad__label">🟠 重要不紧急</span>
              <span className="quad__count">{fmtNum(grouped.tl)}</span>
            </div>
            <div className="quad__hint">计划安排处理</div>
          </div>
          <div className="quad__plot">
            {dotsByQuad.tl.map(renderDot)}
          </div>
        </div>
        <div className="quad quad--tr">
          <div className="quad__head quad__head--right">
            <div className="quad__head-main">
              <span className="quad__label">🔴 紧急且重要</span>
              <span className="quad__count">{fmtNum(grouped.tr)}</span>
            </div>
            <div className="quad__hint">立即处置</div>
          </div>
          <div className="quad__plot">
            {dotsByQuad.tr.map(renderDot)}
          </div>
        </div>
        <div className="quad quad--bl">
          <div className="quad__head">
            <div className="quad__head-main">
              <span className="quad__label">🟢 观察等待</span>
              <span className="quad__count">{fmtNum(grouped.bl)}</span>
            </div>
            <div className="quad__hint">暂不紧急</div>
          </div>
          <div className="quad__plot">
            {dotsByQuad.bl.map(renderDot)}
          </div>
        </div>
        <div className="quad quad--br">
          <div className="quad__head quad__head--right">
            <div className="quad__head-main">
              <span className="quad__label">🟡 快速处置</span>
              <span className="quad__count">{fmtNum(grouped.br)}</span>
            </div>
            <div className="quad__hint">快速分流</div>
          </div>
          <div className="quad__plot">
            {dotsByQuad.br.map(renderDot)}
          </div>
        </div>
        <div className="quad-cross-x" />
        <div className="quad-cross-y" />
        <div className="quad-axis-y">紧 急 程 度 ↑</div>
        <div className="quad-axis-x">→ 重 要 程 度</div>
      </div>
      <div className="quadrant-footer">
        <div className="quad-legend-item">
          <span className="quad-legend-dot" style={{ background: "#F53F3F" }} />
          紧急
        </div>
        <div className="quad-legend-item">
          <span className="quad-legend-dot" style={{ background: "#FF7D00" }} />
          高
        </div>
        <div className="quad-legend-item">
          <span className="quad-legend-dot" style={{ background: "#FFB84D" }} />
          中
        </div>
        <div className="quad-legend-item">
          <span className="quad-legend-dot" style={{ background: "#52C41A" }} />
          低
        </div>
        <div className="quad-legend-item" style={{ marginLeft: "auto", color: "#4E5969" }}>
          圆点位置 = 重要 × 紧急 · 大小 = 工单数 · 点击跳群组
        </div>
      </div>
    </div>
  );
}
