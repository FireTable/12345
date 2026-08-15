"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCivicWorkflow } from "./civic-workflow";

const ITEMS = [
  { href: "/", key: "dashboard", label: "工作面板" },
  { href: "/tickets", key: "center", label: "工单中心" },
  { href: "/multifreq", key: "multifreq", label: "多频透视" },
  { href: "/themes", key: "grouplist", label: "多频工单" },
  { href: "/dict", key: "dict", label: "标准字典" },
];

export function CivicNav() {
  const pathname = usePathname();
  const { analyzing, openUpload, openCopilot, runCluster, isAllAnalyzed, disabledReason } = useCivicWorkflow();
  return (
    <nav className="navbar">
      <div className="navbar__brand">
        <div className="brand-logo">民声智理</div>
        <span className="brand-text-full">顺德 12345 AI 智能研判系统</span>
      </div>
      <div className="navbar__menu">
        {ITEMS.map((it) => {
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
        <button type="button" className="btn btn--default" onClick={openUpload}>
          上传工单
        </button>
        <button
          type="button"
          className="btn btn--primary"
          onClick={runCluster}
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
        <button type="button" className="btn btn--default" onClick={openCopilot}>
          研判助手
        </button>
      </div>
    </nav>
  );
}
