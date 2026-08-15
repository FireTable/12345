import Papa from "papaparse";
import type { MultiFrequencyTheme } from "@/backend/state";

export function exportThemesToCSV(themes: MultiFrequencyTheme[]): void {
  const rows = themes.map((t, idx) => ({
    "序号": idx + 1,
    "主题编号": t.id,
    "风险等级": t.riskLevel === "HIGH" ? "🔴 高风险" : t.riskLevel === "MEDIUM" ? "🟡 中风险" : "🟢 关注",
    "多频主题名称": t.title,
    "规范被诉主体": t.canonicalSubject,
    "规范发生地点": t.canonicalLocation,
    "事件类型": t.eventType,
    "聚合工单总数": t.ticketCount,
    "首末时间跨度(小时)": t.timeSpanHours,
    "首单发生时间": t.firstOccurrence,
    "末单发生时间": t.lastOccurrence,
    "涉及市民表述形式": t.relatedSubjects.join(" | "),
    "AI研判摘要": t.aiSummary,
    "建议处置举措": t.recommendedAction,
    "关联工单编号列表": t.tickets.map((k) => k.ticketNo).join("; "),
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  downloadBlob(csvString, `热线多频工单智能核查汇总报表_${formatDate(new Date())}.csv`, "text/csv;charset=utf-8;");
}

export function exportSingleThemeTicketsToCSV(theme: MultiFrequencyTheme): void {
  const rows = theme.tickets.map((tk, idx) => ({
    "序号": idx + 1,
    "工单编号": tk.ticketNo,
    "登记时间": tk.createTime,
    "诉求人": tk.citizenName,
    "联系电话": tk.citizenPhone,
    "所属区域": `${tk.district} - ${tk.subdistrict}`,
    "诉求渠道": tk.channel,
    "识别主体": tk.canonicalSubject,
    "识别地点": tk.canonicalLocation,
    "诉求类别": tk.eventType,
    "多频归因": `匹配【${theme.canonicalSubject}】+【${theme.eventType}】`,
    "原始工单诉求内容": tk.content,
  }));

  const csvString = "\uFEFF" + Papa.unparse(rows);
  const safeTitle = theme.title.replace(/[\/\\:*?"<>|]/g, "_");
  downloadBlob(csvString, `多频主题明细_${safeTitle}_${formatDate(new Date())}.csv`, "text/csv;charset=utf-8;");
}

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
