import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, gte, ilike, isNotNull, lt, or, sql } from "drizzle-orm";
import { toWorkorderDto } from "@/lib/civic-dto";
import { clampPage, clampSize } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";
import { loadWorkorderStats } from "@/lib/civic-queries";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";

export async function GET(req: Request) {
  try {
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

    const { value: snap } = await cacheGetOrLoad("workorders:stats", () => loadWorkorderStats());
    const { stats, latest, facets } = snap;

    const filters = [];
    if (region) {
      filters.push(
        or(ilike(ticketsTable.subdistrict, `%${region}%`), ilike(ticketsTable.district, `%${region}%`))
      );
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
    if (multifreq === "1" || tab === "multifreq") {
      filters.push(isNotNull(ticketsTable.primaryThemeId));
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
    const countQ = db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const listQ = db
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
