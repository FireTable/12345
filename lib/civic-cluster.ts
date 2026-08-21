export type ClusterUrgency = "urgent" | "high" | "medium" | "low";

export const CIVIC_CATEGORIES = [
  "市容城管",
  "交通出行",
  "环保水务",
  "市场监管",
  "社区物业",
  "劳资社保",
  "公共安全",
] as const;

/** 城管 / 劳资及七类对应项视为“重要”民生类型 */
const IMPORTANT_TYPES = [
  "市容城管", "城市管理", "劳资社保", "劳动社保", "城管", "劳资", "公共安全"
];

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
  high: { label: "较急", cls: "urgency-tag--high" },
  medium: { label: "中等", cls: "urgency-tag--medium" },
  low: { label: "普通", cls: "urgency-tag--low" },
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
    // 官方 7 大法定诉求分类
    市容城管: "#1677FF", // 经典政务科技蓝
    交通出行: "#FA8C16", // 交通活力橙黄
    环保水务: "#52C41A", // 生态水务清新绿
    市场监管: "#13C2C2", // 市场营商青碧色
    社区物业: "#EB2F96", // 社区物业温和品红
    劳资社保: "#722ED1", // 劳动权益高贵紫
    公共安全: "#F5222D", // 公共安全警示红

    // 历史与别名拓展映射
    城管: "#1677FF",
    城市管理: "#1677FF",
    交通: "#FA8C16",
    环保: "#52C41A",
    水务: "#52C41A",
    生态环境: "#52C41A",
    消费: "#13C2C2",
    消费维权: "#13C2C2",
    物业: "#EB2F96",
    物业管理: "#EB2F96",
    劳资: "#722ED1",
    劳动社保: "#722ED1",
    社保: "#722ED1",
    安全: "#F5222D",
    社会治理: "#2F54EB",
    政务服务: "#391085",
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
