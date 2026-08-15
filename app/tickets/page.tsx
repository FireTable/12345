"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useCivicWorkflow } from "@/app/_components/civic/civic-workflow";
import { FileText, Clock, CheckCircle2, Flame, ExternalLink, Layers } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { isTownLabel } from "@/lib/admin-area";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

type Row = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  urgency: string;
  status: string;
  createdAt: string;
  content?: string;
  cluster_id?: string;
  cluster_name?: string;
  multifreq?: boolean;
};

type Stats = { total: number; pending: number; progress: number; finished: number; urgent: number; multifreq: number };

const TABS = [
  { key: "all", label: "全部" },
  { key: "pending", label: "待处理" },
  { key: "progress", label: "处理中" },
  { key: "finished", label: "已办结" },
  { key: "urgent", label: "🚨 紧急" },
  { key: "multifreq", label: "多频聚类" },
] as const;

export default function TicketsPage() {
  const router = useRouter();
  const { openUpload } = useCivicWorkflow();
  const [page, setPage] = useState(1);
  const [size, setSize] = useState(10);
  const [keyword, setKeyword] = useState("");
  const [tab, setTab] = useState("all");
  const [region, setRegion] = useState("");
  const [category, setCategory] = useState("");
  const [time, setTime] = useState("");
  const [jump, setJump] = useState("1");
  const [drawer, setDrawer] = useState<Row | null>(null);
  const [data, setData] = useState<{
    total: number;
    data: Row[];
    stats: Stats;
    facets: { regions: string[]; categories: string[] };
  }>({
    total: 0,
    data: [],
    stats: { total: 0, pending: 0, progress: 0, finished: 0, urgent: 0, multifreq: 0 },
    facets: { regions: [], categories: [] },
  });

  function load() {
    const q = new URLSearchParams({ page: String(page), size: String(size) });
    if (keyword) q.set("keyword", keyword);
    if (tab !== "all") q.set("tab", tab);
    if (region) q.set("region", region);
    if (category) q.set("category", category);
    if (time) q.set("time", time);
    fetch(`/api/workorders?${q}`)
      .then((r) => r.json())
      .then((j) =>
        setData({
          total: j.total || 0,
          data: j.data || [],
          stats: j.stats || data.stats,
          facets: {
            regions: (j.facets?.regions || []).filter((r: string) => isTownLabel(r)),
            categories: j.facets?.categories || [],
          },
        })
      )
      .catch(() => setData((prev) => ({ ...prev, total: 0, data: [] })));
  }

  useEffect(() => {
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, [page, size, keyword, tab, region, category, time]);

  const s = data.stats;
  const pages = Math.max(1, Math.ceil(data.total / size));
  const start = data.total === 0 ? 0 : (page - 1) * size + 1;
  const end = Math.min(page * size, data.total);
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
            <span>📋</span>
            工单中心
          </div>
          <div className="page-hero__sub">
            全部工单 · 实时同步 · 共 <b style={{ color: "var(--c-ink)" }}>{s.total}</b> 条
          </div>
        </div>
        <div className="page-hero__actions">
          <button type="button" className="icon-circle" title="刷新" onClick={load}>
            ↻
          </button>
          <button type="button" className="btn btn--default" onClick={exportCsv}>
            导出
          </button>
          <button type="button" className="btn btn--primary" onClick={openUpload}>
            新增工单
          </button>
        </div>
      </div>

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
        <table className="workorder-table">
          <thead>
            <tr>
              <th style={{ width: 150, minWidth: 140 }}>工单号</th>
              <th style={{ width: 260, minWidth: 220 }}>诉求标题</th>
              <th>诉求正文内容</th>
              <th style={{ width: 85 }}>镇街</th>
              <th style={{ width: 95, minWidth: 90 }}>类型</th>
              <th style={{ width: 80 }}>紧急度</th>
              <th style={{ width: 110 }}>时间</th>
              <th style={{ width: 85 }}>状态</th>
              <th style={{ width: 75, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((r) => (
              <tr key={r.ticketId} onClick={() => setDrawer(r)}>
                <td className="col-id">{r.id}</td>
                <td>
                  <div className="col-title__text" title={r.title}>{r.title}</div>
                </td>
                <td>
                  <div className="col-content__text" title={r.content || ""}>
                    {r.content || "暂无诉求正文"}
                  </div>
                </td>
                <td>{r.region || "—"}</td>
                <td>
                  {r.category ? <span className={`badge-pill ${catPill(r.category)}`}>{r.category}</span> : "—"}
                </td>
                <td>
                  <span className={`badge-pill ${r.urgency === "URGENT" ? "badge-pill--danger" : r.urgency === "MEDIUM" ? "badge-pill--warning" : "badge-pill--default"}`}>
                    {urgencyLabel(r.urgency)}
                  </span>
                </td>
                <td>{r.createdAt}</td>
                <td>
                  <span className={`status-tag status-tag--${statusTag(r.status)}`}>
                    {statusLabel(r.status)}
                  </span>
                </td>
                <td style={{ textAlign: "right", color: "var(--c-brand)" }}>查看 →</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.data.length === 0 && <div className="empty-hint">暂无工单</div>}
        <div className="pagination">
          <div className="pagination__info">
            共 <b>{data.total}</b> 条 · 当前 <b>{start}</b>-<b>{end}</b>
          </div>
          <div className="pagination__controls">
            <Select
              value={String(size)}
              onValueChange={(val) => {
                setSize(Number(val));
                setPage(1);
              }}
            >
              <SelectTrigger className="w-[88px] h-[30px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] rounded-md font-medium">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="10">10/页</SelectItem>
                <SelectItem value="20">20/页</SelectItem>
                <SelectItem value="50">50/页</SelectItem>
              </SelectContent>
            </Select>
            <button type="button" className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </button>
            <button type="button" className="page-btn is-active">
              {page}
            </button>
            <button type="button" className="page-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              ›
            </button>
            <span className="page-jump">
              跳至
              <input
                type="number"
                min={1}
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") setPage(Math.min(pages, Math.max(1, Number(jump) || 1)));
                }}
              />
              页
            </span>
          </div>
        </div>
      </div>

      <div className={`drawer-mask${drawer ? " is-open" : ""}`} onClick={() => setDrawer(null)} />
      <div className={`drawer${drawer ? " is-open" : ""}`}>
        <div className="drawer__head">
          <div>
            <div className="drawer__title">{drawer?.title || "请选择工单"}</div>
            <div className="list-card__sub">{drawer?.id}</div>
          </div>
          <button type="button" className="drawer__close" onClick={() => setDrawer(null)}>
            ×
          </button>
        </div>
        {drawer && (
          <div className="drawer__body">
            <div className="drawer__section">
              <div className="drawer__section-title">基础信息</div>
              <div className="info-row">
                <span className="info-row__label">工单号</span>
                <span className="info-row__value">{drawer.id}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">紧急度</span>
                <span className="info-row__value">{urgencyLabel(drawer.urgency)}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">类型</span>
                <span className="info-row__value">{drawer.category || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">镇街</span>
                <span className="info-row__value">{drawer.region || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">创建时间</span>
                <span className="info-row__value">{drawer.createdAt}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">当前状态</span>
                <span className="info-row__value">{statusLabel(drawer.status)}</span>
              </div>
            </div>
            <div className="drawer__section">
              <div className="drawer__section-title">工单内容</div>
              <div className="content-box">{drawer.content || "—"}</div>
            </div>
            <div className="drawer__section">
              <div className="drawer__section-title">快捷操作</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {drawer.cluster_id ? (
                  <button
                    type="button"
                    className="btn btn--default flex items-center gap-1"
                    onClick={() => {
                      setDrawer(null);
                      router.push(`/themes/${drawer.cluster_id}?ticketId=${encodeURIComponent(drawer.id)}&highlight=${encodeURIComponent(drawer.id)}#ticket-${encodeURIComponent(drawer.id)}`);
                    }}
                  >
                    <Layers className="h-3.5 w-3.5 text-blue-600" />
                    <span>查看聚类定位</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--primary flex items-center gap-1"
                  style={{ marginLeft: "auto" }}
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
          </div>
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
  return s.multifreq;
}

function urgencyLabel(u: string) {
  if (u === "URGENT" || u === "urgent") return "紧急";
  if (u === "MEDIUM" || u === "medium" || u === "high" || u === "HIGH") return "较急";
  return "普通";
}

function statusLabel(s: string) {
  if (s === "RESOLVED" || s === "DONE" || s === "FINISHED" || s === "已办结") return "已办结";
  if (s === "IN_PROGRESS" || s === "PROGRESS" || s === "处置中" || s === "处理中") return "处理中";
  return "待处理";
}

function statusDot(s: string) {
  if (s === "RESOLVED" || s === "DONE" || s === "FINISHED" || s === "已办结") return "finished";
  if (s === "IN_PROGRESS" || s === "PROGRESS" || s === "处置中" || s === "处理中") return "progress";
  return "pending";
}

function statusTag(s: string) {
  if (s === "RESOLVED" || s === "DONE" || s === "FINISHED" || s === "已办结") return "done";
  if (s === "IN_PROGRESS" || s === "PROGRESS" || s === "处置中" || s === "处理中") return "progress";
  return "pending";
}

function catPill(cat: string) {
  if (cat.includes("生态") || cat.includes("环保")) return "badge-pill--success";
  if (cat.includes("劳动") || cat.includes("劳资")) return "badge-pill--warning";
  if (cat.includes("市场") || cat.includes("消费")) return "badge-pill--danger";
  if (cat.includes("城市") || cat.includes("城管")) return "badge-pill--info";
  return "badge-pill--default";
}
