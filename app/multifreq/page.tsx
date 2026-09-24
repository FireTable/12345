"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { ShundeMap } from "@/app/_components/civic/shunde-map";
import { QuadrantBoard } from "@/app/_components/civic/quadrant";
import type { ClusterUrgency } from "@/lib/civic-cluster";
import { clampTimeRef, formatYmd, inTimeWindow } from "@/lib/civic-time";
import { isTownLabel } from "@/lib/admin-area";
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
  type: string;
  region: string;
  count: number;
  mode: "aggregate" | "repeat" | "diverge";
  mode_name: string;
  mode_icon: string;
  ai_confidence: number | null;
  status: { label: string };
  trend: string;
  title: string;
  urgency: ClusterUrgency;
  unprocessed: number;
  communities: number;
  sample_titles?: string[];
  first_date?: string;
  last_date?: string;
};

type Overview = { regionDistribution?: Record<string, number> };

function MultifreqChrome() {
  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">多频工单实时透势</h1>
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

  const pending = filtered.filter((r) => r.status.label === "未处理");
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
    const set = new Set(rows.map((r) => r.region).filter((n) => isTownLabel(n)));
    return [...set].sort((a, b) => a.localeCompare(b, "zh-CN"));
  }, [rows]);

  const top5 = [...filtered].sort((a, b) => b.count - a.count).slice(0, 5);

  function cycleTime() {
    const times = ["近 7 天", "近 30 天", "近 90 天", "全部"];
    const idx = times.indexOf(timeLabel);
    const next = times[idx === -1 ? 0 : (idx + 1) % times.length];
    setTimeLabel(next);
    if (next === "近 7 天") setWindowDays(7);
    else if (next === "近 30 天") setWindowDays(30);
    else if (next === "近 90 天") setWindowDays(90);
    load();
  }

  return (
    <>
      <section className="page-hero">
        <div>
          <h1 className="page-hero__title">
            多频工单实时透势
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
            <ShundeMap
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
        <table className="workorder-table">
          <thead>
            <tr>
              <th style={{ width: 55 }}>排名</th>
              <th style={{ width: 213 }}>辖区</th>
              <th style={{ width: 95 }}>业务类型</th>
              <th style={{ width: 125 }}>研判模式</th>
              <th>代表性诉求标题</th>
              <th style={{ width: 70, textAlign: "right" }}>工单数</th>
              <th style={{ width: 125 }}>AI 置信度</th>
              <th style={{ width: 85 }}>风险等级</th>
              <th style={{ width: 65, textAlign: "center" }}>趋势</th>
              <th style={{ width: 75, textAlign: "center" }}>涉社区</th>
              <th style={{ width: 45, textAlign: "right" }} />
            </tr>
          </thead>
          <tbody>
            {top5.map((c, i) => {
              const risk = c.urgency === "urgent" ? "urgent" : i < 3 ? "medium" : "low";
              const riskText = c.urgency === "urgent" ? "紧急" : i < 3 ? "较急" : "普通";
              const conf = c.ai_confidence;
              return (
                <tr key={c.id} onClick={() => router.push(`/themes/${c.id}`)}>
                  <td>
                    <span className={`rank-badge rank-badge--${i + 1}`}>{i + 1}</span>
                  </td>
                  <td>
                    <span className="font-semibold text-slate-800 text-xs">{c.region || "—"}</span>
                  </td>
                  <td>
                    <span className={`badge-pill ${catPill(c.type)}`}>{c.type}</span>
                  </td>
                  <td>
                    <span className={`mode-badge mode-badge--${c.mode}`}>
                      {c.mode_icon} {c.mode_name}
                    </span>
                  </td>
                  <td>
                    <div
                      className="font-medium text-slate-900 text-xs line-clamp-1"
                      style={{ maxWidth: "min(35vw, 480px)" }}
                      title={c.sample_titles?.[0] || c.title || `${c.region} · ${c.type}`}
                    >
                      {c.sample_titles?.[0] || c.title || `${c.region} · ${c.type}`}
                    </div>
                  </td>
                  <td style={{ fontWeight: 700, fontFeatureSettings: "'tnum'", textAlign: "right", color: "#1E293B" }}>
                    {c.count}
                  </td>
                  <td>
                    {conf == null ? (
                      "—"
                    ) : (
                      <div className="conf-inline">
                        <span className="conf-bar conf-bar--wide">
                          <span className="conf-bar__fill" style={{ width: `${conf}%`, display: "block" }} />
                        </span>
                        <span style={{ fontWeight: 600 }}>{conf}%</span>
                      </div>
                    )}
                  </td>
                  <td>
                    <span className={`risk-pill risk-pill--${risk}`}>
                      <span className="risk-pill__dot" />
                      {riskText}
                    </span>
                  </td>
                  <td style={{ textAlign: "center" }}>
                    <span className="trend-up">{c.trend || "—"}</span>
                  </td>
                  <td style={{ textAlign: "center", color: "var(--c-ink-3)", fontFeatureSettings: "'tnum'" }}>
                    {c.communities ? `${c.communities} 个` : `${Math.max(1, Math.ceil(c.count / 3))} 个`}
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <span className="row-arrow">→</span>
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

function catPill(cat?: string) {
  if (!cat) return "badge-pill--default";
  if (cat.includes("生态") || cat.includes("环保")) return "badge-pill--success";
  if (cat.includes("劳动") || cat.includes("劳资")) return "badge-pill--warning";
  if (cat.includes("市场") || cat.includes("消费")) return "badge-pill--danger";
  if (cat.includes("城市") || cat.includes("城管")) return "badge-pill--info";
  return "badge-pill--default";
}
