import { NextResponse } from "next/server";
import { getRegionDb, type DB } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { and, eq, inArray, or, sql } from "drizzle-orm";
import { normalizeStatusCode, regionLabel, toClusterDto } from "@/lib/civic-dto";
import { clusterRegionLabel } from "@/lib/civic-queries";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { listDisposalLogs, recordDisposalLog, resolveOperatorName } from "@/lib/disposal";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";

type ClusterPatchBody = {
  action?: string;
  step?: number;
  owner?: string;
  eta?: string;
  note?: string;
  ticketId?: string;
  syncMembers?: boolean;
};

function extractDefaultOwner(recommendedAction?: string | null): string {
  const text = (recommendedAction || "").trim();
  if (text) {
    const match = text.match(/牵头部门\s*[:：]\s*([^\n；;。，,]+)/);
    if (match?.[1]) {
      const candidate = match[1].trim().slice(0, 64);
      if (candidate) return candidate;
    }
  }
  return "热线协同督办组";
}

function parseEtaDate(eta: string | undefined, fallbackDays: number): Date {
  if (eta && eta.trim()) {
    const d = new Date(eta.trim());
    if (!Number.isNaN(d.getTime())) return d;
  }
  return new Date(Date.now() + fallbackDays * 24 * 60 * 60 * 1000);
}

async function getThemeMemberTicketIds(db: DB, themeId: string): Promise<string[]> {
  const [ttRows, primaryRows] = await Promise.all([
    db
      .select({ ticketId: ticketThemesTable.ticketId })
      .from(ticketThemesTable)
      .where(eq(ticketThemesTable.themeId, themeId)),
    db
      .select({ id: ticketsTable.id })
      .from(ticketsTable)
      .where(eq(ticketsTable.primaryThemeId, themeId)),
  ]);
  return Array.from(new Set([...ttRows.map((r) => r.ticketId), ...primaryRows.map((r) => r.id)]));
}

async function loadClusterDetailPayload(regionId: string, id: string) {
  const { db } = await getRegionDb(regionId);
  const themes = await db.select().from(themesTable).where(eq(themesTable.id, id)).limit(1);
  const theme = themes[0];
  if (!theme) return null;

  const [townRows, fakeCountRows, disposalLogs] = await Promise.all([
    db
      .select({ subdistrict: ticketsTable.subdistrict })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .where(eq(ticketThemesTable.themeId, id))
      .groupBy(ticketsTable.subdistrict),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(ticketsTable)
      .where(
        and(
          eq(ticketsTable.isFakeClosure, true),
          or(
            eq(ticketsTable.primaryThemeId, id),
            sql`exists (select 1 from ticket_themes tt where tt.theme_id = ${id} and tt.ticket_id = ${ticketsTable.id})`
          )
        )
      ),
    listDisposalLogs(regionId, "THEME", id),
  ]);

  const towns = new Set<string>();
  for (const row of townRows) {
    const town = regionLabel(row.subdistrict);
    if (town) towns.add(town);
  }

  const dto = toClusterDto({ ...theme, tickets: [], ticketCount: theme.ticketCount });
  dto.region = clusterRegionLabel(towns, theme.canonicalLocation);

  return {
    success: true as const,
    ...dto,
    riskLevel: theme.riskLevel || "LOW",
    riskReason: theme.riskReason || "",
    fakeClosureCount: Number(fakeCountRows[0]?.count || 0),
    disposalLogs,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const payload = await loadClusterDetailPayload(regionId, id);
    if (!payload) {
      return NextResponse.json({ success: false, error: "not found" }, { status: 404 });
    }
    return NextResponse.json(payload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to fetch cluster";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db } = await getRegionDb(regionId);

    const themes = await db.select().from(themesTable).where(eq(themesTable.id, id)).limit(1);
    const theme = themes[0];
    if (!theme) {
      return NextResponse.json({ success: false, error: "not found" }, { status: 404 });
    }

    const body = (await req.json().catch(() => null)) as ClusterPatchBody | null;
    if (!body || typeof body.action !== "string") {
      return NextResponse.json({ success: false, error: "action is required" }, { status: 400 });
    }

    const action = body.action.trim().toUpperCase();
    const validActions = new Set([
      "DISPATCH",
      "ADVANCE",
      "ESCALATE",
      "RESOLVE",
      "REOPEN",
      "DETACH_TICKET",
    ]);
    if (!validActions.has(action)) {
      return NextResponse.json({ success: false, error: `Unsupported action: ${action}` }, { status: 400 });
    }

    const operator = await resolveOperatorName(req);
    const fromStatus = normalizeStatusCode(theme.handlingStatus);
    const note = typeof body.note === "string" ? body.note.trim() : "";
    const ownerInput = typeof body.owner === "string" ? body.owner.trim().slice(0, 64) : "";
    const now = new Date();

    const applyResolve = async (viaMeta?: Record<string, unknown>) => {
      const nextEta = body.eta ? parseEtaDate(body.eta, 0) : (theme.handlingEta ?? now);
      const nextOwner = ownerInput || theme.handlingOwner || null;
      await db
        .update(themesTable)
        .set({
          handlingStatus: "RESOLVED",
          handlingProgress: 100,
          handlingEta: nextEta,
          ...(nextOwner ? { handlingOwner: nextOwner } : {}),
        })
        .where(eq(themesTable.id, id));

      const memberIds = await getThemeMemberTicketIds(db, id);
      for (let i = 0; i < memberIds.length; i += 500) {
        const chunk = memberIds.slice(i, i + 500);
        await db
          .update(ticketsTable)
          .set({
            status: "RESOLVED",
            closedAt: now,
            closureStatus: "RESOLVED",
            updatedAt: now,
          })
          .where(inArray(ticketsTable.id, chunk));
      }

      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: id,
        action: "RESOLVE",
        fromStatus,
        toStatus: "RESOLVED",
        owner: nextOwner,
        operator,
        note: note || "群组诉求已办结归档",
        meta: { memberCount: memberIds.length, ...(viaMeta || {}) },
      });
    };

    if (action === "DISPATCH") {
      const nextOwner = ownerInput || theme.handlingOwner?.trim() || extractDefaultOwner(theme.recommendedAction);
      const nextEta = parseEtaDate(body.eta, 2);
      await db
        .update(themesTable)
        .set({
          handlingStatus: "IN_PROGRESS",
          handlingProgress: 40,
          handlingOwner: nextOwner,
          handlingEta: nextEta,
        })
        .where(eq(themesTable.id, id));

      let syncedCount = 0;
      if (body.syncMembers !== false) {
        const memberIds = await getThemeMemberTicketIds(db, id);
        for (let i = 0; i < memberIds.length; i += 500) {
          const chunk = memberIds.slice(i, i + 500);
          const updatedRows = await db
            .update(ticketsTable)
            .set({ status: "IN_PROGRESS", updatedAt: now })
            .where(
              and(
                inArray(ticketsTable.id, chunk),
                sql`(${ticketsTable.status} is null or upper(${ticketsTable.status}) = 'PENDING')`
              )
            )
            .returning({ id: ticketsTable.id });
          syncedCount += updatedRows.length;
        }
      }

      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: id,
        action: "DISPATCH",
        fromStatus,
        toStatus: "IN_PROGRESS",
        owner: nextOwner,
        operator,
        note: note || `已派单至 ${nextOwner}`,
        meta: {
          eta: nextEta.toISOString(),
          syncMembers: body.syncMembers !== false,
          syncedMembers: syncedCount,
        },
      });
    } else if (action === "ADVANCE") {
      const step = Number(body.step);
      if (!Number.isInteger(step) || step < 1 || step > 5) {
        return NextResponse.json({ success: false, error: "step must be 1..5" }, { status: 400 });
      }
      if (step === 5) {
        await applyResolve({ step: 5, via: "ADVANCE" });
      } else {
        const stepMap: Record<number, { status: "PENDING" | "IN_PROGRESS"; progress: number }> = {
          1: { status: "PENDING", progress: 20 },
          2: { status: "IN_PROGRESS", progress: 40 },
          3: { status: "IN_PROGRESS", progress: 60 },
          4: { status: "IN_PROGRESS", progress: 80 },
        };
        const target = stepMap[step];
        const nextOwner = ownerInput || theme.handlingOwner || null;
        await db
          .update(themesTable)
          .set({
            handlingStatus: target.status,
            handlingProgress: target.progress,
            ...(ownerInput ? { handlingOwner: ownerInput } : {}),
            ...(body.eta ? { handlingEta: parseEtaDate(body.eta, 2) } : {}),
          })
          .where(eq(themesTable.id, id));

        await recordDisposalLog({
          regionId,
          targetType: "THEME",
          targetId: id,
          action: "ADVANCE",
          fromStatus,
          toStatus: target.status,
          owner: nextOwner,
          operator,
          note: note || `推进处置进度至第 ${step} 阶段`,
          meta: { step, progress: target.progress },
        });
      }
    } else if (action === "RESOLVE") {
      await applyResolve();
    } else if (action === "ESCALATE") {
      const escalateNote = note || "管理员升级为高风险重点督办";
      const existingReason = (theme.riskReason || "").trim();
      const nextReason = existingReason
        ? existingReason.includes(escalateNote)
          ? existingReason
          : `${existingReason}；[升级督办] ${escalateNote}`
        : `[升级督办] ${escalateNote}`;

      await db
        .update(themesTable)
        .set({
          riskLevel: "HIGH",
          riskReason: nextReason,
          ...(ownerInput ? { handlingOwner: ownerInput } : {}),
        })
        .where(eq(themesTable.id, id));

      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: id,
        action: "ESCALATE",
        fromStatus,
        toStatus: fromStatus,
        owner: ownerInput || theme.handlingOwner || null,
        operator,
        note: escalateNote,
        meta: { fromRiskLevel: theme.riskLevel, toRiskLevel: "HIGH" },
      });
    } else if (action === "REOPEN") {
      await db
        .update(themesTable)
        .set({
          handlingStatus: "IN_PROGRESS",
          handlingProgress: 40,
          ...(ownerInput ? { handlingOwner: ownerInput } : {}),
        })
        .where(eq(themesTable.id, id));

      const memberIds = await getThemeMemberTicketIds(db, id);
      for (let i = 0; i < memberIds.length; i += 500) {
        const chunk = memberIds.slice(i, i + 500);
        await db
          .update(ticketsTable)
          .set({
            status: "IN_PROGRESS",
            closureStatus: "REOPENED",
            updatedAt: now,
          })
          .where(inArray(ticketsTable.id, chunk));
      }

      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: id,
        action: "REOPEN",
        fromStatus,
        toStatus: "IN_PROGRESS",
        owner: ownerInput || theme.handlingOwner || null,
        operator,
        note: note || "管理员重开督办处置",
        meta: { memberCount: memberIds.length },
      });
    } else if (action === "DETACH_TICKET") {
      const rawTicketId = typeof body.ticketId === "string" ? body.ticketId.trim() : "";
      if (!rawTicketId) {
        return NextResponse.json({ success: false, error: "ticketId is required" }, { status: 400 });
      }

      const ticketRows = await db
        .select({ id: ticketsTable.id, ticketNo: ticketsTable.ticketNo, primaryThemeId: ticketsTable.primaryThemeId })
        .from(ticketsTable)
        .where(or(eq(ticketsTable.id, rawTicketId), eq(ticketsTable.ticketNo, rawTicketId)))
        .limit(1);
      const targetTicket = ticketRows[0];
      const realTicketId = targetTicket?.id || rawTicketId;

      await db
        .delete(ticketThemesTable)
        .where(and(eq(ticketThemesTable.themeId, id), eq(ticketThemesTable.ticketId, realTicketId)));

      if (targetTicket && targetTicket.primaryThemeId === id) {
        await db
          .update(ticketsTable)
          .set({ primaryThemeId: null, updatedAt: now })
          .where(eq(ticketsTable.id, realTicketId));
      }

      const [countRow] = await db
        .select({ count: sql<number>`count(*)::int` })
        .from(ticketThemesTable)
        .where(eq(ticketThemesTable.themeId, id));
      const remainingCount = Number(countRow?.count || 0);

      await db
        .update(themesTable)
        .set({ ticketCount: remainingCount })
        .where(eq(themesTable.id, id));

      await recordDisposalLog({
        regionId,
        targetType: "THEME",
        targetId: id,
        action: "DETACH_TICKET",
        fromStatus,
        toStatus: fromStatus,
        owner: theme.handlingOwner || null,
        operator,
        note: note || `移出工单 ${targetTicket?.ticketNo || realTicketId}`,
        meta: {
          ticketId: realTicketId,
          ticketNo: targetTicket?.ticketNo || null,
          remainingCount,
        },
      });

      if (targetTicket) {
        await recordDisposalLog({
          regionId,
          targetType: "TICKET",
          targetId: realTicketId,
          action: "DETACH_THEME",
          fromStatus: null,
          toStatus: null,
          owner: theme.handlingOwner || null,
          operator,
          note: note || `已从专题群组 ${theme.title} (${id}) 移出`,
          meta: { themeId: id },
        });
      }
    }

    invalidateCivicAggregates(regionId);
    broadcastDataRefresh(regionId);

    const updatedPayload = await loadClusterDetailPayload(regionId, id);
    return NextResponse.json(updatedPayload);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "Failed to update cluster";
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
