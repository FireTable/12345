/**
 * 别名知识沉淀与自动归一化替换引擎 (Alias Dictionary & Entity Normalization Engine)
 * 能够持续沉淀镇街、微观社区、商户机构及诉求术语的别名映射，实现自动识别与全局替换。
 */

import { SHUNDE_TOWNSHIPS } from "./vocabulary";

/**
 * 预置官方及政务常见高频别名映射表 (Alias -> Canonical)
 */
const DEFAULT_ALIASES: Record<string, string> = {
  // 1. 镇街俗称 / 历史旧称 / 片区别名
  容奇: "容桂街道",
  桂洲: "容桂街道",
  容奇镇: "容桂街道",
  桂洲镇: "容桂街道",
  容桂区: "容桂街道",
  德胜新区: "大良街道",
  德胜新城: "大良街道",
  顺峰山片区: "大良街道",
  清晖园片区: "大良街道",
  北滘新城: "北滘镇",
  碧桂园总部片区: "北滘镇",
  碧桂园社区: "北滘镇碧桂园社区",
  陈村花乡: "陈村镇",
  花卉世界片区: "陈村镇",
  佛山新城: "乐从镇",
  乐从家具城: "乐从镇",
  乐从钢铁世界: "乐从镇",
  逢简水乡片区: "杏坛镇",
  顺德高新区: "杏坛镇",
  李小龙故里: "均安镇",

  // 2. 常见责任部门及治理诉求术语别名
  交警队: "辖区交警中队",
  城管局: "综合行政执法办公室",
  执法队: "综合行政执法队",
  市监所: "市场监督管理所",
  环监所: "生态环境监督管理所",
  社保局: "人力资源和社会保障局",
  居委会: "社区居民委员会",
};

// 内存中活跃沉淀的别名映射表
const runtimeAliasMap: Map<string, string> = new Map<string, string>(
  Object.entries(DEFAULT_ALIASES)
);

// 自动将官方 10 大镇街的 aliases 阵列也载入映射
SHUNDE_TOWNSHIPS.forEach((t) => {
  t.aliases.forEach((alias) => {
    if (!runtimeAliasMap.has(alias)) {
      runtimeAliasMap.set(alias, t.fullName);
    }
  });
});

/**
 * 实体别名查找与归一化
 * 若存在别名映射，直接替换为规范名称；否则返回清洗后的原名称。
 */
export function resolveEntityAlias(rawName?: string | null): string {
  if (!rawName) return "";
  const trimmed = rawName.trim();
  if (runtimeAliasMap.has(trimmed)) {
    return runtimeAliasMap.get(trimmed)!;
  }
  return trimmed;
}

/**
 * 全文别名替换预处理：在文本入模或抽取前，对文本内包含的已知别名进行自动规范化替换
 */
export function normalizeAliasesInText(text?: string | null): string {
  if (!text) return "";
  let result = text;

  // 按别名长度从长到短排序，优先匹配最长/最具体别名
  const sortedAliases = Array.from(runtimeAliasMap.keys()).sort(
    (a, b) => b.length - a.length
  );

  for (const alias of sortedAliases) {
    if (alias.length >= 2 && result.includes(alias)) {
      const canonical = runtimeAliasMap.get(alias)!;
      if (alias === canonical) continue;

      // 如果别名是规范词的前缀（如 "容桂" vs "容桂街道"），避免将原有的 "容桂街道" 替换为 "容桂街道街道"
      if (canonical.startsWith(alias) && (canonical.endsWith("街道") || canonical.endsWith("镇"))) {
        const suffix = canonical.endsWith("街道") ? "街道" : "镇";
        const re = new RegExp(`${alias}(?!${suffix})`, "g");
        result = result.replace(re, canonical);
      } else {
        result = result.split(alias).join(canonical);
      }
    }
  }

  // 清洗意外产生的叠字后缀（如 "街道街道" -> "街道", "镇镇" -> "镇"）
  result = result
    .replace(/街道街道/g, "街道")
    .replace(/镇镇/g, "镇");

  return result;
}

/**
 * 动态沉淀新识别出的别名映射
 * 当系统或人工识别出某实体新的缩写/别称时调用，并在内存及 PostgreSQL 数据库中双向沉淀。
 */
export function registerAlias(alias: string, canonical: string): boolean {
  const cleanAlias = (alias || "").trim();
  const cleanCanonical = (canonical || "").trim();

  if (!cleanAlias || !cleanCanonical || cleanAlias === cleanCanonical) {
    return false;
  }

  // 严禁将通用虚词沉淀为别名
  const blacklist = ["车主", "小车", "车辆", "商户", "商家", "市民", "某单位", "当事人", "某人"];
  if (blacklist.includes(cleanAlias)) {
    return false;
  }

  runtimeAliasMap.set(cleanAlias, cleanCanonical);

  // 异步写入数据库沉淀持久化
  (async () => {
    try {
      const { db } = await import("@/db/client");
      const { aliasesTable } = await import("@/db/schema");
      await db
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
      // 离线或无 DB 模式下静默忽略
    }
  })();

  return true;
}

/**
 * 批量获取当前沉淀的所有别名库
 */
export function getAllAliases(): Record<string, string> {
  return Object.fromEntries(runtimeAliasMap.entries());
}
