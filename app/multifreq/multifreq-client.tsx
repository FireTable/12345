"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { QuadrantBoard } from "@/app/_components/civic/quadrant";
import { fmtNum } from "@/lib/format-number";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";

const CivicMap = dynamic(
  () => import("@/app/_components/civic/civic-map").then((m) => m.CivicMap),
  {
    ssr: false,
    loading: () => (
      <div className="h-[420px] flex items-center justify-center text-xs text-slate-500">
        正在加载地图组件…
      </div>
    ),
  }
);
import { URGENCY_META, type ClusterUrgency } from "@/lib/civic-cluster";
import { isTownLabel } from "@/lib/admin-area";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { Clock, TrendingUp, Flame, Layers, AlertTriangle } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkMultifreq } from "@/app/_components/civic/skeletons";
import { useRegion } from "@/app/_components/civic/region-context";
import { DomainChannelMatrix } from "@/app/_components/civic/domain-channel-matrix";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useAuthRole } from "@/lib/auth/use-role";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";

type Cluster = {
  id: string;
  code?: string;
  type: string;
  region: string;
  count: number;
  mode: "aggregate" | "repeat" | "diverge";
  mode_name: string;
  mode_icon: string;
  ai_confidence: number | null;
  status: { code?: "PENDING" | "IN_PROGRESS" | "RESOLVED"; label: string; progress?: number; owner?: string };
  trend: string;
  title: string;
  urgency: ClusterUrgency;
  unprocessed: number;
  communities: number;
  sample_titles?: string[];
  first_date?: string;
  last_date?: string;
  days?: number;
};

type Overview = { regionDistribution?: Record<string, number> };

type QuadrantCounts = { tl: number; tr: number; bl: number; br: number };

type MultifreqSummary = {
  filteredTotal: number;
  pendingCount: number;
  urgentCount: number;
  todayNew: number;
  clusterByRegion: Record<string, number>;
  quadrantCounts: QuadrantCounts;
  quadrantClusters: Array<{
    id: string;
    type: string;
    region: string;
    count: number;
    urgency: ClusterUrgency;
    status: { code?: string; label: string };
  }>;
  topClusters: Cluster[];
  facetRegions: string[];
};

const EMPTY_SUMMARY: MultifreqSummary = {
  filteredTotal: 0,
  pendingCount: 0,
  urgentCount: 0,
  todayNew: 0,
  clusterByRegion: {},
  quadrantCounts: { tl: 0, tr: 0, bl: 0, br: 0 },
  quadrantClusters: [],
  topClusters: [],
  facetRegions: [],
};

/** 主题镇街可能是「大良 · 容桂」或「大良 · 容桂 等 3 镇街」。筛选项要拆成单个镇街。 */
function townChoices(labels: string[]): string[] {
  const set = new Set<string>();
  for (const label of labels) {
    if (!label) continue;
    if (label === "未知") {
      set.add("未知");
      continue;
    }
    const head = label.split(" 等 ")[0];
    for (const part of head.split(" · ")) {
      const name = part.trim();
      if (isTownLabel(name)) set.add(name);
    }
  }
  const list = [...set].filter((name) => name !== "未知").sort((a, b) => a.localeCompare(b, "zh-CN"));
  if (set.has("未知")) list.push("未知");
  return list;
}

function MultifreqChrome() {
  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">工单透势</h1>
          <div className="page-hero__sub">实时识别 · AI 自动聚类</div>
        </div>
      </section>
      <SkMultifreq />
    </>
  );
}

export default function MultifreqPage() {
  return (
    <Suspense fallback={<MultifreqChrome />}>
      <MultifreqInner />
    </Suspense>
  );
}

function MultifreqInner() {
  const router = useRouter();
  const search = useSearchParams();
  const { activeRegion, isLoading: regionLoading } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const hasGeoMap = activeRegion?.domainProfile?.hasGeoMap !== false;
  const regionUnit = activeRegion?.domainProfile?.terminology?.regionUnit || "镇街";
  const [summary, setSummary] = useState<MultifreqSummary>(EMPTY_SUMMARY);
  const [ov, setOv] = useState<Overview | null>(null);
  const urlTown = search.get("region") || "";
  const [region, setRegion] = useState(isTownLabel(urlTown) || urlTown === "未知" ? urlTown : "");
  const [timeLabel, setTimeLabel] = useState("近 7 天");
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [confMin, setConfMin] = useState(85);
  const [minCount, setMinCount] = useState(2);
  const [debouncedConfMin, setDebouncedConfMin] = useState(85);
  const [debouncedMinCount, setDebouncedMinCount] = useState(2);
  const [windowDays, setWindowDays] = useState(7);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const ovAbortRef = useRef<AbortController | null>(null);
  const ovSeqRef = useRef(0);
  const summaryAbortRef = useRef<AbortController | null>(null);
  const summarySeqRef = useRef(0);
  const prevRegionIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedConfMin(confMin);
      setDebouncedMinCount(minCount);
    }, 150);
    return () => window.clearTimeout(timer);
  }, [confMin, minCount]);

  useEffect(() => {
    if (regionLoading || hasGeoMap || !urlTown) return;
    setRegion((prev) => prev || urlTown);
  }, [regionLoading, hasGeoMap, urlTown]);

  const loadOverview = useCallback(
    async (bypassCache = false) => {
      if (!isAdmin) return;
      ovAbortRef.current?.abort();
      const controller = new AbortController();
      ovAbortRef.current = controller;
      const seq = ++ovSeqRef.current;

      const headers: Record<string, string> = {};
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const regParam = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      try {
        const overviewRes = await fetch(`/api/overview${regParam}`, {
          headers,
          signal: controller.signal,
          ...(bypassCache ? { cache: "no-cache" as const } : {}),
        });
        if (!overviewRes.ok) {
          throw new Error(`总览数据加载失败 (${overviewRes.status})`);
        }
        const o = await overviewRes.json();
        if (controller.signal.aborted || seq !== ovSeqRef.current) return;
        setOv(o);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err as { name?: string })?.name === "AbortError" ||
          seq !== ovSeqRef.current
        ) {
          return;
        }
        setLoadError((prev) => prev || (err instanceof Error ? err.message : "区域分布数据拉取失败"));
      }
    },
    [isAdmin, activeRegion?.id]
  );

  const loadSummary = useCallback(
    async (bypassCache = false) => {
      if (!isAdmin) return;
      summaryAbortRef.current?.abort();
      const controller = new AbortController();
      summaryAbortRef.current = controller;
      const seq = ++summarySeqRef.current;

      const headers: Record<string, string> = {};
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const params = new URLSearchParams({
        view: "summary",
        confMin: String(debouncedConfMin),
        minCount: String(debouncedMinCount),
        timeLabel,
      });
      if (activeRegion?.id) params.set("regionId", activeRegion.id);
      if (region) params.set("region", region);

      try {
        const clustersRes = await fetch(`/api/clusters?${params.toString()}`, {
          headers,
          signal: controller.signal,
          ...(bypassCache ? { cache: "no-cache" as const } : {}),
        });
        if (!clustersRes.ok) {
          throw new Error(`数据加载失败 (${clustersRes.status})`);
        }
        const c = await clustersRes.json();
        if (controller.signal.aborted || seq !== summarySeqRef.current) return;
        setSummary({
          filteredTotal: Number(c?.filteredTotal ?? c?.totalClusters ?? 0),
          pendingCount: Number(c?.pendingCount ?? 0),
          urgentCount: Number(c?.urgentCount ?? 0),
          todayNew: Number(c?.todayNew ?? 0),
          clusterByRegion: c?.clusterByRegion || {},
          quadrantCounts: c?.quadrantCounts || { tl: 0, tr: 0, bl: 0, br: 0 },
          quadrantClusters: Array.isArray(c?.quadrantClusters) ? c.quadrantClusters : [],
          topClusters: Array.isArray(c?.topClusters) ? c.topClusters : [],
          facetRegions: Array.isArray(c?.facets?.regions) ? c.facets.regions : [],
        });
        setLoadError(null);
      } catch (err) {
        if (
          controller.signal.aborted ||
          (err as { name?: string })?.name === "AbortError" ||
          seq !== summarySeqRef.current
        ) {
          return;
        }
        setSummary(EMPTY_SUMMARY);
        setLoadError(err instanceof Error ? err.message : "多频工单数据拉取失败");
      } finally {
        if (!controller.signal.aborted && seq === summarySeqRef.current) {
          setReady(true);
        }
      }
    },
    [isAdmin, activeRegion?.id, debouncedConfMin, debouncedMinCount, timeLabel, region]
  );

  const load = useCallback(
    async (bypassCache = false) => {
      await Promise.all([loadOverview(bypassCache), loadSummary(bypassCache)]);
    },
    [loadOverview, loadSummary]
  );

  useEffect(() => {
    return () => {
      ovSeqRef.current += 1;
      ovAbortRef.current?.abort();
      summarySeqRef.current += 1;
      summaryAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    loadOverview();
  }, [activeRegion?.id, regionLoading, isRolePending, isAdmin, loadOverview]);

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    if (prevRegionIdRef.current && activeRegion?.id && prevRegionIdRef.current !== activeRegion.id) {
      prevRegionIdRef.current = activeRegion.id;
      if (region !== "") {
        setRegion("");
        return;
      }
    }
    if (activeRegion?.id) {
      prevRegionIdRef.current = activeRegion.id;
    }
    loadSummary();
  }, [regionLoading, isRolePending, isAdmin, activeRegion?.id, region, loadSummary]);

  // WS 推送：簇生成 / 上传后服务端推 civic-data-refresh，立即重拉聚合数据
  useCivicSse(isAdmin ? activeRegion?.id : undefined, (msg) => {
    if (msg.type === "civic-data-refresh" || msg.type === "pipeline-state-refresh") {
      load(true);
    }
  });

  const regions = useMemo(() => {
    const fromTickets = Object.keys(ov?.regionDistribution || {});
    if (hasGeoMap) {
      const labels = fromTickets.length > 0 ? fromTickets : townChoices(summary.facetRegions);
      const set = new Set(labels.filter((name) => isTownLabel(name) || name === "未知"));
      const list = [...set].filter((name) => name !== "未知").sort((a, b) => a.localeCompare(b, "zh-CN"));
      if (set.has("未知")) list.push("未知");
      return list;
    }

    const rowLabels = summary.facetRegions.flatMap((r) =>
      (r || "")
        .split(" 等 ")[0]
        .split(" · ")
        .map((s) => s.trim())
        .filter(Boolean)
    );
    const configured = activeRegion?.domainProfile?.channels || [];
    const labels = fromTickets.length > 0 ? fromTickets : rowLabels.length > 0 ? rowLabels : configured;
    const set = new Set(labels.filter(Boolean));
    const list = [...set].filter((name) => name !== "未知").sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (set.has("未知")) list.push("未知");
    return list;
  }, [ov, summary.facetRegions, hasGeoMap, activeRegion?.domainProfile?.channels]);

  const top5 = summary.topClusters;

  if (isRolePending || !isAdmin) {
    return <MultifreqChrome />;
  }

  function cycleTime() {
    const intervals = [
      { days: 7, label: "近 7 天" },
      { days: 30, label: "近 30 天" },
      { days: 90, label: "近 90 天" },
      { days: 0, label: "全部" },
    ];
    const idx = intervals.findIndex((t) => t.label === timeLabel);
    const nextItem = intervals[idx === -1 ? 0 : (idx + 1) % intervals.length];
    setTimeLabel(nextItem.label);
    setWindowDays(nextItem.days);
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">
            工单透势
          </h1>
          <div className="page-hero__sub">
            实时识别 · AI 自动聚类 · 置信度 ≥ {confMin}%
          </div>
        </div>
        <PageHeaderActions onRefresh={() => void load(true)}>
          <button id="cycle-time-btn" type="button" className="btn btn--default min-h-[44px] md:min-h-[34px] md:h-[34px] px-3 text-xs font-medium" onClick={cycleTime}>
            {timeLabel}
          </button>
          <Select
            value={region || "all"}
            onValueChange={(val) => {
              setRegion(val === "all" ? "" : val);
            }}
          >
            <SelectTrigger
              aria-label="筛选镇街或业务区划"
              className={`${hasGeoMap ? "w-full sm:w-[125px]" : "w-full sm:min-w-[138px] sm:w-auto"} min-h-[44px] md:min-h-[34px] md:h-[34px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg`}
            >
              <SelectValue placeholder={hasGeoMap ? "全部镇街" : `全部${regionUnit}`} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{hasGeoMap ? "全部镇街" : `全部${regionUnit}`}</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" className="btn btn--default min-h-[44px] md:min-h-[34px] md:h-[34px] px-3 text-xs font-medium" onClick={() => setThresholdOpen(true)}>
            阈值设置
          </button>
        </PageHeaderActions>
      </section>

      {!ready ? (
        <SkMultifreq />
      ) : (
        <>
          {loadError && (
            <div
              role="alert"
              className="card border-rose-200 bg-rose-50/80 px-4 py-3 mb-4 flex items-center justify-between gap-3 flex-wrap"
            >
              <div className="flex items-center gap-2 text-xs text-rose-800 min-w-0">
                <AlertTriangle className="h-4 w-4 text-rose-600 shrink-0" aria-hidden="true" />
                <span className="break-words">{loadError}</span>
              </div>
              <button
                type="button"
                onClick={() => void load(true)}
                className="btn btn--default min-h-[44px] sm:min-h-0 text-xs text-rose-700 border-rose-300 hover:bg-rose-100 shrink-0"
              >
                重试加载
              </button>
            </div>
          )}
          <StatCardGrid columns={4}>
            <StatCard
              icon={Clock}
              tone="blue"
              label="待派单"
              value={summary.pendingCount}
              sub="待派单协同处置"
            />
            <StatCard
              icon={TrendingUp}
              tone="orange"
              label="今日新增"
              value={summary.todayNew}
              sub="数据最新一日"
            />
            <StatCard
              icon={Flame}
              tone="red"
              label="紧急群组"
              value={summary.urgentCount}
              sub="高风险优先跟进"
            />
            <StatCard
              icon={Layers}
              tone="purple"
              label="多频总量"
              value={summary.filteredTotal}
              sub="当前筛选主题总计"
            />
          </StatCardGrid>

          <section className="split-row split-row--map">
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">
                  {hasGeoMap
                    ? `${activeRegion ? activeRegion.name : "全区"}多频工单地理透势`
                    : `${activeRegion ? activeRegion.name : "当前站点"} · ${regionUnit}客诉热度与高风险分布矩阵`}
                </h2>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                  {hasGeoMap ? "点击镇街筛选 · 悬停查看详情" : `点击${regionUnit}筛选 · 高亮展示高风险客诉节点`}
                </div>
              </div>
              <div className="card__body split-pane" style={hasGeoMap ? undefined : { padding: "12px", display: "block" }}>
                {hasGeoMap ? (
                  <CivicMap
                    counts={ov?.regionDistribution || {}}
                    clusterCounts={summary.clusterByRegion}
                    selected={region}
                    onSelect={(name) => {
                      setRegion(name);
                    }}
                  />
                ) : (
                  <DomainChannelMatrix
                    counts={ov?.regionDistribution || {}}
                    clusterCounts={summary.clusterByRegion}
                    selected={region}
                    domainProfile={activeRegion?.domainProfile}
                    onSelect={(name) => {
                      setRegion(region === name ? "" : name);
                    }}
                  />
                )}
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <h2 className="card__title">待派单群组 · 紧急 × 重要 四象限</h2>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                  共 <b style={{ color: "#1E5AFF" }}>{summary.pendingCount}</b> 个待派单群组
                </div>
              </div>
              <div className="card__body split-pane">
                {summary.pendingCount === 0 ? (
                  <div className="empty-hint">暂无待派单群组。请先启动 Agent 研判。</div>
                ) : (
                  <QuadrantBoard
                    clusters={summary.quadrantClusters}
                    quadrantCounts={summary.quadrantCounts}
                  />
                )}
              </div>
            </div>
          </section>

          <section className="card" style={{ marginTop: 20 }}>
            <div className="top5-header flex-wrap gap-2">
              <h2 className="top5-header__title">
                <span style={{ color: "#F53F3F" }} aria-hidden="true">🔥</span>
                TOP 5 多频聚类
                <span style={{ fontSize: 12, color: "var(--c-ink-3)", fontWeight: 400, marginLeft: 6 }}>点击下钻到详情</span>
              </h2>
              <button
                type="button"
                className="top5-header__more inline-flex items-center min-h-[44px] sm:min-h-[24px] py-0.5"
                onClick={() => router.push("/themes")}
              >
                查看全部 {fmtNum(summary.filteredTotal)} 个聚类
              </button>
            </div>
            <div
              className="table-scroll overflow-x-auto max-w-full"
              tabIndex={0}
              role="region"
              aria-label="TOP 5 多频聚类列表"
            >
              <table className="group-table multifreq-top-table">
                <caption className="sr-only">TOP 5 多频聚类列表</caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 55, minWidth: 45, textAlign: "center" }}>排名</th>
                    <th scope="col" style={{ width: 90, minWidth: 80 }}>群组编号</th>
                    <th scope="col" style={{ width: 130, minWidth: 120 }}>研判模式</th>
                    <th scope="col" style={{ width: 130, minWidth: 130 }}>{hasGeoMap ? "辖区 · 业务" : `${regionUnit} · 业务`}</th>
                    <th scope="col">代表性诉求标题</th>
                    <th scope="col" style={{ width: 110, textAlign: "center" }}>待派单 / 总数</th>
                    <th scope="col" style={{ width: 80, textAlign: "center" }}>紧急度</th>
                    <th scope="col" style={{ width: 85, textAlign: "right" }}>持续天数</th>
                    <th scope="col" style={{ width: 85 }}>处置状态</th>
                    <th scope="col" style={{ width: 75, textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {top5.map((c, i) => {
                    const u = URGENCY_META[c.urgency] || { label: "普通", cls: "urgency-tag--low" };
                    const statusCode = c.status.code || normalizeStatusCode(c.status.label);
                    const sCls = statusCode === HANDLING_STATUS.RESOLVED ? "status-tag--done" : statusCode === HANDLING_STATUS.IN_PROGRESS ? "status-tag--progress" : "status-tag--pending";
                    const regionColLabel = hasGeoMap ? "辖区 · 业务" : `${regionUnit} · 业务`;
                    return (
                      <tr key={c.id} onClick={() => router.push(`/themes/${c.id}`)} className="hover:bg-blue-50/40 transition-colors">
                        <td data-label="排名" className="col-rank" style={{ textAlign: "center" }}>
                          <span className={`rank-badge rank-badge--${i + 1}`}>{i + 1}</span>
                        </td>
                        <td data-label="群组编号" className="col-code font-mono" style={{ fontFeatureSettings: "'tnum'", color: "var(--c-ink-3)", fontSize: 12 }}>
                          {c.code || c.id.slice(0, 8)}
                        </td>
                        <td data-label="研判模式" className="col-mode">
                          <span className={`mode-badge mode-badge--${c.mode}`}>
                            {c.mode_icon} {c.mode_name}
                          </span>
                        </td>
                        <td data-label={regionColLabel} className="col-region">
                          <div style={{ fontWeight: 600, color: "var(--c-ink)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {c.region}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2, whiteSpace: "nowrap" }}>
                            {c.type}
                          </div>
                        </td>
                        <td data-label="代表性诉求标题" className="col-title">
                          <Link
                            href={`/themes/${encodeURIComponent(c.id)}`}
                            onClick={(e) => e.stopPropagation()}
                            className="group-table__title-link inline-flex items-center min-h-[44px] sm:min-h-[24px] py-0.5 max-w-full font-semibold text-[13px] text-[var(--c-ink)] hover:text-[var(--c-brand)] hover:underline"
                            title={c.title || c.sample_titles?.[0] || `${c.region} · ${c.type}`}
                          >
                            <span className="group-table__title-span truncate">
                              {c.title || c.sample_titles?.[0] || `${c.region} · ${c.type}`}
                            </span>
                          </Link>
                          <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                            {c.first_date || "—"} ~ {c.last_date || "—"}
                          </div>
                        </td>
                        <td data-label="待派单 / 总数" className="col-counts" style={{ textAlign: "center", fontFeatureSettings: "'tnum'" }}>
                          <span>
                            <span style={{ fontWeight: 700, color: c.unprocessed > 0 ? "#F53F3F" : "var(--c-ink-3)", fontSize: 13 }}>
                              {fmtNum(c.unprocessed)}
                            </span>
                            <span style={{ color: "#94A3B8", margin: "0 3px", fontSize: 12 }}>/</span>
                            <span style={{ fontWeight: 600, color: "#1E293B", fontSize: 13 }}>
                              {fmtNum(c.count)}
                            </span>
                          </span>
                        </td>
                        <td data-label="紧急度" className="col-urgency" style={{ textAlign: "center" }}>
                          <span className={`urgency-tag ${u.cls}`}>{u.label}</span>
                        </td>
                        <td data-label="持续天数" className="col-days" style={{ textAlign: "right", fontFeatureSettings: "'tnum'", color: "var(--c-ink-2)" }}>
                          {fmtNum(c.days ?? 1)} 天
                        </td>
                        <td data-label="处置状态" className="col-status">
                          <span className={`status-tag ${sCls}`}>{c.status.label}</span>
                        </td>
                        <td data-label="操作" className="col-actions" style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/themes/${c.id}`);
                            }}
                            aria-label={`查看聚类 ${c.title || c.code || c.id} 详情`}
                            className="table-card-action-btn inline-flex items-center justify-end min-h-[44px] min-w-[44px] sm:min-h-[28px] sm:min-w-[28px] px-3 sm:px-1 text-[var(--c-brand)] font-medium text-xs bg-transparent border-0 cursor-pointer hover:underline"
                          >
                            查看
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {top5.length === 0 && <div className="empty-hint">暂无多频群组。请先启动 Agent 研判。</div>}
          </section>
        </>
      )}

      <Dialog open={thresholdOpen} onOpenChange={setThresholdOpen}>
        <DialogContent className="max-w-[420px] gap-4 p-0 overflow-hidden">
          <DialogHeader className="px-5 pt-5 pr-10 text-left space-y-1">
            <DialogTitle>AI 识别阈值</DialogTitle>
            <DialogDescription>
              调整多频聚类识别的最低置信度、最小工单数与时间窗口过滤条件
            </DialogDescription>
          </DialogHeader>
          <div className="px-5 space-y-5 py-1">
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="threshold-conf-min" className="text-[13px] font-medium text-[var(--c-ink-2)]">
                  最低置信度
                </label>
                <span className="text-[13px] font-semibold text-[var(--c-brand)] tabular-nums">{confMin}%</span>
              </div>
              <input
                id="threshold-conf-min"
                type="range"
                min={50}
                max={99}
                value={confMin}
                aria-valuetext={`${confMin}%`}
                onChange={(e) => setConfMin(Number(e.target.value))}
                className="w-full min-h-[44px] sm:min-h-[24px] cursor-pointer"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="threshold-min-count" className="text-[13px] font-medium text-[var(--c-ink-2)]">
                  最小工单数
                </label>
                <span className="text-[13px] font-semibold text-[var(--c-brand)] tabular-nums">{minCount}</span>
              </div>
              <input
                id="threshold-min-count"
                type="range"
                min={2}
                max={20}
                value={minCount}
                aria-valuetext={`${minCount} 件`}
                onChange={(e) => setMinCount(Number(e.target.value))}
                className="w-full min-h-[44px] sm:min-h-[24px] cursor-pointer"
              />
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label htmlFor="threshold-window-days" className="text-[13px] font-medium text-[var(--c-ink-2)]">
                  时间窗口（天）
                </label>
                <span className="text-[13px] font-semibold text-[var(--c-brand)] tabular-nums">{windowDays}</span>
              </div>
              <input
                id="threshold-window-days"
                type="range"
                min={3}
                max={90}
                value={windowDays}
                aria-valuetext={`${windowDays} 天`}
                onChange={(e) => setWindowDays(Number(e.target.value))}
                className="w-full min-h-[44px] sm:min-h-[24px] cursor-pointer"
              />
            </div>
          </div>
          <DialogFooter className="flex-row justify-end gap-2 border-t border-[var(--c-border-soft)] px-5 py-3">
            <button type="button" className="btn btn--default min-h-[44px] md:min-h-[34px]" onClick={() => setThresholdOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary min-h-[44px] md:min-h-[34px]"
              onClick={() => {
                setTimeLabel(`近 ${windowDays} 天`);
                setThresholdOpen(false);
                toast.success("阈值已保存，列表已按新阈值过滤");
              }}
            >
              保存设置
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

