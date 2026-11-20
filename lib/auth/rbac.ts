import { headers } from "next/headers";
import { auth } from "@/lib/auth/config";
import { apiError, ApiCode } from "@/lib/api-codes";

export type AppRole = "admin" | "user";

export interface AuthenticatedSession {
  user: {
    id: string;
    email: string;
    name: string;
    username?: string | null;
    role: AppRole;
  };
  session: {
    id: string;
    userId: string;
  };
}

export function normalizeAppRole(role: unknown): AppRole {
  return role === "admin" ? "admin" : "user";
}

/**
 * 解析当前请求的 Better Auth Session 并归一化用户角色。
 * 当传入 req 时直接读取 req.headers（避免在 tsx 单测中触发 next/headers() 异常）。
 */
export async function getRequestSession(req?: Request): Promise<AuthenticatedSession | null> {
  try {
    const requestHeaders = req ? req.headers : await headers();
    const rawSession = await auth.api.getSession({ headers: requestHeaders });
    if (!rawSession?.user || !rawSession?.session) {
      return null;
    }

    const rawUser = rawSession.user as {
      id: string;
      email: string;
      name: string;
      username?: string | null;
      role?: unknown;
      banned?: boolean | null;
    };

    if (rawUser.banned === true) {
      return null;
    }

    return {
      user: {
        id: rawUser.id,
        email: rawUser.email,
        name: rawUser.name,
        username: rawUser.username ?? null,
        role: normalizeAppRole(rawUser.role),
      },
      session: {
        id: rawSession.session.id,
        userId: rawSession.session.userId,
      },
    };
  } catch {
    return null;
  }
}

/**
 * 要求请求已通过 Better Auth 登录认证；未登录返回 401。
 */
export async function requireAuthenticated(
  req: Request
): Promise<{ session: AuthenticatedSession } | { response: Response }> {
  const session = await getRequestSession(req);
  if (!session) {
    return {
      response: apiError(ApiCode.UNAUTHORIZED, undefined, 401),
    };
  }
  return { session };
}

/**
 * 要求请求已登录且角色为 admin；未登录返回 401，普通用户返回 403。
 */
export async function requireAdmin(
  req: Request
): Promise<{ session: AuthenticatedSession } | { response: Response }> {
  const authResult = await requireAuthenticated(req);
  if ("response" in authResult) {
    return authResult;
  }
  if (authResult.session.user.role !== "admin") {
    return {
      response: apiError(ApiCode.FORBIDDEN, "当前操作仅限管理员执行", 403),
    };
  }
  return authResult;
}
