import { NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getAllRegions } from "@/db/client";
import {
  filterRegionsByAppDomain,
  getAppDomainMode,
  getFallbackRegionIdForDomain,
  isRegionAllowedInAppDomain,
} from "@/lib/app-domain";

function normalizeRegionId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (trimmed === "shunde") return "fs_shunde";
  if (trimmed === "haizhu") return "gz_haizhu";
  return trimmed || null;
}

/**
 * 从显式参数 / URL / Header / Cookie 中解析当前激活的站点 ID，并强制执行 APP_DOMAIN 业务域隔离
 */
export async function resolveRequestRegionId(
  req?: Request | NextRequest | null,
  explicitRegionId?: string | null
): Promise<string> {
  const mode = getAppDomainMode();
  const candidates: string[] = [];

  const pushCandidate = (value: string | null) => {
    if (value && !candidates.includes(value)) {
      candidates.push(value);
    }
  };

  // 0. 显式传入的 regionId（例如 JSON body 中的 regionId）
  pushCandidate(normalizeRegionId(explicitRegionId));

  // 1. URL Query 参数 ?region=...
  if (req && "url" in req) {
    try {
      const url = new URL(req.url);
      pushCandidate(normalizeRegionId(url.searchParams.get("region")));
    } catch {
      // ignore
    }
  }

  // 2. HTTP Request Header: x-region-id
  if (req && "headers" in req) {
    pushCandidate(normalizeRegionId(req.headers.get("x-region-id")));
  }

  // 3. Cookie: active_region
  try {
    const cookieStore = await cookies();
    pushCandidate(normalizeRegionId(cookieStore.get("active_region")?.value));
  } catch {
    if (req && "headers" in req) {
      const rawCookie = req.headers.get("cookie") || "";
      const match = rawCookie.match(/(?:^|;\s*)active_region=([^;]+)/);
      if (match?.[1]) {
        try {
          pushCandidate(normalizeRegionId(decodeURIComponent(match[1])));
        } catch {
          pushCandidate(normalizeRegionId(match[1]));
        }
      }
    }
  }

  let allRegions: Awaited<ReturnType<typeof getAllRegions>> = [];
  try {
    allRegions = await getAllRegions();
  } catch {
    allRegions = [];
  }

  if (allRegions.length > 0) {
    for (const candidate of candidates) {
      const matched =
        allRegions.find((r) => r.id === candidate) ||
        allRegions.find((r) => r.id.endsWith(`_${candidate}`)) ||
        allRegions.find((r) => r.schemaName === candidate);
      if (matched) {
        if (isRegionAllowedInAppDomain(matched, mode)) {
          return matched.id;
        }
        // 非当前 APP_DOMAIN 的租户（例如 GOV_12345 主站收到旧 ecom_demo cookie）直接丢弃
        continue;
      }
    }

    const allowedRegions = filterRegionsByAppDomain(allRegions, mode);
    const defaultAllowed = allowedRegions.find((r) => r.isDefault) || allowedRegions[0];
    if (defaultAllowed) {
      return defaultAllowed.id;
    }
  } else if (candidates.length > 0) {
    return candidates[0];
  }

  return getFallbackRegionIdForDomain(mode);
}
