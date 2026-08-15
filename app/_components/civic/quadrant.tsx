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

function quadKey(c: QuadCluster): "tl" | "tr" | "bl" | "br" {
  const urgent = c.urgency === "urgent" || c.urgency === "medium";
  const important = c.urgency === "urgent" || c.urgency === "high";
  if (urgent && important) return "tr";
  if (!urgent && important) return "tl";
  if (urgent && !important) return "br";
  return "bl";
}

const QUAD_RANGE = {
  tl: { x: [0, 50], y: [0, 50] },
  tr: { x: [50, 100], y: [0, 50] },
  bl: { x: [0, 50], y: [50, 100] },
  br: { x: [50, 100], y: [50, 100] },
} as const;

export function QuadrantBoard({ clusters }: { clusters: QuadCluster[] }) {
  const router = useRouter();
  const pending = clusters.filter((c) => c.status.label !== "已办结");
  const grouped: Record<"tl" | "tr" | "bl" | "br", QuadCluster[]> = { tl: [], tr: [], bl: [], br: [] };
  pending.forEach((c) => grouped[quadKey(c)].push(c));

  const dots: Array<{ c: QuadCluster; left: number; top: number; size: number; cls: string }> = [];
  let idx = 0;
  (Object.keys(grouped) as Array<keyof typeof grouped>).forEach((key) => {
    const range = QUAD_RANGE[key];
    grouped[key].forEach((c, i) => {
      const left = range.x[0] + 12 + ((i * 17 + idx * 11) % (range.x[1] - range.x[0] - 14));
      const top = range.y[0] + 18 + ((i * 13 + idx * 7) % (range.y[1] - range.y[0] - 20));
      const size = Math.max(14, Math.min(36, 12 + Math.log10((c.count || 1) + 1) * 8));
      const cls =
        key === "tr" ? "quad-dot--urgent" : key === "tl" ? "quad-dot--high" : key === "br" ? "quad-dot--medium" : "quad-dot--low";
      dots.push({ c, left, top, size, cls });
      idx += 1;
    });
  });

  return (
    <div className="quadrant-wrap">
      <div className="quadrant-grid">
        <div className="quad quad--tl">
          <div className="quad__inner">
            <div className="quad__label">🟠 重要不紧急</div>
            <div className="quad__count">{grouped.tl.length}</div>
            <div className="quad__hint">计划安排处理</div>
          </div>
        </div>
        <div className="quad quad--tr">
          <div className="quad__inner" style={{ textAlign: "right" }}>
            <div className="quad__label">🔴 紧急且重要</div>
            <div className="quad__count">{grouped.tr.length}</div>
            <div className="quad__hint">立即处置</div>
          </div>
        </div>
        <div className="quad quad--bl">
          <div className="quad__inner">
            <div className="quad__label">🟢 观察等待</div>
            <div className="quad__count">{grouped.bl.length}</div>
            <div className="quad__hint">暂不紧急</div>
          </div>
        </div>
        <div className="quad quad--br">
          <div className="quad__inner" style={{ textAlign: "right" }}>
            <div className="quad__label">🟡 快速处置</div>
            <div className="quad__count">{grouped.br.length}</div>
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
          圆点大小 = 工单数 · 点击跳群组
        </div>
      </div>
    </div>
  );
}
