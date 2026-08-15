"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { useCivicWorkflow } from "@/app/_components/civic/civic-workflow";

type Overview = {
  totalWorkorders: number;
  dateRange: string;
  totalDays: number;
  avgDaily: number;
  topRegion: string;
  topCategory: string;
  multiFreqCount: number;
  multiFreqClusters: number;
  regionDistribution: Record<string, number>;
  categoryDistribution: Record<string, number>;
  regionCategory?: Record<string, Record<string, number>>;
  insights?: Array<{ tag: string; tone: string; title: string; text: string; href?: string }>;
};

type Trends = { daily: Record<string, number>; dailyNewClusters?: Record<string, number> };

export default function DashboardPage() {
  const { openUpload } = useCivicWorkflow();
  const [daysRange, setDaysRange] = useState(90);
  const [ov, setOv] = useState<Overview | null>(null);
  const [tr, setTr] = useState<Trends | null>(null);

  function load() {
    Promise.all([
      fetch("/api/overview").then((r) => r.json()),
      fetch(`/api/trends?days=${daysRange}`).then((r) => r.json()),
    ])
      .then(([a, b]) => {
        setOv(a);
        setTr(b);
      })
      .catch(() => setOv(null));
  }

  useEffect(() => {
    load();
    const onRefresh = () => load();
    window.addEventListener("civic-data-refresh", onRefresh);
    return () => window.removeEventListener("civic-data-refresh", onRefresh);
  }, [daysRange]);

  async function exportOverview() {
    const res = await fetch("/api/clusters");
    const json = await res.json();
    const list = json.topClusters || [];
    const header = ["id", "region", "type", "count", "mode", "confidence", "status"];
    const lines = [header.join(",")].concat(
      list.map((c: any) =>
        [c.id, c.region, c.type, c.count, c.mode, c.ai_confidence ?? "", c.status?.label ?? ""].join(",")
      )
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ticket_radar_clusters.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${list.length} 个群组`);
  }

  const regions = Object.entries(ov?.regionDistribution || {}).sort((a, b) => b[1] - a[1]);
  const cats = Object.entries(ov?.categoryDistribution || {}).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const maxR = regions[0]?.[1] || 1;
  const days = Object.entries(tr?.daily || {}).sort((a, b) => a[0].localeCompare(b[0]));
  const maxD = Math.max(1, ...days.map(([, n]) => n));

  return (
    <>
      <section className="page-header">
        <div>
          <h1 className="page-header__title">工单数据总览</h1>
          <div className="page-header__status">
            <span className="status-dot" />
            <span>{ov?.dateRange || "等待数据"} · 接口运行正常</span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <select
            className="btn btn--default"
            value={daysRange}
            onChange={(e) => setDaysRange(Number(e.target.value))}
            aria-label="统计区间"
          >
            <option value={7}>近7天</option>
            <option value={30}>近30天</option>
            <option value={90}>近90天</option>
          </select>
          <button type="button" className="btn btn--default" onClick={() => void exportOverview()}>
            导出
          </button>
          <button type="button" className="btn btn--primary" onClick={openUpload}>
            更新工单数据
          </button>
        </div>
      </section>

      <section className="kpi-row">
        <Kpi icon="blue" label="总工单" value={ov?.totalWorkorders} sub={ov?.totalDays ? `${ov.totalDays} 天` : ""} />
        <Kpi icon="green" label="日均" value={ov?.avgDaily} sub={ov?.topRegion ? `最多 ${ov.topRegion}` : ""} />
        <Kpi icon="purple" label="AI 多频" value={ov?.multiFreqCount} sub="多频工单" />
        <Kpi icon="orange" label="聚类数" value={ov?.multiFreqClusters} sub="多频聚类" />
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__header">
          <div className="card__title">关键洞察</div>
        </div>
        <div className="card__body">
          {ov?.insights && ov.insights.length > 0 ? (
            <div className="insight-grid">
              {ov.insights.map((c) => (
                <Link key={c.title} href={c.href || "/themes"} className={`insight-card insight-card--${c.tone}`}>
                  <div className="insight-card__icon">{c.tag === "聚集" ? "🚨" : c.tag === "重复" ? "🔁" : c.tag === "发散" ? "📍" : "📉"}</div>
                  <div>
                    <div className="insight-card__title">{c.title}</div>
                    <div className="insight-card__text">{c.text}</div>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty-hint">暂无聚类洞察。请先上传工单并触发研判。</div>
          )}
        </div>
      </section>

      <section className="split-row">
        <div className="card">
          <div className="card__header">
            <div className="card__title">工单量与多频群组新增趋势</div>
          </div>
          <div className="card__body">
            {days.length === 0 ? (
              <div className="empty-hint">暂无按日工单</div>
            ) : (
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2, height: 220 }}>
                {days.map(([d, n]) => (
                  <div key={d} title={`${d} ${n} 单`} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 2 }}>
                    <div style={{ width: "70%", height: `${(n / maxD) * 180}px`, background: "#1677FF", borderRadius: 2 }} />
                    {tr?.dailyNewClusters?.[d] ? (
                      <div style={{ width: "70%", height: 4, background: "#FF7D00", borderRadius: 2 }} />
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">镇街工单量 TOP 10</div>
          </div>
          <div className="card__body">
            {regions.slice(0, 10).map(([name, n]) => (
              <div key={name} className="rank-row">
                <div className="rank-row__name">{name}</div>
                <div className="rank-row__track">
                  <div className="rank-row__bar" style={{ width: `${(n / maxR) * 100}%` }} />
                </div>
                <div className="rank-row__n">{n.toLocaleString("zh-CN")}</div>
              </div>
            ))}
            {regions.length === 0 && <div className="empty-hint">暂无镇街分布</div>}
          </div>
        </div>
      </section>

      <section className="split-row">
        <div className="card">
          <div className="card__header">
            <div className="card__title">工单类型分布</div>
            <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
              共 <b>{ov?.totalWorkorders || 0}</b> 件
            </div>
          </div>
          <div className="card__body">
            <div className="donut-legend">
              {cats.map(([name, n]) => (
                <span key={name}>
                  {name} {n}
                </span>
              ))}
            </div>
            {cats.map(([name, n]) => (
              <div key={name} className="feat-row">
                <span style={{ width: 88 }}>{name || "未分类"}</span>
                <div className="feat-row__bar">
                  <div className="feat-row__fill" style={{ width: `${(n / (ov?.totalWorkorders || 1)) * 100}%` }} />
                </div>
                <span>{n}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">镇街 × 类型 工单数量</div>
          </div>
          <div className="card__body" style={{ overflowX: "auto" }}>
            <Heatmap
              regions={regions.slice(0, 6).map((r) => r[0])}
              cats={cats.slice(0, 6).map((c) => c[0])}
              grid={ov?.regionCategory || {}}
            />
          </div>
        </div>
      </section>
    </>
  );
}

function Kpi({ icon, label, value, sub }: { icon: string; label: string; value?: number; sub: string }) {
  return (
    <div className="kpi-card">
      <div className={`kpi-card__icon kpi-card__icon--${icon}`} />
      <div className="kpi-card__body">
        <div className="kpi-card__label">{label}</div>
        <div className="kpi-card__value">{(value || 0).toLocaleString("zh-CN")}</div>
        <div className="kpi-card__sub">{sub}</div>
      </div>
    </div>
  );
}

function Heatmap({
  regions,
  cats,
  grid,
}: {
  regions: string[];
  cats: string[];
  grid: Record<string, Record<string, number>>;
}) {
  if (!regions.length || !cats.length) return <div className="empty-hint">数据不足</div>;
  const max = Math.max(1, ...regions.flatMap((r) => cats.map((c) => grid[r]?.[c] || 0)));
  return (
    <table className="heatmap">
      <thead>
        <tr>
          <th />
          {cats.map((c) => (
            <th key={c}>{c}</th>
          ))}
        </tr>
      </thead>
      <tbody>
        {regions.map((r) => (
          <tr key={r}>
            <th>{r}</th>
            {cats.map((c) => {
              const n = grid[r]?.[c] || 0;
              const a = n / max;
              return (
                <td key={c} style={{ background: `rgba(22,119,255,${0.08 + a * 0.55})` }}>
                  {n || ""}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
