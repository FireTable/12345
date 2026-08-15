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
  const { analyzing, openUpload, openCopilot, runCluster } = useCivicWorkflow();
  return (
    <nav className="navbar">
      <div className="navbar__brand">
        <div className="brand-logo">12345</div>
        <span className="brand-text-full">顺德区 12345 热线智能工单管理平台</span>
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
        <button type="button" className="btn btn--primary" onClick={runCluster} disabled={analyzing}>
          {analyzing ? "研判中…" : "启动 AI 聚类"}
        </button>
        <button type="button" className="btn btn--default" onClick={openCopilot}>
          研判助手
        </button>
      </div>
    </nav>
  );
}
