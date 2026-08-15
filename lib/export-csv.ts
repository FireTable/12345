import Papa from "papaparse";
import type { MultiFrequencyTheme } from "@/backend/state";

export function exportThemesToCSV(themes: MultiFrequencyTheme[]): void {
  const rows = themes.map((t, idx) => ({
    "index": idx + 1,
    "themeId": t.id,
    "riskLevel": t.riskLevel,
    "title": t.title,
    "canonicalSubject": t.canonicalSubject,
    "canonicalLocation": t.canonicalLocation,
    "eventType": t.eventType,
    "ticketCount": t.ticketCount,
    "timeSpanHours": t.timeSpanHours,
    "firstOccurrence": t.firstOccurrence,
    "lastOccurrence": t.lastOccurrence,
    "relatedSubjects": t.relatedSubjects.join(" | "),
    "aiSummary": t.aiSummary,
    "recommendedAction": t.recommendedAction,
    "ticketNos": t.tickets.map((k) => k.ticketNo).join("; "),
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  downloadBlob(csvString, `ticket_radar_themes_${formatDate(new Date())}.csv`, "text/csv;charset=utf-8;");
}

export function exportThemeTicketsToCSV(theme: MultiFrequencyTheme): void {
  const rows = theme.tickets.map((tk, idx) => ({
    "index": idx + 1,
    "ticketNo": tk.ticketNo,
    "createTime": tk.createTime,
    "citizenName": tk.citizenName,
    "citizenPhone": tk.citizenPhone,
    "district": tk.district,
    "subdistrict": tk.subdistrict,
    "channel": tk.channel,
    "canonicalSubject": tk.canonicalSubject,
    "canonicalLocation": tk.canonicalLocation,
    "eventType": tk.eventType,
    "content": tk.content,
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  const safeTitle = theme.title.replace(/[\/\\:*?"<>|]/g, "_");
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
