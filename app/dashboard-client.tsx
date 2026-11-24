"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CivicHeatmap, donutOption, trendOption } from "@/app/_components/civic/civic-charts";
import { buildSafeCsv } from "@/lib/export-csv";
import { getTownshipColor, isUnknownTownship } from "@/lib/civic-cluster";
import { FileText, Activity, Sparkles, FolderKanban, MonitorPlay, TrendingUp } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";

const CivicEChart = dynamic(
  () => import("@/app/_components/civic/civic-charts").then((m) => m.CivicEChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[320px] rounded-lg bg-slate-50 flex items-center justify-center text-xs text-slate-400">
        正在加载图表…
      </div>
    ),
  }
);

const CockpitView = dynamic(
  () => import("@/app/_components/cockpit/cockpit-view").then((m) => m.CockpitView),
  {
    ssr: false,
    loading: () => (
      <div className="fixed inset-0 z-[9999] bg-[#020612] flex items-center justify-center text-xs text-slate-300">
        正在加载全景指挥大屏…
      </div>
    ),
  }
);
import { SkDashboard } from "@/app/_components/civic/skeletons";
import { useRegion } from "@/app/_components/civic/region-context";
import { DomainChannelMatrix } from "@/app/_components/civic/domain-channel-matrix";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useAuthRole } from "@/lib/auth/use-role";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

type Overview = {
  totalWorkorders: number;
  todayCount?: number;
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
  const { activeRegion, isLoading: regionLoading } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const router = useRouter();
  const [daysRange, setDaysRange] = useState(0);
  const [showCockpit, setShowCockpit] = useState(false);
  const [ov, setOv] = useState<Overview | null>(null);
  const [tr, setTr] = useState<Trends | null>(null);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const loadSeqRef = useRef(0);
  const exportAbortRef = useRef<AbortController | null>(null);

  const regionHeaders = useCallback((): Record<string, string> => {
    return activeRegion?.id ? { "x-region-id": activeRegion.id } : {};
  }, [activeRegion?.id]);

  const load = useCallback(async (bypassCache = false) => {
    if (!isAdmin) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const seq = ++loadSeqRef.current;

    const regParam = activeRegion?.id ? `&region=${encodeURIComponent(activeRegion.id)}` : "";
    const headers = regionHeaders();
    const fetchOpts: RequestInit = {
      headers,
      signal: controller.signal,
      ...(bypassCache ? { cache: "no-cache" as const } : {}),
    };
    try {
      const [ovRes, trRes] = await Promise.all([
        fetch(`/api/overview?days=${daysRange}${regParam}`, fetchOpts),
        fetch(`/api/trends?days=${daysRange}${regParam}`, fetchOpts),
      ]);
      if (!ovRes.ok || !trRes.ok) {
        throw new Error(`总览数据请求失败 (${!ovRes.ok ? ovRes.status : trRes.status})`);
      }
      const [a, b] = await Promise.all([ovRes.json(), trRes.json()]);
      if (controller.signal.aborted || seq !== loadSeqRef.current) return;
      setLoadError(null);
      setOv(a);
      setTr(b);
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || seq !== loadSeqRef.current) return;
      setOv(null);
      setTr(null);
      setLoadError(err instanceof Error ? err.message : "总览数据加载失败，请重试");
    } finally {
      if (!controller.signal.aborted && seq === loadSeqRef.current) {
        setReady(true);
      }
    }
  }, [isAdmin, activeRegion?.id, daysRange, regionHeaders]);

  useEffect(() => {
    return () => {
      loadSeqRef.current += 1;
      loadAbortRef.current?.abort();
      exportAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    setReady(false);
    load();
  }, [daysRange, activeRegion?.id, regionLoading, isRolePending, isAdmin, load]);

  // WS 推送：服务端在 upload / 集群终态等数据变更时推 civic-data-refresh，
  // 取代之前的 window event 跨 tab 同步（跨进程 / 跨 tab 现在都走同一路）。
  useCivicSse(isAdmin ? activeRegion?.id : undefined, (msg) => {
    if (msg.type === "civic-data-refresh" || msg.type === "pipeline-state-refresh") {
      load(true);
    }
  });

  async function exportOverview() {
    if (!isAdmin) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const exportUrl = activeRegion?.id
        ? `/api/clusters?regionId=${encodeURIComponent(activeRegion.id)}`
        : "/api/clusters";
      const res = await fetch(exportUrl, {
        headers: regionHeaders(),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`导出请求失败 (${res.status})`);
      }
      const json = await res.json();
      if (controller.signal.aborted) return;
      const list = json.topClusters || [];
      const header = ["id", "region", "type", "count", "mode", "confidence", "status"];
      const rows = list.map((c: { id: string; region: string; type: string; count: number; mode: string; ai_confidence?: number; status?: { label: string } }) => [
        c.id,
        c.region,
        c.type,
        c.count,
        c.mode,
        c.ai_confidence ?? "",
        c.status?.label ?? "",
      ]);
      const csvContent = buildSafeCsv(header, rows, { includeBom: true });
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "ticket_radar_clusters.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${list.length} 个群组`);
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "导出失败");
    }
  }

  const regions = Object.entries(ov?.regionDistribution || {}).sort((a, b) => {
    const ua = isUnknownTownship(a[0]);
    const ub = isUnknownTownship(b[0]);
    if (ua !== ub) return ua ? 1 : -1;
    return b[1] - a[1];
  });
  const cats = Object.entries(ov?.categoryDistribution || {}).sort((a, b) => b[1] - a[1]);
  const maxR = Math.max(1, ...regions.map(([, n]) => n));
  const maxDaily = Math.max(0, ...Object.values(tr?.daily || {}));
  const trendOpt = useMemo(
    () => trendOption(tr?.daily || {}, tr?.dailyNewClusters || {}),
    [tr]
  );
  const donutOpt = useMemo(() => donutOption(ov?.categoryDistribution || {}), [ov]);
  const hasTrend = Object.keys(tr?.daily || {}).length > 0;
  const hasDonut = cats.length > 0;
  const hasGeoMap = activeRegion?.domainProfile?.hasGeoMap !== false;
  const regionUnit = activeRegion?.domainProfile?.terminology?.regionUnit || "镇街";

  if (isRolePending || !isAdmin) {
    return <SkDashboard />;
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">数据总览</h1>
          <div className="page-hero__sub flex items-start gap-2">
            <span
              aria-hidden="true"
              className="status-dot status-dot--finished shrink-0 mt-[6px]"
              style={{ display: "inline-block", width: 6, height: 6, borderRadius: "50%", background: "#52C41A" }}
            />
            <span className="min-w-0 leading-snug">
              接口正常 · {ov?.dateRange || "全部时间"} · 工单已研判
            </span>
          </div>
        </div>
        <PageHeaderActions
          onRefresh={() => load(true)}
          onExport={exportOverview}
        >
          {/* 政企科技大屏入口按钮 (Primary 实心科技蓝按钮) */}
          <button
            type="button"
            onClick={() => setShowCockpit(true)}
            className="btn btn--primary group inline-flex items-center gap-1.5 min-h-[44px] sm:min-h-0 sm:h-[34px] px-3.5 rounded-lg text-xs font-semibold text-white bg-[#1677FF] hover:bg-[#0958d9] border border-transparent shadow-[0_2px_6px_rgba(22,119,255,0.28)] hover:shadow-[0_4px_12px_rgba(22,119,255,0.38)] transition-all cursor-pointer active:scale-[0.98]"
            title="展开智能研判全景指挥大屏 (全域态势调度驾驶舱)"
          >
            <MonitorPlay
              size={14}
              className="text-white group-hover:scale-110 transition-transform shrink-0"
              aria-hidden="true"
            />
            <span className="text-white tracking-wide">数据大屏</span>
          </button>

          <Select
            value={String(daysRange)}
            onValueChange={(val) => setDaysRange(Number(val))}
          >
            <SelectTrigger
              aria-label="统计时间区间"
              className="w-[105px] min-h-[44px] sm:min-h-0 sm:h-[34px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
            >
              <SelectValue placeholder="统计区间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="0">全部</SelectItem>
              <SelectItem value="7">近7天</SelectItem>
              <SelectItem value="30">近30天</SelectItem>
              <SelectItem value="90">近90天</SelectItem>
            </SelectContent>
          </Select>
        </PageHeaderActions>
      </section>

      {!ready ? (
        <SkDashboard />
      ) : loadError ? (
        <div
          role="alert"
          className="card p-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 border-rose-200 bg-rose-50/70"
        >
          <div className="space-y-1 min-w-0">
            <h2 className="text-sm font-semibold text-rose-900">数据总览加载失败</h2>
            <p className="text-xs text-rose-700 break-words">{loadError}</p>
          </div>
          <button
            type="button"
            onClick={() => {
              setReady(false);
              void load();
            }}
            className="btn btn--primary min-h-[44px] sm:min-h-0 px-4 text-xs shrink-0"
          >
            重试加载
          </button>
        </div>
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard
              icon={FileText}
              tone="blue"
              label="总工单"
              value={ov?.totalWorkorders}
              sub={ov?.totalDays ? `${ov.totalDays} 天累计` : "--"}
              href="/tickets"
            />
            <StatCard
              icon={TrendingUp}
              tone="orange"
              label="今日新增"
              value={ov?.todayCount ?? 0}
              sub="数据最新一日"
              href="/tickets?time=今天"
            />
            <StatCard
              icon={Activity}
              tone="green"
              label="日均受理"
              value={ov?.avgDaily}
              sub={maxDaily ? `单日最高 ${maxDaily.toLocaleString("zh-CN")}` : ov?.topRegion ? `诉求最多 ${ov.topRegion}` : ""}
            />
            <StatCard
              icon={FolderKanban}
              tone="purple"
              label="多频主题"
              value={ov?.multiFreqClusters}
              sub={ov?.multiFreqCount ? `汇聚 ${ov.multiFreqCount.toLocaleString("zh-CN")} 件工单` : "多频聚类"}
              href="/themes"
            />
          </StatCardGrid>

          <section className="card" style={{ marginTop: 16 }}>
            <div className="card__header">
              <h2 className="card__title" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <span>工单透势</span>
                <span style={{ fontSize: 11, fontWeight: 400, color: "var(--c-ink-3)" }}>由 AI 实时分析生成</span>
              </h2>
            </div>
            <div className="card__body" style={{ padding: "14px 16px" }}>
              {ov?.insights && ov.insights.length > 0 ? (
                <div className="insight-grid">
                  {ov.insights.map((c) => (
                    <Link key={c.title} href={c.href || "/themes"} className={`insight-card insight-card--${c.tone}`}>
                      <div className="insight-card__icon">{(c as any).type === "GATHERING" || c.tag === "聚集" ? "🚨" : (c as any).type === "REPEAT" || c.tag === "重复" ? "🔁" : (c as any).type === "DIVERGE" || c.tag === "发散" ? "📍" : "📉"}</div>
                      <div className="insight-card__body">
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
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card__header">
                <h2 className="card__title">{daysRange === 0 ? "全周期" : `${daysRange} 天`}工单量与多频群组新增趋势</h2>
                <div className="chart-legend">
                  <span>
                    <i style={{ background: "#1677FF" }} /> 每日工单量
                  </span>
                  <span>
                    <i style={{ background: "#FF7D00" }} /> 多频群组新增
                  </span>
                </div>
              </div>
              <div
                className="card__body"
                style={{
                  padding: "16px 12px",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: hasTrend ? "flex-start" : "center",
                }}
              >
                {hasTrend ? (
                  <div style={{ width: "100%" }}>
                    <CivicEChart option={trendOpt} height={380} />
                  </div>
                ) : (
                  <div className="empty-hint">暂无按日工单</div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">
                  {hasGeoMap ? "镇街工单量排行" : `${regionUnit}客诉热度分布矩阵`}
                </h2>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                  {hasGeoMap
                    ? daysRange === 0
                      ? "全周期 · 已研判"
                      : `近 ${daysRange} 天 · 已研判`
                    : `点击节点下钻 · ${daysRange === 0 ? "全周期" : `近 ${daysRange} 天`}`}
                </div>
              </div>
              <div
                className="card__body"
                style={
                  hasGeoMap
                    ? {
                        padding: "8px 12px 4px",
                        maxHeight: 416,
                        overflowY: "auto",
                        overscrollBehavior: "contain",
                      }
                    : { padding: "12px" }
                }
              >
                {hasGeoMap ? (
                  <>
                    {regions.map(([name, n], i) => {
                      const isUnknown = name === "未知" || !name;
                      const color = isUnknown ? "#86909C" : getTownshipColor(name);
                      const top = i < 3;
                      return (
                        <button
                          key={name}
                          type="button"
                          className="rank-item w-full text-left bg-transparent border-0"
                          onClick={() => router.push(`/multifreq?region=${encodeURIComponent(name)}`)}
                        >
                          <span
                            className="rank-item__no"
                            style={{
                              background: top ? color : "var(--c-border-soft)",
                              color: top ? "#fff" : "var(--c-ink-3)",
                            }}
                          >
                            {i + 1}
                          </span>
                          <span style={{ color: "var(--c-ink)", fontWeight: 500, minWidth: 42 }}>{name}</span>
                          <div className="rank-item__track">
                            <div className="rank-item__bar" style={{ width: `${(n / maxR) * 100}%`, background: color }} />
                          </div>
                          <span style={{ color: "var(--c-ink)", fontWeight: 600, minWidth: 60, textAlign: "right", fontFeatureSettings: "'tnum'" }}>
                            {n.toLocaleString("zh-CN")}
                          </span>
                        </button>
                      );
                    })}
                    {regions.length === 0 && <div className="empty-hint">暂无镇街分布。上传后请启动 Agent 研判，镇街由模型从微观地点切分。</div>}
                  </>
                ) : (
                  <DomainChannelMatrix
                    counts={ov?.regionDistribution || {}}
                    regionCategory={ov?.regionCategory}
                    domainProfile={activeRegion?.domainProfile}
                    compact
                    onSelect={(name) => router.push(`/multifreq?region=${encodeURIComponent(name)}`)}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="split-row split-row--main" style={{ marginTop: 16 }}>
            <div className="card" style={{ display: "flex", flexDirection: "column" }}>
              <div className="card__header">
                <h2 className="card__title">工单类型分布</h2>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                  已研判 <b>{ov?.analyzedCount || 0}</b> / {ov?.totalWorkorders || 0} 件
                </div>
              </div>
              <div
                className="card__body"
                style={{
                  padding: "16px 12px",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                {hasDonut ? (
                  <div style={{ width: "100%" }}>
                    <CivicEChart option={donutOpt} height={320} />
                  </div>
                ) : (
                  <div className="empty-hint">暂无类型分布。类型由 AI 归入七类民生业务后展示。</div>
                )}
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">
                  {hasGeoMap ? "镇街 × 类型 工单数量" : `${regionUnit} × 类型 工单数量`}
                </h2>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>色深表示工单数量</div>
              </div>
              <div
                className="card__body heatmap-scroll table-wrapper"
                tabIndex={0}
                role="region"
                aria-label={hasGeoMap ? "镇街与诉求类型热力矩阵" : "渠道与诉求类型热力矩阵"}
                style={{ padding: "0 12px 12px 0" }}
              >
                <CivicHeatmap
                  regions={regions.map((r) => r[0])}
                  cats={cats.slice(0, 7).map((c) => c[0])}
                  grid={ov?.regionCategory || {}}
                />
              </div>
            </div>
          </section>
        </>
      )}

      {/* 科技数据大屏全屏沉浸视窗 */}
      {showCockpit && <CockpitView onClose={() => setShowCockpit(false)} />}
    </>
  );
}
