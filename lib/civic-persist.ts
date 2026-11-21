import { getRegionDb, type DB } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable } from "@/db/schema";
import { sql as drizzleSql } from "drizzle-orm";
import { adminFromLocation } from "@/lib/admin-area";
import { civicModeFromPattern } from "@/backend/theme-metrics";
import { HANDLING_STATUS } from "@/lib/civic-dto";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { recordDisposalLog } from "@/lib/disposal";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";
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
  isFakeClosure?: boolean;
  closureStatus?: string | null;
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
    ...(ticket.isFakeClosure ? { isFakeClosure: true, closureStatus: ticket.closureStatus || ("REOPENED" as const) } : {}),
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
    ticketCount: Number.isFinite(theme.ticketCount) ? Math.round(theme.ticketCount) : 0,
    timeSpanHours: Number.isFinite(theme.timeSpanHours) ? Math.round(theme.timeSpanHours) : 0,
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

function toIsoOrNull(d?: Date | null): string | null {
  return d instanceof Date && !Number.isNaN(d.getTime()) ? d.toISOString() : null;
}

function toIntOrNull(n?: number | null): number | null {
  return typeof n === "number" && Number.isFinite(n) ? Math.round(n) : null;
}

async function bulkUpdateTicketPrimaryThemes(tenantDb: DB, themes: MultiFrequencyTheme[]): Promise<void> {
  const deduped = new Map<string, { id: string; themeId: string; setFakeClosure: boolean }>();
  for (const theme of themes) {
    for (const t of theme.tickets || []) {
      if (!t.id) continue;
      deduped.set(t.id, {
        id: t.id,
        themeId: theme.id,
        setFakeClosure: Boolean(t.isFakeClosure),
      });
    }
  }
  const updates = Array.from(deduped.values());
  if (updates.length === 0) return;

  const CHUNK = 500;
  for (let i = 0; i < updates.length; i += CHUNK) {
    const chunk = updates.slice(i, i + CHUNK);
    const valuesSql = drizzleSql.join(
      chunk.map(
        (u) => drizzleSql`(${u.id}::varchar, ${u.themeId}::varchar, ${u.setFakeClosure}::boolean)`
      ),
      drizzleSql`, `
    );
    await tenantDb.execute(drizzleSql`
      UPDATE tickets AS t
      SET
        primary_theme_id = v.primary_theme_id,
        is_fake_closure = CASE WHEN v.set_fake_closure THEN true ELSE t.is_fake_closure END,
        closure_status = CASE WHEN v.set_fake_closure THEN 'REOPENED' ELSE t.closure_status END
      FROM (VALUES ${valuesSql}) AS v(id, primary_theme_id, set_fake_closure)
      WHERE t.id = v.id
    `);
  }
}

export async function persistTicketAnalysis(
  tickets: EnrichedTicket[],
  opts?: { themeId?: string | null; regionId?: string }
) {
  if (tickets.length === 0) return;
  const dedupedMap = new Map<string, { id: string; patch: TicketAgentPatch }>();
  for (const t of tickets) {
    if (!t.id) continue;
    dedupedMap.set(t.id, { id: t.id, patch: buildTicketAgentPatch(t, opts) });
  }
  const rows = Array.from(dedupedMap.values());
  if (rows.length === 0) return;

  const { db: tenantDb } = await getRegionDb(opts?.regionId);
  const CHUNK = 250;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const valuesSql = drizzleSql.join(
      chunk.map(({ id, patch: p }) =>
        drizzleSql`(${id}::varchar, ${p.district}::varchar, ${p.subdistrict}::varchar, ${p.sourceCategory}::varchar, ${p.address}::varchar, ${toIntOrNull(p.confidence)}::integer, ${p.summarizeTitle}::text, ${p.primaryThemeId}::varchar, ${p.urgency}::varchar, ${toIntOrNull(p.slaHours)}::integer, ${p.stabilityRisk ?? null}::boolean, ${p.canonicalSubject}::varchar, ${p.eventType}::varchar, ${Boolean(p.isFakeClosure)}::boolean, ${p.isFakeClosure ?? null}::boolean, ${p.closureStatus ?? null}::varchar, ${toIsoOrNull(p.createTime)}::timestamptz)`
      ),
      drizzleSql`, `
    );
    await tenantDb.execute(drizzleSql`
      UPDATE tickets AS t
      SET
        district = v.district,
        subdistrict = v.subdistrict,
        source_category = v.source_category,
        address = v.address,
        confidence = v.confidence,
        summarize_title = v.summarize_title,
        primary_theme_id = v.primary_theme_id,
        urgency = v.urgency,
        sla_hours = v.sla_hours,
        stability_risk = v.stability_risk,
        canonical_subject = v.canonical_subject,
        event_type = v.event_type,
        is_fake_closure = CASE WHEN v.set_fake_closure THEN v.is_fake_closure ELSE t.is_fake_closure END,
        closure_status = CASE WHEN v.set_fake_closure THEN v.closure_status ELSE t.closure_status END,
        create_time = COALESCE(v.create_time, t.create_time)
      FROM (VALUES ${valuesSql}) AS v(
        id, district, subdistrict, source_category, address, confidence,
        summarize_title, primary_theme_id, urgency, sla_hours, stability_risk,
        canonical_subject, event_type, set_fake_closure, is_fake_closure, closure_status, create_time
      )
      WHERE t.id = v.id
    `);
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
    const THEME_CHUNK = 200;
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

    await bulkUpdateTicketPrimaryThemes(tenantDb, themes);
  }
  invalidateCivicAggregates(regionId);
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
  const THEME_CHUNK = 200;
  for (let i = 0; i < newRecords.length; i += THEME_CHUNK) {
    await tenantDb
      .insert(themesTable)
      .values(newRecords.slice(i, i + THEME_CHUNK))
      .onConflictDoNothing({ target: themesTable.id });
  }

  if (attachedThemes.length > 0) {
    const dedupedAttachedMap = new Map<string, MultiFrequencyTheme>();
    for (const theme of attachedThemes) {
      if (!theme.id) continue;
      dedupedAttachedMap.set(theme.id, theme);
    }
    const dedupedAttached = Array.from(dedupedAttachedMap.values());
    const ATTACH_CHUNK = 200;
    for (let i = 0; i < dedupedAttached.length; i += ATTACH_CHUNK) {
      const chunk = dedupedAttached.slice(i, i + ATTACH_CHUNK);
      const valuesSql = drizzleSql.join(
        chunk.map((theme) => {
          const ticketCount = Number.isFinite(theme.ticketCount) ? Math.round(theme.ticketCount) : 0;
          const timeSpanHours = Number.isFinite(theme.timeSpanHours) ? Math.round(theme.timeSpanHours) : 0;
          return drizzleSql`(${clip(theme.id, 64)}::varchar, ${ticketCount}::integer, ${timeSpanHours}::integer, ${toIsoOrNull(parseThemeDate(theme.firstOccurrence))}::timestamptz, ${toIsoOrNull(parseThemeDate(theme.lastOccurrence))}::timestamptz, ${clip(theme.riskLevel, 32) || "LOW"}::varchar, ${theme.riskReason || null}::text, ${theme.aiSummary || null}::text, ${theme.recommendedAction || null}::text, ${theme.handlingStatus ? clip(theme.handlingStatus, 16) : null}::varchar, ${toIntOrNull(theme.handlingProgress)}::integer)`;
        }),
        drizzleSql`, `
      );
      await tenantDb.execute(drizzleSql`
        UPDATE themes AS th
        SET
          ticket_count = v.ticket_count,
          time_span_hours = v.time_span_hours,
          first_at = v.first_at,
          last_at = v.last_at,
          risk_level = v.risk_level,
          risk_reason = v.risk_reason,
          ai_summary = v.ai_summary,
          recommended_action = v.recommended_action,
          handling_status = COALESCE(v.handling_status, th.handling_status),
          handling_progress = COALESCE(v.handling_progress, th.handling_progress)
        FROM (VALUES ${valuesSql}) AS v(
          id, ticket_count, time_span_hours, first_at, last_at,
          risk_level, risk_reason, ai_summary, recommended_action,
          handling_status, handling_progress
        )
        WHERE th.id = v.id
      `);
    }
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

  await bulkUpdateTicketPrimaryThemes(tenantDb, newThemes);

  for (const theme of attachedThemes) {
    if ((theme.reopenCount || 0) > 0 && (theme.reopenTicketIds?.length || 0) > 0) {
      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: theme.id,
        action: "REOPEN",
        fromStatus: "RESOLVED",
        toStatus: theme.handlingStatus || "IN_PROGRESS",
        owner: theme.handlingOwner || null,
        operator: "system",
        note: `假闭环复发重开：新增 ${theme.reopenTicketIds!.length} 条疑似假闭环工单，主题自动回弹处理中并升级高危`,
        meta: { ticketIds: theme.reopenTicketIds },
      }).catch(() => {});
    }
  }

  invalidateCivicAggregates(regionId);
  broadcastDataRefresh(regionId);
}
