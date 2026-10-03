"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  FileText,
  Clock,
  CheckCircle2,
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
} from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkTickets } from "@/app/_components/civic/skeletons";
import { isTownLabel } from "@/lib/admin-area";
import { normalizeStatusCode, getCategoryBadgeClass, getUrgencyLabel, categoryBadgeStyle } from "@/lib/civic-dto";
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
};

type Stats = {
  total: number;
  pending: number;
  progress: number;
  finished: number;
  urgent: number;
  multifreq: number;
  single: number;
};

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "progress", label: "处理中" },
  { key: "finished", label: "已办结" },
  { key: "urgent", label: "紧急" },
  { key: "multifreq", label: "多频聚类" },
  { key: "single", label: "单发诉求" },
] as const;

export default function TicketsPage() {
  const router = useRouter();
  const { activeRegion } = useRegion();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(20);
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState("all");
  const [region, setRegion] = useState("");
  const [category, setCategory] = useState("");
  const [cluster, setCluster] = useState("");
  const [time, setTime] = useState("");
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [data, setData] = useState<{
    total: number;
    data: Row[];
    stats: Stats;
    facets: { regions: string[]; categories: string[] };
  }>({
    total: 0,
    data: [],
    stats: { total: 0, pending: 0, progress: 0, finished: 0, urgent: 0, multifreq: 0, single: 0 },
    facets: { regions: [], categories: [] },
  });
  const [ready, setReady] = useState(false);

  function load() {
    const q = new URLSearchParams({ page: String(page), size: String(size) });
    if (activeRegion?.id) q.set("regionId", activeRegion.id);
    if (keyword) q.set("keyword", keyword);
    if (tab !== "all") q.set("tab", tab);
    if (region) q.set("region", region);
    if (category) q.set("category", category);
    if (cluster) q.set("cluster", cluster);
    if (time) q.set("time", time);
    fetch(`/api/workorders?${q}`)
      .then((r) => r.json())
      .then((j) =>
        setData({
          total: j.total || 0,
          data: j.data || [],
          stats: j.stats || data.stats,
          facets: {
            regions: (j.facets?.regions || []).filter((r: string) => isTownLabel(r) || r === "未知"),
            categories: j.facets?.categories || [],
          },
        })
      )
      .catch(() => setData((prev) => ({ ...prev, total: 0, data: [] })))
      .finally(() => setReady(true));
  }

  useEffect(() => {
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, [page, size, keyword, tab, region, category, cluster, time, activeRegion?.id]);

  const s = data.stats;
  const pages = Math.max(1, Math.ceil(data.total / size));
  const pendingShare = s.total ? (((s.pending + s.progress) / s.total) * 100).toFixed(1) : "0";
  const finishShare = s.total ? ((s.finished / s.total) * 100).toFixed(0) : "0";

  function exportCsv() {
    const header = ["单号", "标题", "类型", "镇街", "紧急", "状态", "日期"];
    const lines = [header.join(",")].concat(
      data.data.map((r) => [
        r.id,
        `"${(r.title || "").replace(/"/g, '""')}"`,
        r.category,
        r.region,
        urgencyLabel(r.urgency),
        statusLabel(r.status),
        r.createdAt,
      ].join(","))
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
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
          <div className="page-hero__title">
            工单中心
          </div>
          <div className="page-hero__sub">
            {activeRegion ? `${activeRegion.name} · ` : ""}全部工单 · 实时同步 · 共 <b style={{ color: "var(--c-ink)" }}>{s.total}</b> 条
          </div>
        </div>
        <div className="page-hero__actions">
          <button type="button" className="icon-circle" title="刷新" onClick={load}>
            ↻
          </button>
          <button type="button" className="btn btn--default" onClick={exportCsv}>
            导出
          </button>
        </div>
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
                setPage(1);
              }}
              className={tab === "all" ? "ring-2 ring-blue-500/30" : ""}
            />
            <StatCard
              icon={Clock}
              tone="orange"
              label="待处理"
              value={s.pending + s.progress}
              sub={`占总数 ${pendingShare}%`}
              onClick={() => {
                setTab("pending");
                setPage(1);
              }}
              className={tab === "pending" || tab === "progress" ? "ring-2 ring-amber-500/30" : ""}
            />
            <StatCard
              icon={CheckCircle2}
              tone="green"
              label="已办结"
              value={s.finished}
              sub={`办结率 ${finishShare}%`}
              onClick={() => {
                setTab("finished");
                setPage(1);
              }}
              className={tab === "finished" ? "ring-2 ring-emerald-500/30" : ""}
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
              }}
              className={tab === "urgent" ? "ring-2 ring-rose-500/30" : ""}
            />
          </StatCardGrid>

          <div className="card list-card">
            <div className="list-card__head">
              <div>
                <div className="list-card__title">工单列表</div>
                <div className="list-card__sub">点击行查看详情</div>
              </div>
            </div>
            <div className="filter-tabs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  className={`filter-tab${tab === t.key ? " is-active" : ""}`}
                  onClick={() => {
                    setTab(t.key);
                    setPage(1);
                  }}
                >
                  {t.label}
                  <span className="filter-tab__count">{tabCount(t.key, s)}</span>
                </button>
              ))}
            </div>
            <div className="filter-bar">
              <div className="search-input">
                <span>⌕</span>
                <input
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
                <SelectTrigger className="w-[130px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
                  <SelectValue placeholder="镇街：全部" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">镇街：全部</SelectItem>
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
                <SelectTrigger className="w-[140px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
                <SelectTrigger className="w-[155px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
                <SelectTrigger className="w-[130px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
              <span className="filter-bar__summary">共 {data.total} 条结果</span>
            </div>
            <div className="table-scroll">
              <table className="workorder-table">
                <thead>
                  <tr>
                    <th style={{ width: 150, minWidth: 140 }}>工单号</th>
                    <th>诉求标题</th>
                    <th style={{ width: 85 }}>镇街</th>
                    <th style={{ width: 95, minWidth: 90 }}>类型</th>
                    <th style={{ width: 80 }}>紧急度</th>
                    <th style={{ width: 120 }}>时间</th>
                    <th style={{ width: 85 }}>状态</th>
                    <th style={{ width: 75, textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {data.data.map((r) => (
                    <tr key={r.ticketId} onClick={() => setDrawer(r)}>
                      <td className="col-id">{r.id}</td>
                      <td className="col-title">
                        <div className="col-title__text flex items-center gap-1.5" title={r.title}>
                          <span className="truncate">{r.title}</span>
                          {r.multifreq && (
                            <span className="inline-flex items-center px-1.5 py-0.2 rounded text-[10px] font-medium bg-blue-50 text-blue-700 border border-blue-200 shrink-0" title="已归入多频聚类群组">
                              多频
                            </span>
                          )}
                        </div>
                        <div className="col-title__desc flex items-center gap-2" style={{ marginTop: 2 }}>
                          {r.address ? <span title={r.address}>{r.address}</span> : null}
                          {r.canonicalSubject ? (
                            <span className="text-[11px] text-gray-500 font-normal truncate" title={`研判主体: ${r.canonicalSubject}`}>
                              · 主体: {r.canonicalSubject}
                            </span>
                          ) : null}
                        </div>
                      </td>
                      <td>{r.region || "—"}</td>
                      <td>
                        {r.category ? (
                          <span
                            className={`badge-pill ${catPill(r.category)}`}
                            style={categoryBadgeStyle(r.category)}
                          >
                            {r.category}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td>
                        <span className={`badge-pill ${r.urgency === "URGENT" ? "badge-pill--danger" : r.urgency === "MEDIUM" ? "badge-pill--warning" : "badge-pill--default"}`}>
                          {urgencyLabel(r.urgency)}
                        </span>
                      </td>
                      <td style={{ whiteSpace: "nowrap" }}>{r.createdAt}</td>
                      <td>
                        <span className={`status-tag status-tag--${statusTag(r.status)}`}>
                          {statusLabel(r.status)}
                        </span>
                      </td>
                      <td style={{ textAlign: "right", color: "var(--c-brand)" }}>查看</td>
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
          </div>
        </>
      )}

      <div className={`drawer-mask${drawer ? " is-open" : ""}`} onClick={() => setDrawer(null)} />
      <div className={`drawer${drawer ? " is-open" : ""}`}>
        {drawer && (
          <>
            <div className="drawer__head">
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
                </div>
                <div className="drawer__title" style={{ wordBreak: "break-word", fontSize: 16 }}>
                  {drawer.title || "市民诉求"}
                </div>
                {drawer.rawTitle && drawer.rawTitle !== drawer.title && (
                  <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginTop: 2 }}>
                    市民原报原由：{drawer.rawTitle}
                  </div>
                )}
              </div>
            </div>

            <div className="drawer__body space-y-4">
              {/* 1. AI 智能研判解析 */}
              <AiVerdictCard data={drawer} />

              {/* 2. 市民原始诉求 */}
              <CitizenVoiceCard data={drawer} />

              {/* 3. 空间地理高精打点 (天地图) */}
              <TicketGeoMapCard data={drawer} />

              {/* 4. 经办基础属性 */}
              <TicketPropsGrid data={drawer} />
            </div>

            {/* 4. 吸底操作栏 (固定底部，z-index: 1001，绝不被任何悬浮球遮挡) */}
            <div className="drawer__footer">
              <div>
                {drawer.cluster_id ? (
                  <button
                    type="button"
                    className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1 cursor-pointer transition-colors"
                    onClick={() => {
                      setDrawer(null);
                      router.push(`/themes/${drawer.cluster_id}?ticketId=${encodeURIComponent(drawer.id)}&highlight=${encodeURIComponent(drawer.id)}#ticket-${encodeURIComponent(drawer.id)}`);
                    }}
                  >
                    <Layers className="h-3.5 w-3.5 text-blue-600" />
                    <span>查看所在多频专题</span>
                  </button>
                ) : (
                  <span className="text-xs text-slate-400">诉求已实时同步</span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  className="btn btn--default text-xs"
                  onClick={() => setDrawer(null)}
                >
                  关闭
                </button>
                <button
                  type="button"
                  className="btn btn--primary flex items-center gap-1.5 text-xs shadow-xs"
                  onClick={() => {
                    setDrawer(null);
                    router.push(`/tickets/${drawer.ticketId}`);
                  }}
                >
                  <span>打开完整详情</span>
                  <ExternalLink className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}

function tabCount(key: string, s: Stats) {
  if (key === "all") return s.total;
  if (key === "pending") return s.pending;
  if (key === "progress") return s.progress;
  if (key === "finished") return s.finished;
  if (key === "urgent") return s.urgent;
  if (key === "multifreq") return s.multifreq;
  if (key === "single") return s.single ?? Math.max(0, s.total - s.multifreq);
  return 0;
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
