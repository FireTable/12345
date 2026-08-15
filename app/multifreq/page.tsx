"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

type Cluster = {
  id: string;
  type: string;
  region: string;
  count: number;
  mode: "aggregate" | "repeat" | "diverge";
  mode_name: string;
  mode_icon: string;
};

export default function MultifreqPage() {
  const [rows, setRows] = useState<Cluster[]>([]);
  const [ov, setOv] = useState<{ regionDistribution?: Record<string, number> } | null>(null);

  useEffect(() => {
    Promise.all([fetch("/api/clusters").then((r) => r.json()), fetch("/api/overview").then((r) => r.json())])
      .then(([c, o]) => {
        setRows(c.topClusters || []);
        setOv(o);
      })
      .catch(() => setRows([]));
  }, []);

  const byMode = {
    aggregate: rows.filter((r) => r.mode === "aggregate"),
    repeat: rows.filter((r) => r.mode === "repeat"),
    diverge: rows.filter((r) => r.mode === "diverge"),
  };

  return (
    <>
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">多频透视</h1>
          <div className="page-hero__sub">三种多频形态 · 镇街热力</div>
        </div>
      </div>
      <section className="kpi-row">
        <ModeKpi mode="aggregate" label="群体聚集型" rows={byMode.aggregate} />
        <ModeKpi mode="repeat" label="个体重复型" rows={byMode.repeat} />
        <ModeKpi mode="diverge" label="同主体发散型" rows={byMode.diverge} />
      </section>
      <section className="split-row">
        <div className="card">
          <div className="card__header">
            <div className="card__title">顺德镇街热力</div>
          </div>
          <div className="card__body">
            <div className="map-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <object data="/civic/shunde-map.svg" type="image/svg+xml" aria-label="顺德区地图" style={{ width: "100%", height: 360 }} />
            </div>
            <div style={{ marginTop: 12 }}>
              {Object.entries(ov?.regionDistribution || {})
                .sort((a, b) => b[1] - a[1])
                .map(([name, n]) => (
                  <div key={name} className="rank-row">
                    <div className="rank-row__name">{name}</div>
                    <div className="rank-row__track">
                      <div
                        className="rank-row__bar"
                        style={{
                          width: `${(n / Math.max(1, ...Object.values(ov?.regionDistribution || {}))) * 100}%`,
                        }}
                      />
                    </div>
                    <div className="rank-row__n">{n}</div>
                  </div>
                ))}
            </div>
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">TOP 群组</div>
          </div>
          <div className="card__body">
            {rows.slice(0, 8).map((r) => (
              <div key={r.id} style={{ padding: "8px 0", borderBottom: "1px solid var(--c-border-soft)" }}>
                <Link href={`/themes/${r.id}`}>
                  {r.mode_icon} {r.region} · {r.type}
                </Link>
                <div style={{ fontSize: 12, color: "var(--c-ink-3)" }}>
                  {r.mode_name} · {r.count} 件
                </div>
              </div>
            ))}
            {rows.length === 0 && <div className="empty-hint">暂无多频群组</div>}
          </div>
        </div>
      </section>
    </>
  );
}

function ModeKpi({ mode, label, rows }: { mode: string; label: string; rows: Cluster[] }) {
  const n = rows.reduce((a, r) => a + r.count, 0);
  return (
    <div className="kpi-card">
      <div className="kpi-card__body">
        <div className="kpi-card__label">{label}</div>
        <div className="kpi-card__value">{rows.length}</div>
        <div className="kpi-card__sub">{n} 件工单</div>
        <span className={`mode-pill mode-pill--${mode}`} style={{ marginTop: 8 }}>
          {label}
        </span>
      </div>
    </div>
  );
}
