import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { adminFromLocation } from "@/lib/admin-area";
import { civicModeFromPattern } from "@/backend/theme-metrics";
import { HANDLING_STATUS } from "@/lib/civic-dto";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import type { EnrichedTicket, MultiFrequencyTheme } from "@/backend/state";
import { workOrderInstantFromTicketNo } from "@/lib/work-order-date";

export type TicketAgentPatch = {
  district: string | null;
  subdistrict: string | null;
  sourceCategory: string | null;
  address: string | null;
  confidence: number | null;
  summarizeTitle: string | null;
  primaryThemeId: string | null;
  urgency: string | null;
  slaHours: number | null;
  stabilityRisk: boolean | null;
  canonicalSubject: string | null;
  eventType: string | null;
  createTime?: Date;
};

export type ThemePersistRow = {
  id: string;
  title: string;
  canonicalSubject: string;
  canonicalLocation: string;
  eventType: string;
  category: string;
  riskLevel: string;
  riskReason: string | null;
  ticketCount: number;
  timeSpanHours: number;
  aiSummary: string | null;
  recommendedAction: string | null;
  patternType: string | null;
  civicMode: string | null;
  aiConfidence: number | null;
  firstAt: Date | null;
  lastAt: Date | null;
  handlingStatus: string;
  handlingProgress: number;
  handlingOwner: string | null;
  featuresJson: string | null;
  radarJson: string | null;
  trendPct: number | null;
};

/** Ingest never writes these. Extract/cluster persist is the only writer. */
export const AGENT_TICKET_NULLS: TicketAgentPatch = {
  district: null,
  subdistrict: null,
  sourceCategory: null,
  address: null,
  confidence: null,
  summarizeTitle: null,
  primaryThemeId: null,
  urgency: null,
  slaHours: null,
  stabilityRisk: null,
  canonicalSubject: null,
  eventType: null,
};

function parseThemeDate(value?: string | null): Date | null {
  if (!value) return null;
  const d = new Date(value.replace(" ", "T"));
  return Number.isNaN(d.getTime()) ? null : d;
}

export function buildTicketAgentPatch(
  ticket: EnrichedTicket,
  opts?: { themeId?: string | null }
): TicketAgentPatch {
  const area = adminFromLocation(ticket.canonicalLocation, ticket);
  const themeId = opts?.themeId === undefined ? ticket.clusterId || ticket.primaryThemeId || null : opts.themeId;
  const createTime = workOrderInstantFromTicketNo(ticket.ticketNo);
  return {
    district: area.district,
    subdistrict: ticket.subdistrict || null,
    sourceCategory: ticket.themes?.[0] || ticket.sourceCategory || null,
    address: clipOrNull(ticket.canonicalLocation || ticket.address, 255),
    confidence: typeof ticket.confidence === "number" ? ticket.confidence : null,
    summarizeTitle: ticket.summarizeTitle || null,
    primaryThemeId: themeId,
    urgency: ticket.urgency || null,
    slaHours: typeof ticket.systemOneSlaHours === "number" ? ticket.systemOneSlaHours : ticket.slaHours ?? null,
    stabilityRisk: typeof ticket.systemOneStabilityRisk === "boolean" ? ticket.systemOneStabilityRisk : ticket.stabilityRisk ?? null,
    canonicalSubject: clipOrNull(ticket.canonicalSubject, 255),
    eventType: clipOrNull(ticket.eventType, 128),
    ...(createTime ? { createTime } : {}),
  };
}

function clipOrNull(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.length <= max ? text : text.slice(0, max);
}

function clip(value: string | null | undefined, max: number): string {
  const s = (value ?? "").trim();
  if (s.length <= max) return s;
  return s.slice(0, max);
}

export function buildThemePersistRow(theme: MultiFrequencyTheme): ThemePersistRow {
  return {
    id: clip(theme.id, 64),
    title: clip(theme.title, 255) || "未命名主题",
    canonicalSubject: clip(theme.canonicalSubject, 255) || "相关主体",
    canonicalLocation: clip(theme.canonicalLocation, 255) || "本地辖区",
    eventType: clip(theme.eventType, 128) || "民生诉求",
    category: clip(theme.category, 64),
    riskLevel: clip(theme.riskLevel, 32) || "LOW",
    riskReason: theme.riskReason || null,
    ticketCount: theme.ticketCount,
    timeSpanHours: theme.timeSpanHours,
    aiSummary: theme.aiSummary || null,
    recommendedAction: theme.recommendedAction || null,
    patternType: theme.patternType ? clip(theme.patternType, 32) : null,
    civicMode: clip(theme.civicMode || civicModeFromPattern(theme.patternType) || null, 16) || null,
    aiConfidence: theme.aiConfidence ?? null,
    firstAt: parseThemeDate(theme.firstOccurrence),
    lastAt: parseThemeDate(theme.lastOccurrence),
    handlingStatus: clip(theme.handlingStatus, 16) || HANDLING_STATUS.PENDING,
    handlingProgress: theme.handlingProgress ?? 0,
    handlingOwner: theme.handlingOwner ? clip(theme.handlingOwner, 64) : null,
    featuresJson: theme.features ? JSON.stringify(theme.features) : null,
    radarJson: theme.radar ? JSON.stringify(theme.radar) : null,
    trendPct: theme.trendPct ?? null,
  };
}

export async function persistTicketAnalysis(
  tickets: EnrichedTicket[],
  opts?: { themeId?: string | null; regionId?: string }
) {
  if (tickets.length === 0) return;
  const { db: tenantDb } = await getRegionDb(opts?.regionId);
  const CHUNK = 40;
  for (let i = 0; i < tickets.length; i += CHUNK) {
    const chunk = tickets.slice(i, i + CHUNK);
    await Promise.all(
      chunk.map((t) =>
        tenantDb
          .update(ticketsTable)
          .set(buildTicketAgentPatch(t, opts))
          .where(eq(ticketsTable.id, t.id))
      )
    );
  }
}

export async function persistClusterResult(input: {
  tickets: EnrichedTicket[];
  themes: MultiFrequencyTheme[];
  /** 保留参数，不再使用。主题表和关联表都不删除。 */
  replaceThemes?: boolean;
  regionId?: string;
}) {
  const { tickets, themes, regionId } = input;
  const { db: tenantDb } = await getRegionDb(regionId);

  await persistTicketAnalysis(tickets, { themeId: null, regionId });

  const themeRecords = themes.map(buildThemePersistRow);
  if (themeRecords.length > 0) {
    const THEME_CHUNK = 40;
    for (let i = 0; i < themeRecords.length; i += THEME_CHUNK) {
      await tenantDb
        .insert(themesTable)
        .values(themeRecords.slice(i, i + THEME_CHUNK))
        .onConflictDoNothing({ target: themesTable.id });
    }

    const ticketThemeMappings: Array<{ ticketId: string; themeId: string }> = [];
    for (const theme of themes) {
      for (const t of theme.tickets || []) {
        ticketThemeMappings.push({ ticketId: t.id, themeId: theme.id });
      }
    }
    for (let i = 0; i < ticketThemeMappings.length; i += 500) {
      await tenantDb.insert(ticketThemesTable).values(ticketThemeMappings.slice(i, i + 500)).onConflictDoNothing();
    }

    for (const theme of themes) {
      for (const t of theme.tickets || []) {
        await tenantDb
          .update(ticketsTable)
          .set({
            primaryThemeId: theme.id,
            ...(t.isFakeClosure ? { isFakeClosure: true, closureStatus: "REOPENED" as const } : {}),
          })
          .where(eq(ticketsTable.id, t.id));
      }
    }
  }
  invalidateCivicAggregates();
}

/**
 * 增量写入。只更新这一批工单，并入的旧主题，以及新开的主题。
 * 不删除 themes，也不删除 ticket_themes。
 */
export async function persistIncrementalResult(input: {
  tickets: EnrichedTicket[];
  attachedThemes: MultiFrequencyTheme[];
  newThemes: MultiFrequencyTheme[];
  regionId: string;
}) {
  const { tickets, attachedThemes, newThemes, regionId } = input;
  const { db: tenantDb } = await getRegionDb(regionId);

  const newRecords = newThemes.map(buildThemePersistRow);
  const THEME_CHUNK = 40;
  for (let i = 0; i < newRecords.length; i += THEME_CHUNK) {
    await tenantDb
      .insert(themesTable)
      .values(newRecords.slice(i, i + THEME_CHUNK))
      .onConflictDoNothing({ target: themesTable.id });
  }

  for (let i = 0; i < attachedThemes.length; i += THEME_CHUNK) {
    const chunk = attachedThemes.slice(i, i + THEME_CHUNK);
    await Promise.all(
      chunk.map((theme) =>
        tenantDb
          .update(themesTable)
          .set({
            ticketCount: theme.ticketCount,
            timeSpanHours: theme.timeSpanHours,
            firstAt: parseThemeDate(theme.firstOccurrence),
            lastAt: parseThemeDate(theme.lastOccurrence),
            riskLevel: theme.riskLevel,
            riskReason: theme.riskReason || null,
            aiSummary: theme.aiSummary || null,
            recommendedAction: theme.recommendedAction || null,
          })
          .where(eq(themesTable.id, theme.id))
      )
    );
  }

  await persistTicketAnalysis(tickets, { regionId });

  const links: Array<{ ticketId: string; themeId: string }> = [];
  for (const theme of [...attachedThemes, ...newThemes]) {
    for (const ticket of theme.tickets || []) {
      links.push({ ticketId: ticket.id, themeId: theme.id });
    }
  }
  for (let i = 0; i < links.length; i += 500) {
    await tenantDb
      .insert(ticketThemesTable)
      .values(links.slice(i, i + 500))
      .onConflictDoNothing();
  }

  for (const theme of newThemes) {
    for (const ticket of theme.tickets || []) {
      if (!ticket.isFakeClosure) continue;
      await tenantDb
        .update(ticketsTable)
        .set({ isFakeClosure: true, closureStatus: "REOPENED" })
        .where(eq(ticketsTable.id, ticket.id));
    }
  }

  invalidateCivicAggregates();
}
