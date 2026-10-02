import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, gte, ilike, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { toWorkorderDto, UNKNOWN_TOWN } from "@/lib/civic-dto";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadWorkorderStats } from "@/lib/civic-queries";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const { searchParams } = new URL(req.url);
    const page = clampPage(searchParams.get("page"));
    const size = clampSize(searchParams.get("size"));
    const region = searchParams.get("region") || "";
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || "";
    const tab = searchParams.get("tab") || "";
    const keyword = searchParams.get("keyword") || "";
    const urgency = searchParams.get("urgency") || "";
    const time = searchParams.get("time") || "";
    const multifreq = searchParams.get("multifreq") || "";
    const cluster = searchParams.get("cluster") || multifreq;

    const { value: snap } = await cacheGetOrLoad(`workorders:stats:${regionId}`, () => loadWorkorderStats(regionId));
    const { stats, latest, facets } = snap;

    const filters = [];
    if (region) {
      if (region === UNKNOWN_TOWN || region === "未知") {
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
          or(ilike(ticketsTable.subdistrict, `%${region}%`), ilike(ticketsTable.district, `%${region}%`))
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
    if (cluster === "1" || cluster === "multifreq" || tab === "multifreq") {
      filters.push(isNotNull(ticketsTable.primaryThemeId));
    } else if (
      cluster === "0" ||
      cluster === "single" ||
      cluster === "unclustered" ||
      tab === "single" ||
      tab === "unclustered"
    ) {
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
    if (time) {
      const win = timeWindow(time, clampTimeRef(latest ? new Date(latest) : null));
      if (win.from) filters.push(gte(ticketsTable.createTime, win.from));
      if (win.to) filters.push(lt(ticketsTable.createTime, win.to));
    }

    const where = filters.length ? and(...filters) : undefined;
    const countQ = tenantDb.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const listQ = tenantDb
      .select()
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime))
      .limit(size)
      .offset((page - 1) * size);
    const [countRes, rows] = await Promise.all([
      where ? countQ.where(where) : countQ,
      where ? listQ.where(where) : listQ,
    ]);

    return NextResponse.json({
      success: true,
      page,
      size,
      total: Number(countRes[0]?.count || 0),
      data: rows.map((r) => toWorkorderDto(r)),
      stats,
      facets,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "workorders failed" }, { status: 500 });
  }
}
