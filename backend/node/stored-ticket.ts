import { workOrderClockFromTicketNo } from "@/lib/work-order-date";
import type { EnrichedTicket, RawTicket } from "../state";

/**
 * 抽取完成的标记就是库存字段本身：confidence > 0，并且摘要或事件类型至少有一个。
 * 没有另一列「整理过」。主体和地址可以是空的。
 */
export function ticketExtractionStored(ticket: RawTicket): boolean {
  return Boolean(
    typeof ticket.confidence === "number" &&
      ticket.confidence > 0 &&
      (ticket.summarizeTitle?.trim() || ticket.eventType?.trim())
  );
}

export function everyTicketStored(tickets: readonly RawTicket[]): boolean {
  return tickets.length > 0 && tickets.every(ticketExtractionStored);
}

/**
 * 已落库的工单直接用库存字段组装。
 * 镇街留空就留空，不再扫正文，也不再做别名替换。
 */
export function storedTicketToEnriched(ticket: RawTicket): EnrichedTicket {
  const clock = workOrderClockFromTicketNo(ticket.ticketNo);
  const canonicalSubject = (ticket.canonicalSubject || "").trim();
  const canonicalLocation = (ticket.address || "").trim();
  const eventType = (ticket.eventType || "").trim();
  const summarizeTitle = (ticket.summarizeTitle || "").trim();
  const category = (ticket.sourceCategory || "").trim();
  const confidence = typeof ticket.confidence === "number" ? ticket.confidence : 0;
  const subdistrict = (ticket.subdistrict || "").trim() || undefined;
  return {
    ...ticket,
    createTime: clock || ticket.createTime,
    extractionFailed: false,
    district: ticket.district || undefined,
    subdistrict,
    sourceCategory: category || undefined,
    address: canonicalLocation || ticket.address,
    summarizeTitle,
    confidence,
    canonicalSubject,
    canonicalLocation,
    eventType,
    themes: category ? [category] : [],
    entities: [
      {
        name: canonicalSubject,
        canonicalName: canonicalSubject,
        type: "SUBJECT",
        confidence: Math.min(1, confidence / 100),
      },
      {
        name: canonicalLocation,
        canonicalName: canonicalLocation,
        type: "LOCATION",
        confidence: Math.min(1, Math.max(0, confidence - 5) / 100),
      },
      {
        name: eventType,
        canonicalName: eventType,
        type: "EVENT_TYPE",
        confidence: Math.min(1, confidence / 100),
      },
    ],
    relations: [
      { source: ticket.id, target: canonicalSubject, relation: "投诉主体" },
      { source: ticket.id, target: canonicalLocation, relation: "发生地" },
      { source: canonicalSubject, target: eventType, relation: "涉及事件" },
    ],
  };
}
