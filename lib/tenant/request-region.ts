import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getDefaultRegion } from "@/db/client";

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
      const queryRegion = url.searchParams.get("region");
      if (queryRegion && queryRegion.trim()) {
        return queryRegion.trim();
      }
    } catch (e) {
      // ignore
    }
  }

  // 2. HTTP Request Header: x-region-id
  if (req && "headers" in req) {
    const headerRegion = req.headers.get("x-region-id");
    if (headerRegion && headerRegion.trim()) {
      return headerRegion.trim();
    }
  }

  // 3. Cookie: active_region
  try {
    const cookieStore = await cookies();
    const cookieRegion = cookieStore.get("active_region")?.value;
    if (cookieRegion && cookieRegion.trim()) {
      return cookieRegion.trim();
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

  return "shunde";
}
