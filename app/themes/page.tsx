"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Cluster = {
  id: string;
  type: string;
  region: string;
  count: number;
  mode: "aggregate" | "repeat" | "diverge";
  mode_name: string;
  mode_icon: string;
  ai_confidence: number | null;
  status: { label: string; progress: number; owner: string };
  trend: string;
  first_date: string;
  last_date: string;
  title: string;
};

export default function ThemesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Cluster[]>([]);
  const [tab, setTab] = useState("all");
  const [kw, setKw] = useState("");

  useEffect(() => {
    fetch("/api/clusters")
      .then((r) => r.json())
      .then((j) => setRows(j.topClusters || []))
      .catch(() => setRows([]));
  }, []);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (tab !== "all" && r.mode !== tab) return false;
      if (kw && !`${r.type}${r.region}${r.title}`.includes(kw)) return false;
      return true;
    });
  }, [rows, tab, kw]);

  const counts = {
    all: rows.length,
    aggregate: rows.filter((r) => r.mode === "aggregate").length,
    repeat: rows.filter((r) => r.mode === "repeat").length,
    diverge: rows.filter((r) => r.mode === "diverge").length,
  };

  return (
    <>
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">群组中心</h1>
          <div className="page-hero__sub">多频主题列表 · {rows.length} 个群组</div>
        </div>
      </div>
      <div className="kpi-row">
        <div className="kpi-card">
          <div className="kpi-card__body">
            <div className="kpi-card__label">群组</div>
            <div className="kpi-card__value">{rows.length}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__body">
            <div className="kpi-card__label">覆盖工单</div>
            <div className="kpi-card__value">{rows.reduce((a, r) => a + r.count, 0)}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__body">
            <div className="kpi-card__label">群体聚集</div>
            <div className="kpi-card__value">{counts.aggregate}</div>
          </div>
        </div>
        <div className="kpi-card">
          <div className="kpi-card__body">
            <div className="kpi-card__label">个体重复</div>
            <div className="kpi-card__value">{counts.repeat}</div>
          </div>
        </div>
      </div>
      <div className="filter-tabs">
        {[
          ["all", "全部"],
          ["aggregate", "群体聚集型"],
          ["repeat", "个体重复型"],
          ["diverge", "同主体发散型"],
        ].map(([k, lab]) => (
          <button key={k} className={`filter-tab${tab === k ? " is-active" : ""}`} onClick={() => setTab(k)}>
            {lab}
            <span className="filter-tab__count">{counts[k as keyof typeof counts]}</span>
          </button>
        ))}
      </div>
      <div className="filter-bar">
        <input placeholder="搜索类型 / 镇街 / 标题" value={kw} onChange={(e) => setKw(e.target.value)} />
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>群组</th>
              <th>模式</th>
              <th>镇街</th>
              <th>件数</th>
              <th>置信度</th>
              <th>处置</th>
              <th>趋势</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} onClick={() => router.push(`/themes/${r.id}`)}>
                <td>
                  <div style={{ fontWeight: 600 }}>{r.title || `${r.region} · ${r.type}`}</div>
                  <div style={{ fontSize: 12, color: "var(--c-ink-3)" }}>{r.type}</div>
                </td>
                <td>
                  <span className={`mode-pill mode-pill--${r.mode}`}>
                    {r.mode_icon} {r.mode_name}
                  </span>
                </td>
                <td>{r.region}</td>
                <td>{r.count}</td>
                <td>{r.ai_confidence == null ? "—" : `${r.ai_confidence}%`}</td>
                <td>{r.status.label}</td>
                <td>{r.trend || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 && <div className="empty-hint">暂无群组。请先触发聚类研判。</div>}
      </div>
    </>
  );
}
