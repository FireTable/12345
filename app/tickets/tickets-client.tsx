"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { buildSafeCsv } from "@/lib/export-csv";
import {
  FileText,
  Clock,
  TrendingUp,
  Flame,
  ExternalLink,
  Layers,
  Sparkles,
  Building2,
  Tag,
  MapPin,
  Hourglass,
  ShieldCheck,
  ShieldAlert,
  Check,
  X,
  Wrench,
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkTickets } from "@/app/_components/civic/skeletons";
import { PageHeaderActions } from "@/app/_components/civic/page-header-actions";
import { isTownLabel } from "@/lib/admin-area";
import {
  normalizeStatusCode,
  getCategoryBadgeClass,
  getUrgencyLabel,
  categoryBadgeStyle,
  regionLabel,
} from "@/lib/civic-dto";
import { AiVerdictCard, CitizenVoiceCard, TicketPropsGrid, TicketGeoMapCard } from "@/app/_components/civic/ticket-verdict-view";
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

type Row = {
  id: string;
  ticketId: string;
  title: string;
  rawTitle?: string;
  summarizeTitle?: string;
  category: string;
  region: string;
  urgency: string;
  status: string;
  createdAt: string;
  content?: string;
  rawContent?: string;
  channel?: string;
  caller_name?: string;
  caller_phone?: string;
  address?: string;
  cluster_id?: string;
  cluster_name?: string;
  multifreq?: boolean;
  confidence?: number;
  slaHours?: number | null;
  stabilityRisk?: boolean;
  canonicalSubject?: string;
  eventType?: string;
  isFakeClosure?: boolean;
  detailLoaded?: boolean;
  detailError?: boolean;
  cluster_info?: { id: string; title: string; mode_name?: string } | null;
};

type Stats = {
  total: number;
  today: number;
  pending: number;
  progress: number;
  finished: number;
  urgent: number;
  multifreq: number;
  single: number;
  fakeClosure?: number;
  pendingReview?: number;
};

type ReviewRow = {
  id: string;
  ticketId: string;
  ticketNo?: string | null;
  title?: string | null;
  summarizeTitle?: string | null;
  confidence?: number | null;
  reason?: string | null;
  status: string;
  district?: string | null;
  subdistrict?: string | null;
  createdAt?: string | null;
};

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "progress", label: "处理中" },
  { key: "urgent", label: "紧急" },
  { key: "multifreq", label: "多频聚类" },
  { key: "single", label: "单发诉求" },
  { key: "fake_closure", label: "疑似假闭环" },
  { key: "review", label: "待人工复核" },
] as const;

export default function TicketsPage() {
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
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [debouncedKeyword, setDebouncedKeyword] = useState("");
  const [tab, setTab] = useState("all");
  const [region, setRegion] = useState("");
  const [category, setCategory] = useState("");
  const [cluster, setCluster] = useState("");
  const [time, setTime] = useState("");
  const [drawer, setDrawer] = useState<Row | null>(null);
  const drawerSeq = useRef(0);
  const drawerAbortRef = useRef<AbortController | null>(null);
  const drawerDialogRef = useRef<HTMLDialogElement>(null);
  const drawerPanelRef = useRef<HTMLDivElement>(null);
  const drawerCloseBtnRef = useRef<HTMLButtonElement>(null);
  const drawerPointerOutsideRef = useRef(false);
  const drawerTitleId = useId();
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const loadSeqRef = useRef(0);
  const loadAbortRef = useRef<AbortController | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [data, setData] = useState<{
    total: number;
    data: Row[];
    stats: Stats;
    facets: { regions: string[]; categories: string[] };
  }>({
    total: 0,
    data: [],
    stats: {
      total: 0,
      today: 0,
      pending: 0,
      progress: 0,
      finished: 0,
      urgent: 0,
      multifreq: 0,
      single: 0,
      fakeClosure: 0,
      pendingReview: 0,
    },
    facets: { regions: [], categories: [] },
  });
  const [ready, setReady] = useState(false);
  const [reviewRows, setReviewRows] = useState<ReviewRow[]>([]);
  const [reviewTotal, setReviewTotal] = useState<number | null>(null);
  const [reviewPage, setReviewPage] = useState(1);
  const [reviewSize, setReviewSize] = useState(20);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [actingReviewId, setActingReviewId] = useState<string | null>(null);
  const reviewSeqRef = useRef(0);
  const reviewAbortRef = useRef<AbortController | null>(null);
  const prevReviewRegionRef = useRef<string | undefined>(activeRegion?.id);

  function regionHeaders(): Record<string, string> {
    return activeRegion?.id ? { "x-region-id": activeRegion.id } : {};
  }

  useEffect(() => {
    const trimmed = keyword;
    if (trimmed === debouncedKeyword) return;
    const timer = window.setTimeout(() => {
      setDebouncedKeyword(trimmed);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [keyword, debouncedKeyword]);

  function load() {
    if (!isAdmin) return;
    loadAbortRef.current?.abort();
    const controller = new AbortController();
    loadAbortRef.current = controller;
    const seq = ++loadSeqRef.current;

    const q = new URLSearchParams({ page: String(page), size: String(size) });
    if (activeRegion?.id) q.set("regionId", activeRegion.id);
    if (debouncedKeyword) q.set("keyword", debouncedKeyword);
    if (tab !== "all" && tab !== "review") q.set("tab", tab);
    if (region) q.set("region", region);
    if (category) q.set("category", category);
    if (cluster) q.set("cluster", cluster);
    if (time) q.set("time", time);
    setLoadError(null);
    fetch(`/api/workorders?${q}`, { headers: regionHeaders(), signal: controller.signal })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) {
          throw new Error(j?.error || `工单列表加载失败 (${r.status})`);
        }
        return j;
      })
      .then((j) => {
        if (controller.signal.aborted || seq !== loadSeqRef.current) return;
        setData((prev) => ({
          total: j.total || 0,
          data: j.data || [],
          stats: j.stats || prev.stats,
          facets: {
            regions: (j.facets?.regions || []).filter((r: string) =>
              isEcommerce ? Boolean(r && r.trim()) : isTownLabel(r) || r === "未知"
            ),
            categories: j.facets?.categories || [],
          },
        }));
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError" || seq !== loadSeqRef.current) return;
        const msg = err instanceof Error ? err.message : "工单列表加载失败";
        setLoadError(msg);
        setData((prev) => ({ ...prev, total: 0, data: [] }));
        toast.error(msg);
      })
      .finally(() => {
        if (controller.signal.aborted || seq !== loadSeqRef.current) return;
        setReady(true);
      });
  }

  function loadReview(targetPage = reviewPage, targetSize = reviewSize) {
    if (regionLoading || !isAdmin) return;
    reviewAbortRef.current?.abort();
    const controller = new AbortController();
    reviewAbortRef.current = controller;
    const seq = ++reviewSeqRef.current;

    const q = new URLSearchParams({
      status: "PENDING",
      page: String(targetPage),
      size: String(targetSize),
    });
    if (activeRegion?.id) q.set("region", activeRegion.id);
    setReviewLoading(true);
    fetch(`/api/review?${q}`, { headers: regionHeaders(), signal: controller.signal })
      .then((r) => r.json())
      .then((j) => {
        if (seq !== reviewSeqRef.current) return;
        if (!j?.success) throw new Error(j?.error || "复核队列加载失败");
        const rows = Array.isArray(j.data) ? (j.data as ReviewRow[]) : [];
        const nextTotal = typeof j.total === "number" ? j.total : rows.length;
        const effectiveSize = typeof j.size === "number" && j.size > 0 ? j.size : targetSize;
        const maxPages = Math.max(1, Math.ceil(nextTotal / effectiveSize));
        if (rows.length === 0 && nextTotal > 0 && targetPage > maxPages) {
          setReviewPage(maxPages);
          return;
        }
        setReviewRows(rows);
        setReviewTotal(nextTotal);
        if (typeof j.page === "number" && j.page >= 1 && j.page !== targetPage) {
          setReviewPage(j.page);
        }
      })
      .catch((err) => {
        if (controller.signal.aborted || seq !== reviewSeqRef.current) return;
        setReviewRows([]);
        toast.error(err instanceof Error ? err.message : "复核队列加载失败");
      })
      .finally(() => {
        if (seq !== reviewSeqRef.current) return;
        setReviewLoading(false);
        setReady(true);
      });
  }

  useEffect(() => {
    return () => {
      reviewSeqRef.current += 1;
      reviewAbortRef.current?.abort();
      loadSeqRef.current += 1;
      loadAbortRef.current?.abort();
      drawerSeq.current += 1;
      drawerAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    reviewSeqRef.current += 1;
    reviewAbortRef.current?.abort();
    setReviewTotal(null);
    setReviewRows([]);
    setReviewPage(1);
  }, [activeRegion?.id]);

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    if (tab !== "review" || !ready) {
      load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, size, debouncedKeyword, tab, region, category, cluster, time, activeRegion?.id, regionLoading, isRolePending, isAdmin]);

  useEffect(() => {
    const regionChanged = prevReviewRegionRef.current !== activeRegion?.id;
    prevReviewRegionRef.current = activeRegion?.id;
    if (regionLoading || isRolePending || !isAdmin) return;
    if (tab === "review") {
      if (regionChanged && reviewPage !== 1) {
        setReviewPage(1);
        return;
      }
      loadReview(reviewPage, reviewSize);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, reviewPage, reviewSize, activeRegion?.id, regionLoading, isRolePending, isAdmin]);

  // WS 推送：upload 完成 / 簇生成后立即重拉工单列表
  useCivicSse(isAdmin ? activeRegion?.id : undefined, (msg) => {
    if (msg.type === "civic-data-refresh" || msg.type === "pipeline-state-refresh") {
      load();
      if (tab === "review") loadReview(reviewPage, reviewSize);
    }
  });

  async function handleReviewAction(item: ReviewRow, action: "REVIEWED" | "DISMISSED") {
    if (!isAdmin || actingReviewId) return;
    setActingReviewId(item.id);
    try {
      const q = activeRegion?.id ? `?region=${encodeURIComponent(activeRegion.id)}` : "";
      const res = await fetch(`/api/review${q}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...regionHeaders(),
        },
        body: JSON.stringify({
          reviewId: item.id,
          action,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `操作失败 (${res.status})`);
      }
      const nextTotal = Math.max(0, (reviewTotal ?? reviewRows.length) - 1);
      const nextMaxPage = Math.max(1, Math.ceil(nextTotal / reviewSize));
      setReviewTotal(nextTotal);
      toast.success(action === "REVIEWED" ? "已确认该工单研判无误" : "已忽略该条复核项");
      if (reviewPage > nextMaxPage) {
        setReviewPage(nextMaxPage);
      } else {
        loadReview(reviewPage, reviewSize);
      }
      load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "复核提交失败");
    } finally {
      setActingReviewId(null);
    }
  }

  useEffect(() => {
    const dialogEl = drawerDialogRef.current;
    if (!dialogEl) return;
    if (drawer) {
      if (!dialogEl.open) {
        dialogEl.showModal();
        drawerCloseBtnRef.current?.focus({ preventScroll: true });
      }
    } else if (dialogEl.open) {
      dialogEl.close();
    }
  }, [drawer]);

  if (isRolePending || !isAdmin) {
    return <SkTickets />;
  }

  const s = data.stats;
  const pages = Math.max(1, Math.ceil(data.total / size));
  const reviewTotalCount = reviewTotal ?? reviewRows.length;
  const reviewPages = Math.max(1, Math.ceil(reviewTotalCount / reviewSize));
  const pendingShare = s.total ? (((s.pending + s.progress) / s.total) * 100).toFixed(1) : "0";
  const finishShare = s.total ? ((s.finished / s.total) * 100).toFixed(0) : "0";

  function closeDrawer() {
    drawerSeq.current += 1;
    drawerAbortRef.current?.abort();
    if (drawerDialogRef.current?.open) {
      drawerDialogRef.current.close();
    }
    setDrawer(null);
  }

  function isOutsideDrawerPanel(clientX: number, clientY: number) {
    const panel = drawerPanelRef.current;
    if (!panel) return false;
    const r = panel.getBoundingClientRect();
    return clientX < r.left || clientX > r.right || clientY < r.top || clientY > r.bottom;
  }

  function activateTab(nextKey: string, focusButton = false) {
    setTab(nextKey);
    setPage(1);
    setReviewPage(1);
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

  function openDrawer(row: Row) {
    drawerAbortRef.current?.abort();
    const controller = new AbortController();
    drawerAbortRef.current = controller;
    const seq = ++drawerSeq.current;
    const key = row.ticketId || row.id;
    setDrawer({
      ...row,
      content: undefined,
      rawContent: undefined,
      caller_name: undefined,
      caller_phone: undefined,
      detailLoaded: false,
      detailError: false,
    });
    fetch(`/api/workorders/${encodeURIComponent(key)}`, {
      headers: regionHeaders(),
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (controller.signal.aborted || drawerSeq.current !== seq) return;
        if (!j?.success) {
          setDrawer((current) =>
            current && (current.ticketId || current.id) === key ? { ...current, detailError: true } : current
          );
          toast.error("工单详情加载失败");
          return;
        }
        setDrawer((current) => {
          if (!current || (current.ticketId || current.id) !== key) return current;
          return {
            ...current,
            title: j.title || current.title,
            rawTitle: j.rawTitle ?? current.rawTitle,
            summarizeTitle: j.summarizeTitle,
            category: j.category || current.category,
            region: j.region || current.region,
            urgency: j.urgency || current.urgency,
            status: j.status || current.status,
            createdAt: j.createdAt || current.createdAt,
            content: j.content || "",
            rawContent: j.rawContent || "",
            channel: j.channel,
            caller_name: j.caller_name || "",
            caller_phone: j.caller_phone || "",
            address: j.address || current.address,
            cluster_id: j.cluster_id || current.cluster_id,
            cluster_info: j.cluster_info ?? null,
            confidence: j.confidence,
            slaHours: j.slaHours,
            stabilityRisk: j.stabilityRisk,
            canonicalSubject: j.canonicalSubject,
            eventType: j.eventType,
            isFakeClosure: j.isFakeClosure,
            detailLoaded: true,
          };
        });
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError" || drawerSeq.current !== seq) return;
        setDrawer((current) =>
          current && (current.ticketId || current.id) === key ? { ...current, detailError: true } : current
        );
        toast.error("工单详情加载失败");
      });
  }

  function exportCsv() {
    const header = ["单号", "标题", "类型", regionUnit, "紧急", "状态", "日期"];
    const csvRows = data.data.map((r) => [
      r.id,
      r.title || "",
      r.category,
      r.region,
      urgencyLabel(r.urgency),
      statusLabel(r.status),
      r.createdAt,
    ]);
    const csvContent = buildSafeCsv(header, csvRows, { includeBom: true });
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "workorders.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出本页 ${data.data.length} 条`);
  }

  return (
    <>
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">
            工单中心
          </h1>
          <div className="page-hero__sub">
            {activeRegion ? `${activeRegion.name} · ` : ""}全部工单 · 实时同步
          </div>
        </div>
        <PageHeaderActions
          onRefresh={() => {
            load();
            if (tab === "review") loadReview();
          }}
          onExport={exportCsv}
        />
      </div>

      {!ready ? (
        <SkTickets />
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard
              icon={FileText}
              tone="blue"
              label="工单总数"
              value={s.total}
              sub="当前库累计"
              onClick={() => {
                setTab("all");
                setTime("");
                setPage(1);
                setReviewPage(1);
              }}
              className={tab === "all" && !time ? "ring-2 ring-blue-500/30" : ""}
            />
            <StatCard
              icon={TrendingUp}
              tone="orange"
              label="今日新增"
              value={s.today}
              sub={time === "今天" ? "正在查看今日工单" : "数据最新一日"}
              onClick={() => {
                if (time === "今天") {
                  setTime("");
                } else {
                  setTime("今天");
                  setTab("all");
                }
                setPage(1);
                setReviewPage(1);
              }}
              className={time === "今天" ? "ring-2 ring-amber-500/30" : ""}
            />
            <StatCard
              icon={Clock}
              tone="blue"
              label="待处理"
              value={s.pending + s.progress}
              sub={`占总数 ${pendingShare}%`}
              onClick={() => {
                setTab("pending");
                setPage(1);
                setReviewPage(1);
              }}
              className={tab === "pending" || tab === "progress" ? "ring-2 ring-blue-500/30" : ""}
            />
            <StatCard
              icon={Flame}
              tone="red"
              label="紧急工单"
              value={s.urgent}
              sub="需优先关注处置"
              onClick={() => {
                setTab("urgent");
                setPage(1);
                setReviewPage(1);
              }}
              className={tab === "urgent" ? "ring-2 ring-rose-500/30" : ""}
            />
          </StatCardGrid>

          <div className="card list-card min-w-0 overflow-hidden">
            <div className="list-card__head">
              <div>
                <h2 className="list-card__title m-0">工单列表</h2>
                <div className="list-card__sub">点击行查看详情</div>
              </div>
            </div>
            <div
              className="filter-tabs flex items-center flex-nowrap overflow-x-auto whitespace-nowrap max-w-full"
              role="tablist"
              aria-label="工单筛选视图"
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
                  className={`filter-tab whitespace-nowrap shrink-0${tab === t.key ? " is-active" : ""}`}
                  onClick={() => activateTab(t.key)}
                >
                  {t.label}
                  <span className="filter-tab__count tabular-nums">
                    {tabCount(t.key, s, reviewTotal)}
                  </span>
                </button>
              ))}
            </div>
            {tab === "review" ? (
              <>
                <div className="filter-bar">
                  <span className="text-xs text-slate-600 font-medium">
                    当前站点待人工复核工单（低置信度 / 异常要素抽检）
                  </span>
                  <span className="filter-bar__summary tabular-nums">
                    共 {reviewTotal ?? reviewRows.length} 条待复核
                  </span>
                </div>
                <div
                  className="table-scroll overflow-x-auto max-w-full"
                  tabIndex={0}
                  role="region"
                  aria-label="待人工复核工单列表"
                >
                  <table className="workorder-table">
                    <caption className="sr-only">待人工复核工单列表</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="min-w-[140px] whitespace-nowrap">工单号</th>
                        <th scope="col" className="min-w-[200px]">诉求标题</th>
                        <th scope="col" className="min-w-[104px] whitespace-nowrap">{regionUnit}</th>
                        <th scope="col" className="min-w-[88px] whitespace-nowrap">置信度</th>
                        <th scope="col" className="min-w-[160px] whitespace-nowrap">复核原因</th>
                        <th scope="col" className="min-w-[240px] whitespace-nowrap text-right">复核操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {reviewRows.map((item) => {
                        const town =
                          regionLabel(item.subdistrict, item.district) ||
                          item.subdistrict ||
                          item.district ||
                          "—";
                        const titleText =
                          item.summarizeTitle || item.title || "市民诉求";
                        const busy = actingReviewId === item.id;
                        return (
                          <tr
                            key={item.id}
                            onClick={() =>
                              openDrawer({
                                id: item.ticketNo || item.ticketId,
                                ticketId: item.ticketId,
                                title: titleText,
                                category: "",
                                region: town,
                                urgency: "NORMAL",
                                status: "PENDING",
                                createdAt: item.createdAt
                                  ? String(item.createdAt).slice(0, 10)
                                  : "",
                                confidence: item.confidence ?? undefined,
                              })
                            }
                          >
                            <td className="col-id min-w-[140px] whitespace-nowrap tabular-nums">
                              {item.ticketNo || item.ticketId}
                            </td>
                            <td className="col-title min-w-[200px]">
                              <div className="col-title__text" title={titleText}>
                                {titleText}
                              </div>
                            </td>
                            <td className="min-w-[104px] whitespace-nowrap">{town}</td>
                            <td className="min-w-[88px] whitespace-nowrap tabular-nums">
                              <span className="badge-pill badge-pill--warning font-mono tabular-nums whitespace-nowrap">
                                {item.confidence != null ? `${item.confidence}%` : "—"}
                              </span>
                            </td>
                            <td className="min-w-[160px] whitespace-nowrap">
                              <span className="text-xs text-slate-600 whitespace-nowrap">
                                {formatReviewReason(item.reason)}
                              </span>
                            </td>
                            <td
                              className="min-w-[240px] whitespace-nowrap text-right"
                              onClick={(e) => e.stopPropagation()}
                            >
                              <div className="inline-flex items-center justify-end gap-2 whitespace-nowrap">
                                <button
                                  type="button"
                                  disabled={Boolean(actingReviewId)}
                                  onClick={() =>
                                    void handleReviewAction(item, "REVIEWED")
                                  }
                                  className="relative inline-flex items-center gap-1 px-2.5 min-h-[28px] min-w-0 py-1 rounded-md text-xs font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 hover:bg-emerald-100 disabled:opacity-50 cursor-pointer whitespace-nowrap after:content-[''] after:absolute after:-inset-y-[8px] after:inset-x-0"
                                >
                                  <Check className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>{busy ? "处理中" : "确认无误"}</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={Boolean(actingReviewId)}
                                  onClick={() =>
                                    void handleReviewAction(item, "DISMISSED")
                                  }
                                  className="relative inline-flex items-center gap-1 px-2.5 min-h-[28px] min-w-0 py-1 rounded-md text-xs font-medium bg-slate-100 text-slate-700 border border-slate-200 hover:bg-slate-200 disabled:opacity-50 cursor-pointer whitespace-nowrap after:content-[''] after:absolute after:-inset-y-[8px] after:inset-x-0"
                                >
                                  <X className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>忽略</span>
                                </button>
                                <Link
                                  href={`/tickets/${encodeURIComponent(item.ticketId)}`}
                                  className="relative inline-flex items-center gap-1 px-2.5 min-h-[28px] py-1 rounded-md text-xs font-medium bg-blue-50 text-blue-700 border border-blue-200 hover:bg-blue-100 whitespace-nowrap after:content-[''] after:absolute after:-inset-y-[8px] after:inset-x-0"
                                >
                                  <Wrench className="w-3 h-3 shrink-0" aria-hidden="true" />
                                  <span>去纠偏</span>
                                </Link>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                {reviewLoading ? (
                  <div className="empty-hint">正在加载待复核队列…</div>
                ) : reviewRows.length === 0 ? (
                  <div className="empty-hint">暂无待人工复核工单</div>
                ) : null}
                {reviewTotalCount > 0 && (
                  <TablePager
                    page={reviewPage}
                    pages={reviewPages}
                    total={reviewTotalCount}
                    pageSize={reviewSize}
                    pageSizeOptions={[10, 20, 50, 100]}
                    itemLabel="条"
                    onPageChange={setReviewPage}
                    onPageSizeChange={(n) => {
                      setReviewSize(n);
                      setReviewPage(1);
                    }}
                  />
                )}
              </>
            ) : (
              <>
                <div className="filter-bar">
                  <div className="search-input">
                    <span aria-hidden="true">⌕</span>
                    <input
                      aria-label="搜索工单标题、工单号或内容"
                      placeholder="搜索工单标题 / 工单号 / 内容"
                      value={keyword}
                      onChange={(e) => {
                        setKeyword(e.target.value);
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
                      className="w-full sm:w-[156px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                    >
                      <SelectValue placeholder={`${regionUnit}：全部`} />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">{regionUnit}：全部</SelectItem>
                      {data.facets.regions.map((r) => (
                        <SelectItem key={r} value={r}>
                          {r}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={category || "all"}
                    onValueChange={(val) => {
                      setCategory(val === "all" ? "" : val);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      aria-label="按诉求类型筛选"
                      className="w-full sm:w-[152px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                    >
                      <SelectValue placeholder="类型：全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">类型：全部</SelectItem>
                      {data.facets.categories.map((c) => (
                        <SelectItem key={c} value={c}>
                          {c}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>

                  <Select
                    value={cluster || "all"}
                    onValueChange={(val) => {
                      setCluster(val === "all" ? "" : val);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      aria-label="按聚类状态筛选"
                      className="w-full sm:w-[155px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                    >
                      <SelectValue placeholder="聚类状态：全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">聚类状态：全部</SelectItem>
                      <SelectItem value="multifreq">多频聚类工单</SelectItem>
                      <SelectItem value="single">单发诉求 (未聚类)</SelectItem>
                    </SelectContent>
                  </Select>

                  <Select
                    value={time || "all"}
                    onValueChange={(val) => {
                      setTime(val === "all" ? "" : val);
                      setPage(1);
                    }}
                  >
                    <SelectTrigger
                      aria-label="按时间范围筛选"
                      className="w-full sm:w-[130px] min-h-[44px] sm:min-h-0 sm:h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg"
                    >
                      <SelectValue placeholder="时间：全部" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">时间：全部</SelectItem>
                      <SelectItem value="近90天">时间：近90天</SelectItem>
                      <SelectItem value="近30天">时间：近30天</SelectItem>
                      <SelectItem value="近7天">时间：近7天</SelectItem>
                      <SelectItem value="今天">时间：今天</SelectItem>
                      <SelectItem value="昨天">时间：昨天</SelectItem>
                      <SelectItem value="本月">时间：本月</SelectItem>
                      <SelectItem value="上月">时间：上月</SelectItem>
                    </SelectContent>
                  </Select>
                  <span className="filter-bar__summary tabular-nums">共 {data.total} 条结果</span>
                </div>
                {loadError && (
                  <div
                    role="alert"
                    className="mx-3 sm:mx-5 my-3 rounded-lg border border-rose-200 bg-rose-50 px-3.5 py-2.5 flex items-center justify-between gap-3 flex-wrap text-xs text-rose-800"
                  >
                    <span>{loadError}</span>
                    <button
                      type="button"
                      onClick={load}
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
                  aria-label="工单列表"
                >
                  <table className="workorder-table">
                    <caption className="sr-only">工单列表</caption>
                    <thead>
                      <tr>
                        <th scope="col" className="min-w-[140px] whitespace-nowrap">工单号</th>
                        <th scope="col" className="min-w-[220px]">诉求标题</th>
                        <th scope="col" className="min-w-[104px] whitespace-nowrap">{regionUnit}</th>
                        <th scope="col" className="min-w-[128px] whitespace-nowrap">类型</th>
                        <th scope="col" className="min-w-[84px] whitespace-nowrap">紧急度</th>
                        <th scope="col" className="min-w-[116px] whitespace-nowrap">时间</th>
                        <th scope="col" className="min-w-[88px] whitespace-nowrap">状态</th>
                        <th scope="col" className="min-w-[72px] whitespace-nowrap text-right">操作</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.data.map((r) => (
                        <tr key={r.ticketId} onClick={() => openDrawer(r)}>
                          <td className="col-id min-w-[140px] whitespace-nowrap tabular-nums">{r.id}</td>
                          <td className="col-title min-w-[220px]">
                            <div className="col-title__text flex items-center gap-1.5 min-w-0" title={r.title}>
                              <span className="truncate min-w-0">{r.title}</span>
                              {r.multifreq && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 shrink-0 whitespace-nowrap" title="已归入多频聚类群组">
                                  多频
                                </span>
                              )}
                              {r.isFakeClosure && (
                                <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-amber-50 text-amber-800 border border-amber-200 shrink-0 whitespace-nowrap" title="办结后短期内再次投诉">
                                  假闭环
                                </span>
                              )}
                            </div>
                            <div className="col-title__desc flex items-center gap-2 min-w-0" style={{ marginTop: 2 }}>
                              {r.address ? <span className="truncate" title={r.address}>{r.address}</span> : null}
                              {r.canonicalSubject ? (
                                <span className="text-[11px] text-gray-500 font-normal truncate" title={`研判主体: ${r.canonicalSubject}`}>
                                  · 主体: {r.canonicalSubject}
                                </span>
                              ) : null}
                            </div>
                          </td>
                          <td className="min-w-[104px] whitespace-nowrap">{r.region || "—"}</td>
                          <td className="min-w-[128px] whitespace-nowrap">
                            {r.category ? (
                              <span
                                className={`badge-pill whitespace-nowrap ${catPill(r.category)}`}
                                style={categoryBadgeStyle(r.category)}
                              >
                                {r.category}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="min-w-[84px] whitespace-nowrap">
                            <span className={`badge-pill whitespace-nowrap ${r.urgency === "URGENT" ? "badge-pill--danger" : r.urgency === "MEDIUM" ? "badge-pill--warning" : "badge-pill--default"}`}>
                              {urgencyLabel(r.urgency)}
                            </span>
                          </td>
                          <td className="min-w-[116px] whitespace-nowrap tabular-nums">{r.createdAt}</td>
                          <td className="min-w-[88px] whitespace-nowrap">
                            <span className={`status-tag whitespace-nowrap status-tag--${statusTag(r.status)}`}>
                              {statusLabel(r.status)}
                            </span>
                          </td>
                          <td className="min-w-[72px] whitespace-nowrap text-right">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                openDrawer(r);
                              }}
                              aria-label={`查看工单 ${r.id} 详情`}
                              className="relative inline-flex items-center justify-end min-h-[28px] min-w-0 py-1 px-2 sm:px-0 text-[var(--c-brand)] font-medium text-xs bg-transparent border-0 cursor-pointer hover:underline after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                            >
                              查看
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {data.data.length === 0 && <div className="empty-hint">暂无工单</div>}
                <TablePager
                  page={page}
                  pages={pages}
                  total={data.total}
                  pageSize={size}
                  pageSizeOptions={[20, 50, 100]}
                  itemLabel="条"
                  onPageChange={setPage}
                  onPageSizeChange={(n) => {
                    setSize(n);
                    setPage(1);
                  }}
                />
              </>
            )}
          </div>
        </>
      )}

      <style>{`
        .civic-ticket-drawer:modal {
          overscroll-behavior: contain;
        }
        .civic-ticket-drawer::backdrop {
          overflow: hidden;
          overscroll-behavior: contain;
          background: rgba(15, 23, 42, 0.45);
          backdrop-filter: blur(2px);
        }
        .civic-ticket-drawer[open] {
          display: flex;
        }
      `}</style>
      <dialog
        ref={drawerDialogRef}
        aria-labelledby={drawerTitleId}
        {...({ closedby: "any" } as Record<string, string>)}
        onPointerDown={(e) => {
          if (e.pointerType === "mouse" && e.button !== 0) {
            drawerPointerOutsideRef.current = false;
            return;
          }
          drawerPointerOutsideRef.current = isOutsideDrawerPanel(e.clientX, e.clientY);
        }}
        onPointerUp={(e) => {
          const startedOutside = drawerPointerOutsideRef.current;
          drawerPointerOutsideRef.current = false;
          if (!startedOutside) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;
          if (!isOutsideDrawerPanel(e.clientX, e.clientY)) return;
          const supportsClosedBy =
            typeof HTMLDialogElement !== "undefined" &&
            "closedBy" in HTMLDialogElement.prototype;
          if (!supportsClosedBy) {
            drawerDialogRef.current?.close();
          }
        }}
        onPointerCancel={() => {
          drawerPointerOutsideRef.current = false;
        }}
        onClose={() => {
          closeDrawer();
        }}
        className="civic-ticket-drawer fixed inset-y-0 right-0 left-auto m-0 ml-auto w-[620px] max-w-[100dvw] sm:max-w-[calc(100vw-24px)] h-dvh max-h-dvh flex-col bg-white border-0 border-l border-slate-200 shadow-2xl p-0 text-slate-900 overflow-hidden"
      >
        {drawer && (
          <div ref={drawerPanelRef} className="flex flex-col w-full h-full min-h-0 overflow-hidden">
            <div className="drawer__head gap-3">
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                  <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded">
                    {drawer.id}
                  </span>
                  {drawer.category && (
                    <span
                      className={`badge-pill ${catPill(drawer.category)}`}
                      style={categoryBadgeStyle(drawer.category)}
                    >
                      {drawer.category}
                    </span>
                  )}
                  <span className={`status-tag status-tag--${statusTag(drawer.status)}`}>
                    {statusLabel(drawer.status)}
                  </span>
                  <span className={`badge-pill ${drawer.urgency === "URGENT" ? "badge-pill--danger" : "badge-pill--default"}`}>
                    {urgencyLabel(drawer.urgency)}
                  </span>
                  {drawer.isFakeClosure && (
                    <span className="badge-pill badge-pill--danger">
                      疑似假闭环
                    </span>
                  )}
                </div>
                <h2 id={drawerTitleId} className="drawer__title m-0" style={{ wordBreak: "break-word", fontSize: 16 }}>
                  {drawer.title || "市民诉求"}
                </h2>
                {drawer.rawTitle && drawer.rawTitle !== drawer.title && (
                  <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2 }}>
                    市民原报原由：{drawer.rawTitle}
                  </div>
                )}
              </div>
              <button
                ref={drawerCloseBtnRef}
                type="button"
                aria-label="关闭工单详情抽屉"
                onClick={() => drawerDialogRef.current?.close()}
                className="p-2 rounded-lg text-slate-500 hover:text-slate-800 hover:bg-slate-200/60 transition-colors shrink-0 cursor-pointer min-h-[44px] min-w-[44px] sm:min-h-[32px] sm:min-w-[32px] flex items-center justify-center"
              >
                <X className="w-4 h-4" aria-hidden="true" />
              </button>
            </div>

            <div className="drawer__body space-y-4 overscroll-contain">
              {/* 1. AI 智能研判解析 */}
              <AiVerdictCard data={drawer} headingLevel="h3" />

              {drawer.detailLoaded ? (
                <CitizenVoiceCard data={drawer} headingLevel="h3" />
              ) : (
                <div className="text-xs text-slate-500 px-1">
                  {drawer.detailError ? "原文加载失败" : "正在读取诉求原文…"}
                </div>
              )}

              {/* 3. 空间地理高精打点 (天地图) */}
              <TicketGeoMapCard data={drawer} headingLevel="h3" />

              {/* 4. 经办基础属性 */}
              <TicketPropsGrid data={drawer} headingLevel="h3" />
            </div>

            {/* 4. 吸底操作栏 (固定底部) */}
            <div className="drawer__footer flex-wrap gap-2">
              <div>
                {drawer.cluster_id ? (
                  <button
                    type="button"
                    className="relative min-h-[28px] sm:min-h-0 py-1 text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer transition-colors after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                    onClick={() => {
                      const clusterId = drawer.cluster_id;
                      const ticketKey = drawer.id;
                      closeDrawer();
                      router.push(`/themes/${clusterId}?ticketId=${encodeURIComponent(ticketKey)}&highlight=${encodeURIComponent(ticketKey)}#ticket-${encodeURIComponent(ticketKey)}`);
                    }}
                  >
                    <Layers className="h-3.5 w-3.5 text-blue-600" aria-hidden="true" />
                    <span>查看所在多频专题</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-500">诉求已实时同步</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn--default text-xs"
                  onClick={() => drawerDialogRef.current?.close()}
                >
                  关闭
                </button>
                <button
                  type="button"
                  className="btn btn--primary flex items-center gap-1.5 text-xs shadow-xs"
                  onClick={() => {
                    const ticketId = drawer.ticketId;
                    closeDrawer();
                    router.push(`/tickets/${ticketId}`);
                  }}
                >
                  <span>打开完整详情</span>
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          </div>
        )}
      </dialog>
    </>
  );
}

function tabCount(key: string, s: Stats, reviewTotal: number | null) {
  if (key === "all") return s.total;
  if (key === "pending") return s.pending;
  if (key === "progress") return s.progress;
  if (key === "finished") return s.finished;
  if (key === "urgent") return s.urgent;
  if (key === "multifreq") return s.multifreq;
  if (key === "single") return s.single ?? Math.max(0, s.total - s.multifreq);
  if (key === "fake_closure") return s.fakeClosure ?? 0;
  if (key === "review") return reviewTotal ?? s.pendingReview ?? 0;
  return 0;
}

function formatReviewReason(reason?: string | null): string {
  if (!reason) return "低置信度待复核";
  const r = reason.trim();
  if (r === "LOW_CONFIDENCE") return "AI 抽取置信度较低";
  if (r === "MISSING_SUBJECT") return "涉事主体提取缺失";
  if (r === "MISSING_LOCATION") return "事发地点不明确";
  return r;
}

function urgencyLabel(u: string) {
  return getUrgencyLabel(u);
}

function statusLabel(s: string) {
  const code = normalizeStatusCode(s);
  if (code === "RESOLVED") return "已办结";
  if (code === "IN_PROGRESS") return "处理中";
  return "待处理";
}

function statusDot(s: string) {
  const code = normalizeStatusCode(s);
  if (code === "RESOLVED") return "finished";
  if (code === "IN_PROGRESS") return "progress";
  return "pending";
}

function statusTag(s: string) {
  const code = normalizeStatusCode(s);
  if (code === "RESOLVED") return "done";
  if (code === "IN_PROGRESS") return "progress";
  return "pending";
}

function catPill(cat: string) {
  return getCategoryBadgeClass(cat);
}
