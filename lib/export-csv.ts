import Papa from "papaparse";
import type { MultiFrequencyTheme } from "@/backend/state";

/**
 * Matches CSV cells starting with spreadsheet formula trigger characters
 * (`=`, `+`, `-`, `@`, `\t`, `\r`) or leading whitespace / BOM / zero-width
 * characters followed by `=`, `+`, `-`, `@` (CWE-1236).
 */
const FORMULA_TRIGGER_RE = /^[=+\-@\t\r]|^[\s\uFEFF\u200B-\u200D]+[=+\-@]/;

/**
 * Neutralizes spreadsheet formula injection (CWE-1236) on a single raw cell value
 * without applying RFC-4180 outer quotes (suitable for PapaParse or `buildSafeCsv`).
 */
export function sanitizeCsvCell(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? String(value) : "";
  }
  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }
  if (typeof value === "bigint") {
    return String(value);
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  }
  const str = String(value);
  return FORMULA_TRIGGER_RE.test(str) ? `'${str}` : str;
}

function formatCsvField(value: unknown): string {
  const safe = sanitizeCsvCell(value);
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

/**
 * Builds an RFC-4180 CSV string with CWE-1236 formula neutralization on every
 * header and row cell.
 *
 * Callers MUST pass raw unquoted values (do NOT pre-wrap cells in `"..."`),
 * as this function handles RFC-4180 quoting and double-quote escaping.
 * `options.includeBom` defaults to `false` so callers that prepend `"\uFEFF"`
 * when creating a `Blob` do not emit a duplicate BOM.
 */
export function buildSafeCsv(
  headers: string[],
  rows: unknown[][],
  options?: { includeBom?: boolean }
): string {
  const lines: string[] = [];
  if (headers.length > 0) {
    lines.push(headers.map(formatCsvField).join(","));
  }
  for (const row of rows) {
    lines.push(row.map(formatCsvField).join(","));
  }
  const csv = lines.join("\r\n");
  return options?.includeBom ? `\uFEFF${csv}` : csv;
}

export function exportThemesToCSV(themes: MultiFrequencyTheme[]): void {
  const rows = themes.map((t, idx) => ({
    "index": idx + 1,
    "themeId": sanitizeCsvCell(t.id),
    "riskLevel": sanitizeCsvCell(t.riskLevel),
    "title": sanitizeCsvCell(t.title),
    "canonicalSubject": sanitizeCsvCell(t.canonicalSubject),
    "canonicalLocation": sanitizeCsvCell(t.canonicalLocation),
    "eventType": sanitizeCsvCell(t.eventType),
    "category": sanitizeCsvCell(t.category),
    "ticketCount": t.ticketCount,
    "timeSpanHours": t.timeSpanHours,
    "firstOccurrence": sanitizeCsvCell(t.firstOccurrence),
    "lastOccurrence": sanitizeCsvCell(t.lastOccurrence),
    "relatedSubjects": sanitizeCsvCell((t.relatedSubjects ?? []).join(" | ")),
    "aiSummary": sanitizeCsvCell(t.aiSummary),
    "recommendedAction": sanitizeCsvCell(t.recommendedAction),
    "ticketNos": sanitizeCsvCell((t.tickets ?? []).map((k) => k.ticketNo ?? "").join("; ")),
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  downloadBlob(csvString, `ticket_radar_themes_${formatDate(new Date())}.csv`, "text/csv;charset=utf-8;");
}

export function exportThemeTicketsToCSV(theme: MultiFrequencyTheme): void {
  const rows = (theme.tickets ?? []).map((tk, idx) => ({
    "index": idx + 1,
    "ticketNo": sanitizeCsvCell(tk.ticketNo),
    "createTime": sanitizeCsvCell(tk.createTime),
    "citizenName": sanitizeCsvCell(tk.citizenName),
    "citizenPhone": sanitizeCsvCell(tk.citizenPhone),
    "district": sanitizeCsvCell(tk.district),
    "subdistrict": sanitizeCsvCell(tk.subdistrict),
    "channel": sanitizeCsvCell(tk.channel),
    "canonicalSubject": sanitizeCsvCell(tk.canonicalSubject),
    "canonicalLocation": sanitizeCsvCell(tk.canonicalLocation),
    "eventType": sanitizeCsvCell(tk.eventType),
    "content": sanitizeCsvCell(tk.content),
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  const safeTitle = (theme.title ?? "").replace(/[\/\\:*?"<>|]/g, "_");
  downloadBlob(csvString, `ticket_radar_details_${safeTitle}_${formatDate(new Date())}.csv`, "text/csv;charset=utf-8;");
}

export const exportSingleThemeTicketsToCSV = exportThemeTicketsToCSV;

function formatDate(d: Date): string {
  const pad = (n: number) => (n < 10 ? "0" + n : n);
  return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
}

function downloadBlob(content: string, filename: string, mimeType: string): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
