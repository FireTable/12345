/**
 * 官方权威政务标准词汇表与动态区域治理引擎 (Dynamic Civil & Administrative Vocabulary Engine)
 * 严格杜绝大模型在各省市区县行政区划、诉求分类与责任部门上的幻觉捏造。
 */

import { getRegionDb } from "@/db/client";
import { vocabulariesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import fs from "fs";
import path from "path";

export interface TownshipInfo {
  name: string; // 简写，如 "大良" 或 "琶洲"
  fullName: string; // 官方全称，如 "大良街道" 或 "琶洲街道"
  aliases: string[]; // 常见俗称、旧称、别名
  communities: string[]; // 重点知名社区 / 村居
  landmarks: string[]; // 知名地标 / 园区 / 重点商圈 / 交通枢纽
}

export interface DepartmentInfo {
  code: string;
  name: string;
  fullName: string;
  category: string;
}

export interface CategoryInfo {
  category: string;
  subItems: readonly string[] | string[];
  leadDepartment: string;
}

export interface RegionVocabulary {
  regionId: string;
  regionName: string;
  cityName: string;
  provinceName: string;
  townships: TownshipInfo[];
  departments: DepartmentInfo[];
  categories: CategoryInfo[];
}

/**
 * 标准 7 大民生诉求分类默认定义
 */
export const STANDARD_CATEGORIES: readonly CategoryInfo[] = [
  {
    category: "城市管理",
    subItems: ["物业管理纠纷", "住宅电梯维保与故障", "市政排污/供水管网", "市容市貌与流动摊贩占道", "违章搭建与占绿", "路灯照明与公用设施", "垃圾清运与环卫保洁"],
    leadDepartment: "综合行政执法局 / 住房城乡建设局 / 城市管理局",
  },
  {
    category: "市场监管",
    subItems: ["消费维权与退款纠纷", "虚假宣传与价格欺诈", "无照无证经营", "食品药品安全隐患", "特种设备安全", "商户规范经营", "预付卡消费维权"],
    leadDepartment: "市场监督管理局 / 消费者委员会",
  },
  {
    category: "社会治理",
    subItems: ["社区邻里矛盾纠纷", "基层物业管理协商", "公共服务与便民事务", "租房租赁纠纷", "信访诉求调解", "政务平台系统咨询"],
    leadDepartment: "平安法治办公室 / 社区居委会 / 辖区派出所",
  },
  {
    category: "交通出行",
    subItems: ["机动车违停阻碍通行", "主干道交通拥堵", "非机动车/共享单车乱堆放", "交通信号灯与标线破损", "营运客运与公交服务", "道路开挖与施工占道"],
    leadDepartment: "公安交警大队 / 交通运输局",
  },
  {
    category: "生态环境",
    subItems: ["商业夜间经营音响噪音扰民", "工地施工噪声", "餐饮油烟与恶臭直排", "工业废气粉尘排放", "河道水体黑臭与偷排", "固体废物倾倒"],
    leadDepartment: "生态环境分局 / 综合行政执法队",
  },
  {
    category: "劳动社保",
    subItems: ["企业拖欠工资欠薪", "劳动合同解除与经济补偿", "社保医保缴纳与断缴", "失业保险金申领核验异常", "工伤认定与劳动仲裁"],
    leadDepartment: "人力资源和社会保障局 / 劳动仲裁院",
  },
  {
    category: "公共安全",
    subItems: ["违规销售/燃放烟花爆竹", "危险化学品与易燃易爆隐患", "消防通道占用与堵塞", "建筑施工安全生产事故", "电动车违规室内充电"],
    leadDepartment: "应急管理局 / 消防救援大队 / 辖区派出所",
  },
] as const;

export type StandardCategoryName =
  | "城市管理"
  | "市场监管"
  | "社会治理"
  | "交通出行"
  | "生态环境"
  | "劳动社保"
  | "公共安全";

const STANDARD_CATEGORY_SET = new Set<string>(STANDARD_CATEGORIES.map((c) => c.category));

const CATEGORY_ALIASES: Record<string, StandardCategoryName> = {
  交通管理: "交通出行",
  交通运输: "交通出行",
  交通: "交通出行",
  社会保障: "劳动社保",
  社保: "劳动社保",
  医疗保障: "劳动社保",
  医保: "劳动社保",
  人才就业: "劳动社保",
  就业: "劳动社保",
  政务: "社会治理",
  公共服务: "社会治理",
  教育: "社会治理",
};

export function canonicalizeCategory(name?: string | null): StandardCategoryName | null {
  if (!name) return null;
  const clean = name.trim();
  if (STANDARD_CATEGORY_SET.has(clean)) return clean as StandardCategoryName;
  return CATEGORY_ALIASES[clean] ?? null;
}

/** 缓存已加载的区域词汇库 */
const vocabCache = new Map<string, { vocab: RegionVocabulary; loadedAt: number }>();
const VOCAB_CACHE_TTL = 30 * 1000; // 30 秒缓存

/**
 * 从 JSON 预置文件或内置数据中加载静态备份
 */
export function loadPresetVocabulary(regionId: string = "shunde"): RegionVocabulary {
  try {
    const presetFile =
      regionId === "gz_tianhe" ? "guangzhou_tianhe.json" : "foshan_shunde.json";
    const p = path.resolve(process.cwd(), "lib/presets", presetFile);
    if (fs.existsSync(p)) {
      const parsed = JSON.parse(fs.readFileSync(p, "utf-8"));
      return {
        regionId: parsed.id,
        regionName: parsed.name,
        cityName: parsed.city,
        provinceName: parsed.province || "广东省",
        townships: parsed.townships || [],
        departments: parsed.departments || [],
        categories: parsed.categories || STANDARD_CATEGORIES,
      };
    }
  } catch (err) {
    // ignore
  }

  // 兜底默认从顺德预置文件读取
  try {
    const defaultPresetPath = path.resolve(process.cwd(), "lib", "presets", "foshan_shunde.json");
    if (fs.existsSync(defaultPresetPath)) {
      const parsed = JSON.parse(fs.readFileSync(defaultPresetPath, "utf-8"));
      return {
        regionId: parsed.id || "fs_shunde",
        regionName: parsed.name || "本地辖区",
        cityName: parsed.city || "本地城市",
        provinceName: parsed.province || "广东省",
        townships: parsed.townships || [],
        departments: parsed.departments || [],
        categories: parsed.categories || STANDARD_CATEGORIES,
      };
    }
  } catch (e) {
    // ignore
  }

  return {
    regionId: "fs_shunde",
    regionName: "本地辖区",
    cityName: "本地城市",
    provinceName: "广东省",
    townships: [],
    departments: [],
    categories: STANDARD_CATEGORIES as any,
  };
}

/**
 * 动态加载指定地区的权威政务标准词汇库（优先从该 Schema 的数据库读，支持实时管理）
 */
export async function getRegionVocabulary(regionIdOrSchema?: string | null): Promise<RegionVocabulary> {
  const targetKey = regionIdOrSchema?.trim() || "default";
  const now = Date.now();
  if (vocabCache.has(targetKey)) {
    const cached = vocabCache.get(targetKey)!;
    if (now - cached.loadedAt < VOCAB_CACHE_TTL) {
      return cached.vocab;
    }
  }

  try {
    const { db: tenantDb, region } = await getRegionDb(regionIdOrSchema);
    const rows = await tenantDb.select().from(vocabulariesTable);

    if (rows.length > 0) {
      const townships: TownshipInfo[] = [];
      const departments: DepartmentInfo[] = [];
      const categories: CategoryInfo[] = [];

      for (const r of rows) {
        let meta: any = {};
        if (r.metaJson) {
          try {
            meta = JSON.parse(r.metaJson);
          } catch (e) {}
        }

        if (r.type === "TOWNSHIP") {
          townships.push({
            name: r.name,
            fullName: r.fullName || r.name,
            aliases: Array.isArray(meta.aliases) ? meta.aliases : [r.name],
            communities: Array.isArray(meta.communities) ? meta.communities : [],
            landmarks: Array.isArray(meta.landmarks) ? meta.landmarks : [],
          });
        } else if (r.type === "DEPARTMENT") {
          departments.push({
            code: r.id,
            name: r.name,
            fullName: r.fullName || r.name,
            category: meta.category || "城市管理",
          });
        } else if (r.type === "CATEGORY") {
          categories.push({
            category: r.name,
            subItems: Array.isArray(meta.subItems) ? meta.subItems : [],
            leadDepartment: meta.leadDepartment || "",
          });
        }
      }

      const result: RegionVocabulary = {
        regionId: region?.id || targetKey,
        regionName: region?.name || "本地辖区",
        cityName: region?.city || "本地城市",
        provinceName: region?.province || "广东省",
        townships: townships.length > 0 ? townships : loadPresetVocabulary(region?.id).townships,
        departments: departments.length > 0 ? departments : loadPresetVocabulary(region?.id).departments,
        categories: categories.length > 0 ? categories : (STANDARD_CATEGORIES as any),
      };

      vocabCache.set(targetKey, { vocab: result, loadedAt: now });
      return result;
    }
  } catch (err) {
    // 回落至静态预置
  }

  const fallback = loadPresetVocabulary(regionIdOrSchema || "shunde");
  vocabCache.set(targetKey, { vocab: fallback, loadedAt: now });
  return fallback;
}

/**
 * 清除指定地区的词汇库缓存（在管理端修改字典时触发）
 */
export function invalidateVocabCache(regionId?: string) {
  if (regionId) {
    vocabCache.delete(regionId);
    vocabCache.delete(`region_${regionId}`);
  } else {
    vocabCache.clear();
  }
}

/**
 * 检验输入文本是否包含合法的指定辖区法定镇街/街道（通用动态判断）
 */
export function isValidTownship(name?: string | null, vocab?: RegionVocabulary): boolean {
  if (!name) return false;
  const targetVocab = vocab || loadPresetVocabulary("shunde");
  const clean = name
    .trim()
    .replace(new RegExp(`^(${targetVocab.provinceName}|${targetVocab.cityName}|${targetVocab.regionName})`, "g"), "");

  return targetVocab.townships.some((t) => {
    if (t.name === clean || t.fullName === clean || t.aliases.includes(clean)) return true;
    if (clean.includes(t.fullName) || clean.includes(t.name)) return true;
    return t.aliases.some((a) => clean.includes(a)) || t.communities.some((c) => clean.includes(c));
  });
}

/**
 * 将任意镇街或地点文本标准化为对应的官方标准全称（通用动态归一化）
 */
export function canonicalizeTownship(name?: string | null, vocab?: RegionVocabulary): string | null {
  if (!name) return null;
  const targetVocab = vocab || loadPresetVocabulary("shunde");
  const clean = name
    .trim()
    .replace(new RegExp(`^(${targetVocab.provinceName}|${targetVocab.cityName}|${targetVocab.regionName})`, "g"), "");

  // 1. 优先精确匹配
  for (const t of targetVocab.townships) {
    if (t.name === clean || t.fullName === clean || t.aliases.includes(clean)) {
      return t.fullName;
    }
  }

  // 2. 包含匹配
  for (const t of targetVocab.townships) {
    if (clean.includes(t.fullName) || clean.includes(t.name)) {
      return t.fullName;
    }
    if (t.aliases.some((a) => clean.includes(a))) {
      return t.fullName;
    }
    if (t.communities.some((c) => clean.includes(c))) {
      return t.fullName;
    }
    if (t.landmarks.some((l) => clean.includes(l))) {
      return t.fullName;
    }
  }

  return null;
}

/**
 * 生成供 Prompt 注入使用的轻量标准词汇表约束文本（动态支持任意地区）
 */
export function buildVocabularyPromptConstraint(vocab?: RegionVocabulary): string {
  const targetVocab = vocab || loadPresetVocabulary("shunde");
  const townNames = targetVocab.townships.map((t) => t.fullName).join("、");
  const catNames = targetVocab.categories.map((c) => c.category).join("、");

  return `【${targetVocab.cityName}${targetVocab.regionName}法定区划/街道】：${townNames}
【法定民生分类】：${catNames}`;
}

// ==========================================
// 向后兼容旧版引用
// ==========================================
export const SHUNDE_TOWNSHIPS = loadPresetVocabulary("shunde").townships;
export const SHUNDE_DEPARTMENTS = loadPresetVocabulary("shunde").departments;

export function isValidShundeTownship(name?: string | null): boolean {
  return isValidTownship(name, loadPresetVocabulary("shunde"));
}
