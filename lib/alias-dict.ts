/**
 * 别名知识沉淀与自动归一化替换引擎 (Alias Dictionary & Entity Normalization Engine)
 * 能够持续沉淀镇街、微观社区、商户机构及诉求术语的别名映射，实现自动识别与全局替换。
 */

import { SHUNDE_TOWNSHIPS, SHUNDE_DEPARTMENTS } from "./vocabulary";

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
  机器人谷: "博智林机器人谷",
  甘竹滩: "左滩甘竹滩洪潮发电站历史保护区",
  仓门夜市: "均安仓门夜市风情街",
  美的总部: "美的集团全球总部",
  碧桂园总部: "碧桂园集团总部",
  万和总部: "广东万和新电气股份有限公司",
  科达制造: "科达制造股份有限公司",
  海信家电: "海信家电集团顺德基地",

  // 3. 交通与干道设施
  顺德客运站: "顺德客运总站",
  顺德港码头: "顺德客运港",
  广州7号线西延段: "广州地铁7号线顺德段",
  佛山3号线: "佛山地铁3号线顺德段",
  佛山2号线: "佛山地铁2号线顺德段",
  "105国道": "G105国道顺德段",
  佛山一环: "佛山一环顺德路段",

  // 4. 数字政务系统平台
  粤省事系统: "粤省事政务服务平台",
  粤省事APP: "粤省事移动政务平台",
  粤商通系统: "粤商通涉企移动政务平台",
  顺德政务通: "顺德区政务服务热线系统",

  // 5. 常见责任部门及治理机构别名
  顺德交警: "佛山市顺德区公安局交通警察大队",
  交警队: "辖区交警中队",
  交警大队: "顺德区公安局交通警察大队",
  城管局: "顺德区综合行政执法局",
  城管大队: "综合行政执法办公室",
  执法队: "综合行政执法队",
  市监局: "顺德区市场监督管理局",
  市监所: "市场监督管理所",
  环监局: "佛山市生态环境局顺德分局",
  环监所: "生态环境监督管理所",
  环保局: "佛山市生态环境局顺德分局",
  人社局: "顺德区人力资源和社会保障局",
  社保局: "顺德区社会保险基金管理局",
  医保局: "佛山市医疗保障局顺德分局",
  住建局: "顺德区住房城乡建设和水务局",
  城建办: "镇街城市建设和水务办公室",
  水务办: "镇街城市建设和水务办公室",
  应急局: "顺德区应急管理局",
  应急办: "镇街应急管理办公室",
  消防队: "顺德区消防救援大队",
  消防救援站: "辖区消防救援站",
  派出所: "辖区派出所",
  综治办: "镇街综合治理办公室",
  居委会: "社区居民委员会",
  村委会: "村民委员会",
  消委会: "顺德区消费者委员会",
  消协: "顺德区消费者委员会",
  劳动仲裁院: "顺德区劳动人事争议仲裁院",
  劳动监察大队: "顺德区劳动保障监察大队",
  政数局: "顺德区政务服务和数据管理局",
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
