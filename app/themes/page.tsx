"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { URGENCY_META, type ClusterUrgency } from "@/lib/civic-cluster";
import { isTownLabel } from "@/lib/admin-area";
import { FolderKanban, Clock, Flame, CheckCircle2 } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

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
  status: { label: string; progress: number; owner: string };
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
  { key: "pending", label: "未处理" },
  { key: "progress", label: "处置中" },
  { key: "done", label: "已办结" },
  { key: "urgent", label: "紧急" },
] as const;

export default function ThemesPage() {
  const router = useRouter();
  const [rows, setRows] = useState<Cluster[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [tab, setTab] = useState("all");
  const [kw, setKw] = useState("");
  const [region, setRegion] = useState("");
  const [mode, setMode] = useState("");
  const [urgency, setUrgency] = useState("");
  const [page, setPage] = useState(1);
  const pageSize = 15;

  function load() {
    fetch("/api/clusters")
      .then((r) => r.json())
      .then((j) => {
        setRows(j.topClusters || []);
        setRegions((j.facets?.regions || []).filter((r: string) => isTownLabel(r)));
      })
      .catch(() => setRows([]));
  }

  useEffect(() => {
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, []);

  const counts = {
    all: rows.length,
    pending: rows.filter((r) => r.status.label === "未处理").length,
    progress: rows.filter((r) => r.status.label === "处置中").length,
    done: rows.filter((r) => r.status.label === "已办结").length,
    urgent: rows.filter((r) => r.urgency === "urgent").length,
  };

  const filtered = useMemo(() => {
    const arr = rows.filter((r) => {
      if (tab === "pending" && r.status.label !== "未处理") return false;
      if (tab === "progress" && r.status.label !== "处置中") return false;
      if (tab === "done" && r.status.label !== "已办结") return false;
      if (tab === "urgent" && r.urgency !== "urgent") return false;
      if (region && !r.region.includes(region)) return false;
      if (mode && r.mode !== mode) return false;
      if (urgency && r.urgency !== urgency) return false;
      if (kw && !`${r.type}${r.region}${r.title}${r.code}`.toLowerCase().includes(kw.toLowerCase())) return false;
      return true;
    });
    arr.sort((a, b) => {
      const sa = a.status.label === "未处理" ? 0 : a.status.label === "处置中" ? 1 : 2;
      const sb = b.status.label === "未处理" ? 0 : b.status.label === "处置中" ? 1 : 2;
      if (sa !== sb) return sa - sb;
      return b.count - a.count;
    });
    return arr;
  }, [rows, tab, kw, region, mode, urgency]);

  useEffect(() => {
    setPage(1);
  }, [tab, kw, region, mode, urgency]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const pageData = filtered.slice((page - 1) * pageSize, page * pageSize);

  function exportCsv() {
    const header = ["编号", "模式", "镇街", "类型", "标题", "工单数", "未处理", "紧急度", "持续天数", "置信度", "状态"];
    const lines = [header.join(",")].concat(
      filtered.map((g) =>
        [
          g.code,
          g.mode_name,
          g.region,
          g.type,
          `"${(g.title || "").replace(/"/g, '""')}"`,
          g.count,
          g.unprocessed,
          URGENCY_META[g.urgency].label,
          g.days,
          g.ai_confidence ?? "",
          g.status.label,
        ].join(",")
      )
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "clusters.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${filtered.length} 个群组`);
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">📋 群组中心</h1>
          <div className="page-hero__sub">AI 识别的多频工单群组 · 每行为一个群组，包含多条关联工单</div>
        </div>
        <div className="page-hero__actions">
          <button type="button" className="btn btn--default" onClick={exportCsv}>
            导出
          </button>
          <button type="button" className="btn btn--primary" onClick={load}>
            刷新数据
          </button>
        </div>
      </section>

      <StatCardGrid columns={4}>
        <StatCard
          icon={FolderKanban}
          tone="blue"
          label="总群组数"
          value={counts.all}
          sub="已识别多频主题"
          onClick={() => {
            setTab("all");
            load();
          }}
          className={tab === "all" ? "ring-2 ring-blue-500/30" : ""}
        />
        <StatCard
          icon={Clock}
          tone="red"
          label="未处理"
          value={counts.pending}
          sub="待处置群组"
          onClick={() => {
            setTab("pending");
            load();
          }}
          className={tab === "pending" ? "ring-2 ring-rose-500/30" : ""}
        />
        <StatCard
          icon={Flame}
          tone="orange"
          label="紧急"
          value={counts.urgent}
          sub="未处理工单较多"
          onClick={() => {
            setTab("urgent");
            load();
          }}
          className={tab === "urgent" ? "ring-2 ring-amber-500/30" : ""}
        />
        <StatCard
          icon={CheckCircle2}
          tone="green"
          label="已办结"
          value={counts.done}
          sub="处置完成"
          onClick={() => {
            setTab("done");
            load();
          }}
          className={tab === "done" ? "ring-2 ring-emerald-500/30" : ""}
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
              load();
            }}
          >
            {t.label}
            <span className="filter-tab__count">{counts[t.key]}</span>
          </button>
        ))}
      </div>

      <div className="filter-bar">
        <div className="search-input">
          <span>⌕</span>
          <input placeholder="搜索群组 · 镇街 / 类型 / 标题关键词" value={kw} onChange={(e) => setKw(e.target.value)} />
        </div>
        <div className="filter-bar__divider" />
        <Select
          value={region || "all"}
          onValueChange={(val) => {
            setRegion(val === "all" ? "" : val);
            load();
          }}
        >
          <SelectTrigger className="w-[130px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
            <SelectValue placeholder="镇街：全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">镇街：全部</SelectItem>
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
            load();
          }}
        >
          <SelectTrigger className="w-[135px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
            load();
          }}
        >
          <SelectTrigger className="w-[125px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
            <SelectValue placeholder="紧急度：全部" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">紧急度：全部</SelectItem>
            <SelectItem value="urgent">紧急</SelectItem>
            <SelectItem value="high">高</SelectItem>
            <SelectItem value="medium">中</SelectItem>
            <SelectItem value="low">低</SelectItem>
          </SelectContent>
        </Select>
        <span className="filter-bar__summary">共 {filtered.length} 条结果</span>
      </div>

      <table className="group-table">
        <thead>
          <tr>
            <th style={{ width: 90 }}>群组编号</th>
            <th style={{ width: 110 }}>模式</th>
            <th style={{ width: 120 }}>镇街 · 类型</th>
            <th>代表性标题</th>
            <th style={{ width: 80, textAlign: "right" }}>工单数</th>
            <th style={{ width: 70, textAlign: "right" }}>未处理</th>
            <th style={{ width: 70 }}>紧急度</th>
            <th style={{ width: 70, textAlign: "right" }}>持续天数</th>
            <th style={{ width: 110 }}>AI 置信度</th>
            <th style={{ width: 80 }}>状态</th>
            <th style={{ width: 60 }}>操作</th>
          </tr>
        </thead>
        <tbody>
          {pageData.map((g) => {
            const u = URGENCY_META[g.urgency];
            const sCls = g.status.label === "已办结" ? "status-tag--done" : g.status.label === "处置中" ? "status-tag--progress" : "status-tag--pending";
            const conf = g.ai_confidence;
            const confColor = conf == null ? "#86909C" : conf >= 90 ? "#52C41A" : conf >= 85 ? "#1677FF" : "#FF7D00";
            return (
              <tr key={g.id} onClick={() => router.push(`/themes/${g.id}`)}>
                <td style={{ fontFeatureSettings: "'tnum'", color: "var(--c-ink-3)", fontSize: 12 }}>{g.code || g.id.slice(0, 8)}</td>
                <td>
                  <span className={`mode-badge mode-badge--${g.mode}`}>
                    {g.mode_icon} {g.mode_name}
                  </span>
                </td>
                <td>
                  <div style={{ fontWeight: 500, color: "var(--c-ink)" }}>{g.region}</div>
                  <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>{g.type}</div>
                </td>
                <td>
                  <div style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--c-ink)" }}>
                    {g.title || `${g.region} · ${g.type}`}
                  </div>
                  <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                    {g.first_date} ~ {g.last_date}
                  </div>
                </td>
                <td style={{ textAlign: "right", fontWeight: 600, fontFeatureSettings: "'tnum'" }}>{g.count}</td>
                <td style={{ textAlign: "right", fontFeatureSettings: "'tnum'", color: g.unprocessed > 0 ? "#F53F3F" : "var(--c-ink-3)" }}>
                  {g.unprocessed}
                </td>
                <td>
                  <span className={`urgency-tag ${u.cls}`}>{u.label}</span>
                </td>
                <td style={{ textAlign: "right", fontFeatureSettings: "'tnum'" }}>{g.days} 天</td>
                <td>
                  {conf == null ? (
                    "—"
                  ) : (
                    <>
                      <span className="conf-bar">
                        <span className="conf-bar__fill" style={{ width: `${conf}%`, background: confColor, display: "block" }} />
                      </span>
                      <span style={{ fontSize: 12, fontWeight: 600, color: confColor }}>{conf}%</span>
                    </>
                  )}
                </td>
                <td>
                  <span className={`status-tag ${sCls}`}>{g.status.label}</span>
                </td>
                <td>
                  <span style={{ color: "var(--c-brand)", fontSize: 12 }}>查看 →</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {filtered.length === 0 && <div className="empty-hint">暂无群组。请先触发聚类研判。</div>}
      {filtered.length > 0 && (
        <div className="pagination" style={{ background: "transparent" }}>
          <div className="pagination__info">
            共 {filtered.length} 个群组 · 第 {page}/{pages} 页
          </div>
          <div className="pagination__controls">
            <button type="button" className="page-btn" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              ‹
            </button>
            <button type="button" className="page-btn is-active">
              {page}
            </button>
            <button type="button" className="page-btn" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
              ›
            </button>
          </div>
        </div>
      )}
    </>
  );
}
