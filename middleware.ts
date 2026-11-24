import { NextResponse, type NextRequest } from "next/server";

const textEncoder = new TextEncoder();
let cachedSecret: string | null = null;
let cachedKeyPromise: Promise<CryptoKey> | null = null;

function getAuthSecret(): string {
  return process.env.BETTER_AUTH_SECRET || "civic-12345-auth-secret-key-production-dev-mode";
}

function getHmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKeyPromise && cachedSecret === secret) {
    return cachedKeyPromise;
  }
  cachedSecret = secret;
  cachedKeyPromise = crypto.subtle.importKey(
    "raw",
    textEncoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  return cachedKeyPromise;
}

const STATIC_ASSET_EXT_RE =
  /\.(?:ico|png|jpe?g|gif|svg|webp|css|js|map|woff2?|ttf|eot|txt|xml|json|webmanifest|mp4|webm)$/i;

const PROTECTED_PAGE_PREFIXES = [
  "/themes",
  "/tickets",
  "/admin",
  "/multifreq",
  "/dict",
  "/sandbox",
  "/screen",
  "/agent",
  "/submit",
];

function hasPathPrefix(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

async function verifySignedCookieValue(rawValue: string): Promise<boolean> {
  if (!rawValue) return false;
  // NextRequest.cookies.get() already performs one URL-decode pass; do not decode again
  const value = rawValue;

  const dotIdx = value.lastIndexOf(".");
  if (dotIdx < 1) return false;

  const token = value.slice(0, dotIdx);
  const sig = value.slice(dotIdx + 1);
  if (!token || sig.length !== 44 || !sig.endsWith("=")) {
    return false;
  }

  let sigBytes: Uint8Array;
  try {
    const binary = atob(sig);
    sigBytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      sigBytes[i] = binary.charCodeAt(i);
    }
  } catch {
    return false;
  }

  if (sigBytes.length !== 32) return false;

  try {
    const key = await getHmacKey(getAuthSecret());
    const expected = new Uint8Array(
      await crypto.subtle.sign("HMAC", key, textEncoder.encode(token))
    );
    let diff = expected.length ^ sigBytes.length;
    for (let i = 0; i < expected.length; i++) {
      diff |= expected[i] ^ sigBytes[i];
    }
    return diff === 0;
  } catch {
    return false;
  }
}

async function hasValidSessionSignature(request: NextRequest): Promise<boolean> {
  const candidates = [
    request.cookies.get("better-auth.session_token")?.value,
    request.cookies.get("__Secure-better-auth.session_token")?.value,
  ].filter((v): v is string => Boolean(v));

  for (const candidate of candidates) {
    if (await verifySignedCookieValue(candidate)) {
      return true;
    }
  }
  return false;
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isProtectedPagePath = PROTECTED_PAGE_PREFIXES.some((prefix) =>
    hasPathPrefix(pathname, prefix)
  );

  // 1. Static assets, .well-known, and internal next routes (keep /api/* and protected pages under auth)
  if (
    hasPathPrefix(pathname, "/_next") ||
    hasPathPrefix(pathname, "/civic") ||
    hasPathPrefix(pathname, "/videos") ||
    hasPathPrefix(pathname, "/images") ||
    hasPathPrefix(pathname, "/.well-known") ||
    (!hasPathPrefix(pathname, "/api") &&
      !isProtectedPagePath &&
      STATIC_ASSET_EXT_RE.test(pathname))
  ) {
    return NextResponse.next();
  }

  // 2. Auth API routes
  if (hasPathPrefix(pathname, "/api/auth")) {
    return NextResponse.next();
  }

  // 2.5 Public API routes (no login required; used by landing page + copilot fallback)
  if (hasPathPrefix(pathname, "/api/public")) {
    return NextResponse.next();
  }

  // 2.7 Map tile proxy & Region boundary public APIs (/api/map/geocode requires auth)
  if (
    hasPathPrefix(pathname, "/api/map/tile") ||
    hasPathPrefix(pathname, "/api/regions")
  ) {
    return NextResponse.next();
  }

  // 2.8 Internal server-to-server endpoints (e.g. cluster bootstrap
  //      triggered by instrumentation.ts on next-server boot). The
  //      caller is the same Node process via localhost fetch, so
  //      there's no user identity to authenticate. We rely on the
  //      /api/internal/ URL convention + the bind to 127.0.0.1 as
  //      the only access control. NEVER expose anything user-facing
  //      under /api/internal/.
  if (hasPathPrefix(pathname, "/api/internal")) {
    return NextResponse.next();
  }

  // MCP 发现与令牌交换不能走登录 cookie。
  // 未带 access key 的调用要在路由里返回 401，并带上 WWW-Authenticate。
  // /api/mcp/grant 仍要登录，已登录的人在授权页签发 access key。
  if (
    pathname === "/api/mcp" ||
    pathname === "/api/mcp/token" ||
    pathname === "/api/mcp/oauth-protected-resource" ||
    pathname === "/api/mcp/oauth-authorization-server"
  ) {
    return NextResponse.next();
  }

  // 3. Login page handling (always allow access to login page)
  if (hasPathPrefix(pathname, "/login")) {
    return NextResponse.next();
  }

  const hasValidSession = await hasValidSessionSignature(request);

  // 4. API routes: return 401 if unauthenticated or signature invalid instead of 302 redirect
  if (hasPathPrefix(pathname, "/api")) {
    if (!hasValidSession) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 5. Protected pages
  if (!hasValidSession) {
    const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
    const host = forwardedHost || request.headers.get("host")?.trim();
    const forwardedProto = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto = (forwardedProto || request.nextUrl.protocol.replace(/:$/, "") || "http").replace(/[^a-z]/gi, "");
    const safeOrigin =
      host && /^[a-zA-Z0-9.\-:\[\]]+$/.test(host)
        ? `${proto}://${host}`
        : request.url;
    const loginUrl = new URL("/login", safeOrigin);
    if (pathname !== "/") {
      loginUrl.searchParams.set("from", pathname);
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|api/tickets/upload).*)",
  ],
};
