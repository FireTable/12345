"use client";

import { useRouter } from "next/navigation";
import type { ClusterUrgency } from "@/lib/civic-cluster";

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
 * Per-quadrant bounding box in % coords. Each quadrant is 50×50 of the
 * chart, with an inner padding so dots don't sit on the cross / border.
 *   tl: x ∈ [pad, 50-pad]  y ∈ [pad, 50-pad]
 *   tr: x ∈ [50+pad, 100-pad] y ∈ [pad, 50-pad]
 *   bl: x ∈ [pad, 50-pad]  y ∈ [50+pad, 100-pad]
 *   br: x ∈ [50+pad, 100-pad] y ∈ [50+pad, 100-pad]
 */
const QBOX: Record<Q, { xMin: number; xMax: number; yMin: number; yMax: number }> = {
  tl: { xMin: 8,  xMax: 46, yMin: 18, yMax: 44 },
  tr: { xMin: 54, xMax: 92, yMin: 18, yMax: 44 },
  bl: { xMin: 8,  xMax: 46, yMin: 56, yMax: 88 },
  br: { xMin: 54, xMax: 92, yMin: 56, yMax: 88 },
};

/**
 * FNV-1a mix → number in [0, 1). Two different salts give independent
 * x / y streams so neighbours don't fall on the same row or column.
 */
function hash01(id: string, salt: number): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 10000) / 10000;
}

export function QuadrantBoard({ clusters }: { clusters: QuadCluster[] }) {
  const router = useRouter();
  const pending = clusters.filter((c) => (c.status as any)?.code ? (c.status as any).code !== "RESOLVED" : c.status.label !== "已办结");

  // Per-quadrant counts for the corner labels
  const grouped: Record<Q, number> = { tl: 0, tr: 0, bl: 0, br: 0 };
  pending.forEach((c) => { grouped[quadKey(c)] += 1; });

  type Dot = { c: QuadCluster; left: number; top: number; size: number; cls: string };
  const dots: Dot[] = pending.map((c) => {
    const q = quadKey(c);
    const box = QBOX[q];
    // Pseudo-random scatter inside the quadrant's inner box.
    // hash01 returns [0, 1) so we span the full box width/height.
    const rx = hash01(c.id, 0xA1);
    const ry = hash01(c.id, 0xB2);
    const left = box.xMin + rx * (box.xMax - box.xMin);
    const top  = box.yMin + ry * (box.yMax - box.yMin);
    const size = Math.max(14, Math.min(38, 12 + Math.log10((c.count || 1) + 1) * 9));
    const cls =
      c.urgency === "urgent" ? "quad-dot--urgent"
      : c.urgency === "high" ? "quad-dot--high"
      : c.urgency === "medium" ? "quad-dot--medium"
      : "quad-dot--low";
    return { c, left, top, size, cls };
  });

  return (
    <div className="quadrant-wrap">
      <div className="quadrant-grid">
        <div className="quad quad--tl">
          <div className="quad__inner">
            <div className="quad__label">🟠 重要不紧急</div>
            <div className="quad__count">{grouped.tl}</div>
            <div className="quad__hint">计划安排处理</div>
          </div>
        </div>
        <div className="quad quad--tr">
          <div className="quad__inner" style={{ textAlign: "right" }}>
            <div className="quad__label">🔴 紧急且重要</div>
            <div className="quad__count">{grouped.tr}</div>
            <div className="quad__hint">立即处置</div>
          </div>
        </div>
        <div className="quad quad--bl">
          <div className="quad__inner">
            <div className="quad__label">🟢 观察等待</div>
            <div className="quad__count">{grouped.bl}</div>
            <div className="quad__hint">暂不紧急</div>
          </div>
        </div>
        <div className="quad quad--br">
          <div className="quad__inner" style={{ textAlign: "right" }}>
            <div className="quad__label">🟡 快速处置</div>
            <div className="quad__count">{grouped.br}</div>
            <div className="quad__hint">快速分流</div>
          </div>
        </div>
        <div className="quad-cross-x" />
        <div className="quad-cross-y" />
        <div className="quad-axis-y">紧 急 程 度 ↑</div>
        <div className="quad-axis-x">→ 重 要 程 度</div>
        <div className="quad-priority-flag">右上：优先处置</div>
        <div className="quad-dots">
          {dots.map((d) => (
            <button
              key={d.c.id}
              type="button"
              className={`quad-dot ${d.cls}`}
              title={`${d.c.region}·${d.c.type}`}
              style={{ left: `${d.left}%`, top: `${d.top}%`, width: d.size, height: d.size, fontSize: d.size > 24 ? 10 : 8 }}
              onClick={() => router.push(`/themes/${d.c.id}`)}
            >
              {d.c.count >= 1000 ? `${(d.c.count / 1000).toFixed(1)}k` : d.c.count}
            </button>
          ))}
        </div>
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
