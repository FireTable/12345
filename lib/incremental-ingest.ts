import { asc, sql as drizzleSql } from "drizzle-orm";
import { batchSizeForProfile } from "@civic/embed";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketsTable } from "@/db/schema";
import { persistIncrementalResult } from "@/lib/civic-persist";
import { seedReviewQueue } from "@/lib/review-queue";
import { updateTaskProgress } from "@/lib/task-progress";
import { stagePercent } from "@/lib/pipeline-progress";
import { toRawTicket } from "@/lib/ticket-raw";
import { loadThemeMemberVectors, upsertTicketEmbeddings } from "@/lib/ticket-embeddings";
import { yieldToEventLoop } from "@/lib/yield-loop";
import { getRegionVocabulary } from "@/lib/vocabulary";
import type { ClusterJob } from "@/lib/cluster-queue";
import type { EnrichedTicket, MultiFrequencyTheme, RiskLevel, TicketRadarState } from "@/backend/state";
import { evaluateIncrementalTicket, upgradeThemeWithSystemTwo } from "@/backend/incremental-cluster";
import { nextThemeSerial } from "@/backend/theme-serial";
import { extractNode } from "@/backend/node/extract-node";
import { canonicalNode } from "@/backend/node/canonical-node";
import { clusterTicketSet } from "@/backend/node/cluster-node";
import { summaryNode } from "@/backend/node/summary-node";
import { fillThemesMissingAdvice } from "@/backend/node/advice-backfill";
import {
  embedEligibleBatches,
  embeddingProgressLabel,
  isEmbedEligible,
  type EmbedTicketInput,
} from "@/backend/embed-policy";
import { embedProfileFromEnv, embedTextsWithRetry } from "@/backend/embed-products";

function asRisk(value: string | null | undefined): RiskLevel {
  if (value === "HIGH" || value === "高危") return "HIGH";
  if (value === "MEDIUM" || value === "中") return "MEDIUM";
  return "LOW";
}

function asEmbedInput(ticket: EnrichedTicket): EmbedTicketInput {
  return {
    id: ticket.id,
    canonicalSubject: ticket.canonicalSubject,
    extractionFailed: ticket.extractionFailed,
    summarizeTitle: ticket.summarizeTitle,
    eventType: ticket.eventType,
    canonicalLocation: ticket.canonicalLocation,
    subdistrict: ticket.subdistrict,
    sourceCategory: ticket.sourceCategory,
    confidence: ticket.confidence,
  };
}

async function embedIncoming(regionId: string, tickets: EnrichedTicket[], taskId?: string) {
  const inputs = tickets.map(asEmbedInput);
  const result = await embedEligibleBatches({
    tickets: inputs,
    stored: [],
    batchSize: batchSizeForProfile(embedProfileFromEnv()),
    embedBatch: (texts) => embedTextsWithRetry(texts),
    onProgress: (event) => {
      if (!taskId) return;
      updateTaskProgress(taskId, regionId, {
        stage: "EMBEDDING",
        stageText: embeddingProgressLabel(event.completed, event.eligible),
        processed: event.completed,
        total: event.eligible,
        percent: stagePercent("EMBED", event.completed, event.eligible),
      });
    },
  });
  const written = result.rows.filter((row) => row.vector && row.vector.length === 1024);
  await upsertTicketEmbeddings(regionId, written);
  const byId = new Map(written.map((row) => [row.ticketId, row.vector || []]));
  for (const ticket of tickets) {
    ticket.embedding = isEmbedEligible(asEmbedInput(ticket)) ? (byId.get(ticket.id) ?? []) : [];
  }
}

/**
 * 已有聚类时只处理还没抽取的新工单。
 * 对得上就并进旧主题，对不上的只在这批里互相归并。不删除主题表。
 */
export async function ingestNewTickets(job: ClusterJob): Promise<number> {
  const { db: tenantDb } = await getRegionDb(job.regionId);
  const rows = await tenantDb
    .select()
    .from(ticketsTable)
    .where(drizzleSql`${ticketsTable.confidence} is null or ${ticketsTable.confidence} = 0`)
    .orderBy(asc(ticketsTable.createTime));
  const rawTickets = rows.map((row) => toRawTicket(row));

  const themeRows = await tenantDb
    .select({
      id: themesTable.id,
      title: themesTable.title,
      canonicalSubject: themesTable.canonicalSubject,
      canonicalLocation: themesTable.canonicalLocation,
      eventType: themesTable.eventType,
      category: themesTable.category,
      riskLevel: themesTable.riskLevel,
      riskReason: themesTable.riskReason,
      ticketCount: themesTable.ticketCount,
      timeSpanHours: themesTable.timeSpanHours,
      firstAt: themesTable.firstAt,
      lastAt: themesTable.lastAt,
      aiSummary: themesTable.aiSummary,
      recommendedAction: themesTable.recommendedAction,
      handlingStatus: themesTable.handlingStatus,
    })
    .from(themesTable);
  const serialStart = nextThemeSerial(themeRows.map((row) => row.id));
  const activeThemes: MultiFrequencyTheme[] = themeRows
    .filter((row) => normalizeStatusCode(row.handlingStatus) !== HANDLING_STATUS.RESOLVED)
    .map((row) => ({
      id: row.id,
      title: row.title,
      canonicalSubject: row.canonicalSubject,
      canonicalLocation: row.canonicalLocation,
      eventType: row.eventType,
      category: row.category || "",
      riskLevel: asRisk(row.riskLevel),
      riskReason: row.riskReason || "",
      ticketCount: row.ticketCount,
      timeSpanHours: row.timeSpanHours || 1,
      firstOccurrence: row.firstAt ? row.firstAt.toISOString().slice(0, 19).replace("T", " ") : "",
      lastOccurrence: row.lastAt ? row.lastAt.toISOString().slice(0, 19).replace("T", " ") : "",
      aiSummary: row.aiSummary || "",
      recommendedAction: row.recommendedAction || "",
      handlingStatus: row.handlingStatus || HANDLING_STATUS.PENDING,
      status: "CONFIRMED",
      tickets: [],
      relatedSubjects: [row.canonicalSubject],
      relatedLocations: [row.canonicalLocation],
    }));

  updateTaskProgress(job.taskId, job.regionId, {
    stage: "EXTRACTING",
    stageText: `增量研判 ${rawTickets.length} 条新工单，已有 ${themeRows.length} 个聚类保持不动`,
    total: rawTickets.length,
    processed: 0,
    percent: 1,
  });

  if (rawTickets.length === 0) {
    return themeRows.length;
  }

  const extracted = await extractNode({
    rawTickets,
    regionId: job.regionId,
    taskId: job.taskId,
    status: "idle",
  } as TicketRadarState);
  const lowConfidence = extracted.lowConfidenceTickets || [];
  const aligned = await canonicalNode({
    ...extracted,
    rawTickets,
    regionId: job.regionId,
    taskId: job.taskId,
  } as TicketRadarState);
  const enriched = aligned.enrichedTickets || extracted.enrichedTickets || [];
  await embedIncoming(job.regionId, enriched, job.taskId);

  const vocab = await getRegionVocabulary(job.regionId);
  const themeVectors = await loadThemeMemberVectors(
    job.regionId,
    activeThemes.map((theme) => theme.id)
  );
  const attached = new Map<string, MultiFrequencyTheme>();
  const standalones: EnrichedTicket[] = [];

  updateTaskProgress(job.taskId, job.regionId, {
    stage: "CLUSTERING",
    stageText: `正在把 ${enriched.length} 条新工单并入已有聚类`,
    percent: stagePercent("CLUSTER", 0, Math.max(1, enriched.length), "min"),
  });

  for (let index = 0; index < enriched.length; index++) {
    const ticket = enriched[index];
    const decision = evaluateIncrementalTicket(ticket, activeThemes, {
      townships: vocab.townships,
      vocab,
      ticketVector: ticket.embedding && ticket.embedding.length === 1024 ? ticket.embedding : undefined,
      themeVectors,
    });
    if (decision.action === "ATTACHED" && decision.matchedTheme) {
      const theme = decision.needDeepThinkingUpgrade
        ? await upgradeThemeWithSystemTwo(decision.matchedTheme)
        : decision.matchedTheme;
      attached.set(theme.id, theme);
    } else {
      standalones.push(ticket);
    }
    if ((index + 1) % 20 === 0) await yieldToEventLoop();
  }

  let newThemes: MultiFrequencyTheme[] = [];
  let summarized = false;
  if (standalones.length >= 2) {
    const clustered = await clusterTicketSet(
      {
        enrichedTickets: standalones,
        regionId: job.regionId,
        taskId: job.taskId,
        status: "clustering",
      } as TicketRadarState,
      {
        serialStart,
        onlyTicketIds: standalones.map((ticket) => ticket.id),
      }
    );
    newThemes = clustered.themes || [];
    const kept = new Set(newThemes.map((theme) => theme.id));
    for (const ticket of standalones) {
      if (!ticket.clusterId || !kept.has(ticket.clusterId)) {
        ticket.clusterId = undefined;
        ticket.primaryThemeId = undefined;
      }
    }
    if (newThemes.length > 0) {
      const synthesized = await summaryNode({
        themes: newThemes,
        rawTickets: standalones,
        regionId: job.regionId,
        taskId: job.taskId,
        status: "clustering",
      } as unknown as TicketRadarState);
      newThemes = synthesized.themes || newThemes;
      summarized = true;
    }
  } else {
    for (const ticket of standalones) {
      ticket.clusterId = undefined;
      ticket.primaryThemeId = undefined;
    }
  }

  await persistIncrementalResult({
    tickets: enriched,
    attachedThemes: [...attached.values()],
    newThemes,
    regionId: job.regionId,
  });
  if (!summarized) {
    await fillThemesMissingAdvice(job.regionId, job.taskId);
  }
  if (lowConfidence.length > 0) {
    await seedReviewQueue(lowConfidence, job.regionId);
  }

  const [countRow] = await tenantDb
    .select({ themes: drizzleSql<number>`count(*)::int` })
    .from(themesTable);
  const themeCount = Number(countRow?.themes || 0);
  const leftAlone = enriched.filter((ticket) => !ticket.clusterId).length;
  console.log(
    `[cluster-job] ${job.taskId} 增量完成：新工单 ${enriched.length}，并入 ${attached.size} 个已有聚类，新建 ${newThemes.length}，落单 ${leftAlone}，当前聚类 ${themeCount}`
  );
  return themeCount;
}
