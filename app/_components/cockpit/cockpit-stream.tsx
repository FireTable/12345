"use client";

import React, { useEffect, useId, useRef, useState } from "react";
import { Activity, Clock, ShieldAlert, Radio, X } from "lucide-react";
import { getTownshipColor } from "@/lib/civic-cluster";
import type { DomainProfile } from "../civic/region-context";
import type { CockpitTicket } from "./cockpit-types";

interface CockpitStreamProps {
  tickets: CockpitTicket[];
  selectedTownship?: string | null;
  domainProfile?: DomainProfile | null;
}

export function CockpitStream({
  tickets,
  selectedTownship,
  domainProfile,
}: CockpitStreamProps) {
  const [selectedTicket, setSelectedTicket] = useState<CockpitTicket | null>(null);
  const detailDialogRef = useRef<HTMLDialogElement>(null);
  const detailTitleId = useId();
  const isEcommerce = domainProfile?.domainType === "ECOMMERCE_CS";

  useEffect(() => {
    const dialog = detailDialogRef.current;
    if (!dialog) return;

    if (!selectedTicket) {
      if (dialog.open) dialog.close();
      return;
    }

    if (!dialog.open) {
      dialog.showModal();
    }

    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onPointerDown = (e: PointerEvent) => {
        pressedOutside = outside(e);
      };
      const onPointerUp = (e: PointerEvent) => {
        if (pressedOutside && outside(e)) {
          dialog.close();
        }
      };
      dialog.addEventListener("pointerdown", onPointerDown);
      dialog.addEventListener("pointerup", onPointerUp);
      return () => {
        dialog.removeEventListener("pointerdown", onPointerDown);
        dialog.removeEventListener("pointerup", onPointerUp);
      };
    }
  }, [selectedTicket]);

  const filtered = selectedTownship
    ? tickets.filter(
        (t) =>
          t.subdistrict?.includes(selectedTownship) ||
          selectedTownship.includes(t.subdistrict || "")
      )
    : tickets;

  const displayList = filtered.slice(0, 15);

  return (
    <div className="cockpit-glass-card relative w-full h-full flex flex-col rounded-2xl p-3.5 sm:p-4 min-w-0">
      <div className="cockpit-glass-header flex items-center justify-between gap-2 pb-2 shrink-0 min-w-0">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          <Activity size={14} aria-hidden="true" className="text-sky-400 shrink-0" />
          <h2 className="text-xs font-semibold text-slate-100 tracking-wide cockpit-single-line">
            {isEcommerce ? "实时客诉接入流水" : "实时工单接入流水"}
          </h2>
          {selectedTownship && (
            <span className="text-[10px] px-2 py-0.5 rounded-md bg-sky-500/15 border border-sky-400/30 text-sky-200 whitespace-nowrap shrink-0 max-w-[110px] truncate">
              {selectedTownship}
            </span>
          )}
        </div>
        <div className="flex items-center gap-1 text-[10px] font-mono text-emerald-300/90 whitespace-nowrap shrink-0">
          <Radio size={11} aria-hidden="true" className="text-emerald-400" />
          <span>LIVE STREAM</span>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto mt-2.5 space-y-1.5 pr-1 custom-cockpit-scrollbar min-w-0">
        {displayList.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-slate-400 font-mono">
            {isEcommerce ? "等待新客诉接入..." : "等待新工单接入..."}
          </div>
        ) : (
          displayList.map((ticket) => {
            const timeFormatted = ticket.createTime
              ? ticket.createTime.length > 16
                ? ticket.createTime.slice(11, 16)
                : ticket.createTime
              : "刚刚";

            const townColor = ticket.subdistrict
              ? getTownshipColor(ticket.subdistrict)
              : "#38bdf8";

            return (
              <button
                key={ticket.id}
                type="button"
                onClick={() => setSelectedTicket(ticket)}
                className={`w-full text-left p-2.5 rounded-xl border transition-colors cursor-pointer min-w-0 ${
                  ticket.isUrgent
                    ? "bg-rose-500/[0.06] border-rose-400/35 hover:bg-rose-500/[0.1]"
                    : "cockpit-glass-subcard"
                }`}
              >
                <div className="flex items-center justify-between gap-2 text-[11px] mb-1 min-w-0">
                  <div className="flex items-center gap-1.5 font-medium min-w-0 flex-1">
                    {ticket.subdistrict && (
                      <span
                        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-white/[0.06] border border-white/10 text-slate-100 font-mono text-[10px] font-medium cockpit-single-line max-w-[130px]"
                        title={ticket.subdistrict}
                      >
                        <span
                          aria-hidden="true"
                          className="w-1.5 h-1.5 rounded-full shrink-0"
                          style={{ backgroundColor: townColor }}
                        />
                        <span className="cockpit-single-line">{ticket.subdistrict}</span>
                      </span>
                    )}
                    {ticket.isUrgent ? (
                      <span className="px-1.5 py-0.5 rounded bg-rose-500/15 border border-rose-400/30 text-rose-200 font-mono text-[10px] inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                        <ShieldAlert size={10} aria-hidden="true" />
                        {isEcommerce ? "红线预警" : "紧急突发"}
                      </span>
                    ) : (
                      <span className="text-slate-400 font-mono tabular-nums text-[10px] cockpit-single-line">
                        {ticket.ticketNo}
                      </span>
                    )}
                  </div>
                  <span className="text-[10px] font-mono tabular-nums text-slate-400 inline-flex items-center gap-1 whitespace-nowrap shrink-0">
                    <Clock size={10} aria-hidden="true" />
                    {timeFormatted}
                  </span>
                </div>

                <p className="text-xs text-slate-200 cockpit-single-line leading-relaxed">
                  {ticket.title || ticket.content}
                </p>
              </button>
            );
          })
        )}
      </div>

      <dialog
        ref={detailDialogRef}
        aria-labelledby={detailTitleId}
        {...({ closedby: "any" } as any)}
        onClose={(e) => {
          if (e.currentTarget.open) return;
          setSelectedTicket(null);
        }}
        className="cockpit-stream-dialog"
      >
        {selectedTicket && (
          <div className="p-4 sm:p-5 flex flex-col justify-between gap-4 min-h-0 flex-1">
            <div className="min-w-0 flex-1 flex flex-col min-h-0">
              <div className="flex items-center justify-between gap-2 border-b border-white/10 pb-2.5 mb-3 shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <h3
                    id={detailTitleId}
                    className="text-sm font-mono tabular-nums font-bold text-slate-100 truncate"
                  >
                    {selectedTicket.ticketNo}
                  </h3>
                  {selectedTicket.isUrgent && (
                    <span className="px-2 py-0.5 rounded bg-rose-500/15 text-rose-200 text-[10px] border border-rose-400/30 whitespace-nowrap shrink-0">
                      高危预警
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  autoFocus
                  aria-label="关闭工单详情"
                  onClick={() => detailDialogRef.current?.close()}
                  className="cockpit-action-btn inline-flex items-center justify-center w-8 h-8 rounded-lg text-slate-300 hover:text-white hover:bg-white/10 transition-colors cursor-pointer shrink-0"
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </div>
              <div className="space-y-2.5 text-xs text-slate-300 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 shrink-0">
                    {isEcommerce ? "渠道/仓网：" : "诉求地点："}
                  </span>
                  <span className="text-slate-100 font-medium truncate">
                    {selectedTicket.district || ""}{" "}
                    {selectedTicket.subdistrict || (isEcommerce ? "未归属渠道" : "未归属")}
                  </span>
                </div>
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-slate-400 shrink-0">
                    {isEcommerce ? "进线时间：" : "受理时间："}
                  </span>
                  <span className="font-mono tabular-nums text-slate-200 truncate">
                    {selectedTicket.createTime}
                  </span>
                </div>
                <div className="pt-1 flex-1 min-h-0 flex flex-col">
                  <span className="text-slate-400 block mb-1.5 shrink-0">
                    {isEcommerce ? "客诉详情原貌：" : "市民诉求原貌："}
                  </span>
                  <div className="p-3 rounded-xl bg-white/[0.03] border border-white/10 text-slate-200 text-xs leading-relaxed overflow-y-auto custom-cockpit-scrollbar break-words flex-1 select-text">
                    {selectedTicket.content}
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-3 border-t border-white/10 flex justify-end shrink-0">
              <button
                type="button"
                onClick={() => detailDialogRef.current?.close()}
                className="min-h-[44px] sm:min-h-[34px] px-4 py-1.5 rounded-lg bg-white/[0.08] border border-white/15 text-slate-100 hover:bg-white/[0.14] text-xs font-medium cursor-pointer transition-colors"
              >
                已阅返回
              </button>
            </div>
          </div>
        )}
      </dialog>
    </div>
  );
}
