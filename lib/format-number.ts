/**
 * 统一格式化计数与统计指标为千分位字符串（zh-CN）。
 * 禁止用于编号、工单号、年份、日期时间戳、手机号或百分比。
 */
export function fmtNum(value: number | string | null | undefined, fallback = "0"): string {
  if (value === null || value === undefined || value === "") return fallback;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString("zh-CN");
}
