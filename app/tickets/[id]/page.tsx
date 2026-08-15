"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";
import { Layers, ArrowRight } from "lucide-react";
import { SkTicketDetail } from "@/app/_components/civic/skeletons";

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

  const clusterId = row.cluster_info?.id || "";

  return (
    <>
      <div className="breadcrumb">
        <Link href="/tickets">工单中心</Link>
        <span>/</span>
        <span>{row.id}</span>
      </div>

      {clusterId && (
        <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-4 flex items-center justify-between shadow-2xs">
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
                所属主题：{row.cluster_info?.title || `${row.region} · ${row.category}`}
              </div>
            </div>
          </div>
          <Link
            href={`/themes/${clusterId}?ticketId=${encodeURIComponent(row.id)}&highlight=${encodeURIComponent(row.id)}#ticket-${encodeURIComponent(row.id)}`}
            className="inline-flex items-center gap-1.5 px-3.5 py-1.5 bg-blue-600 text-white rounded-lg text-xs font-semibold hover:bg-blue-700 transition-colors shadow-2xs"
          >
            <span>在群组中定位</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

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
            <div className="card__title">属性</div>
          </div>
          <div className="card__body" style={{ fontSize: 13, color: "var(--c-ink-2)" }}>
            <p className="py-1">反映人：{row.caller_name || "—"}</p>
            <p className="py-1">电话：{row.caller_phone || "—"}</p>
            <p className="py-1">地址：{row.address || "—"}</p>
            <p className="py-1">紧急度：{row.urgency || "NORMAL"}</p>
            <p className="py-1">处置状态：{row.status || "待处理"}</p>
            {row.cluster_info && (
              <p className="py-1">
                所属群组：
                <Link
                  href={`/themes/${row.cluster_info.id}?ticketId=${encodeURIComponent(row.id)}#ticket-${encodeURIComponent(row.id)}`}
                  className="text-blue-600 font-medium ml-1"
                >
                  {row.cluster_info.title}
                </Link>
                {row.cluster_info.mode_name ? ` · ${row.cluster_info.mode_name}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
