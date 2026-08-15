"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";

export default function ThemeDetailPage() {
  const params = useParams<{ id: string }>();
  const [row, setRow] = useState<any>(null);

  useEffect(() => {
    fetch(`/api/clusters/${params.id}`)
      .then((r) => r.json())
      .then(setRow)
      .catch(() => setRow(null));
  }, [params.id]);

  if (!row || row.success === false) {
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

  const hero = `cluster-hero cluster-hero--${row.mode || "diverge"}`;
  return (
    <>
      <div className="breadcrumb">
        <Link href="/themes">群组中心</Link>
        <span>/</span>
        <span>
          {row.region} · {row.type}
        </span>
      </div>
      <div className={hero}>
        <div style={{ fontSize: 13, opacity: 0.85 }}>
          {row.mode_icon} {row.mode_name}
        </div>
        <h1 style={{ fontSize: 26, margin: "8px 0" }}>
          {row.region} · {row.type}
        </h1>
        <div style={{ opacity: 0.9 }}>
          {row.count} 件 · {row.first_date} ~ {row.last_date}
          {row.ai_confidence != null ? ` · 置信度 ${row.ai_confidence}%` : ""}
          {row.trend ? ` · ${row.trend}` : ""}
        </div>
        {row.mode_advice && <p style={{ marginTop: 12 }}>{row.mode_advice}</p>}
      </div>
      <div className="split-row">
        <div className="card">
          <div className="card__header">
            <div className="card__title">成员工单</div>
          </div>
          <div className="card__body">
            {(row.members || []).map((m: any) => (
              <div key={m.ticketId} style={{ padding: "8px 0", borderBottom: "1px solid var(--c-border-soft)" }}>
                <Link href={`/tickets/${m.ticketId}`}>{m.title}</Link>
                <div style={{ fontSize: 12, color: "var(--c-ink-3)" }}>
                  {m.id} · {m.createdAt}
                </div>
              </div>
            ))}
            {!(row.members || []).length && <div className="empty-hint">暂无成员工单</div>}
          </div>
        </div>
        <div className="card">
          <div className="card__header">
            <div className="card__title">特征匹配</div>
          </div>
          <div className="card__body">
            {(row.features || []).length === 0 && <div className="empty-hint">暂无特征（尚未落库）</div>}
            {(row.features || []).map((f: any) => (
              <div key={f.name} className="feat-row">
                <span style={{ width: 80 }}>{f.name}</span>
                <div className="feat-row__bar">
                  <div className="feat-row__fill" style={{ width: `${f.pct}%` }} />
                </div>
                <span>{f.pct}%</span>
              </div>
            ))}
            {row.status?.label && (
              <p style={{ marginTop: 16, fontSize: 13 }}>
                处置：{row.status.label} {row.status.progress}% {row.status.owner}
              </p>
            )}
          </div>
        </div>
      </div>
    </>
  );
}
