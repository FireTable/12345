export type ClusterUrgency = "urgent" | "high" | "medium" | "low";

export const CIVIC_CATEGORIES = [
  "城市管理",
  "交通出行",
  "生态环境",
  "市场监管",
  "劳动社保",
  "公共安全",
  "社会治理",
  // 历史兼容
  "市容城管",
  "环保水务",
  "社区物业",
  "劳资社保",
] as const;

/** 城管 / 劳资及七类对应项视为“重要”民生类型 */
const IMPORTANT_TYPES = [
  "市容城管",
  "城市管理",
  "劳资社保",
  "劳动社保",
  "城管",
  "劳资",
  "公共安全",
  "社会治理",
  "交通出行",
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
  const raw = (name || "").trim();
  const map: Record<string, string> = {
    // 官方 7 大法定诉求分类（标准单一事实来源）
    城市管理: "#1677FF", // 经典政务科技蓝
    交通出行: "#FA8C16", // 交通活力橙黄
    生态环境: "#52C41A", // 生态水务清新绿
    市场监管: "#13C2C2", // 市场营商青碧色
    劳动社保: "#722ED1", // 劳动权益高贵紫
    公共安全: "#F5222D", // 公共安全警示红
    社会治理: "#2F54EB", // 社会治理极客蓝

    // 历史与别名拓展映射
    市容城管: "#1677FF",
    城管: "#1677FF",
    交通: "#FA8C16",
    出行: "#FA8C16",
    环保水务: "#52C41A",
    环保: "#52C41A",
    水务: "#52C41A",
    环境: "#52C41A",
    消费: "#13C2C2",
    消费维权: "#13C2C2",
    社区物业: "#EB2F96",
    物业: "#EB2F96",
    物业管理: "#EB2F96",
    劳资社保: "#722ED1",
    劳资: "#722ED1",
    社保: "#722ED1",
    安全: "#F5222D",
    消防: "#F5222D",
    政务服务: "#391085",
    其他: "#86909C",
  };
  if (map[raw]) return map[raw];
  for (const [key, color] of Object.entries(map)) {
    if (raw.includes(key)) return color;
  }
  return "#86909C";
}

export interface CategoryVisual {
  color: string;
  bg: string;
  border: string;
}

/**
 * 统一获取分类的色系方案（主色、柔和底色、精致边框）
 */
export function categoryVisual(name?: string | null): CategoryVisual {
  const raw = (name || "").trim();
  const color = categoryColor(raw);
  const palette: Record<string, { bg: string; text?: string; border?: string }> = {
    "#1677FF": { bg: "#E8F3FF", text: "#1677FF", border: "#BEDBFF" }, // 城市管理
    "#FA8C16": { bg: "#FFF7E6", text: "#D46B08", border: "#FFD591" }, // 交通出行 (温和暖橙底，暖深橙字，柔和浅橙边框)
    "#52C41A": { bg: "#E8FFEA", text: "#389E0D", border: "#B7EB8F" }, // 生态环境
    "#13C2C2": { bg: "#E6FFFB", text: "#08979C", border: "#87E8DE" }, // 市场监管
    "#722ED1": { bg: "#F9F0FF", text: "#722ED1", border: "#D3ADF7" }, // 劳动社保
    "#F5222D": { bg: "#FFECE8", text: "#F5222D", border: "#FFA39E" }, // 公共安全
    "#2F54EB": { bg: "#F0F5FF", text: "#2F54EB", border: "#ADC6FF" }, // 社会治理
    "#EB2F96": { bg: "#FFF0F6", text: "#EB2F96", border: "#FFADD2" }, // 社区物业 (历史/兼容)
  };
  const item = palette[color] || { bg: "#F0F1F3", text: "#86909C", border: "#E2E8F0" };
  return {
    color: item.text || color,
    bg: item.bg,
    border: item.border || "#E2E8F0",
  };
}

/**
 * 统一样式分类徽章内联属性 (用于各处 Badge / Pill 渲染)
 */
export function categoryBadgeStyle(name?: string | null): {
  color: string;
  backgroundColor: string;
  borderColor: string;
} {
  const v = categoryVisual(name);
  return {
    color: v.color,
    backgroundColor: v.bg,
    borderColor: v.border,
  };
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
