import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { toWorkorderDto } from "@/lib/civic-dto";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const page = Math.max(1, Number(searchParams.get("page") || 1));
    const size = Math.min(50, Math.max(1, Number(searchParams.get("size") || 15)));
    const region = searchParams.get("region") || "";
    const category = searchParams.get("category") || "";
    const status = searchParams.get("status") || "";
    const keyword = searchParams.get("keyword") || "";

    const filters = [];
    if (region) {
      filters.push(
        or(ilike(ticketsTable.subdistrict, `%${region}%`), ilike(ticketsTable.district, `%${region}%`))
      );
    }
    if (category) {
      filters.push(
        or(eq(ticketsTable.sourceCategory, category), ilike(ticketsTable.title, `%${category}%`))
      );
    }
    if (status === "RESOLVED") filters.push(eq(ticketsTable.status, "RESOLVED"));
    else if (status === "IN_PROGRESS") {
      filters.push(or(eq(ticketsTable.status, "DISPATCHED"), eq(ticketsTable.status, "VERIFIED")));
    } else if (status === "PENDING") filters.push(eq(ticketsTable.status, "PENDING"));
    if (keyword) {
      filters.push(
        or(
          ilike(ticketsTable.title, `%${keyword}%`),
          ilike(ticketsTable.content, `%${keyword}%`),
          ilike(ticketsTable.ticketNo, `%${keyword}%`)
        )
      );
    }

    const where = filters.length ? and(...filters) : undefined;
    const countQ = db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const listQ = db.select().from(ticketsTable).orderBy(desc(ticketsTable.createTime)).limit(size).offset((page - 1) * size);
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
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message || "workorders failed" }, { status: 500 });
  }
}
