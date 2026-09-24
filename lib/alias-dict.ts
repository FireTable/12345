/**
 * 别名知识沉淀与自动归一化替换引擎 (Alias Dictionary & Entity Normalization Engine)
 * 能够持续沉淀镇街、微观社区、商户机构及诉求术语的别名映射，实现自动识别与全局替换。
 * 支持多城市独立 Schema 隔离沉淀。
 */

import defaultAliasesPreset from "./presets/default-aliases.json";
export { isAnonymizedCitizen } from "./civic-dto";

/**
 * 预置常见高频别名映射表 (Alias -> Canonical)
 * 已外置至 lib/presets/default-aliases.json 维护，支持运行时及数据库动态扩展
 */
const DEFAULT_ALIASES: Record<string, string> = defaultAliasesPreset as Record<string, string>;

// 内存中活跃沉淀的别名映射表（默认环境）
const runtimeAliasMap: Map<string, string> = new Map<string, string>(
  Object.entries(DEFAULT_ALIASES)
);

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
 * 动态加载指定地区的别名知识库
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

  const map = new Map<string, string>(Object.entries(DEFAULT_ALIASES));

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
    // 离线使用基础默认别名表
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
export function normalizeAliasesInText(text?: string | null, customMap?: Map<string, string>): string {
  if (!text) return "";
  let result = text;
  const activeMap = customMap || runtimeAliasMap;

  // 按别名长度从长到短排序，优先匹配最长/最具体别名
  const sortedAliases = Array.from(activeMap.keys()).sort(
    (a, b) => b.length - a.length
  );

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
