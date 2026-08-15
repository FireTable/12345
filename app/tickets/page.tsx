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
          className={tab === "pending" ? "ring-2 ring-orange-500/30" : ""}
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
          sub="需优先处置"
          onClick={() => {
            setTab("urgent");
            setPage(1);
          }}
          className={tab === "urgent" ? "ring-2 ring-rose-500/30" : ""}
        />
      </StatCardGrid>

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
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <input
          type="text"
          placeholder="搜索工单标题、内容或单号…"
          value={keyword}
          onChange={(e) => {
            setKeyword(e.target.value);
            setPage(1);
          }}
          style={{ width: 280 }}
        />

        <div className="w-[140px]">
          <Select
            value={region || "all"}
            onValueChange={(val) => {
              setRegion(val === "all" ? "" : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[34px] bg-white border-slate-200 text-xs">
              <SelectValue placeholder="全部镇街" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部镇街</SelectItem>
              {data.facets.regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[140px]">
          <Select
            value={category || "all"}
            onValueChange={(val) => {
              setCategory(val === "all" ? "" : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[34px] bg-white border-slate-200 text-xs">
              <SelectValue placeholder="全部分类" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部分类</SelectItem>
              {data.facets.categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="w-[130px]">
          <Select
            value={time || "all"}
            onValueChange={(val) => {
              setTime(val === "all" ? "" : val);
              setPage(1);
            }}
          >
            <SelectTrigger className="h-[34px] bg-white border-slate-200 text-xs">
              <SelectValue placeholder="全部时间" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部时间</SelectItem>
              <SelectItem value="24h">近 24 小时</SelectItem>
              <SelectItem value="3d">近 3 天</SelectItem>
              <SelectItem value="7d">近 7 天</SelectItem>
              <SelectItem value="30d">近 30 天</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {(keyword || region || category || time || tab !== "all") && (
          <button
            type="button"
            className="btn btn--default"
            onClick={() => {
              setKeyword("");
              setRegion("");
              setCategory("");
              setTime("");
              setTab("all");
              setPage(1);
            }}
          >
            重置
          </button>
        )}
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th style={{ width: 140 }}>工单号</th>
              <th>诉求标题</th>
              <th style={{ width: 100 }}>所属镇街</th>
              <th style={{ width: 100 }}>业务类型</th>
              <th style={{ width: 90 }}>紧急度</th>
              <th style={{ width: 150 }}>诉求时间</th>
              <th style={{ width: 100 }}>处置状态</th>
              <th style={{ width: 90, textAlign: "right" }}>操作</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((r) => (
              <tr
                key={r.ticketId}
                onClick={() => setDrawer(r)}
                className="cursor-pointer hover:bg-blue-50/40 transition-colors"
                title="点击展开工单详细抽屉"
              >
                <td className="col-id font-mono text-xs">{r.id}</td>
                <td>
                  <div className="col-title__text">{r.title}</div>
                  <div className="col-title__id">{r.ticketId}</div>
                </td>
                <td>{r.region || "—"}</td>
                <td>
                  <span className="badge badge--default">{r.category || "—"}</span>
                </td>
                <td>
                  <span className={`urgency-tag urgency-tag--${urgencyTag(r.urgency)}`}>
                    {urgencyLabel(r.urgency)}
                  </span>
                </td>
                <td className="text-xs text-slate-500">{r.createdAt}</td>
                <td>
                  <span className={`status-dot status-dot--${statusDot(r.status)}`} />
                  {statusLabel(r.status)}
                </td>
                <td style={{ textAlign: "right", color: "var(--c-brand)", fontWeight: 500 }}>
                  查看 →
                </td>
              </tr>
            ))}
            {data.data.length === 0 && (
              <tr>
                <td colSpan={8} className="empty-hint">
                  暂无匹配工单
                </td>
              </tr>
            )}
          </tbody>
        </table>

        <div className="pagination">
          <div className="pagination__info">
            显示第 <b>{start}</b> - <b>{end}</b> 条，共 <b>{data.total}</b> 条
          </div>
          <div className="pagination__controls">
            <button
              type="button"
              className="page-btn"
              disabled={page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              ‹
            </button>
            {pageNumbers(pages, page).map((p, i) =>
              p === "..." ? (
                <span key={`e-${i}`} style={{ padding: "0 4px", color: "var(--c-ink-3)" }}>
                  …
                </span>
              ) : (
                <button
                  key={p}
                  type="button"
                  className={`page-btn${page === p ? " is-active" : ""}`}
                  onClick={() => setPage(Number(p))}
                >
                  {p}
                </button>
              )
            )}
            <button
              type="button"
              className="page-btn"
              disabled={page >= pages}
              onClick={() => setPage((p) => Math.min(pages, p + 1))}
            >
              ›
            </button>
            <select
              className="page-size-select"
              value={size}
              onChange={(e) => {
                setSize(Number(e.target.value));
                setPage(1);
              }}
            >
              <option value="10">10 条/页</option>
              <option value="20">20 条/页</option>
              <option value="50">50 条/页</option>
            </select>
            <div className="page-jump">
              跳至
              <input
                type="text"
                value={jump}
                onChange={(e) => setJump(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    const n = parseInt(jump, 10);
                    if (n >= 1 && n <= pages) setPage(n);
                  }
                }}
              />
              页
            </div>
          </div>
        </div>
      </div>

      {/* 原生 Civic 抽屉（Drawer） */}
      <div className={`drawer-mask${drawer ? " is-open" : ""}`} onClick={() => setDrawer(null)} />
      <div className={`drawer${drawer ? " is-open" : ""}`}>
        <div className="drawer__head">
          <div>
            <div className="drawer__title">{drawer?.title || "工单详情"}</div>
            <div className="text-xs text-slate-400 font-mono mt-0.5">{drawer?.id}</div>
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
                <span className="info-row__label">工单编号</span>
                <span className="info-row__value font-mono">{drawer.id}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">紧急程度</span>
                <span className="info-row__value">{urgencyLabel(drawer.urgency)}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">业务类别</span>
                <span className="info-row__value">{drawer.category || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">所属镇街</span>
                <span className="info-row__value">{drawer.region || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">诉求时间</span>
                <span className="info-row__value">{drawer.createdAt}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">处置状态</span>
                <span className="info-row__value">{statusLabel(drawer.status)}</span>
              </div>
            </div>

            <div className="drawer__section">
              <div className="drawer__section-title">诉求正文</div>
              <div className="content-box">{drawer.content || "暂无详细正文"}</div>
            </div>

            <div className="drawer__section">
              <div className="drawer__section-title">快捷操作</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                {drawer.cluster_id ? (
                  <button
                    type="button"
                    className="btn btn--default flex items-center gap-1.5"
                    onClick={() => {
                      setDrawer(null);
                      router.push(
                        `/themes/${drawer.cluster_id}?ticketId=${encodeURIComponent(drawer.id)}&highlight=${encodeURIComponent(drawer.id)}#ticket-${encodeURIComponent(drawer.id)}`
                      );
                    }}
                  >
                    <Layers className="h-3.5 w-3.5 text-blue-600" />
                    <span>在多频群组中定位</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  className="btn btn--primary flex items-center gap-1.5"
                  style={{ marginLeft: "auto" }}
                  onClick={() => {
                    setDrawer(null);
                    router.push(`/tickets/${drawer.ticketId || drawer.id}`);
                  }}
                >
                  <span>打开完整页面</span>
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

function urgencyTag(u?: string) {
  if (u === "urgent" || u === "URGENT") return "urgent";
  if (u === "high" || u === "HIGH") return "high";
  if (u === "medium" || u === "NORMAL") return "medium";
  return "low";
}

function urgencyLabel(u?: string) {
  if (u === "urgent" || u === "URGENT") return "紧急";
  if (u === "high" || u === "HIGH") return "高";
  if (u === "medium" || u === "NORMAL") return "中";
  return "低";
}

function statusDot(s?: string) {
  if (s === "PENDING" || s === "未处理") return "pending";
  if (s === "PROGRESS" || s === "处置中" || s === "处理中") return "progress";
  if (s === "DONE" || s === "FINISHED" || s === "已办结") return "finished";
  return "pending";
}

function statusLabel(s?: string) {
  if (s === "PENDING" || s === "未处理") return "待处理";
  if (s === "PROGRESS" || s === "处置中" || s === "处理中") return "处理中";
  if (s === "DONE" || s === "FINISHED" || s === "已办结") return "已办结";
  return "待处理";
}

function pageNumbers(total: number, cur: number) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  if (cur <= 4) return [1, 2, 3, 4, 5, "...", total];
  if (cur >= total - 3) return [1, "...", total - 4, total - 3, total - 2, total - 1, total];
  return [1, "...", cur - 1, cur, cur + 1, "...", total];
}
