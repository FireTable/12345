if (!process.env.BETTER_AUTH_SECRET && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {
    // ignore if .env.local does not exist
  }
}

import { auth } from "../lib/auth/config";

export type TestUserRole = "admin" | "user";

const cookieCache = new Map<TestUserRole, string>();
const inflightCache = new Map<TestUserRole, Promise<string>>();

function extractCookieHeaderFromResponse(res: Response): string {
  const rawSetCookies =
    typeof res.headers.getSetCookie === "function"
      ? res.headers.getSetCookie()
      : res.headers.get("set-cookie")
        ? [res.headers.get("set-cookie") as string]
        : [];

  return rawSetCookies
    .map((entry) => entry.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
}

function resolveCredentials(role: TestUserRole): { username: string; password: string } {
  if (role === "admin") {
    return {
      username: process.env.ADMIN_USERNAME || "admin",
      password: process.env.ADMIN_PASSWORD || "admin",
    };
  }
  return {
    username: process.env.CITIZEN_USERNAME || "citizen",
    password: process.env.CITIZEN_PASSWORD || "citizen123",
  };
}

/**
 * 通过真实 Better Auth `auth.api.signInUsername` 获取已签名的 Session Cookie（进程内按角色缓存）。
 * 严禁绕过鉴权；失败时直接抛出错误。
 */
export async function getTestSessionCookie(role: TestUserRole = "admin"): Promise<string> {
  const cached = cookieCache.get(role);
  if (cached) return cached;

  const inflight = inflightCache.get(role);
  if (inflight) return inflight;

  const task = (async () => {
    if (!process.env.ADMIN_PASSWORD && typeof process.loadEnvFile === "function") {
      try {
        process.loadEnvFile(".env.local");
      } catch {
        // ignore
      }
    }

    const { username, password } = resolveCredentials(role);
    const res = await auth.api.signInUsername({
      body: { username, password },
      asResponse: true,
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      throw new Error(
        `[tests/_auth-helper] Failed to sign in test "${role}" user (${username}): status=${res.status} ${detail}`
      );
    }

    const cookie = extractCookieHeaderFromResponse(res);
    if (!cookie.includes("better-auth.session_token")) {
      throw new Error(
        `[tests/_auth-helper] Better Auth signInUsername did not return a session_token cookie for "${role}" (${username})`
      );
    }

    cookieCache.set(role, cookie);
    return cookie;
  })();

  inflightCache.set(role, task);
  try {
    return await task;
  } finally {
    inflightCache.delete(role);
  }
}

/**
 * 为单元测试请求补齐可信 Host（默认 localhost:3000）与真实 Better Auth Session Cookie。
 */
export async function withAuthHeaders(
  headers?: HeadersInit,
  role: TestUserRole = "admin"
): Promise<Headers> {
  const merged = new Headers(headers);
  if (!merged.has("host")) {
    merged.set("host", "localhost:3000");
  }
  const sessionCookie = await getTestSessionCookie(role);
  const existingCookie = merged.get("cookie");
  if (!existingCookie) {
    merged.set("cookie", sessionCookie);
  } else if (!existingCookie.includes("better-auth.session_token")) {
    merged.set("cookie", `${existingCookie}; ${sessionCookie}`);
  }
  return merged;
}
