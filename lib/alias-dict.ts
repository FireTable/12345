/**
 * 别名知识沉淀与自动归一化替换引擎 (Alias Dictionary & Entity Normalization Engine)
 * 能够持续沉淀镇街、微观社区、商户机构及诉求术语的别名映射，实现自动识别与全局替换。
 * 支持多城市独立 Schema 隔离沉淀。
 */

import { SHUNDE_TOWNSHIPS, SHUNDE_DEPARTMENTS } from "./vocabulary";
import { getRegionDb } from "@/db/client";
import { aliasesTable } from "@/db/schema";

/**
 * 预置常见高频别名映射表 (Alias -> Canonical)
 */
const DEFAULT_ALIASES: Record<string, string> = {
  // 1. 顺德镇街俗称 / 历史旧称 / 片区别名
  容奇: "容桂街道",
  桂洲: "容桂街道",
  容奇镇: "容桂街道",
  桂洲镇: "容桂街道",
  容桂区: "容桂街道",
  德胜新区: "大良街道",
  德胜新城: "大良街道",
  顺峰山片区: "大良街道",
  清晖园片区: "大良街道",
  逢沙片区: "大良街道",
  五沙片区: "大良街道",
  金榜街区: "大良街道",
  北滘新城: "北滘镇",
  碧桂园总部片区: "北滘镇",
  碧桂园社区: "北滘镇碧桂园社区",
  美的总部片区: "北滘镇",
  陈村花乡: "陈村镇",
  花卉世界片区: "陈村镇",
  潭洲会展片区: "陈村镇",
  三龙湾陈村: "陈村镇",
  佛山新城: "乐从镇",
  乐从家具城: "乐从镇",
  乐从钢铁世界: "乐从镇",
  中欧中心片区: "乐从镇",
  世纪莲片区: "乐从镇",
  逢简水乡片区: "杏坛镇",
  顺德高新区: "杏坛镇",
  李小龙故里: "均安镇",
  南沙岛片区: "均安镇",
  仓门夜市片区: "均安镇",
  长鹿片区: "伦教街道",
  木工机械城: "伦教街道",
  五金小镇: "勒流街道",
  黄连古村: "勒流街道",

  // 2. 顺德核心地标 / 园区 / 商圈规范化
  顺德欢乐海岸: "华侨城欢乐海岸PLUS",
  欢乐海岸: "华侨城欢乐海岸PLUS",
  顺峰山: "顺峰山公园",
  清晖园: "清晖园博物馆",
  渔人码头: "容桂渔人码头",
  金榜街: "金榜上街",
  逢简: "逢简水乡景区",
  潭洲会展: "潭洲国际会展中心",
  世纪莲: "佛山新城世纪莲体育中心",
  中欧中心: "佛山中欧中心",
  罗浮宫: "罗浮宫国际家具博览中心",
  工业设计城: "广东工业设计城",

  // 3. 广州核心地标 / 街道别名规范化
  琶醍: "广州琶醍啤酒文化创意艺术区",
  琶醍夜市: "广州琶醍啤酒文化创意艺术区",
  琶洲展馆: "中国进出口商品交易会展馆（广交会展馆）",
  广交会展馆: "中国进出口商品交易会展馆（广交会展馆）",
  小蛮腰: "广州塔",
  中大布市: "广州国际轻纺城（中大布匹市场）",
  中大布匹市场: "广州国际轻纺城（中大布匹市场）",
  康乐村: "凤阳街道康乐村片区",
  鹭江村: "凤阳街道鹭江村片区",
  江南西: "江南西商业步行街",
  太古仓: "太古仓码头文创园",
  海珠湿地: "海珠国家湿地公园",
  小洲艺术村: "小洲村",
  生物岛: "广州国际生物岛",

  // 4. 常见政务部门口语简称规范化
  交警: "公安交警大队",
  城管: "综合行政执法队",
  执法队: "综合行政执法队",
  市监局: "市场监督管理局",
  市监所: "辖区市场监督管理所",
  环保局: "生态环境分局",
  人社局: "人力资源和社会保障局",
  住建局: "住房城乡建设局",
  城建办: "城市建设办公室",
  应急局: "应急管理局",
  应急办: "应急管理办公室",
  消防队: "消防救援大队",
  派出所: "辖区派出所",
  综治办: "平安法治办公室 / 综合治理办公室",
  居委会: "社区居民委员会",
  村委会: "村民委员会",
  消委会: "消费者委员会",
  消协: "消费者委员会",
  政数局: "政务服务和数据管理局",
};

// 内存中活跃沉淀的别名映射表（默认环境）
const runtimeAliasMap: Map<string, string> = new Map<string, string>(
  Object.entries(DEFAULT_ALIASES)
);

// 区域别名缓存（按 regionId 隔离）
const regionAliasCache = new Map<string, { map: Map<string, string>; loadedAt: number }>();
const ALIAS_CACHE_TTL = 30 * 1000;

// 自动载入预置镇街的别名
SHUNDE_TOWNSHIPS.forEach((t) => {
  t.aliases.forEach((alias) => {
    if (!runtimeAliasMap.has(alias)) {
      runtimeAliasMap.set(alias, t.fullName);
    }
  });
});

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

  if (!cleanAlias || !cleanCanonical || cleanAlias === cleanCanonical) {
    return false;
  }

  const blacklist = ["车主", "小车", "车辆", "商户", "商家", "市民", "某单位", "当事人", "某人"];
  if (blacklist.includes(cleanAlias)) {
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
