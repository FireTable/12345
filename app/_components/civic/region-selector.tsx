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
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            height: "28px",
            padding: "0 10px",
            backgroundColor: "#F1F5F9",
            border: "1px solid #CBD5E1",
            borderRadius: "6px",
            fontSize: "12px",
            color: "#64748B",
          }}
        >
          <MapPin style={{ width: "13px", height: "13px", color: "#94A3B8" }} />
          <span>加载辖区...</span>
        </div>
      );
    }
    return null;
  }

  const activeBadge = activeRegion.domainProfile?.domainType === "ECOMMERCE_CS" ? "电商客诉" : "政务热线";
  const isActiveEcom = activeRegion.domainProfile?.domainType === "ECOMMERCE_CS";

  return (
    <div className="relative inline-block text-left" ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="region-selector-btn"
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: "6px",
          height: "28px",
          padding: "0 10px",
          backgroundColor: "#F1F5F9",
          border: "1px solid #CBD5E1",
          borderRadius: "6px",
          fontSize: "12px",
          fontWeight: 600,
          color: "#0F172A",
          cursor: "pointer",
          whiteSpace: "nowrap",
          transition: "all 0.15s ease",
        }}
      >
        <MapPin style={{ width: "13px", height: "13px", color: isActiveEcom ? "#D97706" : "#2563EB", flexShrink: 0 }} />
        <span>{activeRegion.city} · {activeRegion.name}</span>
        <span
          style={{
            fontSize: "10px",
            fontWeight: 600,
            lineHeight: "15px",
            padding: "0 5px",
            borderRadius: "4px",
            backgroundColor: isActiveEcom ? "#FEF3C7" : "#DBEAFE",
            color: isActiveEcom ? "#B45309" : "#1D4ED8",
            flexShrink: 0,
          }}
        >
          {activeBadge}
        </span>
        <ChevronDown style={{ width: "12px", height: "12px", color: "#64748B", flexShrink: 0, transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            minWidth: "296px",
            backgroundColor: "#FFFFFF",
            borderRadius: "8px",
            boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.1), 0 8px 10px -6px rgba(0, 0, 0, 0.1)",
            border: "1px solid #E2E8F0",
            padding: "6px 0",
            zIndex: 9999,
          }}
        >
          <div style={{ padding: "8px 12px 6px", fontSize: "11px", fontWeight: 600, color: "#64748B", letterSpacing: "0.3px" }}>
            切换业务辖区
          </div>

          <div style={{ maxHeight: "240px", overflowY: "auto" }}>
            {regions.map((r) => {
              const isSelected = r.id === activeRegion.id;
              const isEcom = r.domainProfile?.domainType === "ECOMMERCE_CS";
              const badgeLabel = isEcom ? "电商客诉" : "政务热线";
              return (
                <button
                  key={r.id}
                  onClick={() => {
                    switchRegion(r.id);
                    setOpen(false);
                  }}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: "8px",
                    width: "100%",
                    padding: "8px 12px",
                    textAlign: "left",
                    backgroundColor: isSelected ? "#F8FAFC" : "transparent",
                    border: "none",
                    cursor: "pointer",
                    fontSize: "13px",
                    color: isSelected ? "#2563EB" : "#1E293B",
                    fontWeight: isSelected ? 600 : 400,
                  }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = isSelected ? "#F1F5F9" : "#F8FAFC")}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = isSelected ? "#F8FAFC" : "transparent")}
                >
                  <span style={{ display: "inline-flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {r.city} · {r.name}
                    </span>
                    <span
                      style={{
                        fontSize: "10px",
                        fontWeight: 600,
                        lineHeight: "15px",
                        padding: "0 5px",
                        borderRadius: "4px",
                        backgroundColor: isEcom ? "#FEF3C7" : "#EFF6FF",
                        color: isEcom ? "#B45309" : "#1D4ED8",
                        flexShrink: 0,
                      }}
                    >
                      {badgeLabel}
                    </span>
                  </span>
                  {isSelected && <Check style={{ width: "14px", height: "14px", color: "#2563EB", flexShrink: 0 }} />}
                </button>
              );
            })}
          </div>

          <div style={{ height: "1px", backgroundColor: "#E2E8F0", margin: "6px 0" }} />

          <Link
            href="/admin/regions"
            onClick={() => setOpen(false)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: "8px",
              padding: "8px 12px",
              fontSize: "12px",
              fontWeight: 500,
              color: "#475569",
              textDecoration: "none",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = "#F8FAFC")}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = "transparent")}
          >
            <Settings style={{ width: "14px", height: "14px", color: "#64748B" }} />
            <span>站点管理中心</span>
          </Link>
        </div>
      )}
    </div>
  );
}
