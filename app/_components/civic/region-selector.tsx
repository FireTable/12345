"use client";

import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRegion } from "./region-context";
import { MapPin, ChevronDown, Check, Settings } from "lucide-react";
import { fmtNum } from "@/lib/format-number";

export function RegionSelector() {
  const { activeRegion, regions, switchRegion, isLoading } = useRegion();
  const [open, setOpen] = useState(false);
  const [focusedIndex, setFocusedIndex] = useState(0);
  const containerRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const listboxId = useId();
  const govGroupId = useId();
  const ecomGroupId = useId();

  const govRegions = useMemo(
    () => regions.filter((r) => r.domainProfile?.domainType !== "ECOMMERCE_CS"),
    [regions]
  );
  const ecomRegions = useMemo(
    () => regions.filter((r) => r.domainProfile?.domainType === "ECOMMERCE_CS"),
    [regions]
  );
  const orderedRegions = useMemo(
    () => [...govRegions, ...ecomRegions],
    [govRegions, ecomRegions]
  );

  const focusOptionAt = useCallback(
    (index: number) => {
      if (orderedRegions.length === 0) return;
      const bounded = ((index % orderedRegions.length) + orderedRegions.length) % orderedRegions.length;
      setFocusedIndex(bounded);
      const target = optionRefs.current[bounded];
      if (target) {
        target.focus({ preventScroll: true });
        target.scrollIntoView({ block: "nearest" });
      }
    },
    [orderedRegions.length]
  );

  const closeAndReturnFocus = useCallback(() => {
    setOpen(false);
    requestAnimationFrame(() => {
      triggerRef.current?.focus();
    });
  }, []);

  const openAndFocusOption = useCallback(
    (preferredIndex?: number) => {
      if (orderedRegions.length === 0) return;
      const selectedIdx = activeRegion
        ? orderedRegions.findIndex((r) => r.id === activeRegion.id)
        : 0;
      const initialIdx =
        typeof preferredIndex === "number"
          ? preferredIndex
          : selectedIdx >= 0
          ? selectedIdx
          : 0;
      setFocusedIndex(initialIdx);
      setOpen(true);
      requestAnimationFrame(() => {
        focusOptionAt(initialIdx);
      });
    },
    [activeRegion, focusOptionAt, orderedRegions]
  );

  useEffect(() => {
    if (!open) return;
    const handleOutsidePointer = (e: PointerEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", handleOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", handleOutsidePointer);
    };
  }, [open]);

  if (!activeRegion) {
    if (isLoading) {
      return (
        <div className="inline-flex items-center gap-1.5 h-[34px] sm:h-7 px-2.5 bg-slate-100 border border-slate-300 rounded-md text-xs text-slate-500 max-w-full sm:max-w-none min-w-0">
          <MapPin className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
          <span className="truncate">加载辖区...</span>
        </div>
      );
    }
    return null;
  }

  const isActiveEcom = activeRegion.domainProfile?.domainType === "ECOMMERCE_CS";
  const activeBadge = isActiveEcom ? "电商客诉" : "政务热线";
  const activeIdx = orderedRegions.findIndex((r) => r.id === activeRegion.id);

  const renderRegionOption = (r: (typeof regions)[number], optionIndex: number) => {
    const isSelected = r.id === activeRegion.id;
    const isEcom = r.domainProfile?.domainType === "ECOMMERCE_CS";
    const badgeLabel = isEcom ? "电商客诉" : "政务热线";
    return (
      <button
        key={r.id}
        ref={(el) => {
          optionRefs.current[optionIndex] = el;
        }}
        type="button"
        role="option"
        aria-selected={isSelected}
        tabIndex={optionIndex === focusedIndex ? 0 : -1}
        onClick={() => {
          switchRegion(r.id);
          closeAndReturnFocus();
        }}
        className={`flex items-center justify-between gap-2 w-full px-3 py-2 min-h-[38px] text-left text-[13px] transition-colors cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 focus-visible:-outline-offset-2 ${
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
        {isSelected && <Check className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />}
      </button>
    );
  };

  const handleListboxKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (orderedRegions.length === 0) return;
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeAndReturnFocus();
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      focusOptionAt(focusedIndex + 1);
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      focusOptionAt(focusedIndex - 1);
      return;
    }
    if (e.key === "Home") {
      e.preventDefault();
      focusOptionAt(0);
      return;
    }
    if (e.key === "End") {
      e.preventDefault();
      focusOptionAt(orderedRegions.length - 1);
      return;
    }
    if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const needle = e.key.toLowerCase();
      for (let offset = 1; offset <= orderedRegions.length; offset++) {
        const idx = (focusedIndex + offset) % orderedRegions.length;
        const candidate = `${orderedRegions[idx].city} ${orderedRegions[idx].name}`.toLowerCase();
        if (candidate.includes(needle)) {
          e.preventDefault();
          focusOptionAt(idx);
          break;
        }
      }
    }
  };

  return (
    <div
      className="relative inline-block text-left min-w-0 flex-1 max-w-full"
      ref={containerRef}
      onBlur={(e) => {
        if (
          open &&
          e.relatedTarget instanceof Node &&
          !e.currentTarget.contains(e.relatedTarget)
        ) {
          setOpen(false);
        }
      }}
    >
      <button
        ref={triggerRef}
        type="button"
        onClick={(e) => {
          if (open) {
            setOpen(false);
            return;
          }
          if (e.detail === 0) {
            openAndFocusOption();
          } else {
            setFocusedIndex(activeIdx >= 0 ? activeIdx : 0);
            setOpen(true);
          }
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") {
            e.preventDefault();
            if (!open) {
              openAndFocusOption(activeIdx >= 0 ? activeIdx : 0);
            } else {
              focusOptionAt(activeIdx >= 0 ? activeIdx : 0);
            }
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            if (!open) {
              openAndFocusOption(activeIdx >= 0 ? activeIdx : orderedRegions.length - 1);
            } else {
              focusOptionAt(orderedRegions.length - 1);
            }
          } else if (e.key === "Escape" && open) {
            e.preventDefault();
            e.stopPropagation();
            closeAndReturnFocus();
          }
        }}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-controls={open ? listboxId : undefined}
        aria-label={`切换业务辖区，当前为 ${activeRegion.city} · ${activeRegion.name}`}
        className="region-selector-btn relative inline-flex items-center gap-1.5 h-[34px] min-h-[34px] sm:h-7 sm:min-h-7 px-2.5 bg-slate-100 hover:bg-slate-200/70 border border-slate-300 rounded-md text-xs font-semibold text-slate-900 cursor-pointer transition-colors max-w-full min-w-0 after:content-[''] after:absolute after:-inset-y-[6px] sm:after:-inset-y-[8px] after:inset-x-0"
      >
        <MapPin
          className={`w-3.5 h-3.5 shrink-0 ${isActiveEcom ? "text-amber-600" : "text-blue-600"}`}
          aria-hidden="true"
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
          className={`w-3 h-3 text-slate-500 shrink-0 transition-transform duration-150 motion-reduce:transition-none ${
            open ? "rotate-180" : ""
          }`}
          aria-hidden="true"
        />
      </button>

      {open && (
        <div
          className="fixed left-3 top-[52px] sm:absolute sm:top-[calc(100%+6px)] sm:left-0 w-[min(320px,calc(100dvw-1.5rem))] bg-white rounded-lg shadow-xl border border-slate-200 py-1.5 z-[9999]"
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              e.stopPropagation();
              closeAndReturnFocus();
            }
          }}
        >
          <div
            id={listboxId}
            role="listbox"
            aria-label="业务辖区列表"
            onKeyDown={handleListboxKeyDown}
            className="max-h-[min(320px,65dvh)] overflow-y-auto overscroll-contain"
          >
            {govRegions.length > 0 && (
              <div role="group" aria-labelledby={govGroupId}>
                <div
                  id={govGroupId}
                  className="px-3 py-1.5 text-[11px] font-semibold text-slate-500 flex items-center justify-between"
                >
                  <span>政务 12345 热线</span>
                  <span className="font-mono tabular-nums text-[10px] text-slate-400">
                    {fmtNum(govRegions.length)}
                  </span>
                </div>
                {govRegions.map((r, i) => renderRegionOption(r, i))}
              </div>
            )}

            {govRegions.length > 0 && ecomRegions.length > 0 && (
              <div className="h-px bg-slate-200 my-1.5" role="separator" />
            )}

            {ecomRegions.length > 0 && (
              <div role="group" aria-labelledby={ecomGroupId}>
                <div
                  id={ecomGroupId}
                  className="px-3 py-1.5 text-[11px] font-semibold text-amber-700 bg-amber-50/60 flex items-center justify-between"
                >
                  <span>{govRegions.length > 0 ? "跨行业示范 · 电商客诉" : "电商客诉站点"}</span>
                  <span className="font-mono tabular-nums text-[10px] text-amber-600">
                    {fmtNum(ecomRegions.length)}
                  </span>
                </div>
                {ecomRegions.map((r, i) => renderRegionOption(r, govRegions.length + i))}
              </div>
            )}
          </div>

          <div className="h-px bg-slate-200 my-1.5" />

          <Link
            href="/admin/regions"
            onClick={() => setOpen(false)}
            className="flex items-center gap-2 px-3 py-2 min-h-[36px] text-xs font-medium text-slate-600 hover:bg-slate-50 hover:text-slate-900 no-underline transition-colors"
          >
            <Settings className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
            <span>站点管理中心</span>
          </Link>
        </div>
      )}
    </div>
  );
}
