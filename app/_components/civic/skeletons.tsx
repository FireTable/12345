import type { ReactNode } from "react";
import { StatCardGrid } from "./stat-card";

export function SkBone({
  w,
  h = 12,
  className = "",
}: {
  w?: string | number;
  h?: number;
  className?: string;
}) {
  return (
    <span
      className={`sk-bone ${className}`}
      style={{ width: w ?? "100%", height: h }}
      aria-hidden
    />
  );
}

export function SkStatCards({ count = 4 }: { count?: number }) {
  return (
    <StatCardGrid columns={4}>
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="sk-stat">
          <span className="sk-bone sk-stat__icon" />
          <div className="sk-stat__body">
            <SkBone w="42%" h={11} />
            <SkBone w="56%" h={22} />
            <SkBone w="68%" h={10} />
          </div>
        </div>
      ))}
    </StatCardGrid>
  );
}

export function SkCard({
  title,
  height,
  children,
}: {
  title?: boolean;
  height?: number;
  children?: ReactNode;
}) {
  return (
    <div className="card">
      {title !== false && (
        <div className="card__header">
          <SkBone w={140} h={14} />
          <SkBone w={72} h={11} />
        </div>
      )}
      <div className="card__body" style={height ? { minHeight: height } : undefined}>
        {children}
      </div>
    </div>
  );
}

export function SkInsightGrid() {
  return (
    <div className="insight-grid" aria-hidden>
      {Array.from({ length: 4 }, (_, i) => (
        <div key={i} className="insight-card">
          <span className="sk-bone" style={{ width: 28, height: 28, borderRadius: 8 }} />
          <div className="insight-card__body" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <SkBone w="70%" h={14} />
            <SkBone w="95%" h={11} />
            <SkBone w="60%" h={11} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function SkRankList({ rows = 8 }: { rows?: number }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="rank-item">
          <span className="sk-bone" style={{ width: 20, height: 20, borderRadius: 4 }} />
          <SkBone w={42} h={12} />
          <div className="rank-item__track">
            <SkBone w={`${70 - i * 6}%`} h={8} />
          </div>
          <SkBone w={36} h={12} />
        </div>
      ))}
    </div>
  );
}

export function SkChart({ height = 280 }: { height?: number }) {
  return <div className="sk-chart" style={{ height }} aria-hidden />;
}

export function SkHeatmap() {
  return (
    <div className="sk-heatmap" aria-hidden>
      {Array.from({ length: 8 }, (_, r) => (
        <div key={r} className="sk-heatmap__row">
          <SkBone w={48} h={22} />
          {Array.from({ length: 7 }, (_, c) => (
            <span key={c} className="sk-bone sk-heatmap__cell" />
          ))}
        </div>
      ))}
    </div>
  );
}

export function SkTable({ cols, rows = 8 }: { cols: number; rows?: number }) {
  return (
    <div className="table-scroll" aria-hidden>
      <table className="workorder-table">
        <thead>
          <tr>
            {Array.from({ length: cols }, (_, i) => (
              <th key={i}>
                <SkBone w={i === 1 ? "70%" : "56%"} h={11} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from({ length: rows }, (_, r) => (
            <tr key={r}>
              {Array.from({ length: cols }, (_, c) => (
                <td key={c}>
                  <SkBone w={c === 1 ? "88%" : c === 2 ? "72%" : "54%"} h={12} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SkMapPane({ height = 280 }: { height?: number }) {
  return <div className="sk-chart sk-chart--map" style={{ height }} aria-hidden />;
}

export function SkDashboard() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载总览">
      <SkStatCards />
      <SkCard>
        <SkInsightGrid />
      </SkCard>
      <section className="split-row split-row--main" style={{ marginTop: 16 }}>
        <SkCard height={320}>
          <SkChart />
        </SkCard>
        <SkCard>
          <SkRankList />
        </SkCard>
      </section>
      <section className="split-row split-row--main" style={{ marginTop: 16 }}>
        <SkCard height={300}>
          <SkChart />
        </SkCard>
        <SkCard>
          <SkHeatmap />
        </SkCard>
      </section>
    </div>
  );
}

export function SkTickets() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载工单">
      <SkStatCards />
      <div className="card list-card">
        <div className="list-card__head">
          <div>
            <div className="list-card__title">工单列表</div>
            <div className="list-card__sub">点击行查看详情</div>
          </div>
        </div>
        <SkTable cols={9} rows={8} />
      </div>
    </div>
  );
}

export function SkThemes() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载多频工单">
      <SkStatCards />
      <div className="card list-card">
        <div className="list-card__head">
          <div>
            <div className="list-card__title">多频工单群组列表</div>
            <div className="list-card__sub">点击行进入群组全景研判视图</div>
          </div>
        </div>
        <SkTable cols={11} rows={8} />
      </div>
    </div>
  );
}

export function SkMultifreq() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载多频透视">
      <SkStatCards />
      <section className="split-row split-row--map">
        <SkCard height={300}>
          <SkMapPane />
        </SkCard>
        <SkCard height={300}>
          <SkChart height={260} />
        </SkCard>
      </section>
      <div className="card" style={{ marginTop: 20 }}>
        <div className="top5-header">
          <SkBone w={160} h={16} />
          <SkBone w={88} h={12} />
        </div>
        <SkTable cols={10} rows={5} />
      </div>
    </div>
  );
}

export function SkDict() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载字典">
      <SkStatCards />
      <div className="card list-card">
        <SkTable cols={6} rows={8} />
      </div>
    </div>
  );
}

export function SkTicketDetail() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载工单详情">
      <div className="page-hero">
        <div>
          <SkBone w="62%" h={22} />
          <div style={{ marginTop: 8 }}>
            <SkBone w="40%" h={12} />
          </div>
        </div>
      </div>
      <section className="split-row">
        <SkCard height={220}>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SkBone w="96%" h={12} />
            <SkBone w="92%" h={12} />
            <SkBone w="88%" h={12} />
            <SkBone w="70%" h={12} />
          </div>
        </SkCard>
        <SkCard>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {Array.from({ length: 5 }, (_, i) => (
              <SkBone key={i} w={`${70 - i * 6}%`} h={13} />
            ))}
          </div>
        </SkCard>
      </section>
    </div>
  );
}

export function SkThemeDetail() {
  return (
    <div className="sk-page" aria-busy="true" aria-label="加载群组详情">
      <div className="cluster-hero sk-hero">
        <div className="cluster-hero__row">
          <span className="sk-bone" style={{ width: 56, height: 56, borderRadius: 12 }} />
          <div className="cluster-hero__main" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <SkBone w="48%" h={20} />
            <SkBone w="32%" h={12} />
          </div>
        </div>
        <div className="cluster-hero__stats">
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="cluster-hero__stat">
              <SkBone w={64} h={24} />
              <SkBone w={72} h={11} />
            </div>
          ))}
        </div>
      </div>
      <div className="cluster-grid">
        <SkCard height={280}>
          {Array.from({ length: 4 }, (_, i) => (
            <div key={i} className="member-item" style={{ marginBottom: 8 }}>
              <SkBone w="36%" h={12} />
              <div style={{ marginTop: 8 }}>
                <SkBone w="88%" h={12} />
              </div>
            </div>
          ))}
        </SkCard>
        <SkCard height={280}>
          <SkChart height={200} />
        </SkCard>
      </div>
    </div>
  );
}
