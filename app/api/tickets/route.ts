import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql, inArray, eq } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";
import { desensitizeContent } from "@/backend/anonymizer";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { ingestSingleTicketPipeline } from "@/backend/agent";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { CATEGORY } from "@/lib/vocabulary";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const dbRows = await tenantDb.select().from(ticketsTable).limit(500);
    if (dbRows && dbRows.length > 0) {
      const tickets: RawTicket[] = dbRows.map((r) => ({
        id: r.id,
        ticketNo: r.ticketNo,
        title: r.title || undefined,
        summarizeTitle: r.summarizeTitle || undefined,
        createTime: r.createTime ? r.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00",
        citizenPhone: r.citizenPhone || "",
        content: r.content,
        citizenName: r.citizenName || "市民*",
        district: r.district || undefined,
        subdistrict: r.subdistrict || undefined,
        channel: r.channel || "市民服务热线",
        status: (r.status as any) || "PENDING",
      }));

      return NextResponse.json({
        success: true,
        source: "postgresql",
        total: tickets.length,
        data: tickets,
      });
    }
  } catch (e: any) {
    console.error("[tickets/route] GET error:", e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to fetch tickets" },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    source: "postgresql",
    total: 0,
    data: [],
  });
}

export async function POST(req: Request) {
  const startTime = Date.now();
  try {
    const body = await req.json();
    const newTickets = Array.isArray(body) ? body : [body];

    const validRecords: any[] = [];
    let failedCount = 0;

    for (let i = 0; i < newTickets.length; i++) {
      const t = newTickets[i];
      const content = (t.content || t.title || "").trim();
      if (!content) {
        failedCount++;
        continue;
      }

      validRecords.push({
        id: t.id || `tk-${Date.now()}-${i}`,
        ticketNo: t.ticketNo || `GD-${Date.now()}-${i}`,
        title: t.title || "市民诉求",
        content,
        maskedContent: desensitizeContent(content),
        citizenName: t.citizenName || "市民*",
        citizenPhone: t.citizenPhone || "138****0000",
        district: t.district || null,
        subdistrict: t.subdistrict || null,
        channel: t.channel || "市民服务热线",
        status: t.status || "PENDING",
        createTime: t.createTime ? new Date(t.createTime) : new Date(),
      });
    }

    let insertedCount = 0;
    let duplicateCount = 0;

    try {
      const regionId = await resolveRequestRegionId(req);
      const { db: tenantDb } = await getRegionDb(regionId);

      if (validRecords.length > 0) {
        // Collect ticket numbers to check duplicates
        const ticketNos = validRecords.map((r) => r.ticketNo);
        const existingRows = await tenantDb
          .select({ ticketNo: ticketsTable.ticketNo })
          .from(ticketsTable)
          .where(inArray(ticketsTable.ticketNo, ticketNos.slice(0, 1000)));

        const existingSet = new Set(existingRows.map((r) => r.ticketNo));
        duplicateCount = existingSet.size;

        const recordsToInsert = validRecords.filter((r) => !existingSet.has(r.ticketNo));

        if (recordsToInsert.length > 0) {
          // Batch insert newly unique tickets
          await tenantDb
            .insert(ticketsTable)
            .values(recordsToInsert)
            .onConflictDoNothing({ target: ticketsTable.ticketNo });

          insertedCount = recordsToInsert.length;

          // 若为单条新工单接入，后台异步触发增量时空吸附与研判，实现“入库即智能吸附”
          if (recordsToInsert.length === 1) {
            const singleRec = recordsToInsert[0];
            (async () => {
              try {
                const activeRows = (await tenantDb.select().from(themesTable)).filter(
                  (row) => normalizeStatusCode(row.handlingStatus) !== HANDLING_STATUS.RESOLVED
                );

                const activeThemes: any[] = activeRows.map((r: any) => ({
                  id: r.id,
                  title: r.title,
                  canonicalSubject: r.canonicalSubject,
                  canonicalLocation: r.canonicalLocation,
                  eventType: r.eventType,
                  category: r.category || CATEGORY.URBAN_MANAGEMENT,
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

                const { enrichedTicket, result: incResult } = await ingestSingleTicketPipeline(
                  {
                    ...singleRec,
                    createTime: singleRec.createTime instanceof Date ? singleRec.createTime.toISOString().slice(0, 19).replace("T", " ") : String(singleRec.createTime),
                  },
                  activeThemes,
                  regionId
                );

                if (incResult.action === "ATTACHED" && incResult.matchedThemeId) {
                  await tenantDb
                    .update(ticketsTable)
                    .set({
                      primaryThemeId: incResult.matchedThemeId,
                      summarizeTitle: enrichedTicket.summarizeTitle,
                      address: enrichedTicket.canonicalLocation,
                      sourceCategory: enrichedTicket.sourceCategory,
                      confidence: enrichedTicket.confidence,
                      canonicalSubject: enrichedTicket.canonicalSubject,
                      eventType: enrichedTicket.eventType,
                      urgency: enrichedTicket.urgency,
                      slaHours: enrichedTicket.slaHours,
                      stabilityRisk: enrichedTicket.stabilityRisk,
                      subdistrict: enrichedTicket.subdistrict,
                    })
                    .where(eq(ticketsTable.id, singleRec.id));

                  await tenantDb
                    .update(themesTable)
                    .set({
                      ticketCount: incResult.matchedTheme?.ticketCount || sql`${themesTable.ticketCount} + 1`,
                      lastAt: new Date(),
                      riskLevel: incResult.matchedTheme?.riskLevel,
                      riskReason: incResult.matchedTheme?.riskReason,
                      aiSummary: incResult.matchedTheme?.aiSummary,
                      recommendedAction: incResult.matchedTheme?.recommendedAction,
                    })
                    .where(eq(themesTable.id, incResult.matchedThemeId));
                }
              } catch (asyncErr: any) {
                console.warn("[tickets/route] Incremental ingestion background task warning:", asyncErr.message);
              }
            })().catch(() => {});
          }
        }
      }
    } catch (dbErr: any) {
      console.error("[tickets/route] DB insert error:", dbErr.message);
      return NextResponse.json(
        { success: false, error: `工单写入数据库失败: ${dbErr.message}` },
        { status: 500 }
      );
    }

    const durationMs = Date.now() - startTime;

    return NextResponse.json({
      success: true,
      message: `处理完成: 成功入库 ${insertedCount} 条，重复过滤 ${duplicateCount} 条，异常格式 ${failedCount} 条`,
      data: {
        totalParsed: newTickets.length,
        insertedCount,
        duplicateCount,
        failedCount,
        durationMs,
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Invalid ticket payload" },
      { status: 400 }
    );
  }
}
