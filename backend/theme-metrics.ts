import type { CivicMode, EnrichedTicket, MultiFrequencyTheme, PatternType } from "./state";
import { RULES, negativeTermsPattern } from "./rules";

const NEGATIVE_RE = negativeTermsPattern();

// 通用行政区划模式（包含区/县/镇/街道/乡后缀或标准区划简称，无硬编码地名）
const GENERAL_TOWNSHIP_RE = /(?:街道|镇|乡|区|县)$|^[\u4e00-\u9fff]{2,8}$/;

export const MODE_META: Record<
  CivicMode,
  {
    name: string;
    tagline: string;
    risk: string;
    color: string;
    icon: string;
    rule: string;
    reasons: string[];
  }
> = {
  aggregate: {
    name: "群体聚集型",
    tagline: "不同人投诉同一事件",
    risk: "短时间集中爆发，存在蔓延迹象",
    color: "#F53F3F",
    icon: "🚨",
    rule: "不同人投诉同一事件，短时间内频发爆发",
    reasons: [
      "投诉主体明显不同但指向同一事件，说明事件具有公共属性",
      "短时间内工单数陡增，存在突发蔓延迹象，需尽快响应",
      "地理 / 主题词高度集中，可作为同一聚类归档",
    ],
  },
  repeat: {
    name: "个体重复型",
    tagline: "同一人多次投诉同一事件",
    risk: "问题长期未解决，需闭环跟踪",
    color: "#FF7D00",
    icon: "🔁",
    rule: "同一人同一事件多次投诉，问题长期未解决",
    reasons: [
      "反映人多次来电反映同一问题未解决，建议上升处置优先级",
      "问题在窗口期内反复出现，应启动闭环跟踪",
      "可识别为重点回访对象，需安排专员对接",
    ],
  },
  diverge: {
    name: "同主体发散型",
    tagline: "相同地点或主体、不同类型问题",
    risk: "治理隐患，建议源头核查",
    color: "#1677FF",
    icon: "📍",
    rule: "相同地点不同类事件，治理隐患",
    reasons: [
      "同一地点 / 主体在短期内出现多种类型问题",
      "说明该地点在管理 / 服务 / 治理上存在系统隐患",
      "建议现场核查 + 源头治理，避免问题反复出现",
    ],
  },
};

import { isAnonymizedCitizen } from "@/lib/civic-dto";

export function civicModeFromPattern(pattern?: PatternType | null): CivicMode {
  if (pattern === "INDIVIDUAL_REPEAT") return "repeat";
  if (pattern === "DIVERGE") return "diverge";
  return "aggregate";
}

export function inferPatternType(tickets: EnrichedTicket[]): PatternType {
  const cats = new Set(
    tickets.map((t) => (t.themes && t.themes[0]) || t.eventType || "").filter(Boolean)
  );
  if (cats.size >= 2) return "DIVERGE";

  const callers = new Set(
    tickets
      .map((t) => (t.citizenPhone || t.citizenName || "").trim())
      .filter((s) => s && !isAnonymizedCitizen(s))
  );
  if (callers.size === 1) return "INDIVIDUAL_REPEAT";
  return "GROUP_GATHERING";
}

export const CADENCE = {
  BURST: "BURST",
  RECURRING: "RECURRING",
  SEASONAL: "SEASONAL",
} as const;

export type ThemeCadence = (typeof CADENCE)[keyof typeof CADENCE];

const CADENCE_LABEL: Record<ThemeCadence, string> = {
  BURST: "突发",
  RECURRING: "反复",
  SEASONAL: "季节性",
};

export function cadenceLabel(cadence: ThemeCadence): string {
  return CADENCE_LABEL[cadence] || cadence;
}

const BURST_HOURS = 72;
const SEASONAL_GAP_HOURS = 14 * 24;

/** 时间只描述已经聚在一起的主题有多频，不决定工单能不能进这个主题。 */
export function describeCadence(times: Array<string | number | Date | undefined>): ThemeCadence {
  const ms = times
    .map((value) => {
      if (value instanceof Date) return value.getTime();
      if (typeof value === "number") return value;
      return parseTime(value);
    })
    .filter((value) => value > 0)
    .sort((a, b) => a - b);
  if (ms.length < 2) return CADENCE.BURST;

  let maxGapHours = 0;
  for (let i = 1; i < ms.length; i++) {
    maxGapHours = Math.max(maxGapHours, (ms[i] - ms[i - 1]) / 3600000);
  }
  if (maxGapHours >= SEASONAL_GAP_HOURS) return CADENCE.SEASONAL;

  const spanHours = (ms[ms.length - 1] - ms[0]) / 3600000;
  if (spanHours <= BURST_HOURS) return CADENCE.BURST;
  return CADENCE.RECURRING;
}

function parseTime(s?: string): number {
  if (!s) return 0;
  const t = new Date(s.replace(" ", "T")).getTime();
  return Number.isNaN(t) ? 0 : t;
}

export function deriveThemeMetrics(theme: Pick<
  MultiFrequencyTheme,
  "eventType" | "canonicalLocation" | "tickets" | "patternType"
>): {
  features: Array<{ name: string; pct: number; desc: string }>;
  radar: number[];
  aiConfidence: number;
  trendPct: number | null;
} {
  const tickets = theme.tickets || [];
  const n = tickets.length || 1;
  const event = theme.eventType || "";
  const loc = theme.canonicalLocation || "";

  const keywordHits = tickets.filter((t) => {
    const body = `${t.title || ""}${t.content || ""}${t.eventType || ""}`;
    return event && body.includes(event.slice(0, Math.min(4, event.length)));
  }).length;
  const keywordPct = Math.round((keywordHits / n) * 100);

  const locHits = tickets.filter((t) => t.canonicalLocation && t.canonicalLocation === loc).length;
  const geoPct = Math.round((locHits / n) * 100);

  const times = tickets.map((t) => parseTime(t.createTime)).filter(Boolean).sort((a, b) => a - b);
  const spanHours = times.length >= 2 ? (times[times.length - 1] - times[0]) / 3600000 : 1;
  const cadence = describeCadence(times);
  const timePct = spanHours <= 24 ? 92 : spanHours <= 24 * 7 ? 78 : spanHours <= 24 * 30 ? 62 : 45;

  const moodHits = tickets.filter((t) =>
    NEGATIVE_RE.test(`${t.title || ""}${t.content || ""}`)
  ).length;
  const moodPct = Math.round((moodHits / n) * 100);

  const callers = new Set(tickets.map((t) => t.citizenPhone || t.citizenName || ""));
  // ponytail: 原公式 (callers.size - 1)/n 反向，callers 越多 repeat 越低——这才是群体聚集的正确语义
  const repeatPct = callers.size <= 1 ? 95 : Math.max(20, Math.round(80 * (1 - (callers.size - 1) / n)));

  // 跨镇街惩罚：同一主体/地点型主题若覆盖多个镇街，研判置信度应当下调
  const townships = new Set(
    tickets
      .map((t) => (t.subdistrict || t.district || "").trim())
      .filter((s) => s && GENERAL_TOWNSHIP_RE.test(s))
  );
  const townshipCount = townships.size;
  const subject = tickets[0]?.canonicalSubject || "";

  const features = [
    { name: "关键词命中", pct: keywordPct, desc: event ? `主题「${event}」覆盖 ${keywordHits}/${n}` : "无统一事件类型" },
    { name: "地理范围", pct: geoPct, desc: loc ? `落在同一地点 ${locHits}/${n}` : "地点未对齐" },
    { name: "时间模式", pct: timePct, desc: `${cadenceLabel(cadence)} · 跨度约 ${Math.max(1, Math.round(spanHours))} 小时` },
    { name: "情绪强度", pct: moodPct, desc: moodHits ? `险情/激烈用语 ${moodHits} 条` : "未命中险情词" },
  ];

  const radar = [keywordPct, geoPct, timePct, moodPct, repeatPct];

  let aiConfidence = 40;
  if (theme.patternType) aiConfidence += 12;
  if (loc && loc.length >= 5) aiConfidence += 12;
  if (event) aiConfidence += 10;
  if (n >= RULES.minClusterSize) aiConfidence += 16;
  if (geoPct >= 70) aiConfidence += 5;
  if (keywordPct >= 50) aiConfidence += 5;
  // ponytail: 跨镇街惩罚——同一主体若跨 N 个镇街，置信度按 (N-1)*8 扣减，避免「90% 高置信」掩盖跨区拼凑
  if (townshipCount >= 2 && subject) aiConfidence -= 8 * (townshipCount - 1);
  aiConfidence = Math.max(0, Math.min(99, aiConfidence));

  let trendPct: number | null = null;
  if (times.length >= 2) {
    const last = times[times.length - 1];
    const week = 7 * 86400000;
    const recent = times.filter((t) => t >= last - week).length;
    const prev = times.filter((t) => t >= last - 2 * week && t < last - week).length;
    if (prev > 0) trendPct = Math.round(((recent - prev) / prev) * 100);
    else if (recent > 0) trendPct = null;
  }

  return { features, radar, aiConfidence, trendPct };
}
