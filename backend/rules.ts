/**
 * 研判策略单一来源。节点和 Prompt 都读这里，禁止在业务文件里再写一份词表或阈值。
 * 可用环境变量覆盖数字，改词表只改本文件。
 */

function envInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw == null || raw === "") return fallback;
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

export const RULES = {
  minClusterSize: envInt("TICKET_RADAR_MIN_CLUSTER_SIZE", 2),
  risk: {
    highCount: envInt("TICKET_RADAR_RISK_HIGH_COUNT", 5),
    mediumCount: envInt("TICKET_RADAR_RISK_MEDIUM_COUNT", 3),
  },
  fakeClosure: {
    windowDays: envInt("TICKET_RADAR_FAKE_CLOSURE_DAYS", 7),
  },
  defaultCategory: "综合民生",
  /** 险情/群体事件词，扫描正文与写入 Prompt 共用 */
  negativeTerms: [
    "危险",
    "着火",
    "断水",
    "断电",
    "群体聚集",
    "事故",
    "倒塌",
    "中毒",
    "死亡",
    "爆炸",
  ],
  /** 不能当被诉主体的虚词（语言学停用，不是地名表） */
  genericSubjects: [
    "某单位",
    "某公司",
    "某建筑公司",
    "某工地",
    "某建设工程工地",
    "某项目",
    "某餐厅",
    "某湘菜馆",
    "某餐饮",
    "某商铺",
    "某小区",
    "建设工程工地",
    "在建工地",
    "施工工地",
    "工地",
    "项目工地",
    "项目部",
    "总承包方",
    "施工方",
    "开发商",
    "临街重餐饮",
    "烧烤湘菜馆",
    "餐饮店",
    "涉事方",
    "责任主体",
    "责任对象",
    "当事人",
    "市民",
    "车主",
    "商家",
    "物业",
    "物业公司",
  ],
  genericSubjectSuffix: /涉事方|责任主体|责任对象$/,
  /** 微观地点必须具备的空间特征 */
  microLocationHint: /路|街|巷|大道|广场|公园|城|大厦|小区|苑|自建房|号|新村|花园|公寓/,
  /** 仅行政区划、没有微观点位 */
  adminOnlyLocation: /^[\u4e00-\u9fff]{1,8}(区|市|县|街道|镇|乡|开发区|新城|辖区)$/,
  locationNoise: /部门|希望|反映|致电|要求|执法|诉求|我是|电话|居委会|村委|事发地/,
} as const;

export function negativeTermsPattern(): RegExp {
  const escaped = RULES.negativeTerms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp(escaped.join("|"));
}

export function formatNegativeTermsForPrompt(): string {
  return RULES.negativeTerms.join("|");
}

const GENERIC_EXACT_SUBJECTS = new Set<string>([
  ...(RULES.genericSubjects as readonly string[]),
  "建设工程工地",
  "在建工地",
  "施工工地",
  "工地",
  "项目工地",
  "在建地产及市政项目工地",
  "市政项目工地",
  "项目部",
  "工程项目部",
  "施工项目部",
  "总承包方",
  "施工方",
  "承建方",
  "分包方",
  "开发商",
  "建设方",
  "临街重餐饮",
  "一楼临街重餐饮",
  "临街重餐饮烧烤湘菜馆",
  "烧烤湘菜馆",
  "餐饮店",
  "烧烤店",
  "湘菜馆",
  "川菜馆",
  "大排档",
  "涉事方",
  "责任主体",
  "责任对象",
  "当事人",
  "市民",
  "车主",
  "商家",
  "商铺",
  "店铺",
  "店主",
  "单位",
  "公司",
  "企业",
  "工厂",
  "物业",
  "物业公司",
  "物业管理公司",
  "物业管理处",
  "物管",
  "相关部门",
  "相关单位",
  "相关主体",
  "涉事单位",
  "涉事店铺",
  "涉事商家",
  "涉事主体",
  "涉事车辆",
  "涉事工地",
  "涉事物业",
  "涉事物业公司",
  "小区物业",
  "未知",
  "不详",
  "无",
  "空",
  "null",
  "undefined",
  "无名",
  "不知名",
]);

const PLACEHOLDER_MOU_RE =
  /^某|某[\u4e00-\u9fffA-Za-z0-9·]{0,16}(?:号|工地|在建|建设|建筑|地产|市政|工程|项目|项目部|公司|企业|单位|工厂|车间|店|店铺|商铺|商店|商家|餐厅|餐馆|菜馆|酒楼|酒馆|烧烤|餐饮|小吃|摊|大排档|超市|市场|物业|小区|花园|大厦|楼|栋|单元|室|路段|路口|路|街|巷|村|社区|学校|医院|网点|银行|机构|部门|人员|车主|司机)/;

const GENERIC_PREFIXED_NOUN_RE =
  /^(?:该|此|这|那|涉事|相关|在建|施工|工程|项目|临街|一楼|小区)?(?:建设工程工地|在建工地|施工工地|工地|项目工地|项目部|总承包方|施工方|开发商|物业|物业公司|物业管理处|餐饮店|烧烤湘菜馆|临街重餐饮)$/;

/**
 * 判断主体名称是否为「某…」占位词或无区分度的泛化名词。
 * 带具体字号/楼盘/企业前缀的实体（如「万科物业」「中建三局华南国际港项目部」）保留。
 */
export function isGenericOrPlaceholderSubject(raw?: string | null): boolean {
  const s = (raw || "").trim();
  if (!s) return true;
  if (GENERIC_EXACT_SUBJECTS.has(s) || GENERIC_EXACT_SUBJECTS.has(s.toLowerCase())) return true;
  if (RULES.genericSubjectSuffix.test(s)) return true;
  if (GENERIC_PREFIXED_NOUN_RE.test(s)) return true;
  if (PLACEHOLDER_MOU_RE.test(s)) return true;
  if (/某某|\*{2,}|[Xx]{2,}|无法|不清楚|不详|不知名|无名/.test(s)) return true;
  return false;
}
