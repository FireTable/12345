"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { toast } from "sonner";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import {
  Layers,
  ExternalLink,
  ChevronLeft,
  ChevronDown,
  ChevronUp,
  CheckCircle2,
  Clock,
  RotateCcw,
  Wrench,
  AlertTriangle,
  ShieldAlert,
  Trash2,
} from "lucide-react";
import { SkTicketDetail } from "@/app/_components/civic/skeletons";
import {
  categoryBadgeStyle,
  getCategoryBadgeClass,
  getUrgencyLabel,
  normalizeStatusCode,
} from "@/lib/civic-dto";
import { CIVIC_CATEGORIES } from "@/lib/civic-cluster";
import { AiVerdictCard, CitizenVoiceCard, TicketPropsGrid } from "@/app/_components/civic/ticket-verdict-view";
import { DisposalTimeline, type DisposalLogItem } from "@/app/_components/civic/disposal-timeline";
import { useRegion } from "@/app/_components/civic/region-context";
import { useAuthRole } from "@/lib/auth/use-role";
import { ConfirmDialog } from "@/app/_components/ui/confirm-dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/app/_components/ui/select";

function statusLabel(s: string) {
  const code = normalizeStatusCode(s);
  if (code === "RESOLVED") return "已办结";
  if (code === "IN_PROGRESS") return "处理中";
  return "待处理";
}

function statusTag(s: string) {
  const code = normalizeStatusCode(s);
  if (code === "RESOLVED") return "done";
  if (code === "IN_PROGRESS") return "progress";
  return "pending";
}

const SEVEN_CATEGORIES: readonly string[] = CIVIC_CATEGORIES.slice(0, 7);

const ALIAS_TYPE_OPTIONS = [
  { value: "SUBJECT", label: "涉事主体" },
  { value: "LOCATION", label: "地标地点" },
  { value: "TOWNSHIP", label: "镇街名称" },
  { value: "DEPARTMENT", label: "责任部门" },
] as const;

export default function TicketDetailPage() {
  const { activeRegion, isLoading: regionLoading } = useRegion();
  const { isAdmin, isPending: isRolePending } = useAuthRole();
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<any>(null);
  const [load, setLoad] = useState<DetailLoadStatus>("pending");
  const [actionPending, setActionPending] = useState(false);
  const isMountedRef = useRef(true);
  const patchAbortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      patchAbortRef.current?.abort();
    };
  }, []);

  // 状态流转备注
  const [statusNote, setStatusNote] = useState("");

  // 人工纠偏折叠面板与表单状态
  const [correctionOpen, setCorrectionOpen] = useState(false);
  const [subdistrict, setSubdistrict] = useState("");
  const [sourceCategory, setSourceCategory] = useState("");
  const [canonicalSubject, setCanonicalSubject] = useState("");
  const [address, setAddress] = useState("");
  const [eventType, setEventType] = useState("");
  const [urgency, setUrgency] = useState("NORMAL");
  const [correctionNote, setCorrectionNote] = useState("");
  const [saveAsAlias, setSaveAsAlias] = useState(false);
  const [aliasType, setAliasType] = useState<"TOWNSHIP" | "LOCATION" | "SUBJECT" | "DEPARTMENT">("SUBJECT");
  const [aliasText, setAliasText] = useState("");
  const [canonicalText, setCanonicalText] = useState("");

  // 移出群组确认弹窗
  const [detachConfirmOpen, setDetachConfirmOpen] = useState(false);

  function syncCorrectionForm(data: any) {
    if (!data) return;
    setSubdistrict(data.subdistrict ?? (data.region && data.region !== "未知" ? data.region : ""));
    setSourceCategory(data.sourceCategory || data.category || "");
    setCanonicalSubject(data.canonicalSubject || "");
    setAddress(data.address || "");
    setEventType(data.eventType || "");
    setUrgency((data.urgency || "NORMAL").toUpperCase());
  }

  useEffect(() => {
    if (regionLoading || isRolePending || !isAdmin) return;
    const controller = new AbortController();
    setLoad("pending");
    setRow(null);
    const headers: Record<string, string> = {};
    if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
    fetch(`/api/workorders/${encodeURIComponent(params.id)}`, {
      headers,
      signal: controller.signal,
    })
      .then((r) => r.json())
      .then((j) => {
        if (controller.signal.aborted) return;
        setRow(j);
        syncCorrectionForm(j);
        setLoad("done");
      })
      .catch((err) => {
        if (controller.signal.aborted || err?.name === "AbortError") return;
        setRow(null);
        setLoad("error");
      });
    return () => {
      controller.abort();
    };
  }, [params.id, activeRegion?.id, regionLoading, isAdmin, isRolePending]);

  async function patchWorkorder(
    payload: {
      action: "UPDATE_STATUS" | "CORRECT_ENTITY" | "DETACH_THEME";
      status?: "PENDING" | "IN_PROGRESS" | "RESOLVED";
      note?: string;
      correction?: {
        subdistrict?: string;
        sourceCategory?: string;
        canonicalSubject?: string;
        address?: string;
        eventType?: string;
        urgency?: string;
      };
      saveAlias?: {
        alias: string;
        canonical: string;
        type?: "TOWNSHIP" | "LOCATION" | "SUBJECT" | "DEPARTMENT";
      };
    },
    successMsg: string
  ): Promise<boolean> {
    if (!isAdmin) {
      toast.error("需管理员权限可执行工单处置");
      return false;
    }
    if (!row || actionPending) return false;
    patchAbortRef.current?.abort();
    const controller = new AbortController();
    patchAbortRef.current = controller;
    setActionPending(true);
    try {
      const targetId = row.ticketId || row.id || params.id;
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (activeRegion?.id) headers["x-region-id"] = activeRegion.id;
      const res = await fetch(`/api/workorders/${encodeURIComponent(targetId)}`, {
        method: "PATCH",
        headers,
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      const json = await res.json().catch(() => ({}));
      if (controller.signal.aborted || !isMountedRef.current) return false;
      if (!res.ok || !json.success) {
        throw new Error(json.error || `操作失败 (${res.status})`);
      }
      setRow(json);
      syncCorrectionForm(json);
      toast.success(successMsg);
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("civic-data-refresh"));
      }
      return true;
    } catch (err: any) {
      if (controller.signal.aborted || err?.name === "AbortError" || !isMountedRef.current) return false;
      toast.error(err instanceof Error ? err.message : "工单更新失败");
      return false;
    } finally {
      if (isMountedRef.current && !controller.signal.aborted) {
        setActionPending(false);
      }
    }
  }

  async function handleStatusChange(nextStatus: "PENDING" | "IN_PROGRESS" | "RESOLVED") {
    const label = nextStatus === "RESOLVED" ? "已办结" : nextStatus === "IN_PROGRESS" ? "处理中" : "待处理";
    const ok = await patchWorkorder(
      {
        action: "UPDATE_STATUS",
        status: nextStatus,
        note: statusNote.trim() || undefined,
      },
      `工单状态已更新为「${label}」`
    );
    if (ok) setStatusNote("");
  }

  async function handleCorrectionSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saveAsAlias) {
      if (!aliasText.trim() || !canonicalText.trim()) {
        toast.error("勾选沉淀知识库时，请填写原口语别名与标准名称");
        return;
      }
    }
    const ok = await patchWorkorder(
      {
        action: "CORRECT_ENTITY",
        note: correctionNote.trim() || undefined,
        correction: {
          subdistrict: subdistrict.trim(),
          ...(sourceCategory.trim() ? { sourceCategory: sourceCategory.trim() } : {}),
          canonicalSubject: canonicalSubject.trim(),
          address: address.trim(),
          eventType: eventType.trim(),
          urgency,
        },
        ...(saveAsAlias
          ? {
              saveAlias: {
                alias: aliasText.trim(),
                canonical: canonicalText.trim(),
                type: aliasType,
              },
            }
          : {}),
      },
      saveAsAlias ? "纠偏结果已保存并沉淀至标准别名库" : "人工纠偏已保存"
    );
    if (ok) {
      setCorrectionNote("");
      setSaveAsAlias(false);
      setAliasText("");
      setCanonicalText("");
    }
  }

  async function handleConfirmDetachTheme() {
    const ok = await patchWorkorder(
      { action: "DETACH_THEME" },
      "已将该工单移出当前群组"
    );
    if (ok) setDetachConfirmOpen(false);
  }

  if (isRolePending || !isAdmin) {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/tickets">工单中心</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <SkTicketDetail />
      </>
    );
  }

  const view = classifyDetailPayload(load, row);
  if (view === "loading") {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/tickets">工单中心</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <SkTicketDetail />
      </>
    );
  }
  if (view === "missing" || !row) {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/tickets">工单中心</Link>
          <span>/</span>
          <span>详情</span>
        </div>
        <div className="empty-hint">未找到该工单</div>
      </>
    );
  }

  const clusterId = row.cluster_info?.id || row.cluster_id || "";
  const currentStatus = normalizeStatusCode(row.status);
  const logs: DisposalLogItem[] = Array.isArray(row.disposalLogs) ? row.disposalLogs : [];
  const isEcommerce = activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS";
  const unitLabel = activeRegion?.domainProfile?.terminology?.regionUnit || "所属镇街";
  const domainCategories = activeRegion?.domainProfile?.categories;
  const baseCategories = domainCategories?.length ? domainCategories : SEVEN_CATEGORIES;
  const categoryOptions = sourceCategory && !baseCategories.includes(sourceCategory as any)
    ? [sourceCategory, ...baseCategories]
    : baseCategories;

  return (
    <>
      <div className="breadcrumb flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-1.5 min-w-0 flex-wrap">
          <Link href="/tickets" className="hover:underline flex items-center gap-1 whitespace-nowrap">
            <ChevronLeft className="w-3.5 h-3.5 shrink-0" />
            <span>工单中心</span>
          </Link>
          <span>/</span>
          <span className="font-mono tabular-nums break-all">{row.id}</span>
        </div>
        <Link
          href="/tickets"
          className="text-xs text-slate-500 hover:text-slate-800 transition-colors whitespace-nowrap"
        >
          返回工单列表
        </Link>
      </div>

      <div className="page-hero" style={{ marginBottom: 20 }}>
        <div>
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <span className="font-mono text-xs font-bold text-slate-700 bg-slate-100 px-2 py-0.5 rounded border border-slate-200">
              #{row.id}
            </span>
            {row.category && (
              <span
                className={`badge-pill ${getCategoryBadgeClass(row.category)}`}
                style={categoryBadgeStyle(row.category)}
              >
                {row.category}
              </span>
            )}
            <span className={`status-tag status-tag--${statusTag(row.status)}`}>
              {statusLabel(row.status)}
            </span>
            <span
              className={`badge-pill ${row.urgency === "URGENT" ? "badge-pill--danger" : row.urgency === "MEDIUM" ? "badge-pill--warning" : "badge-pill--default"}`}
            >
              {getUrgencyLabel(row.urgency)}
            </span>
            {row.isFakeClosure && (
              <span className="badge-pill badge-pill--danger inline-flex items-center gap-1">
                <AlertTriangle className="w-3 h-3" />
                疑似假闭环
              </span>
            )}
            {row.closureStatus === "REOPENED" && (
              <span className="badge-pill badge-pill--warning">
                复发重开
              </span>
            )}
            {clusterId && (
              <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                多频专题已归集
              </span>
            )}
          </div>
          <h1 className="page-hero__title" style={{ fontSize: 20, fontWeight: 700 }}>
            {row.title}
          </h1>
          {row.rawTitle && row.rawTitle !== row.title && (
            <div style={{ fontSize: 13, color: "var(--c-ink-3)", marginTop: 4 }}>
              市民原报原由：{row.rawTitle}
            </div>
          )}
          <div className="page-hero__sub" style={{ marginTop: 6 }}>
            {[row.region, row.createdAt, row.closedAt ? `办结于 ${String(row.closedAt).slice(0, 10)}` : ""].filter(Boolean).join(" · ")}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左侧主要区域：AI 研判解析与市民诉求原文 (8列) */}
        <div className="lg:col-span-8 space-y-4 min-w-0">
          {/* 1. AI 智能研判解析卡片 (复用统一组件) */}
          <AiVerdictCard data={row} />

          {/* 2. 市民原始诉求卡片 (复用统一组件) */}
          <CitizenVoiceCard data={row} />
        </div>

        {/* 右侧边栏区域：经办属性、工单处置与人工纠偏、群组联动、处置时间轴 (4列) */}
        <div className="lg:col-span-4 space-y-4 min-w-0">
          {/* 1. 经办基础属性 */}
          <TicketPropsGrid data={row} />

          {/* 2. 工单处置与人工纠偏卡片 */}
          <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3.5 shadow-2xs">
            <div className="flex items-center justify-between gap-2 pb-2 border-b border-slate-100">
              <div className="flex items-center gap-1.5 text-xs font-bold text-slate-800">
                <Wrench className="w-4 h-4 text-blue-600 shrink-0" />
                <span>工单处置与人工纠偏</span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                {!isRolePending && !isAdmin && (
                  <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">
                    只读受限
                  </span>
                )}
                <span className={`status-tag shrink-0 status-tag--${statusTag(row.status)}`}>
                  {statusLabel(row.status)}
                </span>
              </div>
            </div>

            {!isRolePending && !isAdmin && (
              <div className="rounded-lg border border-amber-200 bg-amber-50/80 px-2.5 py-2 text-[11px] text-amber-800 flex items-center gap-1.5">
                <ShieldAlert className="w-3.5 h-3.5 shrink-0" />
                <span>需管理员权限可执行状态流转、实体纠偏与移出群组处置</span>
              </div>
            )}

            {/* 状态流转区 */}
            <div className="space-y-2">
              <label htmlFor="ticket-status-note" className="block text-[11px] font-medium text-slate-500">
                状态流转与处置备注
              </label>
              <input
                id="ticket-status-note"
                type="text"
                value={statusNote}
                disabled={!isAdmin || actionPending}
                onChange={(e) => setStatusNote(e.target.value)}
                placeholder={isAdmin ? "填写本次处置说明或办结情况（可选）" : "需管理员权限可填写处置备注"}
                className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-slate-50/70 text-xs text-slate-900 focus:outline-none focus:bg-white focus:border-blue-500 disabled:opacity-60 disabled:cursor-not-allowed"
              />
              <div className="grid grid-cols-3 gap-1.5">
                <button
                  type="button"
                  disabled={!isAdmin || actionPending || currentStatus === "PENDING"}
                  title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                  onClick={() => void handleStatusChange("PENDING")}
                  className={`btn justify-center text-xs min-h-[44px] sm:min-h-[32px] py-1.5 px-2 min-w-0 whitespace-nowrap ${
                    currentStatus === "PENDING"
                      ? "bg-amber-50 text-amber-700 border-amber-200 cursor-default"
                      : "btn--default"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span>待处理</span>
                </button>
                <button
                  type="button"
                  disabled={!isAdmin || actionPending || (currentStatus === "IN_PROGRESS" && !statusNote.trim())}
                  title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                  onClick={() => void handleStatusChange("IN_PROGRESS")}
                  className={`btn justify-center text-xs min-h-[44px] sm:min-h-[32px] py-1.5 px-2 min-w-0 whitespace-nowrap ${
                    currentStatus === "IN_PROGRESS"
                      ? "bg-blue-50 text-blue-700 border-blue-200"
                      : "btn--default"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  {currentStatus === "RESOLVED" ? (
                    <>
                      <RotateCcw className="w-3.5 h-3.5 shrink-0" />
                      <span>重开处理</span>
                    </>
                  ) : (
                    <span>处理中</span>
                  )}
                </button>
                <button
                  type="button"
                  disabled={!isAdmin || actionPending || currentStatus === "RESOLVED"}
                  title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                  onClick={() => void handleStatusChange("RESOLVED")}
                  className={`btn justify-center text-xs min-h-[44px] sm:min-h-[32px] py-1.5 px-2 min-w-0 whitespace-nowrap ${
                    currentStatus === "RESOLVED"
                      ? "bg-emerald-50 text-emerald-700 border-emerald-200 cursor-default"
                      : "btn--primary"
                  } disabled:opacity-60 disabled:cursor-not-allowed`}
                >
                  <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                  <span>一键办结</span>
                </button>
              </div>
            </div>

            {/* 人工纠偏折叠面板 */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                aria-expanded={correctionOpen}
                onClick={() => setCorrectionOpen((prev) => !prev)}
                className="w-full flex items-center justify-between text-xs font-semibold text-slate-700 hover:text-blue-600 py-1.5 min-h-[44px] sm:min-h-[36px] cursor-pointer transition-colors"
              >
                <span>人工纠偏要素与知识沉淀</span>
                {correctionOpen ? (
                  <ChevronUp className="w-4 h-4 text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
                )}
              </button>

              {correctionOpen && (
                <form onSubmit={handleCorrectionSubmit} className="mt-2.5 space-y-2.5">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-2">
                    <div className="min-w-0">
                      <label htmlFor="corr-subdistrict" className="block text-[11px] text-slate-500 mb-1">{unitLabel}</label>
                      <input
                        id="corr-subdistrict"
                        type="text"
                        value={subdistrict}
                        disabled={!isAdmin || actionPending}
                        onChange={(e) => setSubdistrict(e.target.value)}
                        placeholder={isEcommerce ? "如：天猫旗舰店" : "如：大良街道"}
                        className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="corr-category" className="block text-[11px] text-slate-500 mb-1">诉求分类</label>
                      <Select
                        value={sourceCategory || undefined}
                        onValueChange={setSourceCategory}
                        disabled={!isAdmin || actionPending}
                      >
                        <SelectTrigger id="corr-category" className="w-full h-11 sm:h-8 bg-white border-slate-200 text-xs text-slate-900 rounded-lg">
                          <SelectValue placeholder="选择分类" />
                        </SelectTrigger>
                        <SelectContent>
                          {categoryOptions.map((cat) => (
                            <SelectItem key={cat} value={cat}>
                              {cat}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="corr-subject" className="block text-[11px] text-slate-500 mb-1">涉事主体</label>
                    <input
                      id="corr-subject"
                      type="text"
                      value={canonicalSubject}
                      disabled={!isAdmin || actionPending}
                      onChange={(e) => setCanonicalSubject(e.target.value)}
                      placeholder="填写标准化涉事主体名称"
                      className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label htmlFor="corr-address" className="block text-[11px] text-slate-500 mb-1">事发地址</label>
                    <input
                      id="corr-address"
                      type="text"
                      value={address}
                      disabled={!isAdmin || actionPending}
                      onChange={(e) => setAddress(e.target.value)}
                      placeholder="填写微观事发地址"
                      className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 sm:gap-2">
                    <div className="min-w-0">
                      <label htmlFor="corr-event-type" className="block text-[11px] text-slate-500 mb-1">细分事件类型</label>
                      <input
                        id="corr-event-type"
                        type="text"
                        value={eventType}
                        disabled={!isAdmin || actionPending}
                        onChange={(e) => setEventType(e.target.value)}
                        placeholder="如：夜间施工噪音"
                        className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                      />
                    </div>
                    <div className="min-w-0">
                      <label htmlFor="corr-urgency" className="block text-[11px] text-slate-500 mb-1">紧急程度</label>
                      <Select
                        value={urgency}
                        onValueChange={setUrgency}
                        disabled={!isAdmin || actionPending}
                      >
                        <SelectTrigger id="corr-urgency" className="w-full h-11 sm:h-8 bg-white border-slate-200 text-xs text-slate-900 rounded-lg">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="NORMAL">普通</SelectItem>
                          <SelectItem value="MEDIUM">较急</SelectItem>
                          <SelectItem value="URGENT">紧急</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div>
                    <label htmlFor="corr-note" className="block text-[11px] text-slate-500 mb-1">纠偏说明</label>
                    <input
                      id="corr-note"
                      type="text"
                      value={correctionNote}
                      disabled={!isAdmin || actionPending}
                      onChange={(e) => setCorrectionNote(e.target.value)}
                      placeholder="说明人工调整原因（可选）"
                      className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </div>

                  <div className="rounded-lg border border-slate-200/80 bg-slate-50/70 p-2.5 space-y-2">
                    <label className="flex items-center gap-2 min-h-[44px] sm:min-h-[28px] text-xs font-medium text-slate-700 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={saveAsAlias}
                        disabled={!isAdmin || actionPending}
                        onChange={(e) => {
                          const checked = e.target.checked;
                          setSaveAsAlias(checked);
                          if (checked && !canonicalText) {
                            setCanonicalText(canonicalSubject || address || subdistrict || "");
                          }
                        }}
                        className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                      />
                      <span>同步沉淀为标准别名知识库</span>
                    </label>
                    {saveAsAlias && (
                      <div className="space-y-2 pt-1">
                        <Select
                          value={aliasType}
                          onValueChange={(v) => setAliasType(v as typeof aliasType)}
                          disabled={!isAdmin || actionPending}
                        >
                          <SelectTrigger className="w-full h-11 sm:h-8 bg-white border-slate-200 text-xs text-slate-900 rounded-lg">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ALIAS_TYPE_OPTIONS.map((opt) => (
                              <SelectItem key={opt.value} value={opt.value}>
                                别名类型：{opt.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          <input
                            type="text"
                            aria-label="原口语别名"
                            value={aliasText}
                            disabled={!isAdmin || actionPending}
                            onChange={(e) => setAliasText(e.target.value)}
                            placeholder="原口语别名"
                            className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                          />
                          <input
                            type="text"
                            aria-label="对应标准名称"
                            value={canonicalText}
                            disabled={!isAdmin || actionPending}
                            onChange={(e) => setCanonicalText(e.target.value)}
                            placeholder="对应标准名称"
                            className="w-full h-11 sm:h-8 px-2.5 rounded-lg border border-slate-200 bg-white text-xs text-slate-900 focus:outline-none focus:border-blue-500 disabled:bg-slate-50 disabled:opacity-60"
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <button
                    type="submit"
                    disabled={!isAdmin || actionPending}
                    title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                    className="btn btn--primary w-full justify-center text-xs min-h-[44px] sm:min-h-[34px] py-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {!isAdmin
                      ? "需管理员权限可执行处置"
                      : actionPending
                      ? "保存中…"
                      : "保存人工纠偏"}
                  </button>
                </form>
              )}
            </div>
          </div>

          {/* 3. 归属多频专题联动卡片 */}
          {clusterId && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900 pb-2 border-b border-slate-100">
                <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                <span>归属多频研判群组</span>
              </div>
              <div className="text-sm font-bold text-slate-800 leading-snug break-words">
                {row.cluster_info?.title || `${row.region} · ${row.category}专项`}
              </div>
              <div className="text-xs text-slate-500 leading-relaxed">
                该工单已被 Civic Agent 识别为共性事件并自动归入该多频主题，支持协同攻坚处置。
              </div>
              <div className="space-y-2">
                <Link
                  href={`/themes/${clusterId}?ticketId=${encodeURIComponent(row.id)}&highlight=${encodeURIComponent(row.id)}#ticket-${encodeURIComponent(row.id)}`}
                  className="btn btn--default flex items-center justify-center gap-1.5 text-xs text-blue-700 w-full hover:bg-blue-50 min-h-[44px] sm:min-h-[34px] py-2 font-medium"
                >
                  <span>前往专题视图研判定位</span>
                  <ExternalLink className="w-3.5 h-3.5 shrink-0" />
                </Link>
                <button
                  type="button"
                  disabled={!isAdmin || actionPending}
                  title={!isAdmin ? "需管理员权限可执行处置" : undefined}
                  onClick={() => setDetachConfirmOpen(true)}
                  className="btn btn--default flex items-center justify-center gap-1.5 text-xs text-rose-600 border-rose-200 hover:border-rose-400 w-full min-h-[44px] sm:min-h-[34px] py-2 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <Trash2 className="w-3.5 h-3.5 shrink-0" />
                  <span>移出当前群组</span>
                </button>
              </div>
            </div>
          )}

          {/* 4. 处置流转时间轴 */}
          <DisposalTimeline logs={logs} />
        </div>
      </div>

      <ConfirmDialog
        open={detachConfirmOpen}
        title="确认将该工单移出当前群组？"
        description={`移出后，工单 #${row.id} 将恢复为未归组状态，并自动重算原群组工单数量。`}
        confirmLabel="确认移出"
        destructive
        pending={actionPending}
        onConfirm={() => void handleConfirmDetachTheme()}
        onOpenChange={setDetachConfirmOpen}
      />
    </>
  );
}
