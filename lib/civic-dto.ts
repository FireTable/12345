import { MODE_META, civicModeFromPattern } from "@/backend/theme-metrics";
import type { CivicMode, PatternType } from "@/backend/state";
import { parseAdminArea } from "@/lib/admin-area";

export function regionLabel(subdistrict?: string | null, district?: string | null): string {
  const raw = (subdistrict || district || "").trim();
  if (!raw) return "未归属";
  const parsed = parseAdminArea(raw);
  if (parsed.subdistrict) {
    return parsed.subdistrict.replace(/(街道|镇)$/g, "");
  }
  if (parsed.district) {
    return parsed.district;
  }
  for (const t of ["大良", "容桂", "伦教", "勒流", "陈村", "北滘", "乐从", "龙江", "杏坛", "均安"]) {
    if (raw.includes(t)) return t;
  }
  if (raw.includes("顺德")) return "顺德区";
  if (raw.length > 6) return "顺德区";
  return raw.replace(/(街道|镇|区)$/g, "") || "未归属";
}

export function mapTicketStatus(status?: string | null): "PENDING" | "IN_PROGRESS" | "RESOLVED" {
  const s = (status || "PENDING").toUpperCase();
  if (s === "RESOLVED" || s === "FINISHED") return "RESOLVED";
  if (s === "DISPATCHED" || s === "VERIFIED" || s === "IN_PROGRESS" || s === "PROCESSING") {
    return "IN_PROGRESS";
  }
  return "PENDING";
}

export function handlingColor(label?: string | null): string {
  if (label === "已办结") return "#52C41A";
  if (label === "处置中") return "#1677FF";
  return "#F53F3F";
}

export function toClusterDto(theme: {
  id: string;
  title?: string | null;
  category?: string | null;
  canonicalSubject?: string | null;
  canonicalLocation?: string | null;
  eventType?: string | null;
  ticketCount?: number | null;
  patternType?: PatternType | string | null;
  civicMode?: CivicMode | string | null;
  aiConfidence?: number | null;
  firstOccurrence?: string | null;
  lastOccurrence?: string | null;
  firstAt?: Date | string | null;
  lastAt?: Date | string | null;
  recommendedAction?: string | null;
  riskReason?: string | null;
  features?: Array<{ name: string; pct: number; desc: string }> | null;
  featuresJson?: string | null;
  radar?: number[] | null;
  radarJson?: string | null;
  trendPct?: number | null;
  handlingStatus?: string | null;
  handlingProgress?: number | null;
  handlingOwner?: string | null;
  handlingEta?: Date | string | null;
  tickets?: Array<{
    id: string;
    ticketNo?: string;
    title?: string | null;
    summarizeTitle?: string | null;
    content?: string | null;
    maskedContent?: string | null;
    subdistrict?: string | null;
    district?: string | null;
  }>;
}) {
  const mode: CivicMode =
    theme.civicMode === "aggregate" || theme.civicMode === "repeat" || theme.civicMode === "diverge"
      ? theme.civicMode
      : civicModeFromPattern(theme.patternType as PatternType);
  const meta = MODE_META[mode];
  const samples = theme.tickets || [];
  const first =
    theme.firstOccurrence ||
    (theme.firstAt instanceof Date ? theme.firstAt.toISOString().slice(0, 10) : theme.firstAt) ||
    "";
  const last =
    theme.lastOccurrence ||
    (theme.lastAt instanceof Date ? theme.lastAt.toISOString().slice(0, 10) : theme.lastAt) ||
    "";

  let features = theme.features || null;
  if (!features && theme.featuresJson) {
    try {
      features = JSON.parse(theme.featuresJson);
    } catch {
      features = null;
    }
  }
  let radar = theme.radar || null;
  if (!radar && theme.radarJson) {
    try {
      radar = JSON.parse(theme.radarJson);
    } catch {
      radar = null;
    }
  }

  const parsed = parseAdminArea(theme.canonicalLocation);
  // ponytail: 用所有成员工单的去重镇街代替「第一条 member 的地区」，
  // 跨镇街主题不再被首条 sample 掩盖。2 个以内全部展示，更多则展示前 2 + 总数。
  const sampleTowns = Array.from(
    new Set(
      samples
        .map((t) => regionLabel(t.subdistrict, t.district))
        .filter((r) => r && r !== "未归属")
    )
  );
  const region = sampleTowns.length > 0
    ? sampleTowns.length <= 2
      ? sampleTowns.join(" · ")
      : `${sampleTowns.slice(0, 2).join(" · ")} 等 ${sampleTowns.length} 镇街`
    : parsed.subdistrict
      ? regionLabel(parsed.subdistrict)
      : regionLabel(theme.canonicalLocation);
  const type = theme.category || theme.eventType || "综合民生";

  return {
    id: theme.id,
    type,
    region,
    count: theme.ticketCount || 0,
    sample_ids: samples.slice(0, 5).map((t) => t.ticketNo || t.id),
    sample_titles: samples.slice(0, 5).map((t) => t.summarizeTitle || t.title || theme.title || type),
    sample_contents: samples.slice(0, 5).map((t) => t.maskedContent || t.content || ""),
    first_date: typeof first === "string" ? first.slice(0, 10) : "",
    last_date: typeof last === "string" ? last.slice(0, 10) : "",
    mode,
    mode_name: meta.name,
    mode_tagline: meta.tagline,
    mode_risk: theme.riskReason || meta.risk,
    mode_advice: theme.recommendedAction || "",
    mode_color: meta.color,
    mode_icon: meta.icon,
    ai_confidence: theme.aiConfidence ?? null,
    status: {
      label: theme.handlingStatus || "未处理",
      progress: theme.handlingProgress ?? 0,
      owner: theme.handlingOwner || "",
      color: handlingColor(theme.handlingStatus),
      eta: theme.handlingEta
        ? (theme.handlingEta instanceof Date
            ? theme.handlingEta.toISOString().slice(0, 10)
            : String(theme.handlingEta).slice(0, 10))
        : "",
    },
    trend: theme.trendPct == null ? "" : `${theme.trendPct > 0 ? "+" : ""}${theme.trendPct}%`,
    features: features || [],
    radar: radar || [],
    canonicalSubject: theme.canonicalSubject || "",
    canonicalLocation: theme.canonicalLocation || "",
    eventType: theme.eventType || "",
    title: theme.title || "",
    unprocessed: 0,
    urgency: "low" as const,
    days: 0,
    communities: 0,
    code: "",
  };
}

export function toWorkorderDto(row: {
  id: string;
  ticketNo?: string | null;
  title?: string | null;
  summarizeTitle?: string | null;
  sourceCategory?: string | null;
  category?: string | null;
  subdistrict?: string | null;
  district?: string | null;
  urgency?: string | null;
  status?: string | null;
  createTime?: Date | string | null;
  content?: string | null;
  maskedContent?: string | null;
  citizenName?: string | null;
  citizenPhone?: string | null;
  address?: string | null;
  primaryThemeId?: string | null;
  confidence?: number | null;
}) {
  const created =
    row.createTime instanceof Date
      ? row.createTime.toISOString().slice(0, 10)
      : String(row.createTime || "").slice(0, 10);
  const analyzed = row.confidence != null;
  return {
    id: row.ticketNo || row.id,
    ticketId: row.id,
    title: row.summarizeTitle || row.title || "市民诉求",
    category: analyzed ? row.sourceCategory || row.category || "" : "",
    region: analyzed ? regionLabel(row.subdistrict, row.district) : "",
    urgency: row.urgency || "NORMAL",
    status: mapTicketStatus(row.status),
    createdAt: created,
    content: row.maskedContent || row.content || "",
    rawContent: row.content || "",
    caller_name: row.citizenName || "",
    caller_phone: row.citizenPhone || "",
    address: row.address || "",
    cluster_id: row.primaryThemeId || "",
    confidence: row.confidence ?? null,
    multifreq: Boolean(row.primaryThemeId),
  };
}
