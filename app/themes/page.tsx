"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { URGENCY_META, type ClusterUrgency } from "@/lib/civic-cluster";
import { isTownLabel } from "@/lib/admin-area";
import { FolderKanban, Clock, Flame, CheckCircle2 } from "lucide-react";
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
  { key: "pending", label: "未处理" },
  { key: "progress", label: "处置中" },
  { key: "done", label: "已办结" },
  { key: "urgent", label: "紧急" },
] as const;

export default function ThemesPage() {
  const router = useRouter();
  const { activeRegion } = useRegion();
  const [rows, setRows] = useState<Cluster[]>([]);
  const [regions, setRegions] = useState<string[]>([]);
  const [tab, setTab] = useState("all");
  const [kw, setKw] = useState("");
  const [region, setRegion] = useState("");
  const [mode, setMode] = useState("");
  const [urgency, setUrgency] = useState("");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(15);
  const [ready, setReady] = useState(false);

  function load() {
    // 站点由 cookie 决定。region 查询参数是镇街名，传站点 id 会把列表滤空。
    fetch("/api/clusters")
      .then((r) => r.json())
      .then((j) => {
        setRows(j.topClusters || []);
        setRegions((j.facets?.regions || []).filter((r: string) => isTownLabel(r) || r === "未知"));
      })
      .catch(() => setRows([]))
      .finally(() => setReady(true));
  }

  useEffect(() => {
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, [activeRegion?.id]);

  const counts = {
    all: rows.length,
    pending: rows.filter((r) => (r.status.code || HANDLING_STATUS.PENDING) === HANDLING_STATUS.PENDING).length,
    progress: rows.filter((r) => r.status.code === HANDLING_STATUS.IN_PROGRESS).length,
    done: rows.filter((r) => r.status.code === HANDLING_STATUS.RESOLVED).length,
    urgent: rows.filter((r) => r.urgency === "urgent").length,
  };

  const filtered = useMemo(() => {
    const arr = rows.filter((r) => {
      const code = r.status.code || normalizeStatusCode(r.status.label);
      if (tab === "pending" && code !== HANDLING_STATUS.PENDING) return false;
      if (tab === "progress" && code !== HANDLING_STATUS.IN_PROGRESS) return false;
      if (tab === "done" && code !== HANDLING_STATUS.RESOLVED) return false;
      if (tab === "urgent" && r.urgency !== "urgent") return false;
      if (region && !r.region.includes(region)) return false;
      if (mode && r.mode !== mode) return false;
      if (urgency && r.urgency !== urgency) return false;
      if (kw && !`${r.type}${r.region}${r.title}${r.code}`.toLowerCase().includes(kw.toLowerCase())) return false;
      return true;
    });
    const statusOrder: Record<string, number> = { PENDING: 0, IN_PROGRESS: 1, RESOLVED: 2 };
    arr.sort((a, b) => {
      const sa = statusOrder[a.status.code || "PENDING"] ?? 0;
      const sb = statusOrder[b.status.code || "PENDING"] ?? 0;
      if (sa !== sb) return sa - sb;
      return b.count - a.count;
    });
    return arr;
  }, [rows, tab, region, mode, urgency, kw]);

  const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
  const currentPage = Math.min(page, pages);
  const pageData = filtered.slice((currentPage - 1) * pageSize, currentPage * pageSize);

  function exportCsv() {
    const header = ["编号", "模式", "镇街", "类型", "代表标题", "工单数", "未处理", "紧急度", "持续天数", "置信度", "状态"];
    const lines = [header.join(",")].concat(
      filtered.map((g) => [
        g.code,
        g.mode_name,
        g.region,
        g.type,
        `"${(g.title || "").replace(/"/g, '""')}"`,
        g.count,
        g.unprocessed,
        URGENCY_META[g.urgency]?.label || g.urgency,
        g.days,
        g.ai_confidence == null ? "" : `${g.ai_confidence}%`,
        g.status.label,
      ].join(","))
    );
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "multi-frequency-themes.csv";
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`已导出 ${filtered.length} 个群组`);
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">多频工单</h1>
          <div className="page-hero__sub">
            {activeRegion ? `${activeRegion.name} · ` : ""}AI 识别的多频工单群组 · 每行为一个群组，包含多条关联工单
          </div>
        </div>
        <div className="page-hero__actions">
          <button type="button" className="btn btn--default" onClick={exportCsv}>
            导出
          </button>
          <button type="button" className="btn btn--primary" onClick={load}>
            刷新
          </button>
        </div>
      </section>

      {!ready ? (
        <SkThemes />
      ) : (
        <>
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
              tone="orange"
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

          <div className="card list-card">
            <div className="list-card__head">
              <div>
                <div className="list-card__title">多频工单群组列表</div>
                <div className="list-card__sub">点击行进入群组全景研判视图</div>
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
                <input
                  placeholder="搜索群组 · 镇街 / 类型 / 标题关键词"
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
                  setPage(1);
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
                  setPage(1);
                  load();
                }}
              >
                <SelectTrigger className="w-[125px] h-[32px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
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
              <span className="filter-bar__summary">共 {filtered.length} 条结果</span>
            </div>

            <div className="table-scroll">
              <table className="group-table">
                <thead>
                  <tr>
                    <th style={{ width: 90, minWidth: 80 }}>群组编号</th>
                    <th style={{ width: 130, minWidth: 120 }}>研判模式</th>
                    <th style={{ width: 130, minWidth: 130 }}>辖区 · 业务</th>
                    <th>代表性诉求标题</th>
                    <th style={{ width: 110, textAlign: "center" }}>待处理 / 总数</th>
                    <th style={{ width: 80, textAlign: "center" }}>紧急度</th>
                    <th style={{ width: 85, textAlign: "right" }}>持续天数</th>
                    <th style={{ width: 85 }}>处置状态</th>
                    <th style={{ width: 75, textAlign: "right" }}>操作</th>
                  </tr>
                </thead>
                <tbody>
                  {pageData.map((g) => {
                    const u = URGENCY_META[g.urgency];
                    const statusCode = g.status.code || normalizeStatusCode(g.status.label);
                    const sCls = statusCode === HANDLING_STATUS.RESOLVED ? "status-tag--done" : statusCode === HANDLING_STATUS.IN_PROGRESS ? "status-tag--progress" : "status-tag--pending";
                    return (
                      <tr key={g.id} onClick={() => router.push(`/themes/${g.id}`)} className="hover:bg-blue-50/40 transition-colors">
                        <td style={{ fontFeatureSettings: "'tnum'", color: "var(--c-ink-3)", fontSize: 12 }} className="font-mono">
                          {g.code || g.id.slice(0, 8)}
                        </td>
                        <td>
                          <span className={`mode-badge mode-badge--${g.mode}`}>
                            {g.mode_icon} {g.mode_name}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--c-ink)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {g.region}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--c-ink-3)", marginTop: 2, whiteSpace: "nowrap" }}>
                            {g.type}
                          </div>
                        </td>
                        <td>
                          <div
                            style={{ maxWidth: "min(42vw, 560px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "var(--c-ink)", fontSize: 13 }}
                            title={g.title || `${g.region} · ${g.type}`}
                          >
                            {g.title || `${g.region} · ${g.type}`}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--c-ink-3)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                            {g.first_date} ~ {g.last_date}
                          </div>
                        </td>
                        <td style={{ textAlign: "center", fontFeatureSettings: "'tnum'" }}>
                          <span style={{ fontWeight: 700, color: g.unprocessed > 0 ? "#F53F3F" : "var(--c-ink-3)", fontSize: 13 }}>
                            {g.unprocessed}
                          </span>
                          <span style={{ color: "#94A3B8", margin: "0 3px", fontSize: 12 }}>/</span>
                          <span style={{ fontWeight: 600, color: "#1E293B", fontSize: 13 }}>
                            {g.count}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className={`urgency-tag ${u.cls}`}>{u.label}</span>
                        </td>
                        <td style={{ textAlign: "right", fontFeatureSettings: "'tnum'", color: "var(--c-ink-2)" }}>
                          {g.days} 天
                        </td>
                        <td>
                          <span className={`status-tag ${sCls}`}>{g.status.label}</span>
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <span style={{ color: "var(--c-brand)", fontWeight: 500, fontSize: 12 }}>查看</span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {filtered.length === 0 && <div className="empty-hint">暂无群组。请先触发聚类研判。</div>}
            {filtered.length > 0 && (
              <TablePager
                page={currentPage}
                pages={pages}
                total={filtered.length}
                pageSize={pageSize}
                pageSizeOptions={[10, 15, 20, 50]}
                itemLabel="个多频群组"
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
