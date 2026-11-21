import { redirect } from "next/navigation";
import { getRequestSession, type AuthenticatedSession } from "@/lib/auth/rbac";

function hasAsciiControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isSafeRedirectFrom(redirectFrom?: string): redirectFrom is string {
  if (typeof redirectFrom !== "string" || redirectFrom.length === 0) {
    return false;
  }
  if (
    !redirectFrom.startsWith("/") ||
    redirectFrom.startsWith("//") ||
    redirectFrom.includes("\\") ||
    hasAsciiControlChar(redirectFrom)
  ) {
    return false;
  }
  try {
    const parsed = new URL(redirectFrom, "https://civic.local");
    return (
      parsed.origin === "https://civic.local" &&
      parsed.pathname !== "/" &&
      parsed.pathname.startsWith("/") &&
      !parsed.pathname.startsWith("//")
    );
  } catch {
    return false;
  }
}

export function resolveAdminPageRedirect(
  session: AuthenticatedSession | null,
  redirectFrom?: string
): string | null {
  if (!session) {
    return isSafeRedirectFrom(redirectFrom)
      ? `/login?from=${encodeURIComponent(redirectFrom)}`
      : "/login";
  }
  if (session.user.role !== "admin") {
    return "/submit";
  }
  return null;
}

/**
 * 服务端管理页面前置鉴权守卫：
 * - 未登录重定向至 /login（非根路径保留 ?from=）
 * - 非管理员（citizen / user）重定向至 /submit，阻止前端组件挂载与越权探测请求
 */
export async function requireAdminPage(redirectFrom?: string): Promise<AuthenticatedSession> {
  const session = await getRequestSession();
  const redirectTarget = resolveAdminPageRedirect(session, redirectFrom);
  if (redirectTarget || !session) {
    redirect(redirectTarget ?? "/login");
  }
  return session;
}
