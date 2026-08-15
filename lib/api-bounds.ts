/** Shared public query-param clamps. Routes must import these — no per-handler copies. */

export const LIST_PAGE_MIN = 1;
export const LIST_SIZE_DEFAULT = 10;
export const LIST_SIZE_MAX = 50;
export const DAYS_MAX = 366;

function toInt(raw: unknown, fallback: number): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

export function clampPage(raw: unknown): number {
  return Math.max(LIST_PAGE_MIN, toInt(raw, LIST_PAGE_MIN));
}

export function clampSize(raw: unknown): number {
  const n = toInt(raw, LIST_SIZE_DEFAULT);
  if (n < 1) return LIST_SIZE_DEFAULT;
  return Math.min(LIST_SIZE_MAX, n);
}

/** 0 = all-time aggregates (never “return every ticket row”). */
export function clampDays(raw: unknown, fallback = 0): number {
  const n = toInt(raw, fallback);
  if (n < 0) return fallback;
  return Math.min(DAYS_MAX, n);
}
