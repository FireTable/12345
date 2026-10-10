import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDefaultRegion } from "@/db/client";

function normalizeRegionId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "shunde") return "fs_shunde";
  if (trimmed === "haizhu") return "gz_haizhu";
  return trimmed || null;
}

/**
 * 从请求的 Header / Cookie / URL 参数中解析当前激活的地区站点 ID
 */
export async function resolveRequestRegionId(
  req?: Request | NextRequest | null
): Promise<string> {
  // 1. URL Query 参数 ?region=...
  if (req && "url" in req) {
    try {
      const url = new URL(req.url);
      const queryRegion = normalizeRegionId(url.searchParams.get("region"));
      if (queryRegion) {
        return queryRegion;
      }
    } catch (e) {
      // ignore
    }
  }

  // 2. HTTP Request Header: x-region-id
  if (req && "headers" in req) {
    const headerRegion = normalizeRegionId(req.headers.get("x-region-id"));
    if (headerRegion) {
      return headerRegion;
    }
  }

  // 3. Cookie: active_region
  try {
    const cookieStore = await cookies();
    const cookieRegion = normalizeRegionId(cookieStore.get("active_region")?.value);
    if (cookieRegion) {
      return cookieRegion;
    }
  } catch (e) {
    // ignore
  }

  // 4. 默认站点回退
  try {
    const def = await getDefaultRegion();
    if (def) return def.id;
  } catch (e) {
    // ignore
  }

  return "fs_shunde";
}
