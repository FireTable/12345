"use client";

import React, { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { useRegion } from "./region-context";
import { MapPin, ChevronDown, Check, Settings } from "lucide-react";

export function RegionSelector() {
  const { activeRegion, regions, switchRegion } = useRegion();
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

  if (!activeRegion) return null;

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
          transition: "all 0.15s ease",
        }}
      >
        <MapPin style={{ width: "13px", height: "13px", color: "#2563EB" }} />
        <span>{activeRegion.city} · {activeRegion.name}</span>
        <ChevronDown style={{ width: "12px", height: "12px", color: "#64748B", transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            width: "240px",
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
                  <span>{r.city} · {r.name}</span>
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
