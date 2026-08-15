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
  genericSubjects: ["某单位", "当事人", "市民", "车主", "商家"],
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
