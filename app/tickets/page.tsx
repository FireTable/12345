"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Row = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  urgency: string;
  status: string;
  createdAt: string;
};

export default function TicketsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("");
  const [data, setData] = useState<{ total: number; data: Row[] }>({ total: 0, data: [] });

  useEffect(() => {
    const load = () => {
      const q = new URLSearchParams({ page: String(page), size: "15" });
      if (keyword) q.set("keyword", keyword);
      if (status) q.set("status", status);
      fetch(`/api/workorders?${q}`)
        .then((r) => r.json())
        .then((j) => setData({ total: j.total || 0, data: j.data || [] }))
        .catch(() => setData({ total: 0, data: [] }));
    };
    load();
    window.addEventListener("civic-data-refresh", load);
    return () => window.removeEventListener("civic-data-refresh", load);
  }, [page, keyword, status]);

  return (
    <>
      <div className="page-hero">
        <div>
          <h1 className="page-hero__title">工单中心</h1>
          <div className="page-hero__sub">全量热线工单 · 共 {data.total} 条</div>
        </div>
      </div>
      <div className="filter-bar">
        <input placeholder="搜索标题 / 单号 / 正文" value={keyword} onChange={(e) => { setKeyword(e.target.value); setPage(1); }} />
        <select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="PENDING">待处理</option>
          <option value="IN_PROGRESS">处理中</option>
          <option value="RESOLVED">已办结</option>
        </select>
      </div>
      <div className="card" style={{ padding: 0 }}>
        <table className="data-table">
          <thead>
            <tr>
              <th>单号</th>
              <th>标题</th>
              <th>类型</th>
              <th>镇街</th>
              <th>紧急</th>
              <th>状态</th>
              <th>日期</th>
            </tr>
          </thead>
          <tbody>
            {data.data.map((r) => (
              <tr key={r.ticketId} onClick={() => router.push(`/tickets/${r.ticketId}`)}>
                <td>{r.id}</td>
                <td>{r.title}</td>
                <td>{r.category || "—"}</td>
                <td>{r.region}</td>
                <td>{r.urgency === "URGENT" ? "紧急" : r.urgency === "MEDIUM" ? "较急" : "普通"}</td>
                <td>{r.status === "RESOLVED" ? "已办结" : r.status === "IN_PROGRESS" ? "处理中" : "待处理"}</td>
                <td>{r.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.data.length === 0 && <div className="empty-hint">暂无工单</div>}
      </div>
      <div className="pager">
        <button disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>上一页</button>
        <span style={{ fontSize: 13, color: "var(--c-ink-3)", lineHeight: "32px" }}>第 {page} 页</span>
        <button disabled={page * 15 >= data.total} onClick={() => setPage((p) => p + 1)}>下一页</button>
      </div>
    </>
  );
}
