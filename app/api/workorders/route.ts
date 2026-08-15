import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, gte, ilike, isNotNull, lt, or, sql } from "drizzle-orm";
import { mapTicketStatus, regionLabel, toWorkorderDto } from "@/lib/civic-dto";
import { explicitAdmin, isTownLabel } from "@/lib/admin-area";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";
import { CIVIC_CATEGORIES } from "@/lib/civic-cluster";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const size = Math.min(50, Math.max(1, Number(searchParams.get("size") || 10)));
    const region = searchParams.get("region") || "";
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || "";
    const tab = searchParams.get("tab") || "";
    const keyword = searchParams.get("keyword") || "";
    const urgency = searchParams.get("urgency") || "";
    const time = searchParams.get("time") || "";
    const multifreq = searchParams.get("multifreq") || "";

    const snapshot = await db
      .select({
        status: ticketsTable.status,
        urgency: ticketsTable.urgency,
        primaryThemeId: ticketsTable.primaryThemeId,
        createTime: ticketsTable.createTime,
        subdistrict: ticketsTable.subdistrict,
        district: ticketsTable.district,
        sourceCategory: ticketsTable.sourceCategory,
        confidence: ticketsTable.confidence,
      })
      .from(ticketsTable);

    const stats = {
      total: snapshot.length,
      pending: 0,
      progress: 0,
      finished: 0,
      urgent: 0,
      multifreq: 0,
    };
    const regionSet = new Set<string>();
    const categorySet = new Set<string>();
    let latest = 0;
    for (const t of snapshot) {
      const st = mapTicketStatus(t.status);
      if (st === "PENDING") stats.pending += 1;
      else if (st === "IN_PROGRESS") stats.progress += 1;
      else stats.finished += 1;
      if ((t.urgency || "").toUpperCase() === "URGENT") stats.urgent += 1;
      if (t.primaryThemeId) stats.multifreq += 1;
      if (t.createTime) latest = Math.max(latest, t.createTime.getTime());
      if (t.confidence != null) {
        const town = explicitAdmin(t.subdistrict);
        const label = town ? regionLabel(town) : "";
        if (isTownLabel(label)) regionSet.add(label);
        const cat = (t.sourceCategory || "").trim();
        if (cat) categorySet.add(cat);
      }
    }

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

    const known = CIVIC_CATEGORIES.filter((c) => categorySet.has(c));
    const extra = [...categorySet].filter((c) => !(CIVIC_CATEGORIES as readonly string[]).includes(c));
    const facetCategories = [...known, ...extra];

    return NextResponse.json({
      success: true,
      page,
      size,
      total: Number(countRes[0]?.count || 0),
      data: rows.map((r) => toWorkorderDto(r)),
      stats,
      facets: {
        regions: [...regionSet].sort((a, b) => a.localeCompare(b, "zh-CN")),
        categories: facetCategories,
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "workorders failed" }, { status: 500 });
  }
}
