/**
 * Split an AI (or file) location string into 区/县 + 镇/街道.
 * Structural Chinese admin suffixes only — no city gazetteer.
 */

const PLACEHOLDER_ADMIN = new Set([
  "所属辖区",
  "综合辖区",
  "未归属镇街",
  "未标明微观地点",
  "未指定",
  "本区",
  "未归属",
]);

const DISTRICT_NOISE =
  /(?:小区|园区|社区|景区|街区|片区|开发区|高新区|新区|示范区|管理区|协作区|市辖区)$/;

const DISTRICT_PREFIX_SKIP = ["小", "园", "社", "景", "街", "片"];
const DISTRICT_STEM_SKIP = ["开发", "高新", "示范", "管理", "协作", "市辖"];

export function explicitAdmin(value?: string | null): string | null {
  const text = (value || "").trim();
  if (!text || PLACEHOLDER_ADMIN.has(text)) return null;
  return text;
}

/** 筛选项只用像镇街的短名，丢掉「未提供具体…」「…等多处」这类碎片。 */
export function isTownLabel(name?: string | null): boolean {
  const text = (name || "").trim();
  if (!text || text.length > 6) return false;
  if (/未提供|具体|等多处|未标明|未归属|所属|地址/.test(text)) return false;
  return /^[\u4e00-\u9fff]{2,6}$/.test(text);
}

function cjkTail(before: string, maxLen: number): string {
  const chars = (before.match(/[\u4e00-\u9fff]+$/) || [""])[0];
  return chars.slice(-maxLen);
}

function afterAdminPrefix(name: string): string {
  const parts = name.split(/[省市]/);
  return parts[parts.length - 1] || "";
}

export function parseAdminArea(location?: string | null): {
  district: string | null;
  subdistrict: string | null;
} {
  const text = (location || "").trim();
  if (!text || PLACEHOLDER_ADMIN.has(text)) {
    return { district: null, subdistrict: null };
  }

  const districts: string[] = [];
  const districtRe = /自治县|区|县|旗/g;
  let match: RegExpExecArray | null;
  while ((match = districtRe.exec(text))) {
    const suffix = match[0];
    if (suffix === "区") {
      const prev = text.slice(Math.max(0, match.index - 2), match.index);
      if (DISTRICT_PREFIX_SKIP.some((p) => prev.endsWith(p))) continue;
      const stem = text.slice(Math.max(0, match.index - 3), match.index);
      if (DISTRICT_STEM_SKIP.some((p) => stem.endsWith(p))) continue;
    }
    const raw = afterAdminPrefix(cjkTail(text.slice(0, match.index), 8));
    if (!raw) continue;
    const full = `${raw}${suffix}`;
    if (DISTRICT_NOISE.test(full)) continue;
    districts.push(full);
  }

  const towns: string[] = [];
  const townRe = /街道|镇|乡/g;
  while ((match = townRe.exec(text))) {
    const suffix = match[0];
    const raw = cjkTail(text.slice(0, match.index), 8);
    if (!raw) continue;
    const tail = raw.split(/[省市县旗区]/).pop() || "";
    if (!tail || tail === "乡") continue;
    const full = `${tail}${suffix}`;
    if (full === "乡镇") continue;
    towns.push(full);
  }

  return {
    district: districts[0] || null,
    subdistrict: towns[0] || null,
  };
}

export function adminFromLocation(
  location?: string | null,
  fallback?: { district?: string | null; subdistrict?: string | null }
): { district: string | null; subdistrict: string | null } {
  const parsed = parseAdminArea(location);
  return {
    district: parsed.district || explicitAdmin(fallback?.district),
    subdistrict: parsed.subdistrict || explicitAdmin(fallback?.subdistrict),
  };
}
