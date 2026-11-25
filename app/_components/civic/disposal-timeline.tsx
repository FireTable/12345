"use client";

import React from "react";
import { History, ArrowRight, User, Building2 } from "lucide-react";
import { fmtNum } from "@/lib/format-number";

export type DisposalLogItem = {
  id: string;
  action: string;
  fromStatus?: string | null;
  toStatus?: string | null;
  owner?: string | null;
  operator?: string | null;
  note?: string | null;
  metaJson?: string | null;
  createdAt: string;
};

const ACTION_META: Record<
  string,
  { label: string; badgeClass: string; dotColor: string }
> = {
  DISPATCH: {
    label: "派单处置",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    dotColor: "#1677FF",
  },
  ADVANCE: {
    label: "推进进度",
    badgeClass: "bg-sky-50 text-sky-700 border-sky-200",
    dotColor: "#0284C7",
  },
  ESCALATE: {
    label: "升级督办",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
    dotColor: "#F53F3F",
  },
  RESOLVE: {
    label: "办结归档",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotColor: "#16A34A",
  },
  REOPEN: {
    label: "复发重开",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
    dotColor: "#D97706",
  },
  UPDATE_STATUS: {
    label: "状态变更",
    badgeClass: "bg-blue-50 text-blue-700 border-blue-200",
    dotColor: "#1677FF",
  },
  CORRECT_ENTITY: {
    label: "人工纠偏",
    badgeClass: "bg-indigo-50 text-indigo-700 border-indigo-200",
    dotColor: "#4F46E5",
  },
  DETACH_TICKET: {
    label: "移出群组",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    dotColor: "#64748B",
  },
  DETACH_THEME: {
    label: "移出群组",
    badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
    dotColor: "#64748B",
  },
  REVIEW_APPROVE: {
    label: "复核通过",
    badgeClass: "bg-emerald-50 text-emerald-700 border-emerald-200",
    dotColor: "#16A34A",
  },
  REVIEW_DISMISS: {
    label: "复核忽略",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
    dotColor: "#94A3B8",
  },
};

const STATUS_LABELS: Record<string, string> = {
  PENDING: "待派单",
  DISPATCHED: "已派单",
  IN_PROGRESS: "处理中",
  PROCESSING: "处理中",
  RESOLVED: "已办结",
  CLOSED: "已办结",
  FINISHED: "已办结",
  REOPENED: "已重开",
  APPROVED: "已批准",
  EXECUTED: "已执行",
  REJECTED: "已驳回",
  BLOCKED: "已阻断",
  HIGH: "高危督办",
  MEDIUM: "中风险",
  LOW: "常规",
  REVIEWED: "复核通过",
  DISMISSED: "复核忽略",
};

const TASK_TYPE_LABELS: Record<string, string> = {
  MISSING_INFO: "要素补全",
  REOPEN_CALLBACK: "满意度回访",
  SLA_OVERDUE: "超期催办",
  REDLINE_BLOCK: "红线熔断",
};

function formatStatus(value?: string | null): string {
  if (!value) return "";
  const upper = value.trim().toUpperCase();
  return STATUS_LABELS[upper] || value;
}

function formatLogNote(note: string): string {
  return note
    .replace(
      /工单状态变更为\s+(PENDING|DISPATCHED|IN_PROGRESS|PROCESSING|RESOLVED|CLOSED|FINISHED|REOPENED)\b/g,
      (_full, code: string) => `工单状态变更为「${STATUS_LABELS[code] || code}」`
    )
    .replace(
      /\b(MISSING_INFO|REOPEN_CALLBACK|SLA_OVERDUE|REDLINE_BLOCK)\b/g,
      (code: string) => TASK_TYPE_LABELS[code] || code
    )
    .replace(/\baddress=/g, "具体地址=")
    .replace(/\bcanonicalSubject=/g, "涉事主体=")
    .replace(/\bsubdistrict=/g, "所属镇街=");
}

function formatLogTime(raw: string): string {
  if (!raw) return "—";
  const d = new Date(raw);
  if (Number.isNaN(d.getTime())) return raw;
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function DisposalTimeline({
  logs,
  title = "处置流转时间轴",
  emptyText = "暂无处置流转记录",
  className = "",
  headingLevel = "h2",
}: {
  logs: DisposalLogItem[];
  title?: string;
  emptyText?: string;
  className?: string;
  headingLevel?: "h2" | "h3";
}) {
  const HeadingTag = headingLevel;
  return (
    <div className={`card ${className}`.trim()}>
      <div className="card__header">
        <HeadingTag className="card__title flex items-center gap-1.5 m-0">
          <History className="h-4 w-4 text-blue-600 shrink-0" aria-hidden="true" />
          <span>{title}</span>
          {logs.length > 0 && (
            <span className="text-xs font-normal text-slate-500 tabular-nums">
              ({fmtNum(logs.length)})
            </span>
          )}
        </HeadingTag>
      </div>
      <div className="card__body" style={{ padding: "12px 18px" }}>
        {logs.length === 0 ? (
          <div className="py-5 text-center text-xs text-slate-500">
            {emptyText}
          </div>
        ) : (
          <div className="relative pl-4 space-y-3.5 before:content-[''] before:absolute before:left-[5px] before:top-2 before:bottom-2 before:w-px before:bg-slate-200">
            {logs.map((log) => {
              const meta = ACTION_META[log.action] || {
                label: log.action || "处置记录",
                badgeClass: "bg-slate-100 text-slate-700 border-slate-200",
                dotColor: "#64748B",
              };
              const fromLabel = formatStatus(log.fromStatus);
              const toLabel = formatStatus(log.toStatus);
              const showTransition = Boolean(fromLabel && toLabel && fromLabel !== toLabel);

              return (
                <div key={log.id} className="relative">
                  <span
                    className="absolute -left-4 top-1.5 w-2.5 h-2.5 rounded-full border-2 border-white"
                    style={{ backgroundColor: meta.dotColor }}
                    aria-hidden="true"
                  />
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <div className="flex items-center gap-1.5 flex-wrap">
                      <span
                        className={`inline-flex items-center px-2 py-0.5 rounded text-[11px] font-semibold border ${meta.badgeClass}`}
                      >
                        {meta.label}
                      </span>
                      {showTransition ? (
                        <span className="inline-flex items-center gap-1 text-[11px] text-slate-600 font-medium">
                          <span>{fromLabel}</span>
                          <ArrowRight className="w-3 h-3 text-slate-500" aria-hidden="true" />
                          <span className="text-slate-900">{toLabel}</span>
                        </span>
                      ) : toLabel ? (
                        <span className="text-[11px] text-slate-700 font-medium">
                          {toLabel}
                        </span>
                      ) : null}
                    </div>
                    <span className="text-[11px] font-mono tabular-nums text-slate-500 shrink-0">
                      {formatLogTime(log.createdAt)}
                    </span>
                  </div>

                  {(log.operator || log.owner) && (
                    <div className="mt-1 flex items-center gap-3 flex-wrap text-[11px] text-slate-600">
                      {log.operator && (
                        <span className="inline-flex items-center gap-1">
                          <User className="w-3 h-3 text-slate-500" aria-hidden="true" />
                          <span>操作人：{log.operator}</span>
                        </span>
                      )}
                      {log.owner && (
                        <span className="inline-flex items-center gap-1">
                          <Building2 className="w-3 h-3 text-slate-500" aria-hidden="true" />
                          <span>责任部门：{log.owner}</span>
                        </span>
                      )}
                    </div>
                  )}

                  {log.note && (
                    <div className="mt-1.5 text-xs text-slate-700 bg-slate-50 border border-slate-200/70 rounded-md px-2.5 py-1.5 leading-relaxed whitespace-pre-wrap break-words">
                      {formatLogNote(log.note)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
