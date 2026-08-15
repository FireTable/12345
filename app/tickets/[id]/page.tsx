"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { classifyDetailPayload, type DetailLoadStatus } from "@/lib/detail-load";

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
        <div className="empty-hint">加载中…</div>
      </>
    );
  }
  if (view === "missing") {
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

  return (
    <>
      <div className="breadcrumb">
        <Link href="/tickets">工单中心</Link>
        <span>/</span>
        <span>{row.id}</span>
      </div>
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">{row.title}</h1>
          <div className="page-hero__sub">
            {row.region} · {row.category || "未分类"} · {row.createdAt}
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
            <p>反映人：{row.caller_name || "—"}</p>
            <p>电话：{row.caller_phone || "—"}</p>
            <p>地址：{row.address || "—"}</p>
            <p>紧急：{row.urgency}</p>
            <p>状态：{row.status}</p>
            {row.cluster_info && (
              <p>
                所属群组：
                <Link href={`/themes/${row.cluster_info.id}`}>{row.cluster_info.title}</Link>
                {row.cluster_info.mode_name ? ` · ${row.cluster_info.mode_name}` : ""}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
