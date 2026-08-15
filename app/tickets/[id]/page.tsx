"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { ArrowRight, Sparkles, Target, Layers } from "lucide-react";

export default function TicketDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
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
        const target = j.ticketId || j.id || params.id;
        const groupId = j.cluster_info?.id || "unknown";
        router.replace(
          `/themes/${groupId}?ticketId=${encodeURIComponent(target)}&highlight=${encodeURIComponent(target)}#ticket-${encodeURIComponent(target)}`
        );
      })
      .catch(() => {
        setRow(null);
        setLoad("error");
      });
  }, [params.id, router]);

  const view = classifyDetailPayload(load, row);
  if (view === "loading") {
    return (
      <>
        <div className="breadcrumb">
          <Link href="/tickets">工单中心</Link>
          <span>/</span>
          <span>定位中…</span>
        </div>
        <div className="empty-hint">正在跳转至多频群组视图并定位工单…</div>
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

  const clusterId = row.cluster_info?.id || "";

  return (
    <>
      <div className="breadcrumb">
        <Link href="/tickets">工单中心</Link>
        <span>/</span>
        <span>{row.id}</span>
      </div>

      {clusterId ? (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center justify-between shadow-xs">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-blue-600 text-white flex items-center justify-center">
              <Layers className="h-5 w-5" />
            </div>
            <div>
              <div className="text-sm font-bold text-blue-950 flex items-center gap-2">
                <span>该工单已关联至多频研判群组</span>
                {row.cluster_info?.mode_name && (
                  <span className="text-[10px] bg-blue-100 text-blue-800 px-2 py-0.5 rounded font-medium">
                    {row.cluster_info.mode_name}
                  </span>
                )}
              </div>
              <div className="text-xs text-blue-700 mt-0.5">
                建议在多频群组视图中查看完整时空脉络、关联工单与 AI 协同处置建议
              </div>
            </div>
          </div>

          <Link
            href={`/themes/${clusterId}?ticketId=${row.id}&highlight=${row.id}#ticket-${row.id}`}
            className="btn btn--primary flex items-center gap-1.5"
          >
            <Target className="h-4 w-4" />
            进入群组全景并定位
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : null}

      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">{row.title}</h1>
          <div className="page-hero__sub">
            {[row.region, row.category, row.createdAt].filter(Boolean).join(" · ") || row.createdAt}
          </div>
        </div>
      </div>
      <div className="split-row">
        <div className="card">
          <div className="card__header">
            <div className="card__title">诉求正文</div>
          </div>
          <div className="card__body" style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.7 }}>
            {row.content}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">工单属性</div>
          </div>
          <div className="card__body" style={{ fontSize: 13, color: "var(--c-ink-2)" }}>
            <p className="mb-2">反映人：{row.caller_name || "—"}</p>
            <p className="mb-2">电话：{row.caller_phone || "—"}</p>
            <p className="mb-2">地址：{row.address || "—"}</p>
            <p className="mb-2">紧急度：{row.urgency}</p>
            <p className="mb-2">状态：{row.status}</p>
            {row.cluster_info && (
              <p className="mt-3 pt-3 border-t border-slate-100">
                所属群组：
                <Link
                  href={`/themes/${row.cluster_info.id}?ticketId=${row.id}&highlight=${row.id}#ticket-${row.id}`}
                  className="font-bold text-blue-600 hover:underline ml-1"
                >
                  {row.cluster_info.title}
                </Link>
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
