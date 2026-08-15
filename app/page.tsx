"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCivicWorkflow } from "@/app/_components/civic/civic-workflow";
import { CivicEChart, CivicHeatmap, donutOption, trendOption } from "@/app/_components/civic/civic-charts";
import { RANK_COLORS } from "@/lib/civic-cluster";
import { FileText, Activity, Sparkles, FolderKanban } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

type Overview = {
  totalWorkorders: number;
  dateRange: string;
  totalDays: number;
  avgDaily: number;
  topRegion: string;
  topCategory: string;
  analyzedCount?: number;
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
  const router = useRouter();
  const [daysRange, setDaysRange] = useState(0);
  const [ov, setOv] = useState<Overview | null>(null);
  const [tr, setTr] = useState<Trends | null>(null);

  function load() {
    Promise.all([
      fetch(`/api/overview?days=${daysRange}`).then((r) => r.json()),
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
      list.map((c: { id: string; region: string; type: string; count: number; mode: string; ai_confidence?: number; status?: { label: string } }) =>
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
  const cats = Object.entries(ov?.categoryDistribution || {}).sort((a, b) => b[1] - a[1]);
  const maxR = regions[0]?.[1] || 1;
  const maxDaily = Math.max(0, ...Object.values(tr?.daily || {}));
  const trendOpt = useMemo(
    () => trendOption(tr?.daily || {}, tr?.dailyNewClusters || {}),
    [tr]
  );
  const donutOpt = useMemo(() => donutOption(ov?.categoryDistribution || {}), [ov]);
  const hasTrend = Object.keys(tr?.daily || {}).length > 0;
  const hasDonut = cats.length > 0;

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">工单数据总览</h1>
          <div className="page-hero__sub flex items-center gap-2">
            <span className="status-dot status-dot--finished" style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#52C41A" }} />
            <span>接口运行正常 · {ov?.dateRange || "全部时间"} · 实时研判</span>
          </div>
        </div>
        <div className="page-hero__actions">
          <Select
            value={String(daysRange)}
            onValueChange={(val) => setDaysRange(Number(val))}
          >
            <SelectTrigger className="w-[105px] h-[34px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
              <SelectValue placeholder="统计区间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">全部</SelectItem>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="90">近90天</SelectItem>
            </SelectContent>
          </Select>
          <button type="button" className="btn btn--default" onClick={() => void exportOverview()}>
            导出
          </button>
          <button type="button" className="btn btn--primary" onClick={openUpload}>
            更新工单数据
          </button>
        </div>
      </section>

      <StatCardGrid columns={4}>
        <StatCard
          icon={FileText}
          tone="blue"
          label="总工单"
          value={ov?.totalWorkorders}
          sub={ov?.totalDays ? `${ov.totalDays} 天` : "--"}
          href="/tickets"
        />
        <StatCard
          icon={Activity}
          tone="green"
          label="日均"
          value={ov?.avgDaily}
          sub={maxDaily ? `最高 ${maxDaily.toLocaleString("zh-CN")}` : ov?.topRegion ? `最多 ${ov.topRegion}` : ""}
        />
        <StatCard
          icon={Sparkles}
          tone="purple"
          label="AI 多频"
          value={ov?.multiFreqCount}
          sub="多频工单"
          href="/multifreq"
        />
        <StatCard
          icon={FolderKanban}
          tone="orange"
          label="聚类数"
          value={ov?.multiFreqClusters}
          sub="多频聚类"
          href="/themes"
        />
      </StatCardGrid>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__header">
          <div className="card__title" style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ display: "inline-block", width: 4, height: 14, background: "linear-gradient(180deg,#F53F3F 0%,#FF7D00 100%)", borderRadius: 2 }} />
            工单透势
            <span style={{ fontSize: 11, fontWeight: 400, color: "var(--c-ink-3)", marginLeft: 6 }}>由 AI 实时分析生成</span>
          </div>
        </div>
        <div className="card__body" style={{ padding: "14px 16px" }}>
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

      <section className="split-row split-row--main">
        <div className="card">
          <div className="card__header">
            <div className="card__title">{daysRange === 0 ? "全周期" : `${daysRange} 天`}工单量与多频群组新增趋势</div>
            <div className="chart-legend">
              <span>
                <i style={{ background: "#1677FF" }} /> 每日工单量
              </span>
              <span>
                <i style={{ background: "#FF7D00" }} /> 多频群组新增
              </span>
            </div>
          </div>
          <div className="card__body" style={{ padding: "12px 8px 8px" }}>
            {hasTrend ? <CivicEChart option={trendOpt} height={300} /> : <div className="empty-hint">暂无按日工单</div>}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">镇街工单量 TOP 10</div>
            <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>近 {daysRange} 天 · 已研判</div>
          </div>
          <div className="card__body" style={{ padding: "8px 12px 4px" }}>
            {regions.slice(0, 10).map(([name, n], i) => {
              const color = RANK_COLORS[i] || "#86909C";
              const top = i < 3;
              return (
                <div key={name} className="rank-item" onClick={() => router.push(`/multifreq?region=${encodeURIComponent(name)}`)}>
                  <span className="rank-item__no" style={{ background: top ? color : "var(--c-border-soft)", color: top ? "#fff" : "var(--c-ink-3)" }}>
                    {i + 1}
                  </span>
                  <span style={{ color: "var(--c-ink)", fontWeight: 500, minWidth: 42 }}>{name}</span>
                  <div className="rank-item__track">
                    <div className="rank-item__bar" style={{ width: `${(n / maxR) * 100}%`, background: color }} />
                  </div>
                  <span style={{ color: "var(--c-ink)", fontWeight: 600, minWidth: 60, textAlign: "right", fontFeatureSettings: "'tnum'" }}>
                    {n.toLocaleString("zh-CN")}
                  </span>
                </div>
              );
            })}
            {regions.length === 0 && <div className="empty-hint">暂无镇街分布。上传后请启动 Agent 研判，镇街由模型从微观地点切分。</div>}
          </div>
        </div>
      </section>

      <section className="split-row split-row--main" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="card__header">
            <div className="card__title">工单类型分布</div>
            <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
              已研判 <b>{ov?.analyzedCount || 0}</b> / {ov?.totalWorkorders || 0} 件
            </div>
          </div>
          <div className="card__body" style={{ padding: "8px 12px" }}>
            {hasDonut ? <CivicEChart option={donutOpt} height={300} /> : <div className="empty-hint">暂无类型分布。类型由 AI 归入七类民生业务后展示。</div>}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">镇街 × 类型 工单数量</div>
            <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>色深表示工单数量</div>
          </div>
          <div className="card__body heatmap-scroll" style={{ padding: "8px 12px" }}>
            <CivicHeatmap
              regions={regions.slice(0, 10).map((r) => r[0])}
              cats={cats.slice(0, 7).map((c) => c[0])}
              grid={ov?.regionCategory || {}}
            />
          </div>
        </div>
      </section>
    </>
  );
}
