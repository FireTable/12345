"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { fmtNum } from "@/lib/format-number";
import { LOW_CONFIDENCE_THRESHOLD, classifyConfidence } from "@/lib/confidence";
import { MODE_META } from "@/backend/theme-metrics";
import type { CivicMode, GraphData, GraphNode } from "@/backend/state";
import { spanDays, categoryBadgeStyle } from "@/lib/civic-cluster";
import { radarOption } from "@/app/_components/civic/civic-charts";
import { SkThemeDetail } from "@/app/_components/civic/skeletons";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";

const CivicEChart = dynamic(
  () => import("@/app/_components/civic/civic-charts").then((m) => m.CivicEChart),
  {
    ssr: false,
    loading: () => (
      <div className="h-[200px] rounded-lg bg-slate-50 flex items-center justify-center text-xs text-slate-400">
        正在加载图表…
      </div>
    ),
  }
);

const GraphVisualizer = dynamic(
  () => import("@/app/_components/graph/graph-visualizer").then((m) => m.GraphVisualizer),
  {
    ssr: false,
    loading: () => <div className="empty-hint">正在加载实体关系图谱…</div>,
  }
);
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/app/_components/ui/dialog";
import { DisposalTimeline, type DisposalLogItem } from "@/app/_components/civic/disposal-timeline";
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
  AlertTriangle,
  Send,
  ShieldAlert,
  RotateCcw,
  CheckCircle2,
  Trash2,
  Network,
} from "lucide-react";

const ADVICE_LABELS = ["牵头部门", "响应时限", "办理路径", "建议时限"];

function extractOwnerFromAdvice(raw?: string | null): string {
  if (!raw) return "";
  const match = raw.match(/(?:牵头部门|牵头单位|责任部门)[:：]\s*([^\n；;。]+)/);
  return match ? match[1].trim() : "";
}

function addWorkdaysYmd(workdays: number): string {
  const date = new Date();
  let remaining = Math.max(0, workdays);
  while (remaining > 0) {
    date.setDate(date.getDate() + 1);
    const day = date.getDay();
    if (day !== 0 && day !== 6) {
      remaining -= 1;
    }
  }
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

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
  address?: string | null;
  canonicalSubject?: string | null;
  humanVerified?: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null;
  urgency?: string;
  status?: string;
  isFakeClosure?: boolean;
  detailLoaded?: boolean;
};

type MemberStats = {
  totalCount: number;
  lowConfidenceUnverifiedCount: number;
  lowConfidenceTotalCount: number;
  verifiedCount: number;
  lowConfidenceThreshold: number;
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
  riskLevel?: string | null;
  riskReason?: string | null;
  fakeClosureCount?: number;
  disposalLogs?: DisposalLogItem[];
  members?: Member[];
  memberStats?: MemberStats;
  ungrouped?: boolean;
};

const STEPS = [
  { key: "collect", name: "已收集" },
  { key: "dispatch", name: "已派单" },
  { key: "process", name: "处理中" },
  { key: "feedback", name: "待回访" },
  { key: "archive", name: "已办结" },
];

function formatMemberTime(raw?: string | null): string {
  if (!raw) return "—";
  if (/^\d{4}-\d{2}-\d{2}T/.test(raw)) {
    const d = new Date(raw);
    if (!Number.isNaN(d.getTime())) {
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
  }
  return raw;
}

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
  const { isAdmin, isPending: isRolePending } = useAuthRole();
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
  const memberRowsRef = useRef<Member[]>(memberRows);
  memberRowsRef.current = memberRows;
  const [membersLoading, setMembersLoading] = useState(false);
  const [membersDone, setMembersDone] = useState(false);
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [actionPending, setActionPending] = useState(false);
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dispatchOwner, setDispatchOwner] = useState("");
  const [dispatchEta, setDispatchEta] = useState("");
  const [dispatchNote, setDispatchNote] = useState("");
  const [escalateOpen, setEscalateOpen] = useState(false);
  const [escalateNote, setEscalateNote] = useState("");
  const [detachTarget, setDetachTarget] = useState<Member | null>(null);
  const [leftTab, setLeftTab] = useState<"members" | "graph">("members");
  const [memberFilter, setMemberFilter] = useState<"all" | "low_confidence" | "verified">("all");
  const [memberSort, setMemberSort] = useState<"time_desc" | "confidence_asc" | "confidence_desc">("time_desc");
  const [memberStats, setMemberStats] = useState<MemberStats | null>(null);
  const [verifyingTicketId, setVerifyingTicketId] = useState<string | null>(null);
  const membersTabRef = useRef<HTMLButtonElement>(null);
  const graphTabRef = useRef<HTMLButtonElement>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);
  const [graphData, setGraphData] = useState<GraphData | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const memberCursor = useRef<{ time: string | null; id: string } | null>(null);
  const memberOffsetRef = useRef(0);
  const useOffsetPaginationRef = useRef(false);
  const membersLoadingRef = useRef(false);
  const membersDoneRef = useRef(false);
  const membersPaused = useRef(false);
  const memberGen = useRef(0);
  const membersAbortRef = useRef<AbortController | null>(null);
  const graphAbortRef = useRef<AbortController | null>(null);
  const expandAbortRef = useRef<AbortController | null>(null);
  const extraTargetFetchedRef = useRef<string>("");
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const scrolledTarget = useRef(false);

  const regionHeaders = useCallback((): Record<string, string> => {
    return activeRegion?.id ? { "x-region-id": activeRegion.id } : {};
  }, [activeRegion?.id]);

  useEffect(() => {
    return () => {
      memberGen.current += 1;
      membersAbortRef.current?.abort();
      graphAbortRef.current?.abort();
      expandAbortRef.current?.abort();
    };
  }, []);

  useEffect(() => {
    const qTarget = (searchParams.get("ticketId") || searchParams.get("highlight") || "").trim();
    const hashTarget = typeof window !== "undefined" ? window.location.hash.replace(/^#ticket-/, "").replace(/^#/, "").trim() : "";
    const effective = (qTarget || hashTarget).trim();
    if (effective) {
      setTargetTicketId(effective);
    }
  }, [searchParams]);

  const loadMembers = useCallback(async () => {
    if (isRolePending || !isAdmin) return;
    if (!params.id || isUnknownGroup(params.id)) return;
    if (membersLoadingRef.current || membersDoneRef.current || membersPaused.current) return;
    membersAbortRef.current?.abort();
    const controller = new AbortController();
    membersAbortRef.current = controller;
    const gen = memberGen.current;
    membersLoadingRef.current = true;
    setMembersLoading(true);
    try {
      const q = new URLSearchParams({
        limit: "30",
        sort: memberSort,
        filter: memberFilter,
        offset: String(memberOffsetRef.current),
      });
      const cursor = memberCursor.current;
      if (!useOffsetPaginationRef.current && memberSort === "time_desc" && memberFilter === "all" && cursor?.id) {
        q.set("beforeId", cursor.id);
        if (cursor.time) q.set("beforeTime", cursor.time);
      }
      const res = await fetch(`/api/clusters/${params.id}/members?${q}`, {
        headers: regionHeaders(),
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted || memberGen.current !== gen) return;
      if (!data.success) throw new Error(data.error || "工单加载失败");
      const incoming = (data.members || []) as Member[];
      setMemberRows((prev) => {
        const seen = new Set(prev.map((item) => item.ticketId || item.id));
        const next = incoming.filter((item) => {
          const k = item.ticketId || item.id;
          return k && !seen.has(k);
        });
        return next.length ? [...prev, ...next] : prev;
      });
      if (typeof data.nextOffset === "number") {
        useOffsetPaginationRef.current = true;
        memberOffsetRef.current = data.nextOffset;
      } else {
        memberOffsetRef.current += incoming.length;
      }
      if (data.stats) {
        setMemberStats(data.stats as MemberStats);
      }
      const hasMore =
        typeof data.hasMore === "boolean"
          ? data.hasMore
          : typeof data.nextOffset === "number"
            ? data.nextOffset < (data.total ?? 0)
            : Boolean(data.next);
      memberCursor.current = data.next || null;
      membersDoneRef.current = !hasMore;
      setMembersDone(!hasMore);
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || memberGen.current !== gen) return;
      membersPaused.current = true;
      toast.error("工单加载失败");
    } finally {
      if (!controller.signal.aborted && memberGen.current === gen) {
        membersLoadingRef.current = false;
        setMembersLoading(false);
      }
    }
  }, [params.id, memberFilter, memberSort, isRolePending, isAdmin, regionHeaders]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    setLoad("pending");
    setLoadError(null);
    setRow(null);
    setMemberStats(null);
    setExtraMember(null);
    setExpandedMap({});
    scrolledTarget.current = false;
    extraTargetFetchedRef.current = "";

    const isUnknown = isUnknownGroup(params.id);
    const fetchUrl = isUnknown && targetTicketId
      ? `/api/clusters/unknown?ticketId=${encodeURIComponent(targetTicketId)}`
      : `/api/clusters/${params.id}`;

    const controller = new AbortController();
    fetch(fetchUrl, {
      headers: regionHeaders(),
      signal: controller.signal,
    })
      .then(async (r) => {
        const j = await r.json().catch(() => null);
        if (!r.ok && r.status !== 404) {
          throw new Error(j?.error || `群组详情加载失败 (${r.status})`);
        }
        return j;
      })
      .then((j) => {
        if (controller.signal.aborted) return;
        setRow(j);
        if (j?.memberStats) {
          setMemberStats(j.memberStats as MemberStats);
        }
        setLoad("done");
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setRow(null);
        setLoadError(err instanceof Error ? err.message : "群组详情加载失败");
        setLoad("error");
      });
    return () => {
      controller.abort();
    };
  }, [params.id, targetTicketId, isRolePending, isAdmin, regionHeaders, reloadNonce]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    membersAbortRef.current?.abort();
    memberGen.current += 1;
    memberCursor.current = null;
    memberOffsetRef.current = 0;
    useOffsetPaginationRef.current = false;
    membersPaused.current = false;
    membersLoadingRef.current = false;
    const isUnknown = isUnknownGroup(params.id);
    membersDoneRef.current = isUnknown;
    setMembersDone(isUnknown);
    setMembersLoading(false);
    setMemberRows([]);
    if (!isUnknown) {
      void loadMembers();
    }
    return () => {
      membersAbortRef.current?.abort();
    };
  }, [params.id, memberFilter, memberSort, loadMembers, isRolePending, isAdmin, reloadNonce]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    if (!targetTicketId || isUnknownGroup(params.id)) return;
    const fetchKey = `${activeRegion?.id || ""}:${params.id}:${targetTicketId}`;
    if (extraTargetFetchedRef.current === fetchKey) return;
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      const exists = memberRowsRef.current.some((m) => checkIsTarget(m, targetTicketId));
      if (controller.signal.aborted) return;
      if (exists) {
        extraTargetFetchedRef.current = fetchKey;
        return;
      }
      fetch(`/api/workorders/${encodeURIComponent(targetTicketId)}`, {
        headers: regionHeaders(),
        signal: controller.signal,
      })
        .then((r) => r.json())
        .then((singleData) => {
          if (controller.signal.aborted) return;
          extraTargetFetchedRef.current = fetchKey;
          if (!singleData.success) return;
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
        .catch(() => {
          if (controller.signal.aborted && extraTargetFetchedRef.current === fetchKey) {
            extraTargetFetchedRef.current = "";
          }
        });
    }, 400);
    return () => {
      controller.abort();
      window.clearTimeout(timer);
    };
  }, [params.id, targetTicketId, isRolePending, isAdmin, activeRegion?.id, regionHeaders]);

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
  const loadThemeGraph = useCallback(async () => {
    if (isRolePending || !isAdmin) return;
    if (!params.id || isUnknownGroup(params.id)) return;
    graphAbortRef.current?.abort();
    const controller = new AbortController();
    graphAbortRef.current = controller;
    setGraphLoading(true);
    setGraphError(null);
    try {
      const headers = regionHeaders();
      const res = await fetch(
        `/api/graph?themeId=${encodeURIComponent(params.id)}`,
        { headers, signal: controller.signal }
      );
      const json = await res.json().catch(() => null);
      if (controller.signal.aborted) return;
      if (!res.ok || !json?.success) {
        throw new Error(json?.error || "实体关系图谱加载失败");
      }
      const raw = (json.data || { nodes: [], links: [] }) as GraphData;
      const coloredNodes: GraphNode[] = (raw.nodes || []).map((n) => {
        const nodeAny = n as GraphNode & { isFakeClosure?: boolean };
        const isFake = Boolean(nodeAny.isFakeClosure || nodeAny.meta?.isFakeClosure);
        let semanticColor = "#64748B";
        if (n.type === "THEME") {
          semanticColor = n.riskLevel === "HIGH" ? "#E11D48" : n.riskLevel === "MEDIUM" ? "#D97706" : "#2563EB";
        } else if (n.type === "SUBJECT") {
          semanticColor = "#0EA5E9";
        } else if (n.type === "LOCATION") {
          semanticColor = "#8B5CF6";
        } else if (n.type === "TICKET") {
          semanticColor = isFake ? "#F43F5E" : "#64748B";
        }
        return {
          ...n,
          color: semanticColor,
        };
      });
      setGraphData({ nodes: coloredNodes, links: raw.links || [] });
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError") return;
      setGraphError(err instanceof Error ? err.message : "图谱加载失败");
      setGraphData(null);
    } finally {
      if (!controller.signal.aborted) {
        setGraphLoading(false);
      }
    }
  }, [params.id, isRolePending, isAdmin, regionHeaders]);

  useEffect(() => {
    setLeftTab("members");
    setMemberFilter("all");
    setMemberSort("time_desc");
    setGraphData(null);
    setGraphError(null);
  }, [params.id]);

  useEffect(() => {
    if (isRolePending || !isAdmin) return;
    if (leftTab === "graph" && !graphData && !graphLoading && !graphError) {
      void loadThemeGraph();
    }
  }, [leftTab, graphData, graphLoading, graphError, loadThemeGraph, isRolePending, isAdmin]);

  const members = useMemo(() => {
    const list = [...memberRows];
    if (
      memberFilter === "all" &&
      extraMember &&
      !list.some((m) => checkIsTarget(m, extraMember.id) || m.ticketId === extraMember.ticketId)
    ) {
      list.unshift(extraMember);
    }
    return list;
  }, [memberRows, extraMember, memberFilter]);

  const [copiedAdvice, setCopiedAdvice] = useState(false);
  const copyAdviceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (copyAdviceTimerRef.current !== null) {
        window.clearTimeout(copyAdviceTimerRef.current);
      }
    };
  }, []);

  const adviceText = segmentAdvice(row?.mode_advice || meta.rule || "");

  const handleCopyAdvice = () => {
    const text = adviceText.join("\n");
    if (!text) return;
    navigator.clipboard
      .writeText(text)
      .then(() => {
        setCopiedAdvice(true);
        toast.success("已复制协同处置建议！");
        if (copyAdviceTimerRef.current !== null) {
          window.clearTimeout(copyAdviceTimerRef.current);
        }
        copyAdviceTimerRef.current = window.setTimeout(() => setCopiedAdvice(false), 2000);
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
    expandAbortRef.current?.abort();
    const controller = new AbortController();
    expandAbortRef.current = controller;
    setOpeningId(key);
    try {
      const res = await fetch(`/api/workorders/${encodeURIComponent(member.ticketId || member.id)}`, {
        headers: regionHeaders(),
        signal: controller.signal,
      });
      const data = await res.json();
      if (controller.signal.aborted) return;
      if (!data.success) throw new Error(data.error || "读取工单失败");
      const patch = {
        content: typeof data.content === "string" ? data.content : member.content,
        caller_name: data.caller_name || member.caller_name,
        address: data.address || member.address,
        ...(typeof data.isFakeClosure === "boolean" ? { isFakeClosure: data.isFakeClosure } : {}),
        ...(typeof data.status === "string" ? { status: data.status } : {}),
        detailLoaded: true,
      };
      setMemberRows((prev) => prev.map((item) => (item.ticketId === member.ticketId ? { ...item, ...patch } : item)));
      setExtraMember((prev) => (prev && prev.ticketId === member.ticketId ? { ...prev, ...patch } : prev));
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError") return;
      toast.error("读取工单全文失败");
    } finally {
      if (!controller.signal.aborted) {
        setOpeningId(null);
      }
    }
  }

  async function patchCluster(
    payload: {
      action: "DISPATCH" | "ADVANCE" | "ESCALATE" | "RESOLVE" | "REOPEN" | "DETACH_TICKET";
      step?: number;
      owner?: string;
      eta?: string;
      note?: string;
      ticketId?: string;
    },
    successMessage?: string,
    onSuccess?: (json: ClusterDetail) => void
  ): Promise<boolean> {
    if (!isAdmin) {
      toast.error("需管理员权限可执行群组处置");
      return false;
    }
    if (!row || row.ungrouped || actionPending) return false;
    setActionPending(true);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch(`/api/clusters/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `操作失败 (${res.status})`);
      }
      setRow((prev) => (prev ? { ...prev, ...json } : json));
      if (json?.memberStats) {
        setMemberStats(json.memberStats as MemberStats);
      }
      onSuccess?.(json as ClusterDetail);
      if (successMessage) toast.success(successMessage);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "群组处置操作失败");
      return false;
    } finally {
      setActionPending(false);
    }
  }

  async function handleVerifyTicket(member: Member, verify: boolean) {
    if (!isAdmin) {
      toast.error("需管理员权限可执行归属核验");
      return;
    }
    if (!row || row.ungrouped || verifyingTicketId || actionPending) return;
    const ticketKey = member.ticketId || member.id;
    setVerifyingTicketId(ticketKey);
    try {
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch(`/api/clusters/${encodeURIComponent(row.id)}`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({
          action: verify ? "VERIFY_TICKET" : "UNVERIFY_TICKET",
          ticketId: ticketKey,
        }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok || !json.success) {
        throw new Error(json.error || `操作失败 (${res.status})`);
      }

      setRow((prev) => (prev ? { ...prev, ...json } : json));
      if (json.memberStats) {
        setMemberStats(json.memberStats as MemberStats);
      } else {
        setMemberStats((prev) => {
          if (!prev) return prev;
          const threshold = prev.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
          const isLow = member.confidence != null && member.confidence < threshold;
          if (verify && !member.humanVerified) {
            return {
              ...prev,
              verifiedCount: prev.verifiedCount + 1,
              lowConfidenceUnverifiedCount: isLow
                ? Math.max(0, prev.lowConfidenceUnverifiedCount - 1)
                : prev.lowConfidenceUnverifiedCount,
            };
          }
          if (!verify && member.humanVerified) {
            return {
              ...prev,
              verifiedCount: Math.max(0, prev.verifiedCount - 1),
              lowConfidenceUnverifiedCount: isLow
                ? prev.lowConfidenceUnverifiedCount + 1
                : prev.lowConfidenceUnverifiedCount,
            };
          }
          return prev;
        });
      }

      const patchFields: Partial<Member> = {
        humanVerified: verify,
        verifiedBy: verify
          ? (json.verification?.verifiedBy ?? json.verifiedBy ?? json.member?.verifiedBy ?? "管理员")
          : null,
        verifiedAt: verify
          ? (json.verification?.verifiedAt ?? json.verifiedAt ?? json.member?.verifiedAt ?? new Date().toISOString())
          : null,
      };

      const shouldRemoveFromView =
        (verify && memberFilter === "low_confidence") || (!verify && memberFilter === "verified");

      if (shouldRemoveFromView) {
        setMemberRows((prev) =>
          prev.filter((item) => item.ticketId !== ticketKey && item.id !== member.id)
        );
        memberOffsetRef.current = Math.max(0, memberOffsetRef.current - 1);
      } else {
        setMemberRows((prev) =>
          prev.map((item) =>
            item.ticketId === ticketKey || item.id === member.id
              ? { ...item, ...patchFields }
              : item
          )
        );
      }
      setExtraMember((prev) =>
        prev && (prev.ticketId === ticketKey || prev.id === member.id)
          ? { ...prev, ...patchFields }
          : prev
      );

      toast.success(verify ? "已人工确认该工单归属" : "已撤销归属确认");
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "归属核验操作失败");
    } finally {
      setVerifyingTicketId(null);
    }
  }

  function openDispatchDialog() {
    if (!row) return;
    const suggestedOwner = row.status?.owner || extractOwnerFromAdvice(row.mode_advice);
    setDispatchOwner(suggestedOwner);
    setDispatchEta(row.status?.eta || addWorkdaysYmd(2));
    setDispatchNote("");
    setDispatchOpen(true);
  }

  async function handleDispatchSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await patchCluster(
      {
        action: "DISPATCH",
        owner: dispatchOwner.trim() || undefined,
        eta: dispatchEta || undefined,
        note: dispatchNote.trim() || undefined,
      },
      "派单指令已下达"
    );
    if (ok) setDispatchOpen(false);
  }

  async function handleEscalateSubmit(e: React.FormEvent) {
    e.preventDefault();
    const ok = await patchCluster(
      {
        action: "ESCALATE",
        note: escalateNote.trim() || "管理员发起升级重点督办",
      },
      "已升级为高危重点督办"
    );
    if (ok) {
      setEscalateNote("");
      setEscalateOpen(false);
    }
  }

  async function handleConfirmDetach() {
    if (!detachTarget) return;
    const detached = detachTarget;
    const targetTicketKey = detached.ticketId || detached.id;
    const ok = await patchCluster(
      {
        action: "DETACH_TICKET",
        ticketId: targetTicketKey,
      },
      "已将该工单移出群组",
      (json) => {
        if (!json.memberStats) {
          setMemberStats((prev) => {
            if (!prev) return prev;
            const threshold = prev.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD;
            const isLow = detached.confidence != null && detached.confidence < threshold;
            return {
              ...prev,
              totalCount: Math.max(0, prev.totalCount - 1),
              verifiedCount: detached.humanVerified
                ? Math.max(0, prev.verifiedCount - 1)
                : prev.verifiedCount,
              lowConfidenceTotalCount: isLow
                ? Math.max(0, prev.lowConfidenceTotalCount - 1)
                : prev.lowConfidenceTotalCount,
              lowConfidenceUnverifiedCount:
                isLow && !detached.humanVerified
                  ? Math.max(0, prev.lowConfidenceUnverifiedCount - 1)
                  : prev.lowConfidenceUnverifiedCount,
            };
          });
        }
      }
    );
    if (ok) {
      setMemberRows((prev) =>
        prev.filter((item) => item.ticketId !== targetTicketKey && item.id !== detached.id)
      );
      memberOffsetRef.current = Math.max(0, memberOffsetRef.current - 1);
      setExtraMember((prev) =>
        prev && (prev.ticketId === targetTicketKey || prev.id === detached.id) ? null : prev
      );
      setGraphData(null);
      setDetachTarget(null);
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
    const logs = row.disposalLogs || [];
    const lines = [
      `【${regionName} 12345 热线多频诉求${row.riskLevel === "HIGH" ? "重点督办" : "智能研判"}报告】`,
      `群组编号: ${row.code || row.id}`,
      `归属辖区: ${row.region} · 诉求领域: ${row.type}`,
      `研判模式: ${meta.name}（${meta.tagline}）`,
      `风险等级: ${row.riskLevel || "MEDIUM"}${row.riskReason ? `（${row.riskReason}）` : ""}`,
      `整合工单: ${fmtNum(row.count)} 件${(row.fakeClosureCount ?? 0) > 0 ? `（含疑似假闭环 ${fmtNum(row.fakeClosureCount)} 件）` : ""}`,
      `时空脉络: ${row.first_date || "—"} 至 ${row.last_date || "—"}（跨度 ${fmtNum(days)} 天）`,
      `AI 聚类置信度: ${row.ai_confidence ?? "—"}%`,
      `当前处置状态: ${row.status?.label || "待派单"} (进度 ${row.status?.progress ?? 0}%)`,
      `牵头承办部门: ${row.status?.owner || `${regionName}热线督办组`}`,
      `预计办结时限: ${row.status?.eta || "—"}`,
      `协同处置建议:\n${adviceText.join("\n")}`,
      ...(logs.length > 0
        ? [
            "",
            `==================== 处置流转记录（${fmtNum(logs.length)} 条） ====================`,
            ...logs.map(
              (l) =>
                `- ${l.createdAt} | ${l.action} | 操作人: ${l.operator || "—"} | 部门: ${l.owner || "—"}${l.note ? ` | 备注: ${l.note}` : ""}`
            ),
          ]
        : []),
      "",
      `==================== 已加载工单（${fmtNum(members.length)} / ${fmtNum(row.count)}） ====================`,
      ...members.map((m, idx) => `[${idx + 1}] #${m.id} | ${m.createdAt} | 诉求人: ${m.caller_name || "市民"} | 涉事地址: ${m.address || m.region || "—"}${m.isFakeClosure ? " | [疑似假闭环]" : ""}\n    标题: ${m.title}\n    正文: ${m.content || "—"}\n`),
    ];
    const blob = new Blob(["\uFEFF" + lines.join("\n")], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${regionName}12345${row.riskLevel === "HIGH" ? "重点督办单" : "群组研判报告"}-${row.region}-${row.type}-${row.id}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success("已成功生成并下载群组公文研判报告！");
  }

  if (isRolePending || !isAdmin) {
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
        {load === "error" || loadError ? (
          <div
            role="alert"
            className="bg-rose-50 rounded-xl border border-rose-200 p-6 text-center space-y-3"
          >
            <h1 className="text-base font-bold text-rose-900 m-0">群组详情加载失败</h1>
            <p className="text-xs text-rose-700 m-0">{loadError || "请检查网络或稍后重试"}</p>
            <button
              type="button"
              onClick={() => setReloadNonce((n) => n + 1)}
              className="btn btn--default text-xs min-h-[44px] sm:min-h-[34px]"
            >
              重新加载
            </button>
          </div>
        ) : (
          <div className="empty-hint">
            <h1 className="text-base font-semibold text-slate-800 mb-2">未找到该群组</h1>
            <Link href="/themes" className="text-xs text-blue-600 hover:underline">
              返回多频工单列表
            </Link>
          </div>
        )}
      </>
    );
  }

  const cluster = row;
  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const unitLabel = isEcommerce ? "渠道/仓网" : "镇街";

  function memberWhy(m: Member) {
    if (m.region && cluster.region && m.region === cluster.region && m.category && m.category === cluster.type) {
      return `同${unitLabel}「${m.region}」且诉求分类「${m.category}」`;
    }
    if (m.region && cluster.region && m.region === cluster.region) return `同属${activeRegion?.name || "辖区"}「${m.region}」`;
    if (m.category && m.category === cluster.type) return `诉求分类同为「${m.category}」`;
    return `已深度关联主题「${cluster.title || cluster.type}」`;
  }

  return (
    <>
      <div className="breadcrumb flex-wrap">
        <Link href="/themes">多频工单</Link>
        <span>/</span>
        <Link href="/multifreq">工单透势</Link>
        <span>/</span>
        <span className="min-w-0 break-words">{cluster.region} · {cluster.type}</span>
      </div>

      {/* Hero 区域：左侧信息与指标，右侧毛玻璃 AI 处置建议卡片 */}
      <div className={`cluster-hero cluster-hero--${mode}`}>
        <div className="cluster-hero__layout">
          {/* 左侧主要信息与核心指标 */}
          <div className="cluster-hero__left">
            <div className="cluster-hero__row">
              <div className="cluster-hero__icon">{meta.icon}</div>
              <div className="cluster-hero__main">
                <h1 className="cluster-hero__title m-0">
                  <span>
                    {cluster.region} · {cluster.type}
                  </span>
                  <span className="hero-mode-badge">
                    {meta.icon} {meta.name}
                  </span>
                  {row.riskLevel === "HIGH" && (
                    <span
                      className="hero-mode-badge"
                      style={{
                        background: "rgba(220, 38, 38, 0.9)",
                        border: "1px solid rgba(255, 255, 255, 0.45)",
                      }}
                    >
                      <ShieldAlert className="h-3.5 w-3.5" />
                      高危督办
                    </span>
                  )}
                  {(row.fakeClosureCount ?? 0) > 0 && (
                    <span
                      className="hero-mode-badge"
                      style={{
                        background: "rgba(180, 83, 9, 0.92)",
                        border: "1px solid rgba(255, 255, 255, 0.45)",
                      }}
                    >
                      <AlertTriangle className="h-3.5 w-3.5" />
                      疑似假闭环 {fmtNum(row.fakeClosureCount)} 件
                    </span>
                  )}
                </h1>
                <div className="cluster-hero__sub">
                  {meta.tagline}
                  {row.title ? ` · ${row.title}` : ""}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-5 mt-1">
              <div className="cluster-hero__stat min-w-0">
                <div className="cluster-hero__stat-val tabular-nums">{fmtNum(row.count || 0)}</div>
                <div className="cluster-hero__stat-label">整合工单数（件）</div>
              </div>
              <div className="cluster-hero__stat min-w-0">
                <div className="cluster-hero__stat-val tabular-nums">{fmtNum(days)}</div>
                <div className="cluster-hero__stat-label">持续天数（天）</div>
              </div>
              <div className="cluster-hero__stat min-w-0">
                <div className="cluster-hero__stat-val tabular-nums">{row.ai_confidence == null ? "—" : `${row.ai_confidence}%`}</div>
                <div className="cluster-hero__stat-label">AI 聚类置信度</div>
              </div>
              {row.trend ? (
                <div className="cluster-hero__stat min-w-0">
                  <div className="cluster-hero__stat-val tabular-nums">{row.trend}</div>
                  <div className="cluster-hero__stat-label">近 7 天趋势</div>
                </div>
              ) : null}
            </div>

            {row.summary ? <div className="cluster-hero__summary">{row.summary}</div> : null}

            <div className="mode-explainer">
              <b>研判规则：</b>
              {meta.icon} {meta.name}（{meta.tagline}） · <b>触发依据：</b>
              {row.riskReason || row.mode_risk
                ? `${row.riskReason || row.mode_risk} · ${meta.rule}`
                : meta.rule}
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
                      <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>已复制</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
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
        {/* 左侧：成员工单明细列表 / 实体关系图谱 */}
        <div className="card min-w-0">
          <div className="card__header flex items-center justify-between gap-3 flex-wrap">
            <div className="min-w-0">
              <h2 className="card__title flex items-center gap-2 flex-wrap m-0">
                <span aria-hidden="true">{leftTab === "graph" ? "🕸️" : "📑"}</span>
                <span>{leftTab === "graph" ? "实体与工单关系图谱" : "群组成员工单明细"}</span>
                <span className="text-xs text-slate-500 font-normal tabular-nums whitespace-nowrap">
                  {leftTab === "graph"
                    ? graphData
                      ? `(${fmtNum(graphData.nodes.length)} 节点 · ${fmtNum(graphData.links.length)} 关系)`
                      : ""
                    : `(共 ${fmtNum(row.count)} 件 · 已加载 ${fmtNum(members.length)} 件)`}
                </span>
              </h2>
              <div className="text-[11px] text-slate-500 mt-0.5">
                {leftTab === "graph"
                  ? "展示当前专题与涉事主体、事发地点及关联工单（含假闭环复发边）拓扑"
                  : "点击单条工单可展开详细诉求正文、涉事地址与提取要素"}
              </div>
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              {targetTicketId && leftTab === "members" && (
                <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 bg-blue-50 px-3 py-1 rounded-full border border-blue-200 shadow-2xs">
                  <Target className="h-3.5 w-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                  <span>目标工单定位: #{targetTicketId}</span>
                </div>
              )}
              {!cluster.ungrouped && (
                <div
                  role="tablist"
                  aria-label="专题详情视图"
                  onKeyDown={(e) => {
                    if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                      e.preventDefault();
                      const next = leftTab === "members" ? "graph" : "members";
                      setLeftTab(next);
                      const targetRef = next === "members" ? membersTabRef : graphTabRef;
                      targetRef.current?.focus();
                      targetRef.current?.scrollIntoView({ block: "nearest", inline: "nearest" });
                    } else if (e.key === "Home") {
                      e.preventDefault();
                      setLeftTab("members");
                      membersTabRef.current?.focus();
                    } else if (e.key === "End") {
                      e.preventDefault();
                      setLeftTab("graph");
                      graphTabRef.current?.focus();
                    }
                  }}
                  className="inline-flex items-center rounded-lg bg-slate-100 p-0.5 border border-slate-200 text-xs max-w-full overflow-x-auto"
                >
                  <button
                    ref={membersTabRef}
                    id="tab-theme-members"
                    type="button"
                    role="tab"
                    aria-selected={leftTab === "members"}
                    tabIndex={leftTab === "members" ? 0 : -1}
                    onClick={() => setLeftTab("members")}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      leftTab === "members"
                        ? "bg-white text-blue-600 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>成员工单明细</span>
                  </button>
                  <button
                    ref={graphTabRef}
                    id="tab-theme-graph"
                    type="button"
                    role="tab"
                    aria-selected={leftTab === "graph"}
                    tabIndex={leftTab === "graph" ? 0 : -1}
                    onClick={() => setLeftTab("graph")}
                    className={`inline-flex items-center gap-1 px-2.5 py-1.5 sm:py-1 rounded-md font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                      leftTab === "graph"
                        ? "bg-white text-blue-600 shadow-2xs"
                        : "text-slate-600 hover:text-slate-900"
                    }`}
                  >
                    <Network className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                    <span>实体关系图谱</span>
                  </button>
                </div>
              )}
            </div>
          </div>

          <div
            className="card__body min-w-0"
            role={cluster.ungrouped ? undefined : "tabpanel"}
            aria-labelledby={
              cluster.ungrouped
                ? undefined
                : leftTab === "graph"
                  ? "tab-theme-graph"
                  : "tab-theme-members"
            }
            style={{ padding: leftTab === "graph" ? "12px" : "14px 18px" }}
          >
            {leftTab === "graph" ? (
              graphLoading ? (
                <div className="empty-hint">正在加载实体关系图谱…</div>
              ) : graphError ? (
                <div className="empty-hint space-y-2">
                  <div className="text-rose-600">{graphError}</div>
                  <button
                    type="button"
                    className="btn btn--default"
                    onClick={() => void loadThemeGraph()}
                  >
                    重新加载图谱
                  </button>
                </div>
              ) : !graphData || graphData.nodes.length === 0 ? (
                <div className="empty-hint">暂无实体与工单关联图谱数据</div>
              ) : (
                <GraphVisualizer graphData={graphData} embedded={true} />
              )
            ) : (
              <>
                {!cluster.ungrouped && (memberStats?.lowConfidenceUnverifiedCount ?? 0) > 0 && (
                  <div className="border border-amber-200 bg-amber-50/75 rounded-xl px-3.5 py-2.5 mb-3 flex items-center justify-between gap-3 flex-wrap">
                    <div className="flex items-start gap-2 text-xs text-amber-900 min-w-0 flex-1">
                      <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                      <span>
                        有 <b>{fmtNum(memberStats!.lowConfidenceUnverifiedCount)}</b> 条成员工单 AI 归属置信度低于{" "}
                        {memberStats!.lowConfidenceThreshold}%（待人工核验），建议先核验归属或移出误聚工单后再统一派单。
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        if (memberFilter === "low_confidence") {
                          setMemberFilter("all");
                          setMemberSort("time_desc");
                        } else {
                          setMemberFilter("low_confidence");
                          setMemberSort("confidence_asc");
                        }
                      }}
                      className="btn btn--default text-xs bg-white border-amber-300 text-amber-900 hover:bg-amber-100/60 shrink-0 whitespace-nowrap"
                    >
                      {memberFilter === "low_confidence"
                        ? "返回全部工单"
                        : `集中核验低置信度工单 (${fmtNum(memberStats!.lowConfidenceUnverifiedCount)})`}
                    </button>
                  </div>
                )}

                {!cluster.ungrouped && (
                  <div className="flex items-center justify-between gap-2 flex-wrap mb-3 pb-2.5 border-b border-slate-100">
                    <div className="flex items-center gap-1.5 flex-wrap" role="group" aria-label="成员工单筛选">
                      {(
                        [
                          {
                            key: "all" as const,
                            label: `全部 (${fmtNum(memberStats?.totalCount ?? row.count)})`,
                          },
                          {
                            key: "low_confidence" as const,
                            label: `低置信度待核验 <${memberStats?.lowConfidenceThreshold ?? LOW_CONFIDENCE_THRESHOLD}% (${fmtNum(memberStats?.lowConfidenceUnverifiedCount ?? 0)})`,
                          },
                          {
                            key: "verified" as const,
                            label: `已人工确认 (${fmtNum(memberStats?.verifiedCount ?? 0)})`,
                          },
                        ] as const
                      ).map((opt) => {
                        const active = memberFilter === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setMemberFilter(opt.key)}
                            className={`px-2.5 py-1.5 sm:py-1 rounded-lg text-xs font-medium border transition-colors cursor-pointer whitespace-nowrap tabular-nums ${
                              active
                                ? opt.key === "low_confidence"
                                  ? "bg-amber-50 text-amber-800 border-amber-300"
                                  : opt.key === "verified"
                                    ? "bg-emerald-50 text-emerald-800 border-emerald-300"
                                    : "bg-blue-50 text-blue-700 border-blue-200"
                                : "bg-white text-slate-600 border-slate-200 hover:bg-slate-50"
                            }`}
                          >
                            {opt.label}
                          </button>
                        );
                      })}
                    </div>
                    <select
                      aria-label="成员工单排序"
                      value={memberSort}
                      onChange={(e) =>
                        setMemberSort(e.target.value as "time_desc" | "confidence_asc" | "confidence_desc")
                      }
                      className="h-9 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-700 font-medium focus:outline-none focus:border-blue-500"
                    >
                      <option value="time_desc">按时间倒序</option>
                      <option value="confidence_asc">置信度从低到高</option>
                      <option value="confidence_desc">置信度从高到低</option>
                    </select>
                  </div>
                )}

                {members.length === 0 && (
              <div className="empty-hint">
                {membersLoading ? (
                  "正在加载工单…"
                ) : cluster.ungrouped ? (
                  "请从工单中心选择要查看的工单。"
                ) : memberFilter === "low_confidence" ? (
                  <div className="space-y-2">
                    <div>当前群组暂无待人工核验的低置信度工单</div>
                    <button
                      type="button"
                      className="btn btn--default text-xs"
                      onClick={() => {
                        setMemberFilter("all");
                        setMemberSort("time_desc");
                      }}
                    >
                      查看全部工单
                    </button>
                  </div>
                ) : memberFilter === "verified" ? (
                  <div className="space-y-2">
                    <div>暂无已人工确认归属的工单</div>
                    <button
                      type="button"
                      className="btn btn--default text-xs"
                      onClick={() => setMemberFilter("all")}
                    >
                      查看全部工单
                    </button>
                  </div>
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
              const confInfo = classifyConfidence(m.confidence);
              const isLowUnverified =
                !m.humanVerified && m.confidence != null && m.confidence < LOW_CONFIDENCE_THRESHOLD;
              const ticketKey = m.ticketId || m.id;
              const isVerifying = verifyingTicketId === ticketKey;

              return (
                <div
                  key={ticketKey}
                  id={`ticket-${m.id}`}
                  data-ticket-id={m.id}
                  className={`member-item transition-colors relative rounded-xl p-4 mb-3 cursor-pointer ${
                    isTarget
                      ? "is-target-ticket border border-blue-300 bg-blue-50/60"
                      : "bg-slate-50/85 hover:bg-slate-100/80"
                  }`}
                  onClick={() => void toggleExpand(m)}
                >
                  {/* 目标工单定位标识 */}
                  {isTarget && (
                    <div className="inline-flex items-center gap-1.5 text-xs font-semibold text-blue-700 mb-2">
                      <Target className="h-3.5 w-3.5" aria-hidden="true" />
                      <span>当前定位工单</span>
                    </div>
                  )}

                  <div className="member-item__head flex items-center flex-wrap gap-x-2.5 gap-y-1 mb-2">
                    <span className="member-item__id font-mono font-semibold text-xs text-slate-800">
                      #{m.id}
                    </span>
                    {m.humanVerified ? (
                      <>
                        <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 tabular-nums">
                          {m.confidence == null ? "已校准" : `置信度 ${m.confidence}%`}
                        </span>
                        <span
                          className="inline-flex items-center gap-1 bg-emerald-50 text-emerald-700 border border-emerald-200 px-2 py-0.5 rounded-full text-[11px] font-medium"
                          title={`确认人: ${m.verifiedBy || "管理员"} · ${formatMemberTime(m.verifiedAt)}`}
                        >
                          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>已人工确认归属</span>
                        </span>
                      </>
                    ) : isLowUnverified ? (
                      <span className="inline-flex items-center gap-1 bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full text-[11px] font-medium tabular-nums">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>低置信度 {m.confidence}% · 建议核验</span>
                      </span>
                    ) : confInfo.level === "high" && m.confidence != null ? (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 tabular-nums">
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>高置信度 {m.confidence}%</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-xs font-medium text-slate-600 tabular-nums">
                        <Sparkles className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>{m.confidence == null ? confInfo.label || "已校准" : `置信度 ${m.confidence}%`}</span>
                      </span>
                    )}
                    {m.category && (
                      <span
                        className="badge-pill text-xs font-medium"
                        style={categoryBadgeStyle(m.category)}
                      >
                        {m.category}
                      </span>
                    )}
                    {m.region && (
                      <span className="text-xs font-medium text-slate-600">
                        {m.region}
                      </span>
                    )}
                    {m.isFakeClosure && (
                      <span className="inline-flex items-center gap-1 text-xs font-semibold text-rose-700">
                        <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
                        疑似假闭环
                      </span>
                    )}
                    <span className="ml-auto text-xs text-slate-500 font-mono tabular-nums">
                      {formatMemberTime(m.createdAt)}
                    </span>
                  </div>

                  <div className="member-item__title text-sm font-bold text-slate-900 mb-1.5">
                    {m.title}
                  </div>

                  {(m.canonicalSubject || m.address) && (
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-slate-500 mb-2">
                      {m.canonicalSubject && (
                        <span className="inline-flex items-center gap-1 truncate max-w-full">
                          <Building2 className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                          <span className="truncate">涉事主体：{m.canonicalSubject}</span>
                        </span>
                      )}
                      {m.address && (
                        <span className="inline-flex items-center gap-1 truncate max-w-full">
                          <MapPin className="h-3 w-3 shrink-0 text-slate-400" aria-hidden="true" />
                          <span className="truncate">事发地点：{m.address}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {/* 工单正文容器（浅底无内框线，杜绝框套框） */}
                  <div className="bg-white/80 px-3 py-2.5 rounded-lg mb-2.5">
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
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-600 pt-2 border-t border-slate-200/70 mb-2.5">
                      {m.caller_name && (
                        <div className="flex items-center gap-1.5">
                          <User className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                          <span>诉求人：<b className="text-slate-800 font-medium">{m.caller_name}</b></span>
                        </div>
                      )}
                      {m.address && (
                        <div className="flex items-center gap-1.5">
                          <MapPin className="h-3.5 w-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                          <span>事发地址：<b className="text-slate-800 font-medium">{m.address}</b></span>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="member-item__why flex items-center justify-between gap-2 flex-wrap text-xs text-slate-600 pt-1.5 border-t border-slate-100/80">
                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                      <span className="shrink-0" aria-hidden="true">🔎</span>
                      <span className="truncate">
                        归入依据：<b className="text-slate-800 font-medium">{memberWhy(m)}</b>
                      </span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3 min-w-0">
                      <Link
                        href={`/tickets/${encodeURIComponent(ticketKey)}`}
                        onClick={(e) => e.stopPropagation()}
                        className="relative inline-flex items-center gap-1 min-h-[28px] py-1 text-[11px] font-medium text-slate-600 hover:text-blue-600 whitespace-nowrap transition-colors after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                      >
                        <ExternalLink className="h-3 w-3 shrink-0" aria-hidden="true" />
                        <span>查看工单详情</span>
                      </Link>
                      {!cluster.ungrouped && !m.humanVerified && (
                        <button
                          type="button"
                          disabled={!isAdmin || actionPending || Boolean(verifyingTicketId)}
                          title={!isAdmin ? "需管理员权限可执行处置" : "确认该工单归属于当前群组"}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleVerifyTicket(m, true);
                          }}
                          className="relative inline-flex items-center gap-1 min-h-[28px] min-w-0 py-1 text-[11px] font-medium text-emerald-700 hover:text-emerald-800 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                        >
                          <CheckCircle2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{isVerifying ? "确认中…" : "确认归属"}</span>
                        </button>
                      )}
                      {!cluster.ungrouped && m.humanVerified && (
                        <button
                          type="button"
                          disabled={!isAdmin || actionPending || Boolean(verifyingTicketId)}
                          title={!isAdmin ? "需管理员权限可执行处置" : "撤销人工归属确认"}
                          onClick={(e) => {
                            e.stopPropagation();
                            void handleVerifyTicket(m, false);
                          }}
                          className="relative inline-flex items-center gap-1 min-h-[28px] min-w-0 py-1 text-[11px] font-medium text-slate-600 hover:text-slate-800 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                        >
                          <RotateCcw className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>{isVerifying ? "处理中…" : "撤销确认"}</span>
                        </button>
                      )}
                      {!cluster.ungrouped && (
                        <button
                          type="button"
                          disabled={!isAdmin || actionPending || Boolean(verifyingTicketId)}
                          title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!isAdmin) return;
                            setDetachTarget(m);
                          }}
                          className="relative inline-flex items-center gap-1 min-h-[28px] min-w-0 py-1 text-[11px] font-medium text-rose-600 hover:text-rose-700 whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                        >
                          <Trash2 className="h-3 w-3 shrink-0" aria-hidden="true" />
                          <span>移出群组</span>
                        </button>
                      )}
                      <button
                        type="button"
                        aria-expanded={isExpanded}
                        onClick={(e) => {
                          e.stopPropagation();
                          void toggleExpand(m);
                        }}
                        className="relative inline-flex items-center gap-1 min-h-[28px] min-w-0 py-1 text-blue-600 font-semibold text-[11px] whitespace-nowrap bg-transparent border-0 cursor-pointer hover:text-blue-700 after:content-[''] after:absolute after:-inset-y-[8px] after:-inset-x-[4px]"
                      >
                        {openingId === (m.ticketId || m.id) ? (
                          <span>正在读取全文</span>
                        ) : isExpanded ? (
                          <>
                            <span>收起详情</span>
                            <ChevronUp className="h-3.5 w-3.5" aria-hidden="true" />
                          </>
                        ) : (
                          <>
                            <span>展开详情</span>
                            <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                          </>
                        )}
                      </button>
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
                {membersLoading ? "正在加载更多…" : `继续加载（已显示 ${fmtNum(members.length)} / ${fmtNum(row.count)}）`}
              </button>
            )}
            {membersDone && members.length > 0 && members.length >= (row.count || 0) && (
              <div className="empty-hint">已加载全部 {fmtNum(members.length)} 件</div>
            )}
              </>
            )}
          </div>
        </div>

        {/* 右侧：群组基本信息、AI 研判依据、5 节点进度追踪条与操作工具栏 */}
        <div className="min-w-0">
          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <h2 className="card__title m-0">📌 群组基本信息</h2>
            </div>
            <div className="card__body" style={{ padding: "8px 18px" }}>
              <div className="info-row">
                <span className="info-row__label">群组编号</span>
                <span className="info-row__value min-w-0 break-words">{row.code || row.id}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">群组类型</span>
                <span className="info-row__value min-w-0 break-words">
                  {meta.icon} {row.type}
                </span>
              </div>
              <div className="info-row">
                <span className="info-row__label">所属辖区</span>
                <span className="info-row__value min-w-0 break-words">{row.region || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">首件时间</span>
                <span className="info-row__value min-w-0 break-words">{row.first_date || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">末件时间</span>
                <span className="info-row__value min-w-0 break-words">{row.last_date || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">责任部门</span>
                <span className="info-row__value min-w-0 break-words">{row.status?.owner || `${activeRegion?.name || ""}热线督办组`}</span>
              </div>
            </div>
          </div>

          <div className="card" style={{ marginBottom: 14 }}>
            <div className="card__header">
              <h2 className="card__title m-0">🤖 AI 聚类研判依据</h2>
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
                          <div className="feature-list__head gap-2 min-w-0">
                            <span className="flex items-center gap-1.5 font-medium text-slate-700 min-w-0">
                              <span style={{ width: 6, height: 6, borderRadius: "50%", background: style.dot, display: "inline-block", flexShrink: 0 }} />
                              <span className="whitespace-nowrap shrink-0">{f.name}</span>
                              {f.desc ? (
                                <span className="text-xs text-slate-500 font-normal truncate min-w-0">
                                  {f.desc}
                                </span>
                              ) : null}
                            </span>
                            <span className="whitespace-nowrap shrink-0 tabular-nums" style={{ fontWeight: 700, color: style.text }}>{f.pct}%</span>
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
            <div className="card__header flex items-center justify-between gap-2 flex-wrap">
              <h2 className="card__title m-0">
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
                  {row.status?.label || "待派单"}
                </span>
              </h2>
              {!isRolePending && !isAdmin && (
                <span className="text-[11px] font-medium text-amber-700 bg-amber-50 border border-amber-200 px-2 py-0.5 rounded whitespace-nowrap">
                  只读受限态
                </span>
              )}
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
                <button
                  key={s.key}
                  type="button"
                  disabled={!isAdmin || actionPending || cluster.ungrouped}
                  onClick={() =>
                    void patchCluster(
                      { action: "ADVANCE", step: i + 1 },
                      `已推进进度至「${s.name}」`
                    )
                  }
                  className="progress-step w-full text-left rounded-lg px-2 -mx-2 hover:bg-slate-50 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  title={
                    !isAdmin
                      ? "需管理员权限可执行处置"
                      : cluster.ungrouped
                      ? "未聚类分组不可推进"
                      : `点击推进至第 ${i + 1} 阶段：${s.name}`
                  }
                >
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
                </button>
              ))}
              <div className="info-row" style={{ marginTop: 6 }}>
                <span className="info-row__label">预计办结</span>
                <span className="info-row__value min-w-0 break-words">{row.status?.eta || "—"}</span>
              </div>
              <div className="info-row">
                <span className="info-row__label">牵头部门</span>
                <span className="info-row__value min-w-0 break-words">{row.status?.owner || (cluster.ungrouped ? "—" : `${activeRegion?.name || ""}热线督办组`)}</span>
              </div>
            </div>
          </div>

          {/* 底部操作工具栏：真闭环处置 + 导出报告 */}
          {!isRolePending && !isAdmin && !cluster.ungrouped && (
            <div className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50/80 px-3 py-2 text-xs text-amber-800 flex items-center gap-1.5">
              <ShieldAlert className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>需管理员权限可执行派单、推进、升级、办结、重开或移出工单处置</span>
            </div>
          )}
          {!cluster.ungrouped && (row.fakeClosureCount ?? 0) > 0 && row.status?.code === "RESOLVED" && (
            <div className="mt-3.5 rounded-lg border border-amber-200 bg-amber-50/90 px-3 py-2 text-xs text-amber-900 flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
              <span>
                本专题关联 {fmtNum(row.fakeClosureCount)} 件疑似假闭环工单，建议点击「重开督办」恢复跟进。
              </span>
            </div>
          )}
          {(() => {
            const primaryIsDispatch = !cluster.ungrouped && (row.status?.code === "PENDING" || !row.status?.owner);
            return (
              <div className="grid grid-cols-2 sm:flex sm:flex-wrap gap-2 mb-3.5 mt-3.5">
                {!cluster.ungrouped && (
                  <>
                    <button
                      type="button"
                      disabled={!isAdmin || actionPending}
                      title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                      className={`btn ${primaryIsDispatch ? "btn--primary" : "btn--default"} flex items-center justify-center gap-1.5 min-w-0 sm:flex-1 min-h-[44px] sm:min-h-[36px] px-2.5 text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed`}
                      onClick={openDispatchDialog}
                    >
                      <Send className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{row.status?.owner || row.status?.code !== "PENDING" ? "重新指派 / 编辑派单" : "采纳建议并派单"}</span>
                    </button>
                    <button
                      type="button"
                      disabled={!isAdmin || actionPending}
                      title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                      className="btn btn--default flex items-center justify-center gap-1.5 text-rose-700 border-rose-200 hover:border-rose-400 min-w-0 sm:flex-1 min-h-[44px] sm:min-h-[36px] px-2.5 text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                      onClick={() => {
                        setEscalateNote("");
                        setEscalateOpen(true);
                      }}
                    >
                      <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                      <span>升级督办</span>
                    </button>
                    {row.status?.code === "RESOLVED" ? (
                      <button
                        type="button"
                        disabled={!isAdmin || actionPending}
                        title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                        className="btn btn--default flex items-center justify-center gap-1.5 text-amber-700 border-amber-200 hover:border-amber-400 min-w-0 sm:flex-1 min-h-[44px] sm:min-h-[36px] px-2.5 text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() =>
                          void patchCluster(
                            { action: "REOPEN", note: "管理员发起重开督办" },
                            "已重开群组督办"
                          )
                        }
                      >
                        <RotateCcw className="h-3.5 w-3.5 shrink-0" />
                        <span>重开督办</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        disabled={!isAdmin || actionPending}
                        title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                        className="btn btn--default flex items-center justify-center gap-1.5 text-emerald-700 border-emerald-200 hover:border-emerald-400 min-w-0 sm:flex-1 min-h-[44px] sm:min-h-[36px] px-2.5 text-xs whitespace-nowrap disabled:opacity-50 disabled:cursor-not-allowed"
                        onClick={() =>
                          void patchCluster(
                            { action: "RESOLVE", note: "管理员确认办结归档" },
                            "群组已办结归档"
                          )
                        }
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                        <span>办结归档</span>
                      </button>
                    )}
                  </>
                )}
                <button
                  type="button"
                  className={`btn ${primaryIsDispatch ? "btn--default" : "btn--primary"} flex items-center justify-center gap-1.5 min-w-0 sm:flex-1 min-h-[44px] sm:min-h-[36px] px-2.5 text-xs whitespace-nowrap`}
                  onClick={exportReport}
                >
                  <Download className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{row.riskLevel === "HIGH" ? "生成重点督办单" : "生成群组报告"}</span>
                </button>
              </div>
            );
          })()}

          <DisposalTimeline logs={row.disposalLogs || []} />
        </div>
      </div>

      {/* 派单确认弹窗 */}
      <Dialog
        open={dispatchOpen}
        onOpenChange={(open) => {
          if (!open && !actionPending) setDispatchOpen(open);
        }}
      >
        <DialogContent
          closeDisabled={actionPending}
          onEscapeKeyDown={(e) => {
            if (actionPending) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (actionPending) e.preventDefault();
          }}
          className="w-[calc(100vw-1.5rem)] max-w-[460px] max-h-[90dvh] overflow-y-auto gap-4 border-[var(--c-border)] bg-[var(--c-surface)] p-0 shadow-xl rounded-xl text-[var(--c-ink)]"
        >
          <DialogHeader className="space-y-1.5 px-5 pt-5 text-left">
            <DialogTitle className="text-[15px] font-semibold text-[var(--c-ink)]">
              {row.status?.owner || row.status?.code !== "PENDING" ? "重新指派责任部门" : "采纳建议并派单处置"}
            </DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--c-ink-3)]">
              提交后将更新群组与成员工单状态为处理中，并记录处置流转日志。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleDispatchSubmit} className="space-y-3 px-5">
            {(memberStats?.lowConfidenceUnverifiedCount ?? 0) > 0 && (
              <div
                role="alert"
                className="rounded-lg border border-amber-200 bg-amber-50/85 px-3 py-2.5 text-xs text-amber-900 space-y-2"
              >
                <div className="flex items-start gap-2">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" aria-hidden="true" />
                  <span>
                    提示：当前群组尚有 <b>{fmtNum(memberStats!.lowConfidenceUnverifiedCount)}</b> 条置信度低于{" "}
                    {memberStats!.lowConfidenceThreshold}% 的工单未经人工确认，建议先核验归属后再批量派单。
                  </span>
                </div>
                <div className="flex justify-end">
                  <button
                    type="button"
                    className="btn btn--default text-xs bg-white border-amber-300 text-amber-900 hover:bg-amber-100/60"
                    onClick={() => {
                      setDispatchOpen(false);
                      setLeftTab("members");
                      setMemberFilter("low_confidence");
                      setMemberSort("confidence_asc");
                    }}
                  >
                    去集中核验
                  </button>
                </div>
              </div>
            )}
            <div>
              <label htmlFor="dispatch-owner-input" className="block text-xs font-medium text-slate-700 mb-1">
                牵头承办部门
              </label>
              <input
                id="dispatch-owner-input"
                type="text"
                value={dispatchOwner}
                onChange={(e) => setDispatchOwner(e.target.value)}
                placeholder="例如：区城市管理和综合执法局（留空自动取默认值）"
                className="w-full h-11 sm:h-9 px-3 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="dispatch-eta-input" className="block text-xs font-medium text-slate-700 mb-1">
                预计办结时间（默认 +2 工作日）
              </label>
              <input
                id="dispatch-eta-input"
                type="date"
                value={dispatchEta}
                onChange={(e) => setDispatchEta(e.target.value)}
                className="w-full h-11 sm:h-9 px-3 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label htmlFor="dispatch-note-input" className="block text-xs font-medium text-slate-700 mb-1">
                派单要求与备注
              </label>
              <textarea
                id="dispatch-note-input"
                rows={3}
                value={dispatchNote}
                onChange={(e) => setDispatchNote(e.target.value)}
                placeholder="填写现场核查要求、协同部门或督办意见（可选）"
                className="w-full p-2.5 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2 border-t border-[var(--c-border-soft)] -mx-5 px-5 py-3">
              <button
                type="button"
                className="btn btn--default"
                disabled={actionPending}
                onClick={() => setDispatchOpen(false)}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                disabled={!isAdmin || actionPending}
              >
                {actionPending ? "提交中…" : "确认派单"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 升级督办弹窗 */}
      <Dialog
        open={escalateOpen}
        onOpenChange={(open) => {
          if (!open && !actionPending) setEscalateOpen(open);
        }}
      >
        <DialogContent
          closeDisabled={actionPending}
          onEscapeKeyDown={(e) => {
            if (actionPending) e.preventDefault();
          }}
          onPointerDownOutside={(e) => {
            if (actionPending) e.preventDefault();
          }}
          className="w-[calc(100vw-1.5rem)] max-w-[440px] max-h-[90dvh] overflow-y-auto gap-4 border-[var(--c-border)] bg-[var(--c-surface)] p-0 shadow-xl rounded-xl text-[var(--c-ink)]"
        >
          <DialogHeader className="space-y-1.5 px-5 pt-5 text-left">
            <DialogTitle className="text-[15px] font-semibold text-[var(--c-ink)]">
              升级为重点高危督办
            </DialogTitle>
            <DialogDescription className="text-[12px] text-[var(--c-ink-3)]">
              群组风险等级将提升为高危（HIGH），并记录重点督办原因与操作日志。
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEscalateSubmit} className="space-y-3 px-5">
            <div>
              <label htmlFor="escalate-note-input" className="block text-xs font-medium text-slate-700 mb-1">
                督办说明
              </label>
              <textarea
                id="escalate-note-input"
                rows={3}
                value={escalateNote}
                onChange={(e) => setEscalateNote(e.target.value)}
                placeholder="请填写升级督办的具体原因或整改时限要求…"
                className="w-full p-2.5 rounded-lg border border-slate-200 bg-white text-base sm:text-xs text-slate-900 focus:outline-none focus:border-blue-500 resize-none"
              />
            </div>
            <DialogFooter className="flex-row justify-end gap-2 border-t border-[var(--c-border-soft)] -mx-5 px-5 py-3">
              <button
                type="button"
                className="btn btn--default"
                disabled={actionPending}
                onClick={() => setEscalateOpen(false)}
              >
                取消
              </button>
              <button
                type="submit"
                className="btn btn--primary"
                style={{ background: "#DC2626", borderColor: "#DC2626" }}
                disabled={!isAdmin || actionPending}
              >
                {actionPending ? "提交中…" : "确认升级督办"}
              </button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 移出群组二次确认弹窗 */}
      <ConfirmDialog
        open={Boolean(detachTarget)}
        title="确认将该工单移出当前群组？"
        description={
          detachTarget
            ? `工单 #${detachTarget.id}（${detachTarget.title}）将解除与本专题群组的关联，并重算群组工单总数。`
            : undefined
        }
        confirmLabel="确认移出"
        destructive
        pending={actionPending}
        onConfirm={() => void handleConfirmDetach()}
        onOpenChange={(open) => {
          if (!open) setDetachTarget(null);
        }}
      />
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
