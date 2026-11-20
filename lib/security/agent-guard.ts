import { NextResponse } from "next/server";
import {
  requireAdmin,
  requireAuthenticated,
  type AuthenticatedSession,
} from "@/lib/auth/rbac";

export interface GuardAgentOptions {
  role: "admin" | "any";
  scope: string;
  maxPerMinute?: number;
}

interface ParsedHost {
  host: string;
  hostname: string;
}

interface TrustWhitelist {
  exactHosts: Set<string>;
  hostnames: Set<string>;
  suffixes: string[];
  explicitHosts: Set<string>;
  explicitHostnames: Set<string>;
  explicitSuffixes: string[];
}

const BUILTIN_LOCAL_HOSTNAMES = ["localhost", "127.0.0.1", "[::1]"];
const RATE_LIMIT_WINDOW_MS = 60_000;

declare global {
  // eslint-disable-next-line no-var
  var __agentRateLimitBuckets: Map<string, number[]> | undefined;
}

function getRateLimitBuckets(): Map<string, number[]> {
  if (!globalThis.__agentRateLimitBuckets) {
    globalThis.__agentRateLimitBuckets = new Map<string, number[]>();
  }
  return globalThis.__agentRateLimitBuckets;
}

function parseHostCandidate(raw: string): ParsedHost | null {
  const value = raw.split(",")[0]?.trim().toLowerCase() || "";
  if (!value || /[/?#\\@\s]/.test(value)) {
    return null;
  }

  const isIpv6 = /^\[[0-9a-f:]+\](?::(\d{1,5}))?$/i.test(value);
  const isDnsOrIpv4 =
    /^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)*[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?::(\d{1,5}))?$/i.test(
      value
    );

  if (!isIpv6 && !isDnsOrIpv4) {
    return null;
  }

  try {
    const parsed = new URL(`http://${value}`);
    if (
      parsed.username ||
      parsed.password ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }

    const hostname = parsed.hostname.toLowerCase();
    const portMatch = value.match(/:(\d+)$/);
    if (portMatch) {
      const portNum = Number(portMatch[1]);
      if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
        return null;
      }
      return { host: `${hostname}:${portNum}`, hostname };
    }
    return { host: hostname, hostname };
  } catch {
    return null;
  }
}

function parseUrlOriginHost(raw: string): ParsedHost | null {
  const trimmed = raw.trim();
  if (!trimmed || trimmed.toLowerCase() === "null") {
    return null;
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return null;
    }
    const hostname = parsed.hostname.toLowerCase();
    const host = parsed.host.toLowerCase();
    return { host, hostname };
  } catch {
    return null;
  }
}

function addWhitelistEntry(
  rawEntry: string,
  list: TrustWhitelist,
  options: { includeHostnameToo?: boolean; explicit?: boolean } = {}
): void {
  const entry = rawEntry.trim().toLowerCase();
  if (!entry) return;

  if (entry.startsWith(".")) {
    if (/^\.[a-z0-9.-]+$/i.test(entry) && !entry.includes("..")) {
      list.suffixes.push(entry);
      if (options.explicit) list.explicitSuffixes.push(entry);
    }
    return;
  }

  if (entry.includes("://")) {
    const parsed = parseUrlOriginHost(entry);
    if (!parsed) return;
    if (parsed.host !== parsed.hostname) {
      list.exactHosts.add(parsed.host);
      if (options.explicit) list.explicitHosts.add(parsed.host);
      if (options.includeHostnameToo) {
        list.hostnames.add(parsed.hostname);
      }
    } else {
      list.hostnames.add(parsed.hostname);
      if (options.explicit) list.explicitHostnames.add(parsed.hostname);
    }
    return;
  }

  const parsed = parseHostCandidate(entry);
  if (!parsed) return;

  if (parsed.host !== parsed.hostname) {
    list.exactHosts.add(parsed.host);
    if (options.explicit) list.explicitHosts.add(parsed.host);
    if (options.includeHostnameToo) {
      list.hostnames.add(parsed.hostname);
    }
  } else {
    list.hostnames.add(parsed.hostname);
    if (options.explicit) list.explicitHostnames.add(parsed.hostname);
  }
}

function buildTrustWhitelist(): TrustWhitelist {
  const list: TrustWhitelist = {
    exactHosts: new Set<string>(),
    hostnames: new Set<string>(BUILTIN_LOCAL_HOSTNAMES),
    suffixes: [],
    explicitHosts: new Set<string>(),
    explicitHostnames: new Set<string>(),
    explicitSuffixes: [],
  };

  if (process.env.BETTER_AUTH_URL) {
    addWhitelistEntry(process.env.BETTER_AUTH_URL, list, {
      includeHostnameToo: true,
      explicit: true,
    });
  }

  if (process.env.BETTER_AUTH_TRUSTED_ORIGINS) {
    for (const item of process.env.BETTER_AUTH_TRUSTED_ORIGINS.split(",")) {
      addWhitelistEntry(item, list, {
        includeHostnameToo: false,
        explicit: true,
      });
    }
  }

  if (process.env.ALLOWED_AGENT_HOSTS) {
    for (const item of process.env.ALLOWED_AGENT_HOSTS.split(",")) {
      addWhitelistEntry(item, list, {
        includeHostnameToo: false,
        explicit: true,
      });
    }
  }

  return list;
}

function matchesTrusted(target: ParsedHost, list: TrustWhitelist): boolean {
  if (list.exactHosts.has(target.host) || list.hostnames.has(target.hostname)) {
    return true;
  }
  return list.suffixes.some((suffix) => target.hostname.endsWith(suffix));
}

function matchesExplicitTrusted(target: ParsedHost, list: TrustWhitelist): boolean {
  if (list.explicitHosts.has(target.host) || list.explicitHostnames.has(target.hostname)) {
    return true;
  }
  return list.explicitSuffixes.some((suffix) => target.hostname.endsWith(suffix));
}

function isSameHost(a: ParsedHost, b: ParsedHost): boolean {
  return a.host === b.host;
}

function untrustedHostResponse(): Response {
  return NextResponse.json(
    {
      success: false,
      code: "FORBIDDEN",
      error: "Untrusted Host or Origin",
    },
    { status: 403 }
  );
}

/**
 * 校验请求的 Host / X-Forwarded-Host 与 Origin / Referer 是否命中受信任白名单。
 */
export function assertTrustedHostAndOrigin(req: Request): Response | null {
  const rawHost = req.headers.get("x-forwarded-host") || req.headers.get("host");
  if (!rawHost) {
    return untrustedHostResponse();
  }

  const parsedHost = parseHostCandidate(rawHost);
  if (!parsedHost) {
    return untrustedHostResponse();
  }

  const whitelist = buildTrustWhitelist();
  if (!matchesTrusted(parsedHost, whitelist)) {
    return untrustedHostResponse();
  }

  const rawOrigin = req.headers.get("origin");
  if (rawOrigin !== null) {
    const parsedOrigin = parseUrlOriginHost(rawOrigin);
    if (!parsedOrigin) {
      return untrustedHostResponse();
    }
    if (!matchesTrusted(parsedOrigin, whitelist)) {
      return untrustedHostResponse();
    }
    if (!isSameHost(parsedOrigin, parsedHost) && !matchesExplicitTrusted(parsedOrigin, whitelist)) {
      return untrustedHostResponse();
    }
    return null;
  }

  const rawReferer = req.headers.get("referer");
  if (rawReferer !== null) {
    const parsedReferer = parseUrlOriginHost(rawReferer);
    if (!parsedReferer || !matchesTrusted(parsedReferer, whitelist)) {
      return untrustedHostResponse();
    }
  }

  return null;
}

/**
 * 基于内存滑动窗口（60s）对智能体/高消耗接口按 scope + identity 限流。
 */
export function checkAgentRateLimit(
  scope: string,
  identity: string,
  maxPerMinute?: number
): Response | null {
  const envLimit = Number(process.env.AGENT_RATE_LIMIT_PER_MIN || 20);
  const limit =
    typeof maxPerMinute === "number" && Number.isFinite(maxPerMinute) && maxPerMinute > 0
      ? Math.floor(maxPerMinute)
      : Number.isFinite(envLimit) && envLimit > 0
        ? Math.floor(envLimit)
        : 20;

  const now = Date.now();
  const cutoff = now - RATE_LIMIT_WINDOW_MS;
  const buckets = getRateLimitBuckets();

  if (buckets.size > 1000) {
    for (const [k, hits] of buckets.entries()) {
      const latest = hits[hits.length - 1] ?? 0;
      if (latest <= cutoff) {
        buckets.delete(k);
      }
    }
  }

  const bucketKey = `${scope}:${identity}`;
  const recent = (buckets.get(bucketKey) ?? []).filter((ts) => ts > cutoff);

  if (recent.length >= limit) {
    buckets.set(bucketKey, recent);
    const oldest = recent[0] ?? now;
    const retryAfterSec = Math.max(1, Math.ceil((oldest + RATE_LIMIT_WINDOW_MS - now) / 1000));
    return NextResponse.json(
      {
        success: false,
        code: "RATE_LIMITED",
        error: "请求过于频繁，请稍后再试",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSec),
        },
      }
    );
  }

  recent.push(now);
  buckets.set(bucketKey, recent);
  return null;
}

/**
 * 组合执行：1) 可信 Host/Origin 校验 2) RBAC 鉴权 3) 滑动窗口限流。
 */
export async function guardAgentRequest(
  req: Request,
  opts: GuardAgentOptions
): Promise<{ session: AuthenticatedSession } | { response: Response }> {
  const hostError = assertTrustedHostAndOrigin(req);
  if (hostError) {
    return { response: hostError };
  }

  const authResult =
    opts.role === "admin"
      ? await requireAdmin(req)
      : await requireAuthenticated(req);
  if ("response" in authResult) {
    return authResult;
  }

  const rateError = checkAgentRateLimit(opts.scope, authResult.session.user.id, opts.maxPerMinute);
  if (rateError) {
    return { response: rateError };
  }

  return { session: authResult.session };
}
