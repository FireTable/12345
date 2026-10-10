import type { RawTicket } from "@/backend/state";
import { workOrderClockFromTicketNo } from "@/lib/work-order-date";

/** 库里的一行工单转成研判输入。只读这一行，不连带全市。 */
export function toRawTicket(row: {
  id: string;
  ticketNo: string;
  title?: string | null;
  summarizeTitle?: string | null;
  address?: string | null;
  confidence?: number | null;
  sourceCategory?: string | null;
  primaryThemeId?: string | null;
  canonicalSubject?: string | null;
  eventType?: string | null;
  slaHours?: number | null;
  stabilityRisk?: boolean | null;
  createTime?: Date | null;
  content: string;
  maskedContent?: string | null;
  closedAt?: Date | null;
  closureStatus?: string | null;
  isFakeClosure?: boolean | null;
  citizenName?: string | null;
  citizenPhone?: string | null;
  district?: string | null;
  subdistrict?: string | null;
  channel?: string | null;
  status?: string | null;
}): RawTicket {
  return {
    id: row.id,
    ticketNo: row.ticketNo,
    title: row.title || undefined,
    summarizeTitle: row.summarizeTitle || undefined,
    address: row.address || undefined,
    confidence: typeof row.confidence === "number" ? row.confidence : undefined,
    sourceCategory: row.sourceCategory || undefined,
    primaryThemeId: row.primaryThemeId || undefined,
    canonicalSubject: row.canonicalSubject || undefined,
    eventType: row.eventType || undefined,
    slaHours: typeof row.slaHours === "number" ? row.slaHours : undefined,
    stabilityRisk: typeof row.stabilityRisk === "boolean" ? row.stabilityRisk : undefined,
    createTime:
      workOrderClockFromTicketNo(row.ticketNo) ||
      (row.createTime ? row.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00"),
    content: row.content,
    maskedContent: row.maskedContent || undefined,
    closedAt: row.closedAt ? row.closedAt.toISOString().slice(0, 19).replace("T", " ") : undefined,
    closureStatus: (row.closureStatus as "RESOLVED" | "REOPENED" | null) || undefined,
    isFakeClosure: row.isFakeClosure || false,
    citizenName: row.citizenName || "热线市民",
    citizenPhone: row.citizenPhone || "",
    district: row.district || undefined,
    subdistrict: row.subdistrict || undefined,
    channel: row.channel || "市民服务热线",
    status: (row.status as RawTicket["status"]) || "PENDING",
  };
}
