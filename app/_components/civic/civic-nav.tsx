"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { ChevronDown, MessageCircle, User, LogOut, Film, Workflow, MessageSquarePlus } from "lucide-react";
import { useCivicWorkflow } from "./civic-workflow";
import { NAV_ITEMS } from "./nav-items";
import { authClient } from "@/lib/auth/client";
import { useAuthRole } from "@/lib/auth/use-role";
import { toast } from "sonner";
import { VideoModal } from "./video-modal";
import { RegionSelector } from "./region-selector";
import { useRegion } from "./region-context";

export { NAV_ITEMS };

const ADMIN_ONLY_PREFIXES = [
  "/themes",
  "/multifreq",
  "/tickets",
  "/dict",
  "/sandbox",
  "/screen",
  "/admin",
  "/agent",
  "/workbench",
];

function isAdminOnlyPath(pathname: string): boolean {
  if (pathname === "/") return true;
  return ADMIN_ONLY_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

function navItemActive(href: string, pathname: string) {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(href + "/");
}

function useFittingNavCount(itemCount: number, enabled: boolean) {
  const menuRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [count, setCount] = useState(itemCount);

  useLayoutEffect(() => {
    if (!enabled) {
      setCount(itemCount);
      return;
    }
    const menu = menuRef.current;
    const measure = measureRef.current;
    if (!menu || !measure) return;

    const apply = () => {
      if (window.matchMedia("(max-width: 768px)").matches) {
        setCount(itemCount);
        return;
      }
      const available = menu.clientWidth;
      if (available < 8) return;
      const styles = getComputedStyle(measure);
      const gap = parseFloat(styles.columnGap || styles.gap || "8") || 8;
      const widths = Array.from(measure.querySelectorAll<HTMLElement>("[data-nav-measure]")).map(
        (node) => node.offsetWidth
      );
      const moreWidth = measure.querySelector<HTMLElement>("[data-nav-more-measure]")?.offsetWidth ?? 72;
      let used = 0;
      let fit = 0;
      for (let i = 0; i < widths.length; i++) {
        const next = fit === 0 ? widths[i] : used + gap + widths[i];
        const reserve = i < widths.length - 1 ? gap + moreWidth : 0;
        if (next + reserve <= available + 0.5) {
          used = next;
          fit += 1;
        } else {
          break;
        }
      }
      setCount(fit);
    };

    apply();
    const observer = new ResizeObserver(apply);
    observer.observe(menu);
    window.addEventListener("resize", apply);
    return () => {
      observer.disconnect();
      window.removeEventListener("resize", apply);
    };
  }, [itemCount, enabled]);

  return { menuRef, measureRef, count };
}

export function CivicNav() {
  const pathname = usePathname();
  const router = useRouter();
  const { openCopilot, copilotOpen, pipelineDrawerOpen, togglePipelineDrawer, analyzing, taskProgress } =
    useCivicWorkflow();
  const { activeRegion, appDomain } = useRegion();
  const isEcommerce =
    activeRegion?.domainProfile?.domainType === "ECOMMERCE_CS" ||
    (!activeRegion && appDomain === "ECOMMERCE_CS");

  const { user, isAdmin, isCitizen, isAuthenticated, isPending: sessionPending } = useAuthRole();

  const [menuOpen, setMenuOpen] = useState(false);
  const [videoModalOpen, setVideoModalOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const userMenuRef = useRef<HTMLDivElement>(null);
  const moreMenuRef = useRef<HTMLDivElement>(null);

  const { menuRef, measureRef, count: visibleNavCount } = useFittingNavCount(
    NAV_ITEMS.length,
    isAdmin
  );
  const visibleNav = NAV_ITEMS.slice(0, visibleNavCount);
  const overflowNav = NAV_ITEMS.slice(visibleNavCount);

  // 未登录时自动跳转回登录页
  useEffect(() => {
    if (pathname === "/login") return;
    if (!sessionPending && !isAuthenticated) {
      const from = pathname !== "/" ? `?from=${encodeURIComponent(pathname)}` : "";
      router.replace(`/login${from}`);
    }
  }, [pathname, isAuthenticated, sessionPending, router]);

  // 普通用户误访问管理页面时自动分流至 /submit
  useEffect(() => {
    if (pathname === "/login") return;
    if (!sessionPending && isAuthenticated && isCitizen && isAdminOnlyPath(pathname)) {
      router.replace("/submit");
    }
  }, [pathname, sessionPending, isAuthenticated, isCitizen, router]);

  useEffect(() => {
    setMenuOpen(false);
    setMoreOpen(false);
    setUserMenuOpen(false);
  }, [pathname]);

  // 动态同步页面 HTML document.title（带当前辖区站点前缀）
  useEffect(() => {
    if (typeof document === "undefined") return;
    const pageTitles: Record<string, string> = {
      "/": "数据总览",
      "/themes": "多频工单看板",
      "/multifreq": "工单透势研判",
      "/tickets": "工单中心核查",
      "/agent": "智能治理中心",
      "/submit": isEcommerce ? "售后客诉提交" : "民生诉求提交",
      "/dict": "标准字典与别名知识库",
      "/sandbox": "全链路 AI 透视演练",
      "/screen": "实时指挥调度大屏",
      "/admin/regions": "多站点管理与 AI 拓荒",
      "/mcp/authorize": "MCP 智能体授权中心",
      "/login": "系统登录",
    };
    let title = pageTitles[pathname];
    if (!title) {
      if (pathname.startsWith("/tickets/")) title = "工单详情核查";
      else if (pathname.startsWith("/themes/")) title = "多频主题深度研判";
      else title = "智能研判中心";
    }
    const regionPrefix = activeRegion ? `${activeRegion.name} · ` : "";
    document.title = isEcommerce
      ? `${regionPrefix}${title} | 民声智理 · 电商客诉`
      : `${regionPrefix}${title} | 民声智理 12345`;
  }, [pathname, activeRegion, isEcommerce]);

  useEffect(() => {
    if (!menuOpen && !userMenuOpen && !moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      setUserMenuOpen(false);
      setMoreOpen(false);
    };
    const onPointer = (e: MouseEvent) => {
      const target = e.target as Node;
      if (userMenuRef.current && !userMenuRef.current.contains(target)) setUserMenuOpen(false);
      if (moreMenuRef.current && !moreMenuRef.current.contains(target)) setMoreOpen(false);
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onPointer);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onPointer);
    };
  }, [menuOpen, userMenuOpen, moreOpen]);

  const handleSignOut = async () => {
    try {
      await authClient.signOut();
      toast.success("已安全退出系统");
      router.replace("/login");
      router.refresh();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : "退出失败";
      toast.error(message);
    }
  };

  const isLoginPage = pathname === "/login";
  const brandHref = !isAuthenticated || isLoginPage ? "/login" : isCitizen ? "/submit" : "/";

  return (
    <>
      <nav className="navbar" aria-label="主导航">
        <div className="navbar__brand">
          <Link
            href={brandHref}
            prefetch={false}
            className="navbar__brand-link"
            aria-label="民声智理首页"
            title={
              isEcommerce
                ? "民声智理 · 电商客诉 AI 智能研判系统"
                : "民声智理 · 12345 AI 智能研判系统"
            }
          >
            <div className="brand-morph-capsule">
              <div className="brand-morph-viewport">
                <div className="brand-morph-roller">
                  <div className="brand-morph-item">民声智理</div>
                  <div className="brand-morph-item brand-morph-item--sub">
                    {isEcommerce ? "电商 AI 研判" : "12345 AI 研判"}
                  </div>
                  <div className="brand-morph-item">民声智理</div>
                </div>
              </div>
            </div>
          </Link>
          {!isLoginPage && <RegionSelector />}
        </div>

        {isLoginPage ? (
          <div className="navbar__actions navbar__actions--login">
            <button
              type="button"
              className="navbar-icon-btn navbar-icon-btn--video"
              onClick={() => setVideoModalOpen(true)}
              title="系统功能演示视频"
              aria-label="系统功能演示视频"
            >
              <Film size={18} aria-hidden="true" />
            </button>

            <a
              href="https://github.com/FireTable/12345"
              target="_blank"
              rel="noopener noreferrer"
              className="navbar-icon-btn navbar-icon-btn--github"
              title="GitHub 源码仓库"
              aria-label="GitHub 源码仓库"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
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
              <span className="navbar__toggle-bar" aria-hidden="true" />
              <span className="navbar__toggle-bar" aria-hidden="true" />
              <span className="navbar__toggle-bar" aria-hidden="true" />
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
              <div className="navbar__menu" ref={menuRef}>
                {isAdmin ? (
                  <>
                    <div className="navbar__menu-measure" ref={measureRef} aria-hidden="true">
                      {NAV_ITEMS.map((it) => (
                        <span key={it.key} data-nav-measure className="nav-item">
                          {it.label}
                        </span>
                      ))}
                      <span data-nav-more-measure className="nav-item nav-more__trigger">
                        更多
                        <ChevronDown size={14} aria-hidden="true" />
                      </span>
                    </div>
                    {visibleNav.map((it) => {
                      const active = navItemActive(it.href, pathname);
                      return (
                        <Link
                          key={it.key}
                          href={it.href}
                          aria-current={active ? "page" : undefined}
                          className={`nav-item${active ? " is-active" : ""}`}
                        >
                          {it.label}
                        </Link>
                      );
                    })}
                    {overflowNav.length > 0 ? (
                      <div className="nav-more" ref={moreMenuRef}>
                        <button
                          type="button"
                          className={`nav-item nav-more__trigger${
                            overflowNav.some((it) => navItemActive(it.href, pathname))
                              ? " is-active"
                              : ""
                          }${moreOpen ? " is-open" : ""}`}
                          aria-haspopup="menu"
                          aria-expanded={moreOpen}
                          onClick={() => setMoreOpen((open) => !open)}
                        >
                          更多
                          <ChevronDown size={14} aria-hidden="true" />
                        </button>
                        {moreOpen ? (
                          <div className="nav-more__menu" role="menu">
                            {overflowNav.map((it) => {
                              const active = navItemActive(it.href, pathname);
                              return (
                                <Link
                                  key={it.key}
                                  href={it.href}
                                  role="menuitem"
                                  aria-current={active ? "page" : undefined}
                                  className={`nav-item${active ? " is-active" : ""}`}
                                  onClick={() => setMoreOpen(false)}
                                >
                                  {it.label}
                                </Link>
                              );
                            })}
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                  </>
                ) : isCitizen ? (
                  <Link
                    href="/submit"
                    aria-current={navItemActive("/submit", pathname) ? "page" : undefined}
                    className={`nav-item${navItemActive("/submit", pathname) ? " is-active" : ""}`}
                  >
                    <MessageSquarePlus size={15} aria-hidden="true" />
                    <span>我要投诉</span>
                  </Link>
                ) : null}
              </div>

              <div className="navbar__user">
                {isAdmin ? (
                  <>
                    <button
                      type="button"
                      className={`pipeline-console-icon-btn ${pipelineDrawerOpen ? " is-active" : ""} ${
                        analyzing ? " is-processing" : ""
                      }`}
                      onClick={togglePipelineDrawer}
                      title={
                        pipelineDrawerOpen
                          ? "收起 AI 研判流水线控制台 (再次点击关闭)"
                          : analyzing
                            ? `AI 研判流水线运转中 (${taskProgress?.percent ?? 0}%) · 点击展开控制台`
                            : "展开 AI 研判流水线控制台 (从顶部下拉)"
                      }
                      aria-label="AI 研判流水线控制台"
                      aria-expanded={pipelineDrawerOpen}
                      style={
                        analyzing
                          ? ({
                              ["--p" as string]: `${Math.min(100, Math.max(0, taskProgress?.percent ?? 0))}%`,
                            } as React.CSSProperties)
                          : undefined
                      }
                    >
                      <Workflow size={16} aria-hidden="true" className="text-white relative z-10" />
                    </button>

                    <button
                      type="button"
                      className="navbar-icon-btn navbar-icon-btn--video"
                      onClick={() => setVideoModalOpen(true)}
                      title="系统功能演示视频"
                      aria-label="系统功能演示视频"
                    >
                      <Film size={16} aria-hidden="true" />
                    </button>

                    <a
                      href="https://github.com/FireTable/12345"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="navbar-icon-btn navbar-icon-btn--github"
                      title="GitHub 源码仓库"
                      aria-label="GitHub 源码仓库"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0024 12c0-6.63-5.37-12-12-12z" />
                      </svg>
                    </a>
                  </>
                ) : null}

                {user ? (
                  isCitizen ? (
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className="navbar-user-card" title={user.email}>
                        <User size={14} className="navbar-user-icon" aria-hidden="true" />
                        <span className="navbar-user-name">
                          {user.name || user.username || (isEcommerce ? "买家用户" : "市民用户")}
                        </span>
                        <span className="navbar-user-role">
                          {isEcommerce ? "消费者" : "市民"}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn btn--default"
                        onClick={handleSignOut}
                        aria-label="退出账号"
                      >
                        <LogOut size={14} aria-hidden="true" />
                        <span>退出账号</span>
                      </button>
                    </div>
                  ) : (
                    <div className="navbar-user-menu" ref={userMenuRef}>
                      <button
                        type="button"
                        className={`navbar-user-card${userMenuOpen ? " is-open" : ""}`}
                        title={user.email}
                        aria-haspopup="menu"
                        aria-expanded={userMenuOpen}
                        aria-label="账户操作菜单"
                        onClick={() => setUserMenuOpen((open) => !open)}
                      >
                        <User size={14} className="navbar-user-icon" aria-hidden="true" />
                        <span className="navbar-user-name">
                          {user.name || user.username || "管理员"}
                        </span>
                        <span className="navbar-user-role">管理员</span>
                        <ChevronDown size={14} className="navbar-user-chevron" aria-hidden="true" />
                      </button>
                      {userMenuOpen ? (
                        <div className="navbar-user-pop" role="menu">
                          <Link
                            href="/submit"
                            role="menuitem"
                            className="navbar-user-pop__item hover:!bg-blue-50 hover:!text-blue-700"
                            onClick={() => setUserMenuOpen(false)}
                          >
                            <MessageSquarePlus size={14} aria-hidden="true" />
                            <span>{isEcommerce ? "买家投诉端预览" : "市民投诉端预览"}</span>
                          </Link>
                          <button
                            type="button"
                            role="menuitem"
                            className="navbar-user-pop__item"
                            onClick={handleSignOut}
                          >
                            <LogOut size={14} aria-hidden="true" />
                            <span>退出登录</span>
                          </button>
                        </div>
                      ) : null}
                    </div>
                  )
                ) : (
                  <Link
                    href="/login"
                    className="navbar-icon-btn"
                    style={{ textDecoration: "none", width: "auto", padding: "0 12px" }}
                  >
                    <span>登录</span>
                  </Link>
                )}
              </div>
            </div>
          </>
        )}
      </nav>

      {isAdmin ? (
        <VideoModal isOpen={videoModalOpen} onClose={() => setVideoModalOpen(false)} />
      ) : null}

      {isAdmin && !copilotOpen && !isLoginPage ? (
        <button
          type="button"
          className="chat-fab"
          aria-label="打开研判助手"
          title="研判助手"
          onClick={openCopilot}
        >
          <MessageCircle size={22} strokeWidth={2} aria-hidden="true" />
        </button>
      ) : null}
    </>
  );
}
