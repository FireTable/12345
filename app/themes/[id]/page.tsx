"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { MODE_META } from "@/backend/theme-metrics";
import type { CivicMode } from "@/backend/state";
import { spanDays, categoryBadgeStyle } from "@/lib/civic-cluster";
import { CivicEChart, radarOption } from "@/app/_components/civic/civic-charts";
import { SkThemeDetail } from "@/app/_components/civic/skeletons";
import { useRegion } from "@/app/_components/civic/region-context";
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
  Zap,
  Download,
  Share2,
  ExternalLink,
  Copy,
  Check,
} from "lucide-react";

const ADVICE_LABELS = ["牵头部门", "响应时限", "办理路径", "建议时限"];

/** 模型把部门、时限、步骤写成一句。按这几个标记拆成行，页面才有分段。 */
function segmentAdvice(raw: string): string[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];
  if (text.includes("\n")) {
    return text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  }
  const label = ADVICE_LABELS.join("|");
  let marked = text.replace(new RegExp(`(?<!^)\\s*(${label})\\s*[:：]`, "g"), "\n$1：");
  marked = marked.replace(/(办理路径[:：])\s*(?=\d)/g, "$1\n");
  marked = marked.replace(/[；;]\s*(?=\d+[.、．])/g, "\n");
  return marked.split("\n").map((line) => line.trim()).filter(Boolean);
}

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
  detailLoaded?: boolean;
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
  summary?: string;
  title?: string;
  ai_confidence: number | null;
  first_date: string;
  last_date: string;
  trend: string;
  features: Array<{ name: string; pct: number; desc: string }>;
  radar: number[];
  status: { code?: "PENDING" | "IN_PROGRESS" | "RESOLVED"; label: string; progress: number; owner: string; color: string; eta: string };
  members?: Member[];
  ungrouped?: boolean;
};

const STEPS = [
  { key: "collect", name: "已收集" },
  { key: "dispatch", name: "已派单" },
  { key: "process", name: "处置中" },
  { key: "feedback", name: "待回访" },
  { key: "archive", name: "已办结" },
];

function asMode(m?: string): CivicMode {
  if (m === "repeat" || m === "diverge" || m === "aggregate") return m;
  return "aggregate";
}

function isUnknownGroup(id?: string) {
  if (!id) return true;
  const s = id.toLowerCase();
  return s === "unknown" || s === "theme-unknown" || s === "undefined" || s === "null";
}

function checkIsTarget(m: Member, target: string): boolean {
  if (!target) return false;
  const t = target.toLowerCase().trim().replace(/^#/, "").replace(/^ticket-/, "");
  const mId = (m.id || "").toLowerCase().trim().replace(/^#/, "");
  const mTicketId = (m.ticketId || "").toLowerCase().trim().replace(/^#/, "");
  if (!t) return false;
  return (
    mId === t ||
    mTicketId === t ||
    (mId.length >= 6 && t.includes(mId)) ||
    (t.length >= 6 && mId.includes(t)) ||
    (mTicketId.length >= 6 && t.includes(mTicketId)) ||
    (t.length >= 6 && mTicketId.includes(t))
  );
}

function ThemeDetailInner() {
  const { activeRegion } = useRegion();
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();

  // 从 URL 参数与 Hash 中提取目标工单标识
  const [targetTicketId, setTargetTicketId] = useState("");
  const [row, setRow] = useState<ClusterDetail | null>(null);
  const [load, setLoad] = useState<DetailLoadStatus>("pending");
  const [expandedMap, setExpandedMap] = useState<Record<string, boolean>>({});
  const [extraMember, setExtraMember] = useState<Member | null>(null);
  const [memberRows, setMemberRows] = useState<Member[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersDone, setMembersDone] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const memberCursor = useRef<{ time: string | null; id: string } | null>(null);
  const membersLoadingRef = useRef(false);
  const membersDoneRef = useRef(false);
  const membersPaused = useRef(false);
  const memberGen = useRef(0);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrolledTarget = useRef(false);

  useEffect(() => {
    const qTarget = (searchParams.get("ticketId") || searchParams.get("highlight") || "").trim();
    const hashTarget = typeof window !== "undefined" ? window.location.hash.replace(/^#ticket-/, "").replace(/^#/, "").trim() : "";
    const effective = (qTarget || hashTarget).trim();
    if (effective) {
      setTargetTicketId(effective);
    }
  }, [searchParams]);

  const loadMembers = useCallback(async () => {
    if (!params.id || isUnknownGroup(params.id)) return;
    if (membersLoadingRef.current || membersDoneRef.current || membersPaused.current) return;
    const gen = memberGen.current;
    membersLoadingRef.current = true;
    setMembersLoading(true);
    try {
      const q = new URLSearchParams({ limit: "30" });
      const cursor = memberCursor.current;
      if (cursor?.id) {
        q.set("beforeId", cursor.id);
        if (cursor.time) q.set("beforeTime", cursor.time);
      }
      const res = await fetch(`/api/clusters/${params.id}/members?${q}`);
      const data = await res.json();
      if (memberGen.current !== gen) return;
      if (!data.success) throw new Error(data.error || "工单加载失败");
      const incoming = (data.members || []) as Member[];
      setMemberRows((prev) => {
        const seen = new Set(prev.map((item) => item.ticketId));
        const next = incoming.filter((item) => item.ticketId && !seen.has(item.ticketId));
        return next.length ? [...prev, ...next] : prev;
      });
      memberCursor.current = data.next || null;
      membersDoneRef.current = !data.next;
      setMembersDone(!data.next);
    } catch {
      if (memberGen.current !== gen) return;
      membersPaused.current = true;
      toast.error("工单加载失败");
    } finally {
      if (memberGen.current === gen) {
        membersLoadingRef.current = false;
        setMembersLoading(false);
      }
    }
  }, [params.id]);

  useEffect(() => {
    setLoad("pending");
    setRow(null);
    setExtraMember(null);
    setMemberRows([]);
    setExpandedMap({});
    memberGen.current += 1;
    memberCursor.current = null;
    membersPaused.current = false;
    membersLoadingRef.current = false;
    membersDoneRef.current = isUnknownGroup(params.id);
    setMembersDone(isUnknownGroup(params.id));
    setMembersLoading(false);
    scrolledTarget.current = false;

    const isUnknown = isUnknownGroup(params.id);
    const fetchUrl = isUnknown && targetTicketId
      ? `/api/clusters/unknown?ticketId=${encodeURIComponent(targetTicketId)}`
      : `/api/clusters/${params.id}`;

    let cancelled = false;
    fetch(fetchUrl)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        setRow(j);
        setLoad("done");
      })
      .catch(() => {
        if (cancelled) return;
        setRow(null);
        setLoad("error");
      });
    if (!isUnknown) void loadMembers();
    return () => {
      cancelled = true;
    };
  }, [params.id, targetTicketId, loadMembers]);

  useEffect(() => {
    if (!targetTicketId || isUnknownGroup(params.id)) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      const exists = memberRows.some((m) => checkIsTarget(m, targetTicketId));
      if (exists || cancelled) return;
      fetch(`/api/workorders/${encodeURIComponent(targetTicketId)}`)
        .then((r) => r.json())
        .then((singleData) => {
          if (cancelled || !singleData.success) return;
          setExtraMember({
            id: singleData.id,
            ticketId: singleData.ticketId || singleData.id,
            title: singleData.title,
            category: singleData.category,
            region: singleData.region,
            createdAt: singleData.createdAt,
            content: singleData.content,
            confidence: singleData.confidence,
            caller_name: singleData.caller_name,
            address: singleData.address,
            detailLoaded: true,
          });
        })
        .catch(() => {});
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [params.id, targetTicketId, memberRows]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || membersDone) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) void loadMembers();
      },
      { rootMargin: "240px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, [loadMembers, membersDone, memberRows.length]);

  const view = classifyDetailPayload(load, row);
  const mode = asMode(row?.mode);
  const meta = MODE_META[mode];
  
  // 合并群组成员工单（确保目标工单必定存在）
  const members = useMemo(() => {
    const list = [...memberRows];
    if (extraMember && !list.some((m) => checkIsTarget(m, extraMember.id) || m.ticketId === extraMember.ticketId)) {
      list.unshift(extraMember);
    }
    return list;
  }, [memberRows, extraMember]);

  const [copiedAdvice, setCopiedAdvice] = useState(false);

  const adviceText = segmentAdvice(row?.mode_advice || meta.rule || "");

  const handleCopyAdvice = () => {
    const text = adviceText.join("\n");
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedAdvice(true);
        toast.success("已复制协同处置建议！");
        setTimeout(() => setCopiedAdvice(false), 2000);
      })
      .catch(() => {
        toast.error("复制失败，请手动选取复制");
      });
  };

  const days = spanDays(row?.first_date, row?.last_date);
  const radarOpt = useMemo(() => radarOption(row?.radar || []), [row?.radar]);
  const firstMember = members[0];
  const doneSteps = Math.max(1, Math.min(5, Math.ceil((row?.status?.progress || 0) / 20)));

  // 自动滚动并锚点居中定位到目标工单
  useEffect(() => {
    if (!targetTicketId || members.length === 0 || scrolledTarget.current) return;
    const hit = members.some((m) => checkIsTarget(m, targetTicketId));
    if (!hit) return;
    scrolledTarget.current = true;
    const target = members.find((m) => checkIsTarget(m, targetTicketId));
    if (target && !target.detailLoaded) void toggleExpand(target);
    setExpandedMap((prev) => ({ ...prev, [targetTicketId]: true }));
    const timer = window.setTimeout(() => {
      const cleanId = targetTicketId.replace(/^#/, "").replace(/^ticket-/, "");
      const el =
        document.getElementById(`ticket-${cleanId}`) ||
        document.getElementById(cleanId) ||
        document.querySelector(`[data-ticket-id="${cleanId}"]`) ||
        document.querySelector(".is-target-ticket");
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [targetTicketId, members]);

  async function toggleExpand(member: Member) {
    const key = member.ticketId || member.id;
    const opening = !(expandedMap[key] || expandedMap[member.id]);
    setExpandedMap((prev) => ({ ...prev, [key]: opening, [member.id]: opening }));
    if (!opening || member.detailLoaded) return;
    setOpeningId(key);
    try {
      const res = await fetch(`/api/workorders/${encodeURIComponent(member.ticketId || member.id)}`);
      const data = await res.json();
      if (!data.success) throw new Error(data.error || "读取工单失败");
      const patch = {
        content: typeof data.content === "string" ? data.content : member.content,
        caller_name: data.caller_name || member.caller_name,
        address: data.address || member.address,
        detailLoaded: true,
      };
      setMemberRows((prev) => prev.map((item) => (item.ticketId === member.ticketId ? { ...item, ...patch } : item)));
      setExtraMember((prev) => (prev && prev.ticketId === member.ticketId ? { ...prev, ...patch } : prev));
    } catch {
      toast.error("读取工单全文失败");
    } finally {
      setOpeningId(null);
    }
  }

  function stepTime(i: number) {
    const progress = row?.status?.progress || 0;
    if (i === 0) return row?.first_date || "—";
    if (i === 2 && progress >= 40) return row?.last_date || "—";
    if (i === 4 && (row?.status?.code === "RESOLVED" || row?.status?.label === "已办结" || progress >= 100)) return row?.status?.eta || row?.last_date || "—";
    return "—";
  }

  function exportReport() {
    if (!row) return;
    const regionName = activeRegion?.name || "辖区";
    const lines = [
      `【${regionName} 12345 热线多频诉求智能研判报告】`,
      `群组编号: ${row.code || row.id}`,
      `归属辖区: ${row.region} · 诉求领域: ${row.type}`,
      `研判模式: ${meta.name}（${meta.tagline}）`,
      `整合工单: ${row.count} 件`,
      `时空脉络: ${row.first_date || "—"} 至 ${row.last_date || "—"}（跨度 ${days} 天）`,
      `AI 聚类置信度: ${row.ai_confidence ?? "—"}%`,
      `当前处置状态: ${row.status?.label || "未处理"} (进度 ${row.status?.progress ?? 0}%)`,
      `牵头承办部门: ${row.status?.owner || `${regionName}热线督办组`}`,
      `协同处置建议:\n${adviceText.join("\n")}`,
      "",
      `==================== 已加载工单（${members.length} / ${row.count}） ====================`,
      ...members.map((m, idx) => `[${idx + 1}] #${m.id} | ${m.createdAt} | 诉求人: ${m.caller_name || "市民"} | 涉事地址: ${m.address || m.region || "—"}\n    标题: ${m.title}\n    正文: ${m.content || "—"}\n`),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${regionName}12345群组研判报告-${row.region}-${row.type}-${row.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已成功生成并下载群组公文研判报告！");
  }

  if (view === "loading") {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/themes">多频工单</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <SkThemeDetail />
      </>
    );
  }
  if (view === "missing" || !row) {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/themes">多频工单</Link>
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
    if (m.region && cluster.region && m.region === cluster.region) return `同属${activeRegion?.name || "辖区"}「${m.region}」`;
    if (m.category && m.category === cluster.type) return `诉求分类同为「${m.category}」`;
    return `已深度关联主题「${cluster.title || cluster.type}」`;
  }

  return (
    <>
      <div className="breadcrumb">
        <Link href="/themes">多频工单</Link>
        <span>/</span>
        <Link href="/multifreq">工单透势</Link>
        <span>/</span>
        <span>{cluster.region} · {cluster.type}</span>
      </div>

      {/* Hero 区域：左侧信息与指标，右侧毛玻璃 AI 处置建议卡片 */}
      <div className={`cluster-hero cluster-hero--${mode}`}>
        <div className="cluster-hero__layout">
          {/* 左侧主要信息与核心指标 */}
          <div className="cluster-hero__left">
            <div className="cluster-hero__row">
              <div className="cluster-hero__icon">{meta.icon}</div>
              <div className="cluster-hero__main">
                <div className="cluster-hero__title">
                  <span>
                    {cluster.region} · {cluster.type}
                  </span>
                  <span className="hero-mode-badge">
                    {meta.icon} {meta.name}
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
              {row.trend ? (
                <div className="cluster-hero__stat">
                  <div className="cluster-hero__stat-val">{row.trend}</div>
                  <div className="cluster-hero__stat-label">近 7 天趋势</div>
                </div>
              ) : null}
            </div>

            {row.summary ? <div className="cluster-hero__summary">{row.summary}</div> : null}

            <div className="mode-explainer">
              <b>研判规则：</b>
              {meta.icon} {meta.name}（{meta.tagline}） · <b>触发依据：</b>
              {row.mode_risk ? `${row.mode_risk} · ${meta.rule}` : meta.rule}
            </div>
          </div>

          {/* 右侧毛玻璃 AI 协同处置建议卡片 */}
          <div className="cluster-hero__right">
            <div className="cluster-hero__glass-advice">
              <div className="glass-advice__head">
                <span className="glass-advice__icon">✨</span>
                <span className="glass-advice__title">AI 协同处置建议</span>
                <button
                  type="button"
                  onClick={handleCopyAdvice}
                  className="glass-advice__copy-btn"
                  title="一键复制协同处置建议"
                >
                  {copiedAdvice ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-300" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-white/90" />
                      <span>复制建议</span>
                    </>
                  )}
                </button>
              </div>
              <div className="glass-advice__body">
                {adviceText.map((line, index) => (
                  <p key={`${index}-${line.slice(0, 12)}`} className={/^\d+[.、．]/.test(line) ? "glass-advice__step" : undefined}>
                    {line}
                  </p>
                ))}
              </div>
              <div className="glass-advice__foot">
                <span>牵头：{row.status?.owner || "所属辖区行业主管部门"}</span>
                <span>建议时限：2 工作日内</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      <div className="cluster-grid">
        {/* 左侧：成员工单明细列表（支持锚点定位、1px 纯蓝边框与完整展开） */}
        <div className="card">
          <div className="card__header flex items-center justify-between">
            <div>
              <div className="card__title flex items-center gap-2">
                <span>📑</span>
                群组成员工单明细
                <span className="text-xs text-slate-500 font-normal">
                  (共 {row.count} 件 · 已加载 {members.length} 件)
                </span>
              </div>
              <div className="text-[11px] text-slate-400 mt-0.5">
                点击单条工单可展开详细诉求正文、涉事地址与提取要素
              </div>
            </div>
            {targetTicketId && (
              <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200 shadow-2xs">
                <Target className="h-3.5 w-3.5 text-blue-600 animate-spin" />
                <span>目标工单定位: #{targetTicketId}</span>
              </div>
            )}
          </div>

          <div className="card__body" style={{ padding: "14px 18px" }}>
            {members.length === 0 && (
              <div className="empty-hint">
                {membersLoading ? (
                  "正在加载工单…"
                ) : cluster.ungrouped ? (
                  "请从工单中心选择要查看的工单。"
                ) : (row.count || 0) > 0 ? (
                  <button
                    type="button"
                    className="btn btn--default"
                    onClick={() => {
                      membersDoneRef.current = false;
                      membersPaused.current = false;
                      setMembersDone(false);
                      void loadMembers();
                    }}
                  >
                    重新加载工单
                  </button>
                ) : (
                  "暂无关联工单数据"
                )}
              </div>
            )}
            
            {members.map((m) => {
              const isTarget = checkIsTarget(m, targetTicketId);
              const isExpanded = isTarget || Boolean(expandedMap[m.ticketId || m.id] || expandedMap[m.id]);

              return (
                <div
                  key={m.ticketId || m.id}
                  id={`ticket-${m.id}`}
                  data-ticket-id={m.id}
                  className={`member-item transition-colors relative rounded-xl p-4 mb-3.5 cursor-pointer ${
                    isTarget
                      ? "is-target-ticket border border-blue-600 bg-blue-50/30 shadow-xs"
                      : "border border-slate-200/90 bg-white hover:border-slate-300"
                  }`}
                  style={
                    isTarget
                      ? {
                          borderColor: "#2563eb",
                          backgroundColor: "rgba(239, 246, 255, 0.4)",
                        }
                      : {}
                  }
                  onClick={() => void toggleExpand(m)}
                >
                  {/* 目标工单浮动徽标 */}
                  {isTarget && (
                    <div className="absolute -top-3 right-4 z-20 flex items-center gap-1.5 bg-blue-600 text-white text-[11px] font-medium px-3 py-0.5 rounded-full shadow-xs border border-white">
                      <Target className="h-3 w-3" />
                      <span>🎯 当前定位工单</span>
                    </div>
                  )}

                  <div className="member-item__head flex items-center gap-2 mb-2">
                    <span className="member-item__id font-mono font-bold text-xs text-slate-800 bg-slate-100 px-2 py-0.5 rounded border border-slate-200/80">
                      #{m.id}
                    </span>
                    <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-md">
                      <Sparkles className="h-3 w-3" />
                      {m.confidence == null ? "已校准" : `置信度 ${m.confidence}%`}
                    </span>
                    {m.category && (
                      <span
                        className="badge-pill text-[11px] font-medium"
                        style={categoryBadgeStyle(m.category)}
                      >
                        {m.category}
                      </span>
                    )}
                    {m.region && (
                      <span className="text-[11px] font-medium text-slate-700 bg-slate-100 px-2.5 py-0.5 rounded-md">
                        📍 {m.region}
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-400 font-mono">
                      {m.createdAt}
                    </span>
                  </div>

                  <div className="member-item__title text-sm font-bold text-slate-900 mb-2">
                    {m.title}
                  </div>

                  {/* 工单正文容器（外层提供内边距，内层提供 line-clamp，绝无半截文字露出的问题） */}
                  <div className="bg-slate-50/90 p-3 rounded-lg border border-slate-200/70 mb-2.5">
                    <div
                      className={`text-xs text-slate-700 leading-relaxed ${
                        isExpanded
                          ? "block whitespace-pre-wrap break-words"
                          : "line-clamp-2 overflow-hidden"
                      }`}
                    >
                      {m.content || "暂无详细正文"}
                    </div>
                  </div>

                  {/* 展开展示诉求人与具体门牌 */}
                  {isExpanded && (m.caller_name || m.address) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-600 bg-white p-2.5 rounded-md border border-slate-200/80 mb-2.5">
                      {m.caller_name && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-400" />
                          <span>诉求人：<b className="text-slate-800 font-medium">{m.caller_name}</b></span>
                        </div>
                      )}
                      {m.address && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-400" />
                          <span>事发地址：<b className="text-slate-800 font-medium">{m.address}</b></span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="member-item__why flex items-center justify-between text-xs text-slate-500 pt-1.5 border-t border-slate-100/80">
                    <div className="flex items-center gap-1.5">
                      <span>🔎</span>
                      <span>
                        归入依据：<b className="text-slate-800 font-medium">{memberWhy(m)}</b>
                      </span>
                    </div>
                    <div className="flex items-center gap-1 text-blue-600 font-semibold text-[11px]">
                      {openingId === (m.ticketId || m.id) ? (
                        <span>正在读取全文</span>
                      ) : isExpanded ? (
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
            <div ref={sentinelRef} />
            {members.length > 0 && !membersDone && (
              <button
                type="button"
                className="btn btn--default w-full"
                disabled={membersLoading}
                onClick={() => {
                  membersPaused.current = false;
                  void loadMembers();
                }}
              >
                {membersLoading ? "正在加载更多…" : `继续加载（已显示 ${members.length} / ${row.count}）`}
              </button>
            )}
            {membersDone && members.length > 0 && members.length >= (row.count || 0) && (
              <div className="empty-hint">已加载全部 {members.length} 件</div>
            )}
          </div>
        </div>

        {/* 右侧：群组基本信息、AI 研判依据、5 节点进度追踪条与操作工具栏 */}
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
                <span className="info-row__value">{row.status?.owner || `${activeRegion?.name || ""}热线督办组`}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <div className="card__title">🤖 AI 聚类研判依据</div>
            </div>
            <div className="card__body" style={{ padding: "8px 18px 14px" }}>
              {cluster.ungrouped ? (
                <div className="empty-hint">尚未聚类，暂无研判依据。工作人员可直接阅读左侧工单原文。</div>
              ) : (
                <>
                  <div className="feature-list">
                    {(row.features || []).length === 0 && <div className="empty-hint">暂无特征（尚未落库）</div>}
                    {(row.features || []).map((f, idx) => {
                      const dimStyles = [
                        { text: "#1D4ED8", fill: "linear-gradient(90deg, #60A5FA 0%, #1D4ED8 100%)", dot: "#2563EB" }, // 关键词
                        { text: "#059669", fill: "linear-gradient(90deg, #34D399 0%, #059669 100%)", dot: "#10B981" }, // 地理
                        { text: "#D97706", fill: "linear-gradient(90deg, #FBBF24 0%, #D97706 100%)", dot: "#F59E0B" }, // 时间
                        { text: "#DB2777", fill: "linear-gradient(90deg, #F472B6 0%, #DB2777 100%)", dot: "#EC4899" }, // 情绪
                        { text: "#7C3AED", fill: "linear-gradient(90deg, #A78BFA 0%, #7C3AED 100%)", dot: "#8B5CF6" }, // 重复度
                      ];
                      const style = dimStyles[idx % dimStyles.length];
                      return (
                        <div key={f.name} className="feature-list__item">
                          <div className="feature-list__head">
                            <span className="flex items-center gap-1.5 font-medium text-slate-700">
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: style.dot, display: "inline-block", flexShrink: 0 }} />
                              {f.name} <span style={{ color: "var(--c-ink-3)", fontSize: 11 }}>{f.desc || ""}</span>
                            </span>
                            <span style={{ fontWeight: 700, color: style.text }}>{f.pct}%</span>
                          </div>
                          <div className="feature-list__bar" style={{ background: "#F1F5F9" }}>
                            <div
                              className="feature-list__fill"
                              style={{ width: `${f.pct}%`, background: style.fill, transition: "width 0.4s ease" }}
                            />
                          </div>
                        </div>
                      );
                    })}
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
                </>
              )}
            </div>
          </div>

          {/* 5 阶段处置进度可视化卡片（完全采用同事的原生进度条设计） */}
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
                    className={`progress-step__dot${
                      i < doneSteps - 1
                        ? " progress-step__dot--done"
                        : i === doneSteps - 1
                        ? " progress-step__dot--current"
                        : ""
                    }`}
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
                <span className="info-row__value">{row.status?.owner || (cluster.ungrouped ? "—" : `${activeRegion?.name || ""}热线督办组`)}</span>
              </div>
            </div>
          </div>

          {/* 底部操作工具栏：包含一键导出群组报告 */}
          <div className="action-row">
            <button
              type="button"
              className="btn btn--default"
              onClick={() => toast.info(row.status?.owner ? `牵头部门：${row.status.owner}` : "尚未指定责任部门")}
            >
              联系部门
            </button>
            <button
              type="button"
              className="btn btn--default"
              onClick={() => toast.success("已记录升级协同督办意向")}
            >
              升级处置
            </button>
            <button
              type="button"
              className="btn btn--primary flex items-center justify-center gap-1.5"
              onClick={exportReport}
            >
              <Download className="h-4 w-4" />
              生成群组报告
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

export default function ThemeDetailPage() {
  return (
    <Suspense fallback={<SkThemeDetail />}>
      <ThemeDetailInner />
    </Suspense>
  );
}
