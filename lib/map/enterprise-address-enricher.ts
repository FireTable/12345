/**
 * 企业/商户责任主体地址智能补全器 (Enterprise Address Enricher)
 * 纯规则 + 天地图安全两级补全，零硬编码，完全由动态多租户区划词库驱动。
 */

import { geocodeAddress, reverseGeocode } from "./tianditu-service";
import { canonicalizeTownship, matchTownshipName, type RegionVocabulary } from "@/lib/vocabulary";
import type { RegionRecord } from "@/db/schema";

export const PLACEHOLDER_LOCATIONS = new Set([
  "",
  "无",
  "未知",
  "未指定",
  "无辖区",
  "全国",
  "线上",
  "纯网购",
  "null",
  "undefined",
]);

export function isPlaceholderLocation(loc?: string | null): boolean {
  if (!loc) return true;
  return PLACEHOLDER_LOCATIONS.has(loc.trim());
}

const ENTERPRISE_KEYWORD_REGEX =
  /(?:公司|有限|集团|店|厂|商行|门市|中心|广场|商场|大厦|超市|酒店|宾馆|阁|城|局|所|院|校|站|坊|社|商场|俱乐部|工作室|档口|加工|制造|物流|供应链|窗口|服务台|个体户)/;

const PERSONAL_PRONOUNS_REGEX =
  /^(?:涉事方|涉事人|市民|反映人|业主|租客|车主|群众|当事人|消费者|投保人|患者|旅客|乘客)$/;

export function isEnterpriseEntity(subject?: string | null): boolean {
  if (!subject) return false;
  const s = subject.trim();
  if (s.length < 3 || s.length > 60) return false;
  if (PERSONAL_PRONOUNS_REGEX.test(s)) return false;
  return ENTERPRISE_KEYWORD_REGEX.test(s);
}

// 进程级内存缓存，相同商户秒级复用，杜绝重复网络请求
const enterpriseGeoCache = new Map<
  string,
  { address?: string; township?: string; lng?: number; lat?: number } | null
>();

export interface EnrichedEnterpriseLocation {
  address?: string;
  township?: string;
  lng?: number;
  lat?: number;
  enriched: boolean;
}

/**
 * 根据责任主体（商户/企业）智能推导其线下经营/注册地址及所属法定镇街
 * 优先级:
 * 1. 动态比对主体名中是否已包含法定镇街 (0ms)
 * 2. 内存 LRU 缓存命中 (0ms)
 * 3. 天地图正向 POI/地理编码 + 逆向行政区划反查 (受控超时，静默容错)
 */
export async function enrichEnterpriseLocation(
  subject: string,
  region?: Partial<RegionRecord> | null,
  vocab?: RegionVocabulary
): Promise<EnrichedEnterpriseLocation> {
  const cleanSubject = (subject || "").trim();
  if (!isEnterpriseEntity(cleanSubject)) {
    return { enriched: false };
  }

  // 1. 本地动态词库比对：检查主体名称中是否包含当前站点的法定镇街 (0ms)
  if (vocab?.townships && vocab.townships.length > 0) {
    const matchedTown = matchTownshipName(cleanSubject, vocab.townships);
    if (matchedTown) {
      return {
        address: `${matchedTown} (${cleanSubject})`,
        township: matchedTown,
        enriched: true,
      };
    }
  }

  // 2. 检查内存缓存 (0ms)
  const cacheKey = `${region?.id || "default"}:${cleanSubject}`;
  if (enterpriseGeoCache.has(cacheKey)) {
    const cached = enterpriseGeoCache.get(cacheKey);
    if (!cached) return { enriched: false };
    return { ...cached, enriched: true };
  }

  // 3. 检查是否有天地图 Key
  const tiandituKey = process.env.TIANDITU_SERVER_KEY;
  if (!tiandituKey || tiandituKey === "your_tianditu_server_key_here") {
    enterpriseGeoCache.set(cacheKey, null);
    return { enriched: false };
  }

  // 4. 动态生成区域前缀（例如 "广东省佛山市顺德区" 或 "广东省广州市天河区"，纯动态驱动，零硬编码）
  const regionPrefix = [region?.province, region?.city, region?.name]
    .filter(Boolean)
    .join("");

  try {
    const geoRes = await geocodeAddress(cleanSubject, regionPrefix);

    if (geoRes.success && typeof geoRes.lng === "number" && typeof geoRes.lat === "number") {
      const revRes = await reverseGeocode(geoRes.lng, geoRes.lat);

      if (revRes.success) {
        // 验证反查出的镇街是否符合当前站点的法定字典
        const rawTown = revRes.township || "";
        const validatedTown = canonicalizeTownship(rawTown, vocab);
        const resolvedAddress = revRes.formattedAddress || geoRes.formattedAddress || cleanSubject;

        const result = {
          address: resolvedAddress,
          township: validatedTown || undefined,
          lng: geoRes.lng,
          lat: geoRes.lat,
        };

        enterpriseGeoCache.set(cacheKey, result);
        return { ...result, enriched: true };
      }
    }
  } catch {
    // 静默容错，不阻断正常业务
  }

  enterpriseGeoCache.set(cacheKey, null);
  return { enriched: false };
}
