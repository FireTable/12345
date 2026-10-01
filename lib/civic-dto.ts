import { MODE_META, civicModeFromPattern } from "@/backend/theme-metrics";
import type { CivicMode, PatternType } from "@/backend/state";
import { parseAdminArea } from "@/lib/admin-area";

export function regionLabel(subdistrict?: string | null, district?: string | null): string {
  const raw = (subdistrict || district || "").trim();
  if (!raw) return "未归属";
  const parsed = parseAdminArea(raw);
  if (parsed.subdistrict) {
    return parsed.subdistrict.replace(/(街道|镇|乡)$/g, "");
  }
  if (parsed.district) {
    return parsed.district;
  }
  return raw.replace(/(街道|镇|乡|区|县)$/g, "") || "未归属";
}

export const HANDLING_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  RESOLVED: "RESOLVED",
} as const;

export type HandlingStatusCode = (typeof HANDLING_STATUS)[keyof typeof HANDLING_STATUS];

const HANDLING_STATUS_LABEL: Record<HandlingStatusCode, string> = {
  PENDING: "未处理",
  IN_PROGRESS: "处置中",
  RESOLVED: "已办结",
};

export function mapTicketStatus(status?: string | null): HandlingStatusCode {
  const s = (status || HANDLING_STATUS.PENDING).toUpperCase();
  if (s === HANDLING_STATUS.RESOLVED || s === "FINISHED") return HANDLING_STATUS.RESOLVED;
  if (s === "DISPATCHED" || s === "VERIFIED" || s === HANDLING_STATUS.IN_PROGRESS || s === "PROCESSING") {
    return HANDLING_STATUS.IN_PROGRESS;
  }
  return HANDLING_STATUS.PENDING;
}

/**
 * 校验是否为脱敏/匿名市民通用占位称谓
 */
const ANONYMIZED_CITIZEN_RE = /^(?:市民\*?|热线市民|当事人|匿名|某市民|无)$/;
export function isAnonymizedCitizen(name?: string | null): boolean {
  if (!name) return true;
  const trimmed = name.trim();
  return !trimmed || ANONYMIZED_CITIZEN_RE.test(trimmed);
}

const LEGACY_RESOLVED = new Set(["已办结", "办结"]);
const LEGACY_IN_PROGRESS = new Set(["处置中", "处理中"]);

export function normalizeStatusCode(status?: string | null): HandlingStatusCode {
  if (!status) return HANDLING_STATUS.PENDING;
  const s = status.trim();
  const upper = s.toUpperCase();
  if (upper === HANDLING_STATUS.RESOLVED || upper === "FINISHED" || LEGACY_RESOLVED.has(s)) {
    return HANDLING_STATUS.RESOLVED;
  }
  if (
    upper === HANDLING_STATUS.IN_PROGRESS ||
    upper === "PROCESSING" ||
    upper === "DISPATCHED" ||
    LEGACY_IN_PROGRESS.has(s)
  ) {
    return HANDLING_STATUS.IN_PROGRESS;
  }
  return HANDLING_STATUS.PENDING;
}

export function handlingStatusLabel(status?: string | null): string {
  return HANDLING_STATUS_LABEL[normalizeStatusCode(status)];
}

export function getUrgencyLabel(urgency?: string | null): string {
  const u = (urgency || "").toUpperCase();
  if (u === "URGENT" || u === "HIGH") return "紧急";
  if (u === "MEDIUM") return "较急";
  return "普通";
}

export function handlingColor(label?: string | null): string {
  const code = normalizeStatusCode(label);
  if (code === HANDLING_STATUS.RESOLVED) return "#52C41A";
  if (code === HANDLING_STATUS.IN_PROGRESS) return "#1677FF";
  return "#F53F3F";
}

/**
 * 统一样式分类徽章映射 (支持标准民生分类与动态扩展)
 */
export function getCategoryBadgeClass(category?: string | null): string {
  if (!category) return "badge-pill--default";
  const cat = category.trim();
  if (/(?:生态|环境|环保|河道|水污染)/.test(cat)) return "badge-pill--success";
  if (/(?:劳动|社保|劳资|欠薪|工伤)/.test(cat)) return "badge-pill--warning";
  if (/(?:市场|市监|消费|物价|欺诈)/.test(cat)) return "badge-pill--danger";
  if (/(?:城市|城管|市政|环卫|违建)/.test(cat)) return "badge-pill--info";
  if (/(?:交通|交警|出行|道路|拥堵)/.test(cat)) return "badge-pill--primary";
  if (/(?:安全|消防|燃气|应急)/.test(cat)) return "badge-pill--danger";
  return "badge-pill--default";
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
  riskLevel?: string | null;
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
  if (!features || features.length === 0) {
    features = [
      { name: "语义相关度", pct: 93, desc: "工单核心诉求高度同源" },
      { name: "空间聚集度", pct: theme.patternType === "DIVERGE" ? 84 : 95, desc: `同属${theme.canonicalLocation || "辖区"}物理半径` },
      { name: "时序密度", pct: 86, desc: "相近时段内呈多频突发态势" },
      { name: "情绪敏感度", pct: theme.riskLevel === "HIGH" ? 90 : 75, desc: "群众切身民生利益诉求" },
      { name: "主体一致性", pct: theme.patternType === "DIVERGE" ? 98 : 92, desc: "指向相同涉事主体或处置单位" },
    ];
  }

  let radar = theme.radar || null;
  if (!radar && theme.radarJson) {
    try {
      radar = JSON.parse(theme.radarJson);
    } catch {
      radar = null;
    }
  }
  if (!radar || radar.length === 0) {
    radar = theme.riskLevel === "HIGH" ? [95, 92, 88, 90, 96] : [93, 90, 86, 75, 92];
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
      code: normalizeStatusCode(theme.handlingStatus),
      label: handlingStatusLabel(theme.handlingStatus),
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
  channel?: string | null;
}) {
  const created =
    row.createTime instanceof Date
      ? row.createTime.toISOString().slice(0, 10)
      : String(row.createTime || "").slice(0, 10);
  const defaultConfidence = row.confidence ?? (row.sourceCategory ? 85 : 80);
  return {
    id: row.ticketNo || row.id,
    ticketId: row.id,
    title: row.summarizeTitle || row.title || "市民诉求",
    category: row.sourceCategory || row.category || "",
    region: regionLabel(row.subdistrict, row.district) || "辖区",
    urgency: row.urgency || "NORMAL",
    status: mapTicketStatus(row.status),
    createdAt: created,
    content: row.maskedContent || row.content || "",
    rawContent: row.content || "",
    channel: row.channel || "市民服务热线",
    caller_name: row.citizenName || "",
    caller_phone: row.citizenPhone || "",
    address: row.address || "",
    cluster_id: row.primaryThemeId || "",
    confidence: defaultConfidence,
    multifreq: Boolean(row.primaryThemeId),
  };
}
