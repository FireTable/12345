"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { toast } from "sonner";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { MODE_META } from "@/backend/theme-metrics";
import type { CivicMode } from "@/backend/state";
import { spanDays } from "@/lib/civic-cluster";
import { CivicEChart, radarOption } from "@/app/_components/civic/civic-charts";

type Member = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  createdAt: string;
  content: string;
  confidence: number | null;
};

type ClusterDetail = {
  success?: boolean;
  id: string;
  code?: string;
  type: string;
  region: string;
  count: number;
  mode: CivicMode;
  mode_name: string;
  mode_icon: string;
  mode_tagline?: string;
  mode_risk?: string;
  mode_advice?: string;
  title?: string;
  ai_confidence: number | null;
  first_date: string;
  last_date: string;
  trend: string;
  features: Array<{ name: string; pct: number; desc: string }>;
  radar: number[];
  status: { label: string; progress: number; owner: string; color: string; eta: string };
  members?: Member[];
};

const STEPS = [
  { key: "collect", name: "已收集" },
  { key: "dispatch", name: "已派单" },
  { key: "process", name: "处置中" },
  { key: "feedback", name: "待回访" },
  { key: "archive", name: "已归档" },
];

function asMode(m?: string): CivicMode {
  if (m === "repeat" || m === "diverge" || m === "aggregate") return m;
  return "aggregate";
}

export default function ThemeDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const [row, setRow] = useState<ClusterDetail | null>(null);
  const [load, setLoad] = useState<DetailLoadStatus>("pending");

  useEffect(() => {
    setLoad("pending");
    setRow(null);
    fetch(`/api/clusters/${params.id}`)
      .then((r) => r.json())
      .then((j) => {
        setRow(j);
        setLoad("done");
      })
      .catch(() => {
        setRow(null);
        setLoad("error");
      });
  }, [params.id]);

  const view = classifyDetailPayload(load, row);
  const mode = asMode(row?.mode);
  const meta = MODE_META[mode];
  const members = row?.members || [];
  const days = spanDays(row?.first_date, row?.last_date);
  const radarOpt = useMemo(() => radarOption(row?.radar || []), [row?.radar]);
  const firstMember = members[0];
  const doneSteps = Math.max(1, Math.min(5, Math.ceil((row?.status?.progress || 0) / 20)));

  if (view === "loading") {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/themes">群组中心</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <div className="empty-hint">加载中…</div>
      </>
    );
  }
  if (view === "missing" || !row) {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/themes">群组中心</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <div className="empty-hint">未找到该群组</div>
      </>
    );
  }

  const cluster = row;

  function stepTime(i: number) {
    const progress = cluster.status?.progress || 0;
    if (i === 0) return cluster.first_date || "—";
    if (i === 2 && progress >= 40) return cluster.last_date || "—";
    if (i === 4 && (cluster.status?.label === "已办结" || progress >= 100)) return cluster.status?.eta || cluster.last_date || "—";
    return "—";
  }

  function memberWhy(m: Member) {
    if (m.region && cluster.region && m.region === cluster.region && m.category && m.category === cluster.type) {
      return `同镇街「${m.region}」且类型「${m.category}」`;
    }
    if (m.region && cluster.region && m.region === cluster.region) return `同镇街「${m.region}」`;
    if (m.category && m.category === cluster.type) return `类型同为「${m.category}」`;
    return `已关联主题「${cluster.title || cluster.type}」`;
  }

  function exportReport() {
    const lines = [
      `群组 ${cluster.id}`,
      `${cluster.region} · ${cluster.type}`,
      `模式 ${cluster.mode_name}`,
      `件数 ${cluster.count}`,
      `区间 ${cluster.first_date} ~ ${cluster.last_date}`,
      `置信度 ${cluster.ai_confidence ?? "—"}`,
      "",
      ...members.map((m) => `${m.id}\t${m.title}`),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cluster.id}-report.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出群组报告");
  }

  return (
    <>
      <div className="breadcrumb">
        <Link href="/themes">群组中心</Link>
        <span>/</span>
        <Link href="/multifreq">多频透视</Link>
        <span>/</span>
        <span>
          {row.region} · {row.type}
        </span>
      </div>

      <div className={`cluster-hero cluster-hero--${mode}`}>
        <div className="cluster-hero__row">
          <div className="cluster-hero__icon">{meta.icon}</div>
          <div className="cluster-hero__main">
            <div className="cluster-hero__title">
              <span>
                {row.region} · {row.type}
              </span>
              <span className="hero-mode-badge">
                {meta.icon} {meta.name}
              </span>
              <span className="view-switch">
                {firstMember ? (
                  <Link href={`/tickets/${firstMember.ticketId}`}>单工单视图</Link>
                ) : (
                  <span style={{ padding: "6px 12px", opacity: 0.7 }}>单工单视图</span>
                )}
                <span className="is-active">群组视图</span>
              </span>
            </div>
            <div className="cluster-hero__sub">
              {meta.tagline}
              {row.title ? ` · ${row.title}` : ""}
            </div>
          </div>
        </div>

        <div className="cluster-hero__stats">
          <div className="cluster-hero__stat">
            <div className="cluster-hero__stat-val">{(row.count || 0).toLocaleString("zh-CN")}</div>
            <div className="cluster-hero__stat-label">整合工单数（件）</div>
          </div>
          <div className="cluster-hero__stat">
            <div className="cluster-hero__stat-val">{days}</div>
            <div className="cluster-hero__stat-label">持续天数（天）</div>
          </div>
          <div className="cluster-hero__stat">
            <div className="cluster-hero__stat-val">{row.ai_confidence == null ? "—" : `${row.ai_confidence}%`}</div>
            <div className="cluster-hero__stat-label">AI 聚类置信度</div>
          </div>
          <div className="cluster-hero__stat">
            <div className="cluster-hero__stat-val">{row.trend || "—"}</div>
            <div className="cluster-hero__stat-label">近 7 天趋势</div>
          </div>
        </div>

        <div className="cluster-hero__advice">
          <b>处置建议：</b>
          {row.mode_advice || meta.rule}
        </div>
        <div className="mode-explainer">
          <b>本群组模式：</b>
          {meta.icon} {meta.name}（{meta.tagline}） · <b>触发规则：</b>
          {row.mode_risk ? `${row.mode_risk} · ${meta.rule}` : meta.rule}
        </div>
      </div>

      <div className="cluster-grid">
        <div className="card">
          <div className="card__header">
            <div className="card__title">
              📑 群组成员工单
              <span style={{ fontSize: 12, color: "var(--c-ink-3)", fontWeight: 400, marginLeft: 6 }}>
                共 {row.count} 件 · 展示 {members.length} 件
              </span>
            </div>
            <div style={{ fontSize: 12, color: "var(--c-ink-3)" }}>点击查看原始工单</div>
          </div>
          <div className="card__body" style={{ padding: "14px 18px" }}>
            {members.length === 0 && <div className="empty-hint">暂无成员工单</div>}
            {members.map((m) => (
              <div key={m.ticketId} className="member-item" onClick={() => router.push(`/tickets/${m.ticketId}`)}>
                <div className="member-item__head">
                  <span className="member-item__id">#{m.id}</span>
                  <span className="member-item__match">
                    {m.confidence == null ? "待研判" : `🤖 抽取置信度 ${m.confidence}%`}
                  </span>
                  <span style={{ marginLeft: "auto", fontSize: 12, color: "var(--c-ink-3)" }}>{m.createdAt}</span>
                </div>
                <div className="member-item__title">{m.title}</div>
                <div className="member-item__content">{m.content || "—"}</div>
                <div className="member-item__why">
                  <span>🔎</span>
                  <span>
                    归入原因：<b>{memberWhy(m)}</b>
                  </span>
                  <Link href={`/tickets/${m.ticketId}`} style={{ marginLeft: "auto", color: "#1E5AFF", fontWeight: 500 }} onClick={(e) => e.stopPropagation()}>
                    查看 →
                  </Link>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <div className="card__title">📌 群组基本信息</div>
            </div>
            <div className="card__body" style={{ padding: "8px 18px" }}>
              <div className="info-row">
                <span className="info-row__label">群组编号</span>
                <span className="info-row__value">{row.code || row.id}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">群组类型</span>
                <span className="info-row__value">
                  {meta.icon} {row.type}
                </span>
              </div>
              <div className="info-row">
                <span className="info-row__label">所属镇街</span>
                <span className="info-row__value">{row.region || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">开始时间</span>
                <span className="info-row__value">{row.first_date || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">最近工单</span>
                <span className="info-row__value">{row.last_date || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">责任部门</span>
                <span className="info-row__value">{row.status?.owner || "—"}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <div className="card__title">🤖 AI 聚类研判依据</div>
            </div>
            <div className="card__body" style={{ padding: "8px 18px 14px" }}>
              <div className="feature-list">
                {(row.features || []).length === 0 && <div className="empty-hint">暂无特征（尚未落库）</div>}
                {(row.features || []).map((f) => (
                  <div key={f.name} className="feature-list__item">
                    <div className="feature-list__head">
                      <span>
                        {f.name} <span style={{ color: "var(--c-ink-3)", fontSize: 11 }}>{f.desc || ""}</span>
                      </span>
                      <span style={{ fontWeight: 600, color: "#1E5AFF" }}>{f.pct}%</span>
                    </div>
                    <div className="feature-list__bar">
                      <div className="feature-list__fill" style={{ width: `${f.pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginBottom: 6 }}>匹配五维</div>
                {row.radar?.length ? <CivicEChart option={radarOpt} height={200} /> : <div className="empty-hint">暂无雷达数据</div>}
              </div>
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 12, color: "var(--c-ink-3)", marginBottom: 6 }}>归入本群组的核心原因</div>
                <ul className="ai-reason-list">
                  {meta.reasons.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <div className="card__title">
                ⏱ 群组处理进度
                <span
                  style={{
                    marginLeft: 8,
                    fontSize: 12,
                    padding: "2px 10px",
                    borderRadius: 999,
                    background: `${row.status?.color || "#1677FF"}18`,
                    color: row.status?.color || "#1677FF",
                  }}
                >
                  {row.status?.label || "未处理"}
                </span>
              </div>
            </div>
            <div className="card__body" style={{ padding: "8px 18px 14px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
                <div style={{ fontSize: 24, fontWeight: 700 }}>{row.status?.progress ?? 0}%</div>
                <div style={{ flex: 1 }}>
                  <div className="progress-bar">
                    <div
                      className="progress-bar__fill"
                      style={{
                        width: `${row.status?.progress ?? 0}%`,
                        background: `linear-gradient(90deg, ${row.status?.color || "#1677FF"} 0%, #4B7BFF 100%)`,
                      }}
                    />
                  </div>
                </div>
              </div>
              {STEPS.map((s, i) => (
                <div key={s.key} className="progress-step">
                  <span
                    className={`progress-step__dot${i < doneSteps - 1 ? " progress-step__dot--done" : i === doneSteps - 1 ? " progress-step__dot--current" : ""}`}
                  />
                  <span className="progress-step__label">
                    {i + 1}. {s.name}
                  </span>
                  <span className="progress-step__time">{stepTime(i)}</span>
                </div>
              ))}
              <div className="info-row" style={{ marginTop: 6 }}>
                <span className="info-row__label">预计办结</span>
                <span className="info-row__value">{row.status?.eta || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">牵头部门</span>
                <span className="info-row__value">{row.status?.owner || "—"}</span>
              </div>
            </div>
          </div>

          <div className="action-row">
            <button type="button" className="btn btn--default" onClick={() => toast.info(row.status?.owner ? `牵头部门：${row.status.owner}` : "尚未指定责任部门")}>
              联系部门
            </button>
            <button type="button" className="btn btn--default" onClick={() => toast.success("已记录升级处置意向（演示）")}>
              升级处置
            </button>
            <button type="button" className="btn btn--primary" onClick={exportReport}>
              生成群组报告
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
