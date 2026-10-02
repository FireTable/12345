"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { CivicMap } from "@/app/_components/civic/civic-map";
import { QuadrantBoard } from "@/app/_components/civic/quadrant";
import { URGENCY_META, type ClusterUrgency } from "@/lib/civic-cluster";
import { clampTimeRef, formatYmd, inTimeWindow } from "@/lib/civic-time";
import { isTownLabel } from "@/lib/admin-area";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { Clock, TrendingUp, Flame, Layers } from "lucide-react";
import { StatCard, StatCardGrid } from "@/app/_components/civic/stat-card";
import { SkMultifreq } from "@/app/_components/civic/skeletons";
import { useRegion } from "@/app/_components/civic/region-context";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

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
  const { activeRegion } = useRegion();
  const [rows, setRows] = useState<Cluster[]>([]);
  const [ov, setOv] = useState<Overview | null>(null);
  const [region, setRegion] = useState(search.get("region") || "");
  const [timeLabel, setTimeLabel] = useState("近 7 天");
  const [thresholdOpen, setThresholdOpen] = useState(false);
  const [confMin, setConfMin] = useState(85);
  const [minCount, setMinCount] = useState(2);
  const [windowDays, setWindowDays] = useState(7);
  const [ready, setReady] = useState(false);

  function load() {
    Promise.all([fetch("/api/clusters").then((r) => r.json()), fetch("/api/overview").then((r) => r.json())])
      .then(([c, o]) => {
        setRows(c.topClusters || []);
        setOv(o);
      })
      .catch(() => setRows([]))
      .finally(() => setReady(true));
  }

  useEffect(() => {
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, []);

  const filtered = useMemo(() => {
    const latestStr = rows.reduce((acc, r) => {
      const d = r.last_date || r.first_date || "";
      return d > acc ? d : acc;
    }, "");
    const ref = clampTimeRef(latestStr ? new Date(latestStr.replace(" ", "T")) : null);
    return rows.filter((r) => {
      if (region && !r.region.includes(region)) return false;
      if ((r.ai_confidence ?? 100) < confMin) return false;
      if (r.count < minCount) return false;
      if (!inTimeWindow(r.last_date || r.first_date, timeLabel, ref)) return false;
      return true;
    });
  }, [rows, region, confMin, minCount, timeLabel]);

  const pending = filtered.filter((r) => r.status.code ? r.status.code === "PENDING" : r.status.label === "未处理");
  const urgent = filtered.filter((r) => r.urgency === "urgent");
  const latestStr = rows.reduce((acc, r) => {
    const d = r.last_date || r.first_date || "";
    return d > acc ? d : acc;
  }, "");
  const todayKey = formatYmd(clampTimeRef(latestStr ? new Date(latestStr.replace(" ", "T")) : null));
  const todayNew = filtered.filter((r) => r.last_date === todayKey || r.first_date === todayKey).length;

  const clusterByRegion: Record<string, number> = {};
  for (const r of filtered) {
    if (r.region) clusterByRegion[r.region] = (clusterByRegion[r.region] || 0) + 1;
  }

  const regions = useMemo(() => {
    const set = new Set(rows.map((r) => r.region).filter((n) => isTownLabel(n) || n === "未知"));
    const list = [...set].filter((n) => n !== "未知").sort((a, b) => a.localeCompare(b, "zh-CN"));
    if (set.has("未知")) list.push("未知");
    return list;
  }, [rows]);

  const top5 = [...filtered].sort((a, b) => b.count - a.count).slice(0, 5);

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
    load();
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">
            工单透势
          </h1>
          <div className="page-hero__sub">实时识别 · AI 自动聚类 · 置信度 ≥ {confMin}%</div>
        </div>
        <div className="page-hero__actions">
          <button type="button" className="btn btn--default" onClick={cycleTime}>
            {timeLabel}
          </button>
          <Select
            value={region || "all"}
            onValueChange={(val) => {
              setRegion(val === "all" ? "" : val);
              load();
            }}
          >
            <SelectTrigger className="w-[125px] h-[34px] bg-[var(--c-surface)] border-[var(--c-border)] text-xs text-[var(--c-ink-2)] font-medium rounded-lg">
              <SelectValue placeholder="全部镇街" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">全部镇街</SelectItem>
              {regions.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" className="btn btn--default" onClick={() => setThresholdOpen(true)}>
            阈值设置
          </button>
          <button type="button" className="icon-circle" title="刷新" onClick={load}>
            ↻
          </button>
        </div>
      </section>

      {!ready ? (
        <SkMultifreq />
      ) : (
        <>
          <StatCardGrid columns={4}>
            <StatCard
              icon={Clock}
              tone="blue"
              label="未处理"
              value={pending.length}
              sub="待派单协同处置"
            />
            <StatCard
              icon={TrendingUp}
              tone="orange"
              label="今日新增"
              value={todayNew}
              sub="24小时内新识别"
            />
            <StatCard
              icon={Flame}
              tone="red"
              label="紧急群组"
              value={urgent.length}
              sub="高风险优先跟进"
            />
            <StatCard
              icon={Layers}
              tone="purple"
              label="多频总量"
              value={filtered.length}
              sub="当前筛选主题总计"
            />
          </StatCardGrid>

          <section className="split-row split-row--map">
            <div className="card">
              <div className="card__header">
                <div className="card__title">{activeRegion ? activeRegion.name : "全区"}多频工单地理透势</div>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>点击镇街筛选 · 悬停查看详情</div>
              </div>
              <div className="card__body" style={{ padding: 8, paddingTop: 40, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 460 }}>
                <CivicMap
                  counts={ov?.regionDistribution || {}}
                  clusterCounts={clusterByRegion}
                  selected={region}
                  onSelect={(name) => {
                    setRegion(name);
                    load();
                  }}
                />
              </div>
            </div>
            <div className="card">
              <div className="card__header">
                <div className="card__title">未处理群组 · 紧急 × 重要 四象限</div>
                <div style={{ fontSize: 11, color: "var(--c-ink-3)" }}>
                  共 <b style={{ color: "#1E5AFF" }}>{pending.length}</b> 个未处理群组
                </div>
              </div>
              <div className="card__body" style={{ padding: 8, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 460 }}>
                {pending.length === 0 ? (
                  <div className="empty-hint">暂无未处理群组。请先启动 Agent 研判。</div>
                ) : (
                  <QuadrantBoard clusters={filtered} />
                )}
              </div>
            </div>
          </section>

          <section className="card" style={{ marginTop: 20 }}>
            <div className="top5-header">
              <div className="top5-header__title">
                <span style={{ color: "#F53F3F" }}>🔥</span>
                TOP 5 多频聚类
                <span style={{ fontSize: 12, color: "var(--c-ink-3)", fontWeight: 400, marginLeft: 6 }}>点击下钻到详情</span>
              </div>
              <button type="button" className="top5-header__more" onClick={() => router.push("/themes")}>
                查看全部 {filtered.length} 个聚类 →
              </button>
            </div>
            <div className="table-scroll">
              <table className="group-table">
                <thead>
                  <tr>
                    <th style={{ width: 55, minWidth: 45, textAlign: "center" }}>排名</th>
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
                  {top5.map((c, i) => {
                    const u = URGENCY_META[c.urgency] || { label: "普通", cls: "urgency-tag--low" };
                    const statusCode = c.status.code || normalizeStatusCode(c.status.label);
                    const sCls = statusCode === HANDLING_STATUS.RESOLVED ? "status-tag--done" : statusCode === HANDLING_STATUS.IN_PROGRESS ? "status-tag--progress" : "status-tag--pending";
                    return (
                      <tr key={c.id} onClick={() => router.push(`/themes/${c.id}`)} className="hover:bg-blue-50/40 transition-colors">
                        <td style={{ textAlign: "center" }}>
                          <span className={`rank-badge rank-badge--${i + 1}`}>{i + 1}</span>
                        </td>
                        <td style={{ fontFeatureSettings: "'tnum'", color: "var(--c-ink-3)", fontSize: 12 }} className="font-mono">
                          {c.code || c.id.slice(0, 8)}
                        </td>
                        <td>
                          <span className={`mode-badge mode-badge--${c.mode}`}>
                            {c.mode_icon} {c.mode_name}
                          </span>
                        </td>
                        <td>
                          <div style={{ fontWeight: 600, color: "var(--c-ink)", fontSize: 12, whiteSpace: "nowrap" }}>
                            {c.region}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--c-ink-3)", marginTop: 2, whiteSpace: "nowrap" }}>
                            {c.type}
                          </div>
                        </td>
                        <td>
                          <div
                            style={{ maxWidth: "min(38vw, 520px)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontWeight: 600, color: "var(--c-ink)", fontSize: 13 }}
                            title={c.title || c.sample_titles?.[0] || `${c.region} · ${c.type}`}
                          >
                            {c.title || c.sample_titles?.[0] || `${c.region} · ${c.type}`}
                          </div>
                          <div style={{ fontSize: 11, color: "var(--c-ink-3)", marginTop: 2, fontFamily: "ui-monospace, monospace" }}>
                            {c.first_date || "—"} ~ {c.last_date || "—"}
                          </div>
                        </td>
                        <td style={{ textAlign: "center", fontFeatureSettings: "'tnum'" }}>
                          <span style={{ fontWeight: 700, color: c.unprocessed > 0 ? "#F53F3F" : "var(--c-ink-3)", fontSize: 13 }}>
                            {c.unprocessed}
                          </span>
                          <span style={{ color: "#94A3B8", margin: "0 3px", fontSize: 12 }}>/</span>
                          <span style={{ fontWeight: 600, color: "#1E293B", fontSize: 13 }}>
                            {c.count}
                          </span>
                        </td>
                        <td style={{ textAlign: "center" }}>
                          <span className={`urgency-tag ${u.cls}`}>{u.label}</span>
                        </td>
                        <td style={{ textAlign: "right", fontFeatureSettings: "'tnum'", color: "var(--c-ink-2)" }}>
                          {c.days ?? 1} 天
                        </td>
                        <td>
                          <span className={`status-tag ${sCls}`}>{c.status.label}</span>
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
            {top5.length === 0 && <div className="empty-hint">暂无多频群组。请先启动 Agent 研判。</div>}
          </section>
        </>
      )}

      <div className={`modal-mask${thresholdOpen ? " is-open" : ""}`} onClick={() => setThresholdOpen(false)}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal__header">
            <div className="modal__title">⚙ AI 识别阈值</div>
            <button type="button" className="modal__close" onClick={() => setThresholdOpen(false)}>
              ×
            </button>
          </div>
          <div className="modal__body">
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>最低置信度</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-brand)" }}>{confMin}%</span>
              </div>
              <input type="range" min={50} max={99} value={confMin} onChange={(e) => setConfMin(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div style={{ marginBottom: 20 }}>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>最小工单数</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-brand)" }}>{minCount}</span>
              </div>
              <input type="range" min={2} max={20} value={minCount} onChange={(e) => setMinCount(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 6 }}>
                <span style={{ fontSize: 13 }}>时间窗口（天）</span>
                <span style={{ fontSize: 13, fontWeight: 600, color: "var(--c-brand)" }}>{windowDays}</span>
              </div>
              <input type="range" min={3} max={90} value={windowDays} onChange={(e) => setWindowDays(Number(e.target.value))} style={{ width: "100%" }} />
            </div>
          </div>
          <div className="modal__footer">
            <button type="button" className="btn btn--default" onClick={() => setThresholdOpen(false)}>
              取消
            </button>
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                setTimeLabel(`近 ${windowDays} 天`);
                setThresholdOpen(false);
                toast.success("阈值已保存，列表已按新阈值过滤");
              }}
            >
              保存设置
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

