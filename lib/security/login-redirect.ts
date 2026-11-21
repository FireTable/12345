const ADMIN_ROUTE_PREFIXES = [
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

function hasAsciiControlChar(value: string): boolean {
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code <= 0x1f || code === 0x7f) {
      return true;
    }
  }
  return false;
}

export function isSafeRedirectFrom(redirectFrom?: string | null): redirectFrom is string {
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

export function isAdminRoutePath(path: string): boolean {
  if (!path.startsWith("/") || path.startsWith("//") || path.includes("\\")) {
    return false;
  }
  let pathname = path;
  try {
    const parsed = new URL(path, "https://civic.local");
    if (parsed.origin !== "https://civic.local") {
      return false;
    }
    pathname = parsed.pathname;
  } catch {
    return false;
  }
  if (pathname === "/") return true;
  return ADMIN_ROUTE_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`)
  );
}

export function resolvePostLoginTarget(
  role: string | null | undefined,
  rawFrom?: string | null
): string {
  const normalizedRole = role === "admin" ? "admin" : "user";
  const defaultTarget = normalizedRole === "user" ? "/submit" : "/";
  if (!isSafeRedirectFrom(rawFrom)) {
    return defaultTarget;
  }
  let parsed: URL;
  try {
    parsed = new URL(rawFrom, "https://civic.local");
  } catch {
    return defaultTarget;
  }
  if (parsed.pathname === "/login" || parsed.pathname.startsWith("/login/")) {
    return defaultTarget;
  }
  if (normalizedRole === "user" && isAdminRoutePath(parsed.pathname)) {
    return "/submit";
  }
  return `${parsed.pathname}${parsed.search}${parsed.hash}`;
}
