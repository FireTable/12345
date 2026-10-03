"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import {
  Layers,
  Sparkles,
  ExternalLink,
  ChevronLeft,
} from "lucide-react";
import { SkTicketDetail } from "@/app/_components/civic/skeletons";
import {
  categoryBadgeStyle,
  getCategoryBadgeClass,
  getUrgencyLabel,
  normalizeStatusCode,
} from "@/lib/civic-dto";
import { AiVerdictCard, CitizenVoiceCard, TicketPropsGrid } from "@/app/_components/civic/ticket-verdict-view";

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

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<any>(null);
  const [load, setLoad] = useState<DetailLoadStatus>("pending");

  useEffect(() => {
    setLoad("pending");
    setRow(null);
    fetch(`/api/workorders/${params.id}`)
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

  return (
    <>
      <div className="breadcrumb flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          <Link href="/tickets" className="hover:underline flex items-center gap-1">
            <ChevronLeft className="w-3.5 h-3.5" />
            <span>工单中心</span>
          </Link>
          <span>/</span>
          <span>{row.id}</span>
        </div>
        <Link
          href="/tickets"
          className="text-xs text-slate-500 hover:text-slate-800 transition-colors"
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
              className={`badge-pill ${row.urgency === "URGENT" ? "badge-pill--danger" : "badge-pill--default"}`}
            >
              {getUrgencyLabel(row.urgency)}
            </span>
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
            {[row.region, row.createdAt].filter(Boolean).join(" · ") || row.createdAt}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* 左侧主要区域：AI 研判解析与市民诉求原文 (8列) */}
        <div className="lg:col-span-8 space-y-4">
          {/* 1. AI 智能研判解析卡片 (复用统一组件) */}
          <AiVerdictCard data={row} />

          {/* 2. 市民原始诉求卡片 (复用统一组件) */}
          <CitizenVoiceCard data={row} />
        </div>

        {/* 右侧边栏区域：多频专题与经办属性 (4列，无冗余多层嵌套) */}
        <div className="lg:col-span-4 space-y-4">
          {/* 1. 经办基础属性 (直接渲染，杜绝框套框) */}
          <TicketPropsGrid data={row} />

          {/* 2. 归属多频专题联动卡片 (采用统一的现代无缝质感) */}
          {clusterId && (
            <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3 shadow-2xs">
              <div className="flex items-center gap-1.5 text-xs font-bold text-blue-900 pb-2 border-b border-slate-100">
                <Layers className="w-4 h-4 text-blue-600" />
                <span>归属多频研判群组</span>
              </div>
              <div className="text-sm font-bold text-slate-800 leading-snug">
                {row.cluster_info?.title || `${row.region} · ${row.category}专项`}
              </div>
              <div className="text-xs text-slate-500 leading-relaxed">
                该工单已被 Civic Agent 识别为共性事件并自动归入该多频主题，支持协同攻坚处置。
              </div>
              <Link
                href={`/themes/${clusterId}?ticketId=${encodeURIComponent(row.id)}&highlight=${encodeURIComponent(row.id)}#ticket-${encodeURIComponent(row.id)}`}
                className="btn btn--default flex items-center justify-center gap-1.5 text-xs text-blue-700 w-full hover:bg-blue-50 py-2 font-medium"
              >
                <span>前往专题视图研判定位</span>
                <ExternalLink className="w-3.5 h-3.5" />
              </Link>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
