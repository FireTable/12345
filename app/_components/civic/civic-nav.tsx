"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle, User, LogOut } from "lucide-react";
import { useCivicWorkflow } from "./civic-workflow";
import { NAV_ITEMS } from "./nav-items";
import { authClient } from "@/lib/auth/client";
import { toast } from "sonner";

export { NAV_ITEMS };

export function CivicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { openCopilot, copilotOpen } = useCivicWorkflow();
  const [menuOpen, setMenuOpen] = useState(false);
  const { data: session } = authClient.useSession();

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

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      toast.success("已安全退出系统");
      router.replace("/login");
      router.refresh();
    } catch (err: any) {
      toast.error(err?.message || "退出失败");
    }
  };

  const isLoginPage = pathname === "/login";

  return (
    <>
    <nav className="navbar">
      <div className="navbar__brand">
        <Link href="/" className="navbar__brand" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="brand-logo">民声智理</div>
          <span className="brand-text-full">顺德 12345 AI 智能研判系统</span>
        </Link>
      </div>

      {!isLoginPage && (
        <>
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
              {session?.user ? (
                <div className="navbar-user-box">
                  <div className="navbar-user-tag" title={session.user.email}>
                    <User size={13} />
                    <span>{session.user.name || (session.user as any).username || "管理员"}</span>
                    <span className="navbar-user-role">
                      {(session.user as any).role === "admin" ? "管理员" : "经办员"}
                    </span>
                  </div>
                  <button
                    type="button"
                    className="navbar-logout-btn"
                    onClick={handleSignOut}
                    title="退出登录"
                  >
                    <LogOut size={13} />
                    <span>退出</span>
                  </button>
                </div>
              ) : (
                <Link href="/login" className="navbar-logout-btn" style={{ textDecoration: "none" }}>
                  <span>登录</span>
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </nav>
    {!copilotOpen && !isLoginPage && (
      <button
        type="button"
        className="chat-fab"
        aria-label="打开研判助手"
        title="研判助手"
        onClick={openCopilot}
      >
        <MessageCircle size={22} strokeWidth={2} />
      </button>
    )}
    </>
  );
}
