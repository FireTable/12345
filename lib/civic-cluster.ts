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

/**
 * 通用镇街行政区划协调调色盘数组 (16 色高辨识度低饱和政务调色板)
 */
export const CIVIC_TOWNSHIP_PALETTE: string[] = [
  "#1E5AFF", // 0. 科技蓝 (大良)
  "#722ED1", // 1. 雅致紫 (容桂)
  "#08979C", // 2. 青碧 (伦教)
  "#2F54EB", // 3. 极客深蓝 (勒流)
  "#FA8C16", // 4. 活力橙 (北滘)
  "#52C41A", // 5. 生态绿 (陈村)
  "#EB2F96", // 6. 胭脂红 (乐从)
  "#D46B08", // 7. 琥珀棕 (龙江)
  "#1890FF", // 8. 明净天蓝 (杏坛)
  "#7CB305", // 9. 青柠绿 (均安)
  "#13C2C2", // 10. 薄荷绿
  "#9254DE", // 11. 鸢尾紫
  "#FA541C", // 12. 暖朱红
  "#36CFC9", // 13. 浅湖蓝
  "#F759AB", // 14. 樱花粉
  "#A0D911", // 15. 嫩草绿
];

/**
 * 标准法定重点城市镇街指定色彩对照表 (与数据字典完全统一)
 */
export const KNOWN_TOWNSHIP_COLORS: Record<string, string> = {
  // 顺德区 10 大法定镇街
  "大良": "#1E5AFF",
  "大良街道": "#1E5AFF",
  "容桂": "#722ED1",
  "容桂街道": "#722ED1",
  "伦教": "#08979C",
  "伦教街道": "#08979C",
  "勒流": "#2F54EB",
  "勒流街道": "#2F54EB",
  "北滘": "#FA8C16",
  "北滘镇": "#FA8C16",
  "陈村": "#52C41A",
  "陈村镇": "#52C41A",
  "乐从": "#EB2F96",
  "乐从镇": "#EB2F96",
  "龙江": "#D46B08",
  "龙江镇": "#D46B08",
  "杏坛": "#1890FF",
  "杏坛镇": "#1890FF",
  "均安": "#7CB305",
  "均安镇": "#7CB305",

  // 广州市天河区主要街道映射
  "猎德": "#722ED1",
  "猎德街道": "#722ED1",
  "天园": "#1E5AFF",
  "天园街道": "#1E5AFF",
  "石牌": "#FA8C16",
  "石牌街道": "#FA8C16",
  "五山": "#52C41A",
  "五山街道": "#52C41A",
  "冼村": "#08979C",
  "冼村街道": "#08979C",
  "林和": "#2F54EB",
  "林和街道": "#2F54EB",
  "天河南": "#1890FF",
  "天河南街道": "#1890FF",
  "棠下": "#EB2F96",
  "棠下街道": "#EB2F96",
  "员村": "#D46B08",
  "员村街道": "#D46B08",
  "车陂": "#7CB305",
  "车陂街道": "#7CB305",
};

/**
 * 统一获取镇街的专属法定色彩（单一事实来源 SSOT）
 * 1. 优先从 KNOWN_TOWNSHIP_COLORS 精确对照表读取
 * 2. 否则通过字符串确定性哈希均匀映射到 CIVIC_TOWNSHIP_PALETTE 调色盘
 */
export function getTownshipColor(name?: string | null): string {
  if (!name) return "#1E5AFF";
  const raw = name.trim();
  const short = raw.replace(/(街道|镇|办事处)$/, "");

  if (KNOWN_TOWNSHIP_COLORS[raw]) return KNOWN_TOWNSHIP_COLORS[raw];
  if (KNOWN_TOWNSHIP_COLORS[short]) return KNOWN_TOWNSHIP_COLORS[short];

  // 模糊匹配已知项
  for (const [k, c] of Object.entries(KNOWN_TOWNSHIP_COLORS)) {
    if (raw.includes(k) || k.includes(raw)) return c;
  }

  // Hash 算法映射到统一调色盘，保证同一镇街颜色绝对稳定且互不相同
  let hash = 0;
  for (let i = 0; i < raw.length; i++) {
    hash = (hash << 5) - hash + raw.charCodeAt(i);
    hash |= 0;
  }
  const idx = Math.abs(hash) % CIVIC_TOWNSHIP_PALETTE.length;
  return CIVIC_TOWNSHIP_PALETTE[idx];
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
