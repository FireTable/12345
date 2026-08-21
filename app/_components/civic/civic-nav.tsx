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

export { NAV_ITEMS };

export function CivicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { openCopilot, copilotOpen } = useCivicWorkflow();
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
      <div className="navbar__brand">
        <Link href="/" className="navbar__brand" style={{ textDecoration: "none", color: "inherit" }}>
          <div className="brand-logo">民声智理</div>
          <span className="brand-text-full">顺德 12345 AI 智能研判系统</span>
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
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
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
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
                  <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.484 2 12.017c0 4.425 2.865 8.18 6.839 9.504.5.092.682-.217.682-.483 0-.237-.008-.868-.013-1.703-2.782.605-3.369-1.343-3.369-1.343-.454-1.158-1.11-1.466-1.11-1.466-.908-.62.069-.608.069-.608 1.003.07 1.53 1.032 1.53 1.032.892 1.53 2.341 1.088 2.91.832.092-.647.35-1.088.636-1.338-2.22-.253-4.555-1.113-4.555-4.951 0-1.093.39-1.988 1.029-2.688-.103-.253-.446-1.272.098-2.65 0 0 .84-.27 2.75 1.026A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.296 2.747-1.027 2.747-1.027.546 1.379.202 2.398.1 2.651.64.7 1.028 1.595 1.028 2.688 0 3.848-2.339 4.695-4.566 4.943.359.309.678.92.678 1.855 0 1.338-.012 2.419-.012 2.747 0 .268.18.58.688.482A10.019 10.019 0 0022 12.017C22 6.484 17.522 2 12 2z" />
                </svg>
              </a>

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
