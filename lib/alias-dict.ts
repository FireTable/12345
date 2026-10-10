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

  // 2. 若数据库无记录（冷启动或离线测试），自动从对应地区出厂字典提炼别名
  if (map.size === 0) {
    try {
      const vocab = loadPresetVocabulary(targetKey);
      for (const t of vocab.townships) {
        for (const a of t.aliases || []) {
          if (a && a !== t.fullName) map.set(a, t.fullName);
        }
        for (const lm of t.landmarks || []) {
          if (lm) map.set(lm, `${t.fullName}${lm}`);
        }
      }
      for (const d of vocab.departments) {
        if (d.name && d.name !== d.fullName) {
          map.set(d.name, d.fullName);
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
 * 全文别名替换预处理：在文本入模或抽取前，对文本内包含的已知别名进行自动规范化替换
 */
const sortedAliasCache = new WeakMap<Map<string, string>, { size: number; aliases: string[] }>();

function sortedAliasKeys(activeMap: Map<string, string>): string[] {
  const cached = sortedAliasCache.get(activeMap);
  // registerAlias 只增不删。键集合没变时，长度相同，排序结果可以复用。
  if (cached && cached.size === activeMap.size) return cached.aliases;
  const aliases = Array.from(activeMap.keys()).sort((a, b) => b.length - a.length);
  sortedAliasCache.set(activeMap, { size: activeMap.size, aliases });
  return aliases;
}

export function normalizeAliasesInText(text?: string | null, customMap?: Map<string, string>): string {
  if (!text) return "";
  let result = text;
  const activeMap = customMap || runtimeAliasMap;

  // 按别名长度从长到短排序，优先匹配最长/最具体别名
  const sortedAliases = sortedAliasKeys(activeMap);

  for (const alias of sortedAliases) {
    if (alias.length >= 2 && result.includes(alias)) {
      const canonical = activeMap.get(alias)!;
      if (alias === canonical) continue;

      if (canonical.startsWith(alias) && (canonical.endsWith("街道") || canonical.endsWith("镇"))) {
        const suffix = canonical.endsWith("街道") ? "街道" : "镇";
        const re = new RegExp(`${alias}(?!${suffix})`, "g");
        result = result.replace(re, canonical);
      } else {
        result = result.split(alias).join(canonical);
      }
    }
  }

  // 清洗意外产生的叠字后缀
  result = result
    .replace(/街道街道/g, "街道")
    .replace(/镇镇/g, "镇");

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
