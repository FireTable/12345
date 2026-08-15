"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCivicWorkflow } from "./civic-workflow";
import { NAV_ITEMS } from "./nav-items";

export { NAV_ITEMS };

export function CivicNav() {
  const pathname = usePathname();
  const { analyzing, openUpload, openCopilot, runCluster, isAllAnalyzed, disabledReason } = useCivicWorkflow();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <nav className="navbar">
      <div className="navbar__brand">
        <div className="brand-logo">民声智理</div>
        <span className="brand-text-full">顺德 12345 AI 智能研判系统</span>
      </div>
      <button
        type="button"
        className={`navbar__toggle${menuOpen ? " is-open" : ""}`}
        aria-expanded={menuOpen}
        aria-controls="navbar-panel"
        aria-label={menuOpen ? "关闭导航" : "打开导航"}
        onClick={() => setMenuOpen((v) => !v)}
      >
        <span className="navbar__toggle-bar" />
        <span className="navbar__toggle-bar" />
        <span className="navbar__toggle-bar" />
      </button>
      {menuOpen ? (
        <button
          type="button"
          className="navbar__scrim"
          aria-label="关闭导航"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}
      <div id="navbar-panel" className={`navbar__panel${menuOpen ? " is-open" : ""}`}>
        <div className="navbar__menu">
          {NAV_ITEMS.map((it) => {
            const active =
              it.href === "/"
                ? pathname === "/"
                : pathname === it.href || pathname.startsWith(it.href + "/");
            return (
              <Link key={it.key} href={it.href} className={`nav-item${active ? " is-active" : ""}`}>
                {it.label}
              </Link>
            );
          })}
        </div>
        <div className="navbar__user">
          <button
            type="button"
            className="btn btn--default"
            onClick={() => {
              setMenuOpen(false);
              openUpload();
            }}
          >
            上传工单
          </button>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => {
              setMenuOpen(false);
              runCluster();
            }}
            disabled={analyzing || isAllAnalyzed}
            title={analyzing ? "AI 研判执行中..." : disabledReason || undefined}
            style={
              isAllAnalyzed && !analyzing
                ? {
                    opacity: 0.5,
                    cursor: "not-allowed",
                    filter: "grayscale(0.6)",
                  }
                : undefined
            }
          >
            {analyzing ? "研判中…" : isAllAnalyzed ? "已全部研判" : "启动 Agent 研判"}
          </button>
          <button
            type="button"
            className="btn btn--default"
            onClick={() => {
              setMenuOpen(false);
              openCopilot();
            }}
          >
            研判助手
          </button>
        </div>
      </div>
    </nav>
  );
}
