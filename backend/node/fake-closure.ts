import { differenceInDays } from "date-fns";
import type { EnrichedTicket } from "../state";
import { RULES } from "../rules";

export function parseTicketDate(dateStr?: string | null): Date | null {
  if (!dateStr) return null;
  const d = new Date(dateStr.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function markFakeClosures(tickets: EnrichedTicket[]): {
  reopenCount: number;
  reopenTicketIds: string[];
} {
  const windowDays = RULES.fakeClosure.windowDays;
  const sorted = [...tickets].sort((a, b) => {
    const ta = parseTicketDate(a.createTime)?.getTime() ?? 0;
    const tb = parseTicketDate(b.createTime)?.getTime() ?? 0;
    return ta - tb;
  });

  const reopenTicketIds: string[] = [];

  for (let i = 0; i < sorted.length; i++) {
    const curr = sorted[i];
    const currAt = parseTicketDate(curr.createTime);
    if (!currAt) continue;

    for (let j = 0; j < i; j++) {
      const prev = sorted[j];
      if (prev.closureStatus !== "RESOLVED" || !prev.closedAt) continue;
      const closedAt = parseTicketDate(prev.closedAt);
      if (!closedAt) continue;
      const days = differenceInDays(currAt, closedAt);
      if (days >= 0 && days <= windowDays) {
        curr.isFakeClosure = true;
        curr.closureStatus = "REOPENED";
        reopenTicketIds.push(curr.id);
        break;
      }
    }
  }

  return { reopenCount: reopenTicketIds.length, reopenTicketIds };
}
