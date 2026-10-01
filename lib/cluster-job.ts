import { desc } from "drizzle-orm";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { runTicketRadarPipeline } from "@/backend/agent";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { persistClusterResult } from "@/lib/civic-persist";
import { seedReviewQueue } from "@/lib/review-queue";
import type { RawTicket } from "@/backend/state";
import type { ClusterJob } from "@/lib/cluster-queue";
import { workOrderClockFromTicketNo } from "@/lib/work-order-date";

/**
 * 跑完一条已经入队的研判。抽取中途写入的置信度会让下次拉起跳过已完成的工单。
 */
export async function executeClusterJob(job: ClusterJob): Promise<number> {
  const { db: tenantDb } = await getRegionDb(job.regionId);
  const rows = await tenantDb.select().from(ticketsTable).orderBy(desc(ticketsTable.createTime));
  const tickets: RawTicket[] = rows.map((r) => ({
    id: r.id,
    ticketNo: r.ticketNo,
    title: r.title || undefined,
    summarizeTitle: r.summarizeTitle || undefined,
    address: r.address || undefined,
    confidence: typeof r.confidence === "number" ? r.confidence : undefined,
    sourceCategory: r.sourceCategory || undefined,
    primaryThemeId: r.primaryThemeId || undefined,
    canonicalSubject: r.canonicalSubject || undefined,
    eventType: r.eventType || undefined,
    slaHours: typeof r.slaHours === "number" ? r.slaHours : undefined,
    stabilityRisk: typeof r.stabilityRisk === "boolean" ? r.stabilityRisk : undefined,
    createTime:
      workOrderClockFromTicketNo(r.ticketNo) ||
      (r.createTime ? r.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00"),
    content: r.content,
    maskedContent: r.maskedContent || undefined,
    closedAt: r.closedAt ? r.closedAt.toISOString().slice(0, 19).replace("T", " ") : undefined,
    closureStatus: (r.closureStatus as "RESOLVED" | "REOPENED" | null) || undefined,
    isFakeClosure: r.isFakeClosure || false,
    citizenName: r.citizenName || "热线市民",
    citizenPhone: r.citizenPhone || "",
    district: r.district || undefined,
    subdistrict: r.subdistrict || undefined,
    channel: r.channel || "市民服务热线",
    status: (r.status as RawTicket["status"]) || "PENDING",
  }));

  let existingActiveThemes: any[] = [];
  try {
    const activeRows = (await tenantDb.select().from(themesTable)).filter(
      (row) => normalizeStatusCode(row.handlingStatus) !== HANDLING_STATUS.RESOLVED
    );
    existingActiveThemes = activeRows.map((r) => ({
      id: r.id,
      title: r.title,
      canonicalSubject: r.canonicalSubject,
      canonicalLocation: r.canonicalLocation,
      eventType: r.eventType,
      category: r.category || "",
      riskLevel: r.riskLevel,
      riskReason: r.riskReason || "",
      ticketCount: r.ticketCount,
      timeSpanHours: r.timeSpanHours || 1,
      firstOccurrence: r.firstAt ? r.firstAt.toISOString().slice(0, 19).replace("T", " ") : "",
      lastOccurrence: r.lastAt ? r.lastAt.toISOString().slice(0, 19).replace("T", " ") : "",
      aiSummary: r.aiSummary || "",
      recommendedAction: r.recommendedAction || "",
      handlingStatus: r.handlingStatus || HANDLING_STATUS.PENDING,
      status: "CONFIRMED",
      tickets: [],
      relatedSubjects: [r.canonicalSubject],
      relatedLocations: [r.canonicalLocation],
    }));
  } catch {
    existingActiveThemes = [];
  }

  const result = await runTicketRadarPipeline(
    tickets,
    job.taskId,
    job.taskId,
    job.regionId,
    existingActiveThemes
  );

  await persistClusterResult({
    tickets: result.enrichedTickets || [],
    themes: result.themes || [],
    regionId: job.regionId,
  });
  if (result.lowConfidenceTickets && result.lowConfidenceTickets.length > 0) {
    await seedReviewQueue(result.lowConfidenceTickets, job.regionId);
  }
  return result.themes?.length || 0;
}
