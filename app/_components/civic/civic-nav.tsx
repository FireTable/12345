"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const ITEMS = [
  { href: "/", key: "dashboard", label: "工作面板" },
  { href: "/tickets", key: "center", label: "工单中心" },
  { href: "/multifreq", key: "multifreq", label: "多频透视" },
  { href: "/themes", key: "grouplist", label: "群组中心" },
];

export function CivicNav() {
  const pathname = usePathname();
  return (
    <nav className="navbar">
      <div className="navbar__brand">
        <div className="brand-logo">12345</div>
        <span className="brand-text-full">顺德区12345热线智能工单管理平台</span>
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
        <span className="user-name" style={{ color: "var(--c-ink-3)", fontSize: 12 }}>
          研判工作台
        </span>
      </div>
    </nav>
  );
}
