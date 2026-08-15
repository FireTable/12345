import type { CivicMode, EnrichedTicket, MultiFrequencyTheme, PatternType } from "./state";
import { RULES, negativeTermsPattern } from "./rules";

const NEGATIVE_RE = negativeTermsPattern();

export const MODE_META: Record<
  CivicMode,
  { name: string; tagline: string; risk: string; color: string; icon: string }
> = {
  aggregate: {
    name: "群体聚集型",
    tagline: "不同人投诉同一事件",
    risk: "短时间集中爆发，存在蔓延迹象",
    color: "#F53F3F",
    icon: "🚨",
  },
  repeat: {
    name: "个体重复型",
    tagline: "同一人多次投诉同一事件",
    risk: "问题长期未解决，需闭环跟踪",
    color: "#FF7D00",
    icon: "🔁",
  },
  diverge: {
    name: "同主体发散型",
    tagline: "相同地点或主体、不同类型问题",
    risk: "治理隐患，建议源头核查",
    color: "#1677FF",
    icon: "📍",
  },
};

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
      .filter((s) => s && s !== "市民*" && s !== "热线市民")
  );
  if (callers.size === 1) return "INDIVIDUAL_REPEAT";
  return "GROUP_GATHERING";
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
  const timePct = spanHours <= 24 ? 92 : spanHours <= 24 * 7 ? 78 : spanHours <= 24 * 30 ? 62 : 45;

  const moodHits = tickets.filter((t) =>
    NEGATIVE_RE.test(`${t.title || ""}${t.content || ""}`)
  ).length;
  const moodPct = Math.round((moodHits / n) * 100);

  const callers = new Set(tickets.map((t) => t.citizenPhone || t.citizenName || ""));
  const repeatPct = Math.round((1 - Math.min(1, (callers.size - 1) / n)) * 100);

  const features = [
    { name: "关键词命中", pct: keywordPct, desc: event ? `主题「${event}」覆盖 ${keywordHits}/${n}` : "无统一事件类型" },
    { name: "地理范围", pct: geoPct, desc: loc ? `落在同一地点 ${locHits}/${n}` : "地点未对齐" },
    { name: "时间模式", pct: timePct, desc: `跨度约 ${Math.max(1, Math.round(spanHours))} 小时` },
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
