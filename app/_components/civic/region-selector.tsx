"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRegion } from "./region-context";
import { MapPin, ChevronDown, Check, Settings } from "lucide-react";

export function RegionSelector() {
  const { activeRegion, regions, switchRegion, isLoading } = useRegion();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener("mousedown", handleOutsideClick);
    }
    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
    };
  }, [open]);

  if (!activeRegion) {
    if (isLoading) {
      return (
        <div className="inline-flex items-center gap-1.5 h-7 px-2.5 bg-slate-100 border border-slate-300 rounded-md text-xs text-slate-500 max-w-[170px] sm:max-w-none min-w-0">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" />
          <span className="truncate">加载辖区...</span>
        </div>
      );
    }
    return null;
  }

  const isActiveEcom = activeRegion.domainProfile?.domainType === "ECOMMERCE_CS";
  const activeBadge = isActiveEcom ? "电商客诉" : "政务热线";

  const govRegions = regions.filter((r) => r.domainProfile?.domainType !== "ECOMMERCE_CS");
  const ecomRegions = regions.filter((r) => r.domainProfile?.domainType === "ECOMMERCE_CS");

  const renderRegionOption = (r: (typeof regions)[number]) => {
    const isSelected = r.id === activeRegion.id;
    const isEcom = r.domainProfile?.domainType === "ECOMMERCE_CS";
    const badgeLabel = isEcom ? "电商客诉" : "政务热线";
    return (
      <button
        key={r.id}
        type="button"
        role="option"
        aria-selected={isSelected}
        onClick={() => {
          switchRegion(r.id);
          setOpen(false);
        }}
        className={`flex items-center justify-between gap-2 w-full px-3 py-2 min-h-[38px] text-left text-[13px] transition-colors cursor-pointer ${
          isSelected
            ? "bg-slate-100/90 text-blue-600 font-semibold"
            : "bg-transparent text-slate-800 hover:bg-slate-50 font-normal"
        }`}
      >
        <span className="inline-flex items-center gap-1.5 min-w-0 flex-1">
          <span className="truncate">
            {r.city} · {r.name}
          </span>
          <span
            className={`text-[10px] font-semibold leading-[15px] px-1.5 rounded shrink-0 whitespace-nowrap ${
              isEcom ? "bg-amber-100 text-amber-800" : "bg-blue-50 text-blue-700"
            }`}
          >
            {badgeLabel}
          </span>
        </span>
        {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" />}
      </button>
    );
  };

  return (
    <div className="relative inline-block text-left min-w-0" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`切换业务辖区，当前为 ${activeRegion.city} · ${activeRegion.name}`}
        className="region-selector-btn inline-flex items-center gap-1.5 h-7 sm:h-7 px-2.5 bg-slate-100 hover:bg-slate-200/70 border border-slate-300 rounded-md text-xs font-semibold text-slate-900 cursor-pointer transition-colors max-w-[170px] sm:max-w-none min-w-0 overflow-hidden"
      >
        <MapPin
          className={`w-3.5 h-3.5 shrink-0 ${isActiveEcom ? "text-amber-600" : "text-blue-600"}`}
        />
        <span className="min-w-0 truncate">
          {activeRegion.city} · {activeRegion.name}
        </span>
        <span
          className={`hidden sm:inline-flex items-center text-[10px] font-semibold leading-[15px] px-1.5 rounded shrink-0 whitespace-nowrap ${
            isActiveEcom ? "bg-amber-100 text-amber-800" : "bg-blue-100 text-blue-700"
          }`}
        >
          {activeBadge}
        </span>
        <ChevronDown
          className={`w-3 h-3 text-slate-500 shrink-0 transition-transform duration-150 ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label="业务辖区列表"
          className="fixed left-3 top-[52px] sm:absolute sm:top-[calc(100%+6px)] sm:left-0 w-[min(320px,calc(100dvw-1.5rem))] bg-white rounded-lg shadow-xl border border-slate-200 py-1.5 z-[9999]"
        >
          <div className="max-h-[min(320px,65dvh)] overflow-y-auto">
            {govRegions.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 flex items-center justify-between">
                  <span>政务 12345 热线</span>
                  <span className="font-mono tabular-nums text-[10px] text-slate-400">
                    {govRegions.length}
                  </span>
                </div>
                {govRegions.map(renderRegionOption)}
              </div>
            )}

            {govRegions.length > 0 && ecomRegions.length > 0 && (
              <div className="h-px bg-slate-200 my-1.5" />
            )}

            {ecomRegions.length > 0 && (
              <div>
                <div className="px-3 py-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50/60 flex items-center justify-between">
                  <span>跨行业示范 · 电商客诉</span>
                  <span className="font-mono tabular-nums text-[10px] text-amber-600">
                    {ecomRegions.length}
                  </span>
                </div>
                {ecomRegions.map(renderRegionOption)}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-200 my-1.5" />

          <Link
            href="/admin/regions"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 min-h-[36px] text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 no-underline transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" />
            <span>站点管理中心</span>
          </Link>
        </div>
      )}
    </div>
  );
}
