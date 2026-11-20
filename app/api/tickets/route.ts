import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable, ticketThemesTable } from "@/db/schema";
import { and, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";
import { desensitizeContent } from "@/backend/anonymizer";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { ingestSingleTicketPipeline } from "@/backend/agent";
import { HANDLING_STATUS, regionLabel, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { CATEGORY } from "@/lib/vocabulary";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";
import { memberLastAt } from "@/backend/embed-policy";
import { loadThemeMemberVectors } from "@/lib/ticket-embeddings";
import { cacheGetOrLoad, invalidateCivicAggregates } from "@/lib/civic-cache";
import { loadWorkorderStats, resolveSiteRegionId } from "@/lib/civic-queries";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { isTownLabel } from "@/lib/admin-area";
import { parseDomainProfile } from "@/lib/domain-profile";
import { recordDisposalLog } from "@/lib/disposal";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";
import { requireAdmin } from "@/lib/auth/rbac";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveSiteRegionId(req);
    const { db: tenantDb, region: tenantRegion } = await getRegionDb(regionId);
    const domainProfile = parseDomainProfile(tenantRegion?.categoryConfigJson);
    const isEcommerce = domainProfile.domainType === "ECOMMERCE_CS";

    const { searchParams } = new URL(req.url);
    const tab = searchParams.get("tab") || "";
    const status = searchParams.get("status") || "";
    const urgency = searchParams.get("urgency") || "";
    const regionQuery = (searchParams.get("region") || "").trim();
    const regionAllowedDirect =
      Boolean(regionQuery) &&
      regionQuery !== regionId &&
      (isEcommerce ||
        domainProfile.channels.includes(regionQuery) ||
        isTownLabel(regionQuery) ||
        regionQuery === UNKNOWN_TOWN ||
        regionQuery === "未知");
    const category = searchParams.get("category") || "";
    const keyword = searchParams.get("keyword") || "";
    const pageParam = searchParams.get("page");
    const sizeParam = searchParams.get("size");
    const page = pageParam ? clampPage(pageParam) : 1;
    const size = sizeParam ? clampSize(sizeParam) : 500;

    const buildWhere = (regionFilter: string) => {
      const filters = [];
      if (regionFilter) {
        if (regionFilter === UNKNOWN_TOWN || regionFilter === "未知") {
          filters.push(
            or(
              isNull(ticketsTable.subdistrict),
              eq(ticketsTable.subdistrict, ""),
              eq(ticketsTable.subdistrict, "未知"),
              eq(ticketsTable.subdistrict, "未指定")
            )
          );
        } else {
          filters.push(
            or(
              ilike(ticketsTable.subdistrict, `%${regionFilter}%`),
              ilike(ticketsTable.district, `%${regionFilter}%`)
            )
          );
        }
      }
      if (category) {
        filters.push(eq(ticketsTable.sourceCategory, category));
      }

      const effectiveStatus = status || (tab === "pending" || tab === "progress" || tab === "finished" ? tab : "");
      if (effectiveStatus === "RESOLVED" || effectiveStatus === "finished") {
        filters.push(or(eq(ticketsTable.status, "RESOLVED"), eq(ticketsTable.status, "FINISHED")));
      } else if (effectiveStatus === "IN_PROGRESS" || effectiveStatus === "progress") {
        filters.push(
          or(
            eq(ticketsTable.status, "DISPATCHED"),
            eq(ticketsTable.status, "VERIFIED"),
            eq(ticketsTable.status, "IN_PROGRESS"),
            eq(ticketsTable.status, "PROCESSING")
          )
        );
      } else if (effectiveStatus === "PENDING" || effectiveStatus === "pending") {
        filters.push(eq(ticketsTable.status, "PENDING"));
      }

      if (urgency === "URGENT" || tab === "urgent") {
        filters.push(eq(ticketsTable.urgency, "URGENT"));
      }
      if (tab === "fake_closure") {
        filters.push(eq(ticketsTable.isFakeClosure, true));
      }
      if (tab === "multifreq") {
        filters.push(isNotNull(ticketsTable.primaryThemeId));
      } else if (tab === "single" || tab === "unclustered") {
        filters.push(isNull(ticketsTable.primaryThemeId));
      }
      if (keyword) {
        filters.push(
          or(
            ilike(ticketsTable.title, `%${keyword}%`),
            ilike(ticketsTable.content, `%${keyword}%`),
            ilike(ticketsTable.ticketNo, `%${keyword}%`),
            ilike(ticketsTable.summarizeTitle, `%${keyword}%`)
          )
        );
      }

      return filters.length ? and(...filters) : undefined;
    };

    const countQ = tenantDb.select({ count: sql<number>`count(*)::int` }).from(ticketsTable);
    const listQ = tenantDb
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        content: sql<string>`left(${ticketsTable.content}, 80)`,
        district: ticketsTable.district,
        subdistrict: ticketsTable.subdistrict,
        sourceCategory: ticketsTable.sourceCategory,
        urgency: ticketsTable.urgency,
        channel: ticketsTable.channel,
        status: ticketsTable.status,
        createTime: ticketsTable.createTime,
        closedAt: ticketsTable.closedAt,
        closureStatus: ticketsTable.closureStatus,
        isFakeClosure: ticketsTable.isFakeClosure,
        primaryThemeId: ticketsTable.primaryThemeId,
      })
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime))
      .limit(size)
      .offset((page - 1) * size);

    const snapPromise = cacheGetOrLoad(`workorders:stats:${regionId}`, () => loadWorkorderStats(regionId));

    let snap: Awaited<typeof snapPromise>["value"];
    let countRows: Array<{ count: number }> | null;
    let dbRows: Awaited<typeof listQ>;

    if (!regionQuery || regionAllowedDirect) {
      const where = buildWhere(regionAllowedDirect ? regionQuery : "");
      const [snapRes, cRows, lRows] = await Promise.all([
        snapPromise,
        where ? countQ.where(where) : Promise.resolve(null),
        where ? listQ.where(where) : listQ,
      ]);
      snap = snapRes.value;
      countRows = cRows;
      dbRows = lRows;
    } else {
      const snapRes = await snapPromise;
      snap = snapRes.value;
      const facetMatch =
        regionQuery !== regionId && snap.facets.regions.includes(regionQuery) ? regionQuery : "";
      const where = buildWhere(facetMatch);
      const [cRows, lRows] = await Promise.all([
        where ? countQ.where(where) : Promise.resolve(null),
        where ? listQ.where(where) : listQ,
      ]);
      countRows = cRows;
      dbRows = lRows;
    }

    const filteredTotal = countRows ? Number(countRows[0]?.count || 0) : snap.stats.total;
    const tickets: Array<
      RawTicket & {
        ticketId: string;
        region: string;
        primaryThemeId?: string;
        sourceCategory?: string;
      }
    > = dbRows.map((r) => ({
      id: r.id,
      ticketId: r.id,
      ticketNo: r.ticketNo,
      title: r.title || undefined,
      summarizeTitle: r.summarizeTitle || undefined,
      createTime: r.createTime ? r.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00",
      citizenPhone: "",
      content: r.content,
      citizenName: "",
      district: r.district || undefined,
      subdistrict: r.subdistrict || undefined,
      region: regionLabel(r.subdistrict),
      sourceCategory: r.sourceCategory || undefined,
      urgency: (r.urgency as RawTicket["urgency"]) || "NORMAL",
      channel: r.channel || "市民服务热线",
      status: (r.status as RawTicket["status"]) || "PENDING",
      closedAt: r.closedAt ? r.closedAt.toISOString() : undefined,
      closureStatus: (r.closureStatus as RawTicket["closureStatus"]) || null,
      isFakeClosure: Boolean(r.isFakeClosure),
      primaryThemeId: r.primaryThemeId || undefined,
    }));

    return NextResponse.json({
      success: true,
      source: "postgresql",
      page,
      size,
      total: filteredTotal,
      stats: snap.stats,
      data: tickets,
    });
  } catch (e: any) {
    console.error("[tickets/route] GET error:", e?.message);
    return NextResponse.json(
      { success: false, error: e?.message || "Failed to fetch tickets" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  const startTime = Date.now();
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

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
                const [activeRows, closedRows] = await Promise.all([
                  tenantDb
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
                      handlingProgress: themesTable.handlingProgress,
                      handlingOwner: themesTable.handlingOwner,
                      handlingEta: themesTable.handlingEta,
                    })
                    .from(themesTable),
                  tenantDb
                    .select({
                      themeId: ticketThemesTable.themeId,
                      maxClosedAt: sql<Date | null>`max(${ticketsTable.closedAt})`,
                    })
                    .from(ticketThemesTable)
                    .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
                    .groupBy(ticketThemesTable.themeId),
                ]);

                const closedAtByTheme = new Map<string, string>();
                for (const r of closedRows) {
                  if (r.maxClosedAt) {
                    const d = r.maxClosedAt instanceof Date ? r.maxClosedAt : new Date(r.maxClosedAt);
                    if (!Number.isNaN(d.getTime())) closedAtByTheme.set(r.themeId, d.toISOString());
                  }
                }

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
                  firstOccurrence: r.firstAt ? r.firstAt.toISOString() : "",
                  lastOccurrence: r.lastAt ? r.lastAt.toISOString() : "",
                  aiSummary: r.aiSummary || "",
                  recommendedAction: r.recommendedAction || "",
                  handlingStatus: r.handlingStatus || HANDLING_STATUS.PENDING,
                  handlingProgress: r.handlingProgress ?? 0,
                  handlingOwner: r.handlingOwner || undefined,
                  handlingEta: r.handlingEta ? r.handlingEta.toISOString() : undefined,
                  closedAt: closedAtByTheme.get(r.id),
                  status: "CONFIRMED",
                  tickets: [],
                  relatedSubjects: [r.canonicalSubject],
                  relatedLocations: [r.canonicalLocation],
                }));

                const themeVectors = await loadThemeMemberVectors(
                  regionId,
                  activeThemes.map((theme) => theme.id)
                );
                const { enrichedTicket, result: incResult } = await ingestSingleTicketPipeline(
                  {
                    ...singleRec,
                    createTime: singleRec.createTime instanceof Date ? singleRec.createTime.toISOString() : String(singleRec.createTime),
                  },
                  activeThemes,
                  regionId,
                  { themeVectors }
                );

                // 1. 无条件将抽取提炼出的结构化要素持久化回工单表 (确保单条推送必定完成自动研判)
                await tenantDb
                  .update(ticketsTable)
                  .set({
                    primaryThemeId: incResult.action === "ATTACHED" && incResult.matchedThemeId ? incResult.matchedThemeId : null,
                    summarizeTitle: enrichedTicket.summarizeTitle || singleRec.title,
                    address: enrichedTicket.canonicalLocation || singleRec.district,
                    sourceCategory: enrichedTicket.sourceCategory,
                    confidence: enrichedTicket.confidence || 0.85,
                    canonicalSubject: enrichedTicket.canonicalSubject,
                    eventType: enrichedTicket.eventType,
                    urgency: enrichedTicket.urgency,
                    slaHours: enrichedTicket.slaHours,
                    stabilityRisk: enrichedTicket.stabilityRisk,
                    subdistrict: enrichedTicket.subdistrict || singleRec.subdistrict,
                    ...(enrichedTicket.isFakeClosure
                      ? {
                          isFakeClosure: true,
                          closureStatus: enrichedTicket.closureStatus || "REOPENED",
                        }
                      : {}),
                  })
                  .where(eq(ticketsTable.id, singleRec.id));

                // 2. 若成功吸附到已有主题，同步刷新对应专题的工单数与案卷建议（含假闭环复发重开）
                if (incResult.action === "ATTACHED" && incResult.matchedThemeId) {
                  await tenantDb
                    .insert(ticketThemesTable)
                    .values({
                      ticketId: singleRec.id,
                      themeId: incResult.matchedThemeId,
                    })
                    .onConflictDoNothing();
                  await tenantDb
                    .update(themesTable)
                    .set({
                      ticketCount: incResult.matchedTheme?.ticketCount ?? 1,
                      lastAt: memberLastAt(singleRec.ticketNo, singleRec.createTime ?? null),
                      riskLevel: incResult.matchedTheme?.riskLevel,
                      riskReason: incResult.matchedTheme?.riskReason,
                      aiSummary: incResult.matchedTheme?.aiSummary,
                      recommendedAction: incResult.matchedTheme?.recommendedAction,
                      ...(incResult.fakeClosureDetected || (incResult.matchedTheme?.reopenCount || 0) > 0
                        ? {
                            handlingStatus: incResult.matchedTheme?.handlingStatus || "IN_PROGRESS",
                            handlingProgress: incResult.matchedTheme?.handlingProgress ?? 40,
                          }
                        : {}),
                    })
                    .where(eq(themesTable.id, incResult.matchedThemeId));

                  if (incResult.fakeClosureDetected || (incResult.matchedTheme?.reopenCount || 0) > 0) {
                    await recordDisposalLog({
                      regionId,
                      targetType: "THEME",
                      targetId: incResult.matchedThemeId,
                      action: "REOPEN",
                      fromStatus: "RESOLVED",
                      toStatus: incResult.matchedTheme?.handlingStatus || "IN_PROGRESS",
                      owner: incResult.matchedTheme?.handlingOwner || null,
                      operator: "system",
                      note: `假闭环复发重开：工单 ${singleRec.ticketNo || singleRec.id} 并入已办结主题`,
                      meta: { ticketId: singleRec.id, ticketNo: singleRec.ticketNo },
                    });
                  }
                }
                invalidateCivicAggregates(regionId);
                broadcastDataRefresh(regionId);
              } catch (asyncErr: any) {
                console.warn("[tickets/route] Incremental ingestion background task warning:", asyncErr.message);
              }
            })().catch(() => {});
          } else if (recordsToInsert.length > 1) {
            // 若为批量新工单接入，后台自动开启研判流水线
            triggerClusterJobAuto(regionId).catch((err) => {
              console.warn("[tickets/route] Auto cluster trigger warning:", err?.message || err);
            });
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
