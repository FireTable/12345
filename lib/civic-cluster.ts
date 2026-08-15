export type ClusterUrgency = "urgent" | "high" | "medium" | "low";

export const CIVIC_CATEGORIES = [
  "城市管理",
  "市场监管",
  "社会治理",
  "交通出行",
  "生态环境",
  "劳动社保",
  "公共安全",
] as const;

/** 城管 / 劳资及七类对应项视为“重要”民生类型 */
const IMPORTANT_TYPES = ["城市管理", "劳动社保", "城管", "劳资"];

export function spanDays(first?: string | null, last?: string | null): number {
  if (!first || !last) return 1;
  const a = Date.parse(first);
  const b = Date.parse(last);
  if (Number.isNaN(a) || Number.isNaN(b)) return 1;
  return Math.max(1, Math.round(Math.abs(b - a) / 86400000));
}

/** 设计稿：未处理 > 200 为紧急。数据量不足时按分位缩放，避免 306 单永远达不到阈值。 */
export function urgentCutFromUnprocessed(values: number[]): number {
  if (!values.length) return 200;
  const max = Math.max(...values);
  if (max >= 200) return 200;
  const sorted = [...values].sort((a, b) => a - b);
  const p80 = sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.8))] || 0;
  return Math.max(3, p80);
}

export function deriveClusterUrgency(unprocessed: number, type: string, urgentCut: number): ClusterUrgency {
  const isUrgent = unprocessed >= urgentCut;
  const isImportant = IMPORTANT_TYPES.some((t) => (type || "").includes(t));
  if (isUrgent && isImportant) return "urgent";
  if (!isUrgent && isImportant) return "high";
  if (isUrgent && !isImportant) return "medium";
  return "low";
}

export const URGENCY_META: Record<ClusterUrgency, { label: string; cls: string }> = {
  urgent: { label: "紧急", cls: "urgency-tag--urgent" },
  high: { label: "高", cls: "urgency-tag--high" },
  medium: { label: "中", cls: "urgency-tag--medium" },
  low: { label: "低", cls: "urgency-tag--low" },
};

export function mapColorByShare(count: number, max: number): string {
  if (max <= 0 || count <= 0) return "#D9F7BE";
  const r = count / max;
  if (r >= 0.8) return "#F53F3F";
  if (r >= 0.55) return "#FF7D00";
  if (r >= 0.3) return "#FFB84D";
  return "#52C41A";
}

export function categoryColor(name: string): string {
  const map: Record<string, string> = {
    消费: "#13C2C2",
    市场监管: "#13C2C2",
    城管: "#1E5AFF",
    城市管理: "#1E5AFF",
    劳资: "#FF7D00",
    劳动社保: "#FF7D00",
    物业: "#722ED1",
    环保: "#52C41A",
    生态环境: "#52C41A",
    交通出行: "#FAAD14",
    公共安全: "#F53F3F",
    社会治理: "#EB2F96",
    其他: "#86909C",
  };
  return map[name] || "#86909C";
}

export const RANK_COLORS = [
  "#F53F3F",
  "#FF7D00",
  "#1677FF",
  "#13C2C2",
  "#722ED1",
  "#52C41A",
  "#FAAD14",
  "#EB2F96",
  "#A6CFF0",
  "#FFCCCC",
];
