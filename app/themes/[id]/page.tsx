"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { MODE_META } from "@/backend/theme-metrics";
import type { CivicMode } from "@/backend/state";
import { spanDays } from "@/lib/civic-cluster";
import { CivicEChart, radarOption } from "@/app/_components/civic/civic-charts";
import {
  FileText,
  MapPin,
  Tag,
  Clock,
  Sparkles,
  ChevronDown,
  ChevronUp,
  Target,
  Building2,
  Phone,
  User,
} from "lucide-react";

type Member = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  createdAt: string;
  content: string;
  confidence: number | null;
  caller_name?: string;
  caller_phone?: string;
  address?: string;
  urgency?: string;
  status?: string;
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

function asMode(m?: string): CivicMode {
  if (m === "repeat" || m === "diverge" || m === "aggregate") return m;
  return "aggregate";
}

function ThemeDetailInner() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const targetTicketId = (searchParams.get("ticketId") || searchParams.get("highlight") || "").trim();

  const [row, setRow] = useState<ClusterDetail | null>(null);
  const [load, setLoad] = useState<DetailLoadStatus>("pending");
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});

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

  // 自动滚动并锚点定位到目标工单
  useEffect(() => {
    if (targetTicketId && members.length > 0) {
      // 默认展开目标工单
      setExpandedMap((prev) => ({ ...prev, [targetTicketId]: true }));

      const timer = setTimeout(() => {
        const el =
          document.getElementById(`ticket-${targetTicketId}`) ||
          document.getElementById(targetTicketId);
        if (el) {
          el.scrollIntoView({ behavior: "smooth", block: "center" });
        }
      }, 300);
      return () => clearTimeout(timer);
    }
  }, [targetTicketId, members]);

  const toggleExpand = (id: string) => {
    setExpandedMap((prev) => ({ ...prev, [id]: !prev[id] }));
  };

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

  function memberWhy(m: Member) {
    if (m.region && cluster.region && m.region === cluster.region && m.category && m.category === cluster.type) {
      return `同镇街「${m.region}」且诉求分类「${m.category}」`;
    }
    if (m.region && cluster.region && m.region === cluster.region) return `同属顺德区「${m.region}」`;
    if (m.category && m.category === cluster.type) return `诉求分类同为「${m.category}」`;
    return `已深度关联主题「${cluster.title || cluster.type}」`;
  }

  function exportReport() {
    const lines = [
      `群组编号: ${cluster.code || cluster.id}`,
      `业务领域: ${cluster.region} · ${cluster.type}`,
      `多频模式: ${cluster.mode_name}`,
      `工单件数: ${cluster.count}`,
      `时间跨度: ${cluster.first_date} ~ ${cluster.last_date}`,
      `AI置信度: ${cluster.ai_confidence ?? "—"}%`,
      `态势综述: ${cluster.title || "—"}`,
      `处置建议: ${cluster.mode_advice || "—"}`,
      "",
      "【关联诉求工单清单】",
      ...members.map((m, i) => `${i + 1}. [${m.id}] ${m.title} (${m.createdAt})`),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${cluster.id}-多频群组研判报告.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已导出群组研判报告");
  }

  return (
    <>
      <div className="breadcrumb">
        <Link href="/themes">群组中心</Link>
        <span>/</span>
        <span>{cluster.code || cluster.id}</span>
      </div>

      <div className="cluster-hero">
        <div className="cluster-hero__header">
          <div className="cluster-hero__icon">{meta.icon}</div>
          <div className="cluster-hero__info">
            <div className="cluster-hero__title-row">
              <span className="cluster-hero__title">
                {cluster.region} · {cluster.type}
              </span>
              <span className={`cluster-hero__badge mode-badge--${cluster.mode}`}>
                {meta.name}
              </span>
              <span className="cluster-hero__tabs">
                <span className="is-active">多频群组全景视图</span>
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
          <b>协同处置建议：</b>
          {row.mode_advice || meta.rule}
        </div>
        <div className="mode-explainer">
          <b>研判规则：</b>
          {meta.icon} {meta.name}（{meta.tagline}） · <b>触发依据：</b>
          {row.mode_risk ? `${row.mode_risk} · ${meta.rule}` : meta.rule}
        </div>
      </div>

      <div className="cluster-grid">
        {/* 左侧：成员工单明细列表（支持锚点定位与边框闪烁高亮） */}
        <div className="card">
          <div className="card__header flex items-center justify-between">
            <div>
              <div className="card__title flex items-center gap-2">
                <span>📑</span>
                群组成员工单明细
                <span className="text-xs text-slate-500 font-normal">
                  (共 {row.count} 件 · 当前加载 {members.length} 件)
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                点击单条工单可展开详细诉求正文、涉事地点与提取要素
              </div>
            </div>
            {targetTicketId && (
              <div className="inline-flex items-center gap-1 text-xs font-semibold text-blue-600 bg-blue-50 px-2.5 py-1 rounded-full border border-blue-200">
                <Target className="h-3.5 w-3.5 animate-spin" />
                正在定位: #{targetTicketId}
              </div>
            )}
          </div>

          <div className="card__body" style={{ padding: "14px 18px" }}>
            {members.length === 0 && <div className="empty-hint">暂无关联工单数据</div>}
            
            {members.map((m) => {
              const isTarget =
                Boolean(targetTicketId) &&
                (m.ticketId === targetTicketId ||
                  m.id === targetTicketId ||
                  m.ticketId?.includes(targetTicketId) ||
                  m.id?.includes(targetTicketId));
              const isExpanded = isTarget || Boolean(expandedMap[m.ticketId || m.id]);

              return (
                <div
                  key={m.ticketId || m.id}
                  id={`ticket-${m.ticketId || m.id}`}
                  className={`member-item transition-all duration-300 relative rounded-xl border p-4 mb-3 cursor-pointer ${
                    isTarget
                      ? "ticket-highlight-pulse border-blue-500 bg-blue-50/40"
                      : "border-slate-200/90 bg-white hover:border-slate-300"
                  }`}
                  onClick={() => toggleExpand(m.ticketId || m.id)}
                >
                  {/* 目标工单呼吸动画徽标 */}
                  {isTarget && (
                    <div className="absolute -top-3 right-4 z-10 flex items-center gap-1.5 bg-blue-600 text-white text-[11px] font-bold px-3 py-0.5 rounded-full shadow-md animate-bounce">
                      <Target className="h-3 w-3" />
                      🎯 当前定位工单 (Target)
                    </div>
                  )}

                  <div className="member-item__head flex items-center gap-2 mb-1.5">
                    <span className="member-item__id font-mono font-bold text-xs text-slate-800 bg-slate-100 px-2 py-0.5 rounded">
                      #{m.id}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-medium text-emerald-700 bg-emerald-50 border border-emerald-200 px-2 py-0.5 rounded-md">
                      <Sparkles className="h-3 w-3" />
                      {m.confidence == null ? "已校准" : `置信度 ${m.confidence}%`}
                    </span>
                    {m.category && (
                      <span className="text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-2 py-0.5 rounded-md">
                        {m.category}
                      </span>
                    )}
                    {m.region && (
                      <span className="text-[10px] font-medium text-slate-700 bg-slate-100 px-2 py-0.5 rounded-md">
                        📍 {m.region}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 font-mono">
                      {m.createdAt}
                    </span>
                  </div>

                  <div className="member-item__title text-sm font-bold text-slate-900 mb-1.5">
                    {m.title}
                  </div>

                  {/* 工单正文（展开/折叠） */}
                  <div
                    className={`member-item__content text-xs text-slate-600 leading-relaxed bg-slate-50/70 p-2.5 rounded-lg border border-slate-100 mb-2 ${
                      isExpanded ? "whitespace-pre-wrap" : "line-clamp-2"
                    }`}
                  >
                    {m.content || "暂无详细正文"}
                  </div>

                  {/* 展开展示诉求人与具体门牌 */}
                  {isExpanded && (m.caller_name || m.address) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2 rounded-md border border-slate-200/60 mb-2">
                      {m.caller_name && (
                        <div className="flex items-center gap-1">
                          <User className="h-3 w-3 text-slate-400" />
                          <span>诉求人：{m.caller_name}</span>
                        </div>
                      )}
                      {m.address && (
                        <div className="flex items-center gap-1">
                          <MapPin className="h-3 w-3 text-slate-400" />
                          <span>事发地址：{m.address}</span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="member-item__why flex items-center justify-between text-xs text-slate-500 pt-1 border-t border-slate-100/80">
                    <div className="flex items-center gap-1.5">
                      <span>🔎</span>
                      <span>
                        归入依据：<b className="text-slate-800 font-medium">{memberWhy(m)}</b>
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-600 font-semibold text-[11px]">
                      {isExpanded ? (
                        <>
                          收起详情 <ChevronUp className="h-3.5 w-3.5" />
                        </>
                      ) : (
                        <>
                          展开详情 <ChevronDown className="h-3.5 w-3.5" />
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 右侧：群组基本信息与 AI 研判依据 */}
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
                <span className="info-row__label">所属辖区</span>
                <span className="info-row__value">{row.region || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">首件时间</span>
                <span className="info-row__value">{row.first_date || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">末件时间</span>
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
            <div className="card__body" style={{ padding: "14px 18px" }}>
              <div className="info-row">
                <span className="info-row__label">责任人 / 部门</span>
                <span className="info-row__value">{row.status?.owner || "顺德区热线督办组"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">办理进度</span>
                <span className="info-row__value font-semibold text-blue-600">{row.status?.progress ?? 0}%</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ThemeDetailPage() {
  return (
    <Suspense fallback={<div className="empty-hint">加载群组视图中…</div>}>
      <ThemeDetailInner />
    </Suspense>
  );
}
