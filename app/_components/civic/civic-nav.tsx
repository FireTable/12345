"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { MessageCircle, User, LogOut, Film } from "lucide-react";
import { useCivicWorkflow } from "./civic-workflow";
import { NAV_ITEMS } from "./nav-items";
import { authClient } from "@/lib/auth/client";
import { toast } from "sonner";
import { VideoModal } from "./video-modal";
import { RegionSelector } from "./region-selector";
import { useRegion } from "./region-context";

export { NAV_ITEMS };

export function CivicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { openCopilot, copilotOpen } = useCivicWorkflow();
  const { activeRegion } = useRegion();
  const [menuOpen, setMenuOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
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
      <div className="navbar__brand" style={{ display: "flex", alignItems: "center", gap: "10px" }}>
        <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", color: "inherit" }}>
          <div className="brand-logo">民声智理</div>
        </Link>
        <RegionSelector />
        <Link href="/" style={{ display: "flex", alignItems: "center", textDecoration: "none", color: "inherit" }}>
          <span className="brand-text-full">
            12345 AI 智能研判系统
          </span>
        </Link>
      </div>

      {isLoginPage ? (
        <div className="navbar__user" style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: "8px" }}>
          {/* 演示视频图标按钮 */}
          <button
            type="button"
            className="navbar-icon-btn navbar-icon-btn--video"
            onClick={() => setVideoModalOpen(true)}
            title="系统功能演示视频"
            aria-label="系统功能演示视频"
          >
            <Film size={18} />
          </button>

          {/* GitHub 仓库图标链接 */}
          <a
            href="https://github.com/FireTable/12345"
            target="_blank"
            rel="noopener noreferrer"
            className="navbar-icon-btn navbar-icon-btn--github"
            title="GitHub 源码仓库"
            aria-label="GitHub 源码仓库"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
            </svg>
          </a>
        </div>
      ) : (
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
              {/* 演示视频图标按钮 */}
              <button
                type="button"
                className="navbar-icon-btn navbar-icon-btn--video"
                onClick={() => setVideoModalOpen(true)}
                title="系统功能演示视频"
                aria-label="系统功能演示视频"
              >
                <Film size={16} />
              </button>

              {/* GitHub 仓库图标链接 */}
              <a
                href="https://github.com/FireTable/12345"
                target="_blank"
                rel="noopener noreferrer"
                className="navbar-icon-btn navbar-icon-btn--github"
                title="GitHub 源码仓库"
                aria-label="GitHub 源码仓库"
              >
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z"/>
                </svg>
              </a>

              {session?.user ? (
                <div className="navbar-user-card" title={session.user.email}>
                  <User size={14} className="navbar-user-icon" />
                  <span className="navbar-user-name">
                    {session.user.name || (session.user as any).username || "管理员"}
                  </span>
                  <span className="navbar-user-role">
                    {(session.user as any).role === "admin" ? "管理员" : "经办员"}
                  </span>
                  <span className="navbar-user-divider" />
                  <button
                    type="button"
                    className="navbar-user-logout-btn"
                    onClick={handleSignOut}
                    title="退出登录"
                  >
                    <LogOut size={13} />
                    <span>退出</span>
                  </button>
                </div>
              ) : (
                <Link href="/login" className="navbar-icon-btn" style={{ textDecoration: "none", width: "auto", padding: "0 12px" }}>
                  <span>登录</span>
                </Link>
              )}
            </div>
          </div>
        </>
      )}
    </nav>

    {/* 系统演示视频弹窗 */}
    <VideoModal
      isOpen={videoModalOpen}
      onClose={() => setVideoModalOpen(false)}
    />

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
