import { NextResponse, type NextRequest } from "next/server";

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // 1. Static assets and internal next routes
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/civic") ||
    pathname.startsWith("/videos") ||
    pathname.startsWith("/images") ||
    pathname.includes(".")
  ) {
    return NextResponse.next();
  }

  // 2. Auth API routes
  if (pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  // 2.5 Public API routes (no login required; used by landing page + copilot fallback)
  if (pathname.startsWith("/api/public/")) {
    return NextResponse.next();
  }

  // 2.7 Map tile proxy & Region boundary public APIs
  if (
    pathname.startsWith("/api/map/tile") ||
    pathname.startsWith("/api/map/geocode") ||
    pathname.startsWith("/api/regions/")
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
  if (pathname.startsWith("/api/internal/")) {
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

  const sessionToken =
    request.cookies.get("better-auth.session_token")?.value ||
    request.cookies.get("__Secure-better-auth.session_token")?.value;

  // 3. Login page handling (always allow access to login page)
  if (pathname.startsWith("/login")) {
    return NextResponse.next();
  }

  // 4. API routes: return 401 if unauthenticated instead of 302 redirect
  if (pathname.startsWith("/api/")) {
    if (!sessionToken) {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }
    return NextResponse.next();
  }

  // 5. Protected pages
  if (!sessionToken) {
    const loginUrl = new URL("/login", request.url);
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
