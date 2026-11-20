import { NextRequest, NextResponse } from "next/server";
import { getRegionDb, type DB } from "@/db/client";
import { aliasesTable, themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { and, eq, or, sql } from "drizzle-orm";
import { mapTicketStatus, toWorkorderDto } from "@/lib/civic-dto";
import { MODE_META, civicModeFromPattern } from "@/backend/theme-metrics";
import type { CivicMode, PatternType } from "@/backend/state";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { listDisposalLogs, recordDisposalLog, resolveOperatorName } from "@/lib/disposal";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";

type WorkorderPatchBody = {
  action?: string;
  status?: string;
  note?: string;
  correction?: {
    subdistrict?: string;
    sourceCategory?: string;
    canonicalSubject?: string;
    address?: string;
    eventType?: string;
    urgency?: string;
  };
  saveAlias?: {
    alias?: string;
    canonical?: string;
    type?: string;
  };
};

async function loadWorkorderDetailPayload(tenantDb: DB, regionId: string, key: string) {
  const rows = await tenantDb
    .select()
    .from(ticketsTable)
    .where(or(eq(ticketsTable.id, key), eq(ticketsTable.ticketNo, key)))
    .limit(1);
  const row = rows[0];
  if (!row) return null;

  let cluster_info = null;
  if (row.primaryThemeId) {
    const themes = await tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        civicMode: themesTable.civicMode,
        patternType: themesTable.patternType,
        aiConfidence: themesTable.aiConfidence,
      })
      .from(themesTable)
      .where(eq(themesTable.id, row.primaryThemeId))
      .limit(1);
    const th = themes[0];
    if (th) {
      const mode = (th.civicMode as CivicMode) || civicModeFromPattern(th.patternType as PatternType);
      cluster_info = {
        id: th.id,
        title: th.title,
        mode_name: MODE_META[mode].name,
        ai_confidence: th.aiConfidence,
      };
    }
  }

  const disposalLogs = await listDisposalLogs(regionId, "TICKET", row.id);

  return {
    success: true as const,
    ...toWorkorderDto(row),
    content: row.content,
    subdistrict: row.subdistrict || "",
    district: row.district || "",
    sourceCategory: row.sourceCategory || "",
    closedAt: row.closedAt ? row.closedAt.toISOString() : null,
    closureStatus: row.closureStatus || null,
    isFakeClosure: Boolean(row.isFakeClosure),
    cluster_info,
    disposalLogs,
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const payload = await loadWorkorderDetailPayload(tenantDb, regionId, id);
    if (!payload) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    return NextResponse.json(payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch workorder";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const rows = await tenantDb
      .select()
      .from(ticketsTable)
      .where(or(eq(ticketsTable.id, id), eq(ticketsTable.ticketNo, id)))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    const body = (await req.json().catch(() => null)) as WorkorderPatchBody | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ success: false, error: "action is required" }, { status: 400 });
    }

    const action = body.action.trim().toUpperCase();
    if (action !== "UPDATE_STATUS" && action !== "CORRECT_ENTITY" && action !== "DETACH_THEME") {
      return NextResponse.json({ success: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const operator = await resolveOperatorName(req);
    const fromStatus = mapTicketStatus(row.status);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const now = new Date();

    if (action === "UPDATE_STATUS") {
      const nextStatus = typeof body.status === "string" ? body.status.trim().toUpperCase() : "";
      if (nextStatus !== "PENDING" && nextStatus !== "IN_PROGRESS" && nextStatus !== "RESOLVED") {
        return NextResponse.json(
          { success: false, error: "status must be PENDING, IN_PROGRESS, or RESOLVED" },
          { status: 400 }
        );
      }

      const updateFields: Record<string, unknown> = {
        status: nextStatus,
        updatedAt: now,
      };
      if (nextStatus === "RESOLVED") {
        updateFields.closedAt = now;
        updateFields.closureStatus = "RESOLVED";
      } else if (fromStatus === "RESOLVED") {
        updateFields.closureStatus = "REOPENED";
      }

      await tenantDb
        .update(ticketsTable)
        .set(updateFields)
        .where(eq(ticketsTable.id, row.id));

      const logAction =
        nextStatus === "RESOLVED"
          ? "RESOLVE"
          : fromStatus === "RESOLVED"
            ? "REOPEN"
            : "UPDATE_STATUS";

      await recordDisposalLog({
        regionId,
        targetType: "TICKET",
        targetId: row.id,
        action: logAction,
        fromStatus,
        toStatus: nextStatus,
        operator,
        note:
          note ||
          (nextStatus === "RESOLVED"
            ? "单工单已办结"
            : fromStatus === "RESOLVED"
              ? "已办结工单重开流转"
              : `工单状态变更为 ${nextStatus}`),
      });
    } else if (action === "CORRECT_ENTITY") {
      const corr = body.correction;
      const patch: Record<string, unknown> = {};
      if (corr && typeof corr === "object") {
        if (typeof corr.subdistrict === "string") {
          patch.subdistrict = corr.subdistrict.trim().slice(0, 64) || null;
        }
        if (typeof corr.sourceCategory === "string") {
          patch.sourceCategory = corr.sourceCategory.trim().slice(0, 64) || null;
        }
        if (typeof corr.canonicalSubject === "string") {
          patch.canonicalSubject = corr.canonicalSubject.trim().slice(0, 255) || null;
        }
        if (typeof corr.address === "string") {
          patch.address = corr.address.trim().slice(0, 255) || null;
        }
        if (typeof corr.eventType === "string") {
          patch.eventType = corr.eventType.trim().slice(0, 128) || null;
        }
        if (typeof corr.urgency === "string" && corr.urgency.trim()) {
          const u = corr.urgency.trim().toUpperCase();
          if (u === "NORMAL" || u === "MEDIUM" || u === "URGENT") {
            patch.urgency = u;
          }
        }
      }

      if (Object.keys(patch).length > 0) {
        patch.updatedAt = now;
        await tenantDb
          .update(ticketsTable)
          .set(patch)
          .where(eq(ticketsTable.id, row.id));
      }

      let savedAlias: { alias: string; canonical: string; type: string } | null = null;
      const aliasRaw = typeof body.saveAlias?.alias === "string" ? body.saveAlias.alias.trim().slice(0, 128) : "";
      const canonicalRaw =
        typeof body.saveAlias?.canonical === "string" ? body.saveAlias.canonical.trim().slice(0, 128) : "";
      if (aliasRaw && canonicalRaw) {
        const typeRaw = typeof body.saveAlias?.type === "string" ? body.saveAlias.type.trim().toUpperCase() : "";
        const validTypes = new Set(["TOWNSHIP", "LOCATION", "SUBJECT", "DEPARTMENT", "ENTITY"]);
        const aliasType = validTypes.has(typeRaw)
          ? typeRaw
          : canonicalRaw.endsWith("街道") || canonicalRaw.endsWith("镇")
            ? "TOWNSHIP"
            : "SUBJECT";

        await tenantDb
          .insert(aliasesTable)
          .values({
            id: `ALIAS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            alias: aliasRaw,
            canonical: canonicalRaw,
            type: aliasType,
            source: "MANUAL",
            usageCount: 1,
            createdAt: now,
          })
          .onConflictDoUpdate({
            target: aliasesTable.alias,
            set: {
              canonical: canonicalRaw,
              type: aliasType,
              source: "MANUAL",
              usageCount: sql`${aliasesTable.usageCount} + 1`,
            },
          });

        savedAlias = { alias: aliasRaw, canonical: canonicalRaw, type: aliasType };
      }

      await recordDisposalLog({
        regionId,
        targetType: "TICKET",
        targetId: row.id,
        action: "CORRECT_ENTITY",
        fromStatus,
        toStatus: fromStatus,
        operator,
        note: note || "人工纠偏工单要素",
        meta: {
          correction: corr || null,
          saveAlias: savedAlias,
        },
      });
    } else if (action === "DETACH_THEME") {
      const linkRows = await tenantDb
        .select({ themeId: ticketThemesTable.themeId })
        .from(ticketThemesTable)
        .where(eq(ticketThemesTable.ticketId, row.id));
      const affectedThemeIds = Array.from(
        new Set([
          ...linkRows.map((l) => l.themeId),
          ...(row.primaryThemeId ? [row.primaryThemeId] : []),
        ])
      );

      await tenantDb
        .delete(ticketThemesTable)
        .where(eq(ticketThemesTable.ticketId, row.id));

      await tenantDb
        .update(ticketsTable)
        .set({ primaryThemeId: null, updatedAt: now })
        .where(eq(ticketsTable.id, row.id));

      for (const themeId of affectedThemeIds) {
        const [countRow] = await tenantDb
          .select({ count: sql<number>`count(*)::int` })
          .from(ticketThemesTable)
          .where(eq(ticketThemesTable.themeId, themeId));
        const remainingCount = Number(countRow?.count || 0);
        await tenantDb
          .update(themesTable)
          .set({ ticketCount: remainingCount })
          .where(eq(themesTable.id, themeId));

        await recordDisposalLog({
          regionId,
          targetType: "THEME",
          targetId: themeId,
          action: "DETACH_TICKET",
          fromStatus: null,
          toStatus: null,
          operator,
          note: note || `工单 ${row.ticketNo || row.id} 从群组移出`,
          meta: { ticketId: row.id, ticketNo: row.ticketNo, remainingCount },
        });
      }

      await recordDisposalLog({
        regionId,
        targetType: "TICKET",
        targetId: row.id,
        action: "DETACH_THEME",
        fromStatus,
        toStatus: fromStatus,
        operator,
        note: note || "已将工单移出当前多频群组",
        meta: { detachedThemeIds: affectedThemeIds },
      });
    }

    invalidateCivicAggregates(regionId);
    broadcastDataRefresh(regionId);

    const updatedPayload = await loadWorkorderDetailPayload(tenantDb, regionId, row.id);
    return NextResponse.json(updatedPayload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update workorder";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
