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

  // 2.6 Copilot endpoint: anon users can chat with the LLM using public stats.
  // Doesn't expose ticket content / PII — only KPI numbers and LLM streaming.
  if (pathname === "/api/copilot") {
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
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
