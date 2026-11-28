/**
 * 别名知识沉淀与自动归一化替换引擎 (Alias Dictionary & Entity Normalization Engine)
 * 能够持续沉淀镇街、微观社区、商户机构及诉求术语的别名映射，实现自动识别与全局替换。
 * 支持多城市独立 Schema 隔离沉淀。
 */

import { loadPresetVocabulary } from "./vocabulary";
export { isAnonymizedCitizen } from "./civic-dto";

// 内存中活跃沉淀的别名映射表（默认环境）
const runtimeAliasMap: Map<string, string> = new Map<string, string>();

// 区域别名缓存（按 regionId 隔离）
const regionAliasCache = new Map<string, { map: Map<string, string>; loadedAt: number }>();
const ALIAS_CACHE_TTL = 30 * 1000;

/**
 * 获取当前所有已注册的别名知识库映射
 */
export function getAllAliases(): Record<string, string> {
  const res: Record<string, string> = {};
  runtimeAliasMap.forEach((v, k) => {
    res[k] = v;
  });
  return res;
}

/** 只给对得上的城市盖出厂镇街别名，避免天河句子被顺德词典改写。 */
function presetTownshipKey(regionIdOrSchema?: string | null): "gz_tianhe" | "fs_shunde" | null {
  const key = (regionIdOrSchema || "").trim().toLowerCase();
  if (!key || key === "default" || key.includes("shunde")) return "fs_shunde";
  if (key.includes("tianhe")) return "gz_tianhe";
  return null;
}

/**
 * 动态加载指定地区的别名知识库（优先查 DB，无 DB 时自动从对应地区预置提炼）
 */
export async function getRegionAliasMap(regionIdOrSchema?: string | null): Promise<Map<string, string>> {
  const targetKey = regionIdOrSchema?.trim() || "default";
  const now = Date.now();
  if (regionAliasCache.has(targetKey)) {
    const cached = regionAliasCache.get(targetKey)!;
    if (now - cached.loadedAt < ALIAS_CACHE_TTL) {
      return cached.map;
    }
  }

  const map = new Map<string, string>();

  // 1. 优先从当前租户独立的数据库 aliases 表读取
  try {
    const { getRegionDb } = await import("@/db/client");
    const { aliasesTable } = await import("@/db/schema");
    const { db: tenantDb } = await getRegionDb(regionIdOrSchema);
    const rows = await tenantDb.select().from(aliasesTable);
    for (const r of rows) {
      if (r.alias && r.canonical) {
        map.set(r.alias, r.canonical);
      }
    }
  } catch (err) {
    // 数据库连接异常或未初始化
  }

  // 2. 出厂镇街别名盖过库里挖错的同名映射。库里已有别名时不再铺地标，避免把正文改长。
  const hadDbRows = map.size > 0;
  const presetKey = presetTownshipKey(targetKey);
  if (presetKey) {
    try {
      const vocab = loadPresetVocabulary(presetKey);
      for (const t of vocab.townships) {
        for (const a of t.aliases || []) {
          if (a && a !== t.fullName) map.set(a, t.fullName);
        }
        if (!hadDbRows) {
          for (const lm of t.landmarks || []) {
            if (lm) map.set(lm, `${t.fullName}${lm}`);
          }
        }
      }
      for (const c of vocab.colloquialAliases || []) {
        if (c.alias && c.canonical && c.alias !== c.canonical) {
          if (!hadDbRows || !map.has(c.alias)) {
            map.set(c.alias, c.canonical);
          }
        }
      }
      if (!hadDbRows) {
        for (const d of vocab.departments) {
          if (d.name && d.name !== d.fullName) {
            map.set(d.name, d.fullName);
          }
        }
      }
    } catch {
      // 容错忽略
    }
  }

  regionAliasCache.set(targetKey, { map, loadedAt: now });
  return map;
}

/**
 * 实体别名查找与归一化
 * 若存在别名映射，直接替换为规范名称；否则返回清洗后的原名称。
 */
export function resolveEntityAlias(rawName?: string | null, customMap?: Map<string, string>): string {
  if (!rawName) return "";
  const trimmed = rawName.trim();
  if (customMap && customMap.has(trimmed)) {
    return customMap.get(trimmed)!;
  }
  if (runtimeAliasMap.has(trimmed)) {
    return runtimeAliasMap.get(trimmed)!;
  }
  return trimmed;
}

/**
 * 全文别名替换预处理：单遍最长优先正则替换，避免嵌套二次改写与路名后缀误伤
 */
const compiledMatcherCache = new WeakMap<
  Map<string, string>,
  { size: number; regex: RegExp | null; canonicalGuards: Set<string> }
>();

const TOWNSHIP_FOLLOW_PROTECT_RE =
  /^[街道镇路大道桥涌村站东南西北一二三四五六七八九公园医院广场大厦市场城学所局院]/;

function escapeRegExp(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getCompiledMatcher(activeMap: Map<string, string>): {
  regex: RegExp | null;
  canonicalGuards: Set<string>;
} {
  const cached = compiledMatcherCache.get(activeMap);
  if (cached && cached.size === activeMap.size) {
    return cached;
  }

  const aliases = Array.from(activeMap.keys()).filter((a) => {
    if (a.length < 2) return false;
    const c = activeMap.get(a);
    return Boolean(c && c !== a);
  });

  if (aliases.length === 0) {
    const empty = { size: activeMap.size, regex: null, canonicalGuards: new Set<string>() };
    compiledMatcherCache.set(activeMap, empty);
    return empty;
  }

  const canonicalGuards = new Set<string>();
  for (const canonical of activeMap.values()) {
    if (canonical && canonical.length >= 2 && !activeMap.has(canonical)) {
      canonicalGuards.add(canonical);
    }
  }

  // 同时纳入标准全称与别名做单遍最长匹配；命中已有标准全称时直接原样保留，保障幂等与括号内部不被二次切分
  const allTokens = Array.from(new Set([...canonicalGuards, ...aliases])).sort(
    (a, b) => b.length - a.length
  );
  const regex = new RegExp(allTokens.map(escapeRegExp).join("|"), "g");
  const entry = { size: activeMap.size, regex, canonicalGuards };
  compiledMatcherCache.set(activeMap, entry);
  return entry;
}

export function normalizeAliasesInText(text?: string | null, customMap?: Map<string, string>): string {
  if (!text) return "";
  const activeMap = customMap || runtimeAliasMap;
  const { regex, canonicalGuards } = getCompiledMatcher(activeMap);
  if (!regex) return text;

  let result = text.replace(regex, (matched, offset: number, source: string) => {
    if (canonicalGuards.has(matched)) {
      return matched;
    }

    const canonical = activeMap.get(matched);
    if (!canonical || matched === canonical) {
      return matched;
    }

    // 幂等保护：前面已带完整街道/规范前缀时不重复拼接
    if (canonical.endsWith(matched) && canonical.length > matched.length) {
      const prefix = canonical.slice(0, canonical.length - matched.length);
      if (offset >= prefix.length && source.slice(offset - prefix.length, offset) === prefix) {
        return matched;
      }
    }

    // 已完整匹配规范全称时不重复展开
    if (canonical.startsWith(matched) && source.startsWith(canonical, offset)) {
      return matched;
    }

    // 短镇街名紧邻道路/桥梁/河涌/站点等专名后缀时跳过，避免把 "元岗路" 误改成 "元岗街道路"
    if (canonical.startsWith(matched) && (canonical.endsWith("街道") || canonical.endsWith("镇"))) {
      const nextChar = source[offset + matched.length] || "";
      if (nextChar && TOWNSHIP_FOLLOW_PROTECT_RE.test(nextChar)) {
        return matched;
      }
    }

    return canonical;
  });

  // 清洗叠字与重复街道后缀
  result = result
    .replace(/街道街道/g, "街道")
    .replace(/镇镇/g, "镇")
    .replace(/([\u4e00-\u9fa5]{2,4}街道)\1+/g, "$1");

  return result;
}

/**
 * 动态沉淀新识别出的别名映射
 */
export function registerAlias(alias: string, canonical: string, regionIdOrSchema?: string): boolean {
  const cleanAlias = (alias || "").trim();
  const cleanCanonical = (canonical || "").trim();

  if (!cleanAlias || !cleanCanonical || cleanAlias === cleanCanonical || cleanAlias.length <= 1) {
    return false;
  }

  runtimeAliasMap.set(cleanAlias, cleanCanonical);
  if (regionIdOrSchema && regionAliasCache.has(regionIdOrSchema)) {
    regionAliasCache.get(regionIdOrSchema)!.map.set(cleanAlias, cleanCanonical);
  }

  // 异步写入对应 Schema 数据库沉淀持久化
  (async () => {
    try {
      const { getRegionDb } = await import("@/db/client");
      const { aliasesTable } = await import("@/db/schema");
      const { db: tenantDb } = await getRegionDb(regionIdOrSchema);
      await tenantDb
        .insert(aliasesTable)
        .values({
          id: `ALIAS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          alias: cleanAlias,
          canonical: cleanCanonical,
          type: cleanCanonical.endsWith("街道") || cleanCanonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY",
          source: "AI_MINED",
          usageCount: 1,
        })
        .onConflictDoNothing({ target: aliasesTable.alias });
    } catch (e) {
      // 离线模式静默忽略
    }
  })();

  return true;
}
