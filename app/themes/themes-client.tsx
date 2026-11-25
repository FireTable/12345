"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { buildSafeCsv } from "@/lib/export-csv";
import { fmtNum } from "@/lib/format-number";
import { URGENCY_META, type ClusterUrgency } from "@/lib/civic-cluster";
import { isTownLabel } from "@/lib/admin-area";
import { FolderKanban, Clock, Flame, TrendingUp } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkThemes } from "@/app/_components/civic/skeletons";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";
import { TablePager } from "@/app/_components/civic/table-pager";
import { useRegion } from "@/app/_components/civic/region-context";
import { useCivicSse } from "@/app/_hooks/use-civic-sse";
import { useAuthRole } from "@/lib/auth/use-role";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";

type Cluster = {
  id: string;
  code: string;
  type: string;
  region: string;
  count: number;
  mode: "aggregate" | "repeat" | "diverge";
  mode_name: string;
  mode_icon: string;
  ai_confidence: number | null;
  status: { code?: "PENDING" | "IN_PROGRESS" | "RESOLVED"; label: string; progress: number; owner: string };
  trend: string;
  first_date: string;
  last_date: string;
  title: string;
  unprocessed: number;
  urgency: ClusterUrgency;
  days: number;
};

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待派单" },
  { key: "progress", label: "处理中" },
  { key: "urgent", label: "紧急" },
] as const;

export default function ThemesPage() {
  const router = useRouter();
  const { activeRegion, isLoading: regionLoading } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const rawRegionUnit = activeRegion?.domainProfile?.terminology?.regionUnit || "镇街";
  const regionUnit = isEcommerce
    ? rawRegionUnit
    : rawRegionUnit === "所属镇街"
      ? "镇街"
      : rawRegionUnit;
  const themeNoun =
    activeRegion?.domainProfile?.terminology?.themeNoun ||
    (isEcommerce ? "多频客诉案卷" : "多频工单");
  const [rows, setRows] = useState<Cluster[]>([]);
  const [filteredTotal, setFilteredTotal] = useState(0);
  const [counts, setCounts] = useState({
    all: 0,
    today: 0,
    pending: 0,
    progress: 0,
    urgent: 0,
  });
  const [regions, setRegions] = useState<string[]>([]);
  const [tab, setTab] = useState("all");
  const [todayOnly, setTodayOnly] = useState(false);
  const [kw, setKw] = useState("");
  const [debouncedKw, setDebouncedKw] = useState("");
  const [region, setRegion] = useState("");
  const [mode, setMode] = useState("");
  const [urgency, setUrgency] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const loadAbortRef = useRef<AbortController | null>(null);
  const exportAbortRef = useRef<AbortController | null>(null);
  const loadSeqRef = useRef(0);
  const prevRegionIdRef = useRef<string | undefined>(undefined);
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedKw(kw.trim()), 180);
    return () => window.clearTimeout(timer);
  }, [kw]);

  const buildFilterParams = useCallback(
    (includePaging: boolean) => {
      const params = new URLSearchParams({ sort: "story" });
      if (activeRegion?.id) params.set("regionId", activeRegion.id);
      if (includePaging) {
        params.set("page", String(page));
        params.set("size", String(pageSize));
      }
      if (tab && tab !== "all") params.set("tab", tab);
      if (todayOnly) params.set("todayOnly", "1");
      if (region) params.set("region", region);
      if (mode) params.set("mode", mode);
      if (urgency) params.set("urgency", urgency);
      if (debouncedKw) params.set("keyword", debouncedKw);
      return params;
    },
    [activeRegion?.id, page, pageSize, tab, todayOnly, region, mode, urgency, debouncedKw]
  );

  const load = useCallback(
    (bypassCache = false) => {
      if (!isAdmin) return;
      loadAbortRef.current?.abort();
      const controller = new AbortController();
      loadAbortRef.current = controller;
      const seq = ++loadSeqRef.current;

      const headers: Record<string, string> = {};
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      setLoadError(null);

      // 服务端分页 + 预排序：仅传输当前页（~5KB），避免一次性拉取数千条（数 MB）
      const params = buildFilterParams(true);
      fetch(`/api/clusters?${params.toString()}`, {
        headers,
        signal: controller.signal,
        ...(bypassCache ? { cache: "no-cache" as const } : {}),
      })
        .then(async (r) => {
          const j = await r.json().catch(() => ({}));
          if (!r.ok) {
            throw new Error(j?.error || `加载多频群组失败 (${r.status})`);
          }
          return j;
        })
        .then((j) => {
          if (controller.signal.aborted || seq !== loadSeqRef.current) return;
          const list: Cluster[] = Array.isArray(j.topClusters) ? j.topClusters : [];
          setRows(list);
          setFilteredTotal(typeof j.total === "number" ? j.total : list.length);
          if (j.counts && typeof j.counts === "object") {
            setCounts({
              all: Number(j.counts.all || 0),
              today: Number(j.counts.today || 0),
              pending: Number(j.counts.pending || 0),
              progress: Number(j.counts.progress || 0),
              urgent: Number(j.counts.urgent || 0),
            });
          } else {
            setCounts({
              all: Number(j.totalClusters || list.length),
              today: Number(j.todayNew || 0),
              pending: 0,
              progress: 0,
              urgent: 0,
            });
          }
          if (typeof j.page === "number" && j.page !== page) {
            setPage(j.page);
          }
          setRegions(
            (j.facets?.regions || []).filter((r: string) =>
              isEcommerce ? Boolean(r && r.trim()) : isTownLabel(r) || r === "未知"
            )
          );
        })
        .catch((err) => {
          if (controller.signal.aborted || err?.name === "AbortError" || seq !== loadSeqRef.current) return;
          const msg = err instanceof Error ? err.message : "加载多频群组失败";
          setLoadError(msg);
          setRows([]);
          setFilteredTotal(0);
          toast.error(msg);
        })
        .finally(() => {
          if (controller.signal.aborted || seq !== loadSeqRef.current) return;
          setReady(true);
        });
    },
    [isAdmin, activeRegion?.id, isEcommerce, buildFilterParams, page]
  );

  useEffect(() => {
    return () => {
      loadSeqRef.current += 1;
      loadAbortRef.current?.abort();
      exportAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    if (prevRegionIdRef.current && activeRegion?.id && prevRegionIdRef.current !== activeRegion.id) {
      prevRegionIdRef.current = activeRegion.id;
      if (region !== "" || page !== 1) {
        setRegion("");
        setPage(1);
        return;
      }
    }
    if (activeRegion?.id) {
      prevRegionIdRef.current = activeRegion.id;
    }
    load();
  }, [activeRegion?.id, regionLoading, isRolePending, isAdmin, load, region, page]);

  // WS 推送：簇生成 / 上传完成后立即重拉聚合列表
  useCivicSse(isAdmin ? activeRegion?.id : undefined, (msg) => {
    if (msg.type === "civic-data-refresh" || msg.type === "pipeline-state-refresh") {
      load(true);
    }
  });

  const pages = Math.max(1, Math.ceil(filteredTotal / pageSize));
  const currentPage = Math.min(page, pages);
  const pageData = rows;

  function activateTab(nextKey: string, focusButton = false) {
    setTab(nextKey);
    setPage(1);
    if (focusButton) {
      const btn = tabRefs.current[nextKey];
      if (btn) {
        btn.focus();
        btn.scrollIntoView({ block: "nearest", inline: "nearest" });
      }
    }
  }

  function handleTabKeyDown(e: React.KeyboardEvent<HTMLDivElement>) {
    const idx = TABS.findIndex((t) => t.key === tab);
    if (idx < 0) return;
    if (e.key === "ArrowRight") {
      e.preventDefault();
      activateTab(TABS[(idx + 1) % TABS.length].key, true);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      activateTab(TABS[(idx - 1 + TABS.length) % TABS.length].key, true);
    } else if (e.key === "Home") {
      e.preventDefault();
      activateTab(TABS[0].key, true);
    } else if (e.key === "End") {
      e.preventDefault();
      activateTab(TABS[TABS.length - 1].key, true);
    }
  }

  if (isRolePending || !isAdmin) {
    return <SkThemes />;
  }

  async function exportCsv() {
    if (!isAdmin) return;
    exportAbortRef.current?.abort();
    const controller = new AbortController();
    exportAbortRef.current = controller;
    try {
      const headers: Record<string, string> = {};
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const params = buildFilterParams(false);
      const res = await fetch(`/api/clusters?${params.toString()}`, {
        headers,
        signal: controller.signal,
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error || `导出请求失败 (${res.status})`);
      }
      if (controller.signal.aborted) return;
      const list: Cluster[] = Array.isArray(json.topClusters) ? json.topClusters : [];
      const header = ["编号", "模式", regionUnit, "类型", "代表标题", "工单数", "待派单", "紧急度", "持续天数", "置信度", "状态"];
      const csvRows = list.map((g) => [
        g.code,
        g.mode_name,
        g.region,
        g.type,
        g.title || "",
        g.count,
        g.unprocessed,
        URGENCY_META[g.urgency]?.label || g.urgency,
        g.days,
        g.ai_confidence == null ? "" : `${g.ai_confidence}%`,
        g.status.label,
      ]);
      const csvContent = buildSafeCsv(header, csvRows, { includeBom: true });
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "multi-frequency-themes.csv";
      a.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${fmtNum(list.length)} 个${isEcommerce ? "案卷" : "群组"}`);
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError") return;
      toast.error(err instanceof Error ? err.message : "导出失败");
    }
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">{isEcommerce ? themeNoun : "多频工单"}</h1>
          <div className="page-hero__sub">
            {isEcommerce
              ? `AI 识别的${themeNoun} · 每行为一个案卷，包含多条关联客诉工单`
              : "AI 识别的多频工单群组 · 每行为一个群组，包含多条关联工单"}
          </div>
        </div>
        <PageHeaderActions
          onRefresh={() => load(true)}
          onExport={exportCsv}
        />
      </section>

      {!ready ? (
        <SkThemes />
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard
              icon={FolderKanban}
              tone="blue"
              label={isEcommerce ? "总案卷数" : "总群组数"}
              value={counts.all}
              sub={isEcommerce ? `已识别${themeNoun}` : "已识别多频主题"}
              onClick={() => {
                setTab("all");
                setTodayOnly(false);
                setPage(1);
              }}
              className={tab === "all" && !todayOnly ? "ring-2 ring-blue-500/30" : ""}
            />
            <StatCard
              icon={TrendingUp}
              tone="orange"
              label="今日新增"
              value={counts.today}
              sub={todayOnly ? (isEcommerce ? "正在查看今日案卷" : "正在查看今日群组") : "数据最新一日"}
              onClick={() => {
                setTodayOnly(!todayOnly);
                setTab("all");
                setPage(1);
              }}
              className={todayOnly ? "ring-2 ring-amber-500/30" : ""}
            />
            <StatCard
              icon={Clock}
              tone="blue"
              label="待派单"
              value={counts.pending}
              sub={isEcommerce ? "待处置案卷" : "待处置群组"}
              onClick={() => {
                setTab("pending");
                setTodayOnly(false);
                setPage(1);
              }}
              className={tab === "pending" && !todayOnly ? "ring-2 ring-blue-500/30" : ""}
            />
            <StatCard
              icon={Flame}
              tone="red"
              label={isEcommerce ? "紧急案卷" : "紧急群组"}
              value={counts.urgent}
              sub={isEcommerce ? "高关注度共性客诉" : "高关注度共性诉求"}
              onClick={() => {
                setTab("urgent");
                setTodayOnly(false);
                setPage(1);
              }}
              className={tab === "urgent" && !todayOnly ? "ring-2 ring-rose-500/30" : ""}
            />
          </StatCardGrid>

          <div className="card list-card">
            <div className="list-card__head">
              <div>
                <h2 className="list-card__title m-0">
                  {isEcommerce ? `${themeNoun}列表` : "多频工单群组列表"}
                </h2>
                <div className="list-card__sub">
                  {isEcommerce ? "点击行进入案卷全景研判视图" : "点击行进入群组全景研判视图"}
                </div>
              </div>
            </div>

            <div
              className="filter-tabs"
              role="tablist"
              aria-label={isEcommerce ? `${themeNoun}状态筛选` : "多频工单群组状态筛选"}
              onKeyDown={handleTabKeyDown}
            >
              {TABS.map((t) => (
                <button
                  key={t.key}
                  ref={(el) => {
                    tabRefs.current[t.key] = el;
                  }}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  tabIndex={tab === t.key ? 0 : -1}
                  className={`filter-tab${tab === t.key ? " is-active" : ""}`}
                  onClick={() => activateTab(t.key)}
                >
                  {t.label}
                  <span className="filter-tab__count">{fmtNum(counts[t.key])}</span>
                </button>
              ))}
            </div>

            <div className="filter-bar">
              <div className="search-input">
                <span aria-hidden="true">⌕</span>
                <input
                  aria-label={isEcommerce ? "搜索案卷关键词" : "搜索群组关键词"}
                  placeholder={`搜索${isEcommerce ? "案卷" : "群组"} · ${regionUnit} / 类型 / 标题关键词`}
                  value={kw}
                  onChange={(e) => {
                    setKw(e.target.value);
                    setPage(1);
                  }}
                />
              </div>
              <div className="filter-bar__divider" />
              <Select
                value={region || "all"}
                onValueChange={(val) => {
                  setRegion(val === "all" ? "" : val);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label={`按${regionUnit}筛选`}
                  className={`${isEcommerce ? "w-full sm:min-w-[146px] sm:w-auto" : "w-full sm:w-[130px]"} min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg`}
                >
                  <SelectValue placeholder={`${regionUnit}：全部`} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">{regionUnit}：全部</SelectItem>
                  {regions.map((r) => (
                    <SelectItem key={r} value={r}>
                      {r}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={mode || "all"}
                onValueChange={(val) => {
                  setMode(val === "all" ? "" : val);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="按研判模式筛选"
                  className="w-full sm:w-[135px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                >
                  <SelectValue placeholder="模式：全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">模式：全部</SelectItem>
                  <SelectItem value="aggregate">群体聚集型</SelectItem>
                  <SelectItem value="repeat">个体重复型</SelectItem>
                  <SelectItem value="diverge">同主体发散型</SelectItem>
                </SelectContent>
              </Select>
              <Select
                value={urgency || "all"}
                onValueChange={(val) => {
                  setUrgency(val === "all" ? "" : val);
                  setPage(1);
                }}
              >
                <SelectTrigger
                  aria-label="按紧急度筛选"
                  className="w-full sm:w-[125px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                >
                  <SelectValue placeholder="紧急度：全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">紧急度：全部</SelectItem>
                  <SelectItem value="urgent">紧急</SelectItem>
                  <SelectItem value="high">较急</SelectItem>
                  <SelectItem value="medium">中等</SelectItem>
                  <SelectItem value="low">普通</SelectItem>
                </SelectContent>
              </Select>
              <span className="filter-bar__summary">共 {fmtNum(filteredTotal)} 条结果</span>
            </div>

            {loadError && (
              <div
                role="alert"
                className="mx-3 sm:mx-5 my-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs text-rose-800"
              >
                <span>{loadError}</span>
                <button
                  type="button"
                  onClick={() => load(true)}
                  className="btn btn--default text-xs min-h-[44px] sm:min-h-[30px]"
                >
                  重试加载
                </button>
              </div>
            )}

            <div
              className="table-scroll overflow-x-auto max-w-full"
              tabIndex={0}
              role="region"
              aria-label={isEcommerce ? `${themeNoun}列表` : "多频工单群组列表"}
            >
              <table className="group-table">
                <caption className="sr-only">
                  {isEcommerce ? `${themeNoun}列表` : "多频工单群组列表"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col" style={{ width: 90, minWidth: 80 }}>
                      {isEcommerce ? "案卷编号" : "群组编号"}
                    </th>
                    <th scope="col" style={{ width: 130, minWidth: 120 }}>研判模式</th>
                    <th scope="col" style={{ width: 130, minWidth: 130 }}>
                      {isEcommerce ? `${regionUnit} · 业务` : "辖区 · 业务"}
                    </th>
                    <th scope="col">{isEcommerce ? "代表性客诉标题" : "代表性诉求标题"}</th>
                    <th scope="col" style={{ width: 110, textAlign: "center" }}>待派单 / 总数</th>
                    <th scope="col" style={{ width: 80, textAlign: "center" }}>紧急度</th>
                    <th scope="col" style={{ width: 85, textAlign: "right" }}>持续天数</th>
                    <th scope="col" style={{ width: 85 }}>处置状态</th>
                    <th scope="col" style={{ width: 80, minWidth: 76, textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((g) => {
                    const u = URGENCY_META[g.urgency];
                    const statusCode = g.status.code || normalizeStatusCode(g.status.label);
                    const sCls = statusCode === HANDLING_STATUS.RESOLVED ? "status-tag--done" : statusCode === HANDLING_STATUS.IN_PROGRESS ? "status-tag--progress" : "status-tag--pending";
                    const codeLabel = isEcommerce ? "案卷编号" : "群组编号";
                    const regionColLabel = isEcommerce ? `${regionUnit} · 业务` : "辖区 · 业务";
                    const titleColLabel = isEcommerce ? "代表性客诉标题" : "代表性诉求标题";
                    return (
                      <tr key={g.id} onClick={() => router.push(`/themes/${g.id}`)} className="hover:bg-blue-50/40 transition-colors">
                        <td data-label={codeLabel} className="col-code font-mono" style={{ fontFeatureSettings: "'tnum'", color: "var(--c-ink-3)", fontSize: 12 }}>
                          {g.code || g.id.slice(0, 8)}
                        </td>
                        <td data-label="研判模式" className="col-mode">
                          <span className={`mode-badge mode-badge--${g.mode}`}>
                            {g.mode_icon} {g.mode_name}
                          </span>
                        </td>
                        <td data-label={regionColLabel} className="col-region">
                          <div style={{ fontWeight: 600, color: "var(--c-ink)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {g.region}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2, whiteSpace: "nowrap" }}>
                            {g.type}
                          </div>
                        </td>
                        <td data-label={titleColLabel} className="col-title">
                          <div
                            className="group-table__title-text"
                            title={g.title || `${g.region} · ${g.type}`}
                          >
                            {g.title || `${g.region} · ${g.type}`}
                          </div>
                          <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                            {g.first_date} ~ {g.last_date}
                          </div>
                        </td>
                        <td data-label="待派单 / 总数" className="col-counts" style={{ textAlign: "center", fontFeatureSettings: "'tnum'" }}>
                          <span>
                            <span style={{ fontWeight: 700, color: g.unprocessed > 0 ? "#F53F3F" : "var(--c-ink-3)", fontSize: 13 }}>
                              {fmtNum(g.unprocessed)}
                            </span>
                            <span style={{ color: "#94A3B8", margin: "0 3px", fontSize: 12 }}>/</span>
                            <span style={{ fontWeight: 600, color: "#1E293B", fontSize: 13 }}>
                              {fmtNum(g.count)}
                            </span>
                          </span>
                        </td>
                        <td data-label="紧急度" className="col-urgency" style={{ textAlign: "center" }}>
                          <span className={`urgency-tag ${u.cls}`}>{u.label}</span>
                        </td>
                        <td data-label="持续天数" className="col-days" style={{ textAlign: "right", fontFeatureSettings: "'tnum'", color: "var(--c-ink-2)" }}>
                          {fmtNum(g.days)} 天
                        </td>
                        <td data-label="处置状态" className="col-status">
                          <span className={`status-tag ${sCls}`}>{g.status.label}</span>
                        </td>
                        <td data-label="操作" className="col-actions" style={{ textAlign: "right" }}>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              router.push(`/themes/${g.id}`);
                            }}
                            aria-label={`查看群组 ${g.title || g.code || g.id} 详情`}
                            className="table-card-action-btn relative inline-flex items-center justify-end whitespace-nowrap min-h-[44px] md:min-h-[28px] min-w-0 py-1 px-3 md:px-1 text-[var(--c-brand)] font-medium text-xs bg-transparent border-0 cursor-pointer hover:underline"
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
            {filteredTotal === 0 && (
              <div className="empty-hint">
                {isEcommerce ? "暂无案卷。请先触发聚类研判。" : "暂无群组。请先触发聚类研判。"}
              </div>
            )}
            {filteredTotal > 0 && (
              <TablePager
                page={currentPage}
                pages={pages}
                total={filteredTotal}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 50]}
                itemLabel={isEcommerce ? "个多频案卷" : "个多频群组"}
                onPageChange={setPage}
                onPageSizeChange={(n) => {
                  setPageSize(n);
                  setPage(1);
                }}
              />
            )}
          </div>
        </>
      )}
    </>
  );
}
