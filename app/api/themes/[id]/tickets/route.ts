import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, ticketThemesTable } from "@/db/schema";
import { eq, ilike, or } from "drizzle-orm";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import type { RawTicket } from "@/backend/state";

export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(req.url);
    const subject = searchParams.get("subject") || "";
    const keyword = searchParams.get("keyword") || "";

    // 1. Try querying from junction table ticketThemesTable
    const junctionRows = await db
      .select({
        id: ticketsTable.id,
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        content: ticketsTable.content,
        citizenName: ticketsTable.citizenName,
        citizenPhone: ticketsTable.citizenPhone,
        district: ticketsTable.district,
        subdistrict: ticketsTable.subdistrict,
        channel: ticketsTable.channel,
        status: ticketsTable.status,
        createTime: ticketsTable.createTime,
      })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketThemesTable.ticketId, ticketsTable.id))
      .where(eq(ticketThemesTable.themeId, id))
      .limit(100);

    if (junctionRows && junctionRows.length > 0) {
      const tickets: RawTicket[] = junctionRows.map((r) => ({
        id: r.id,
        ticketNo: r.ticketNo,
        title: r.title || undefined,
        summarizeTitle: r.summarizeTitle || undefined,
        createTime: r.createTime
          ? r.createTime.toISOString().slice(0, 19).replace("T", " ")
          : "2025-01-01 00:00:00",
        citizenPhone: r.citizenPhone || "",
        content: r.content,
        citizenName: r.citizenName || "市民*",
        district: r.district || "所属辖区",
        subdistrict: r.subdistrict || "未归属镇街",
        channel: r.channel || "市民服务热线",
        status: (r.status as any) || "PENDING",
      }));

      return NextResponse.json({
        success: true,
        themeId: id,
        total: tickets.length,
        data: tickets,
      });
    }

    // 2. Fallback: Search by subject or keyword in content
    if (subject || keyword) {
      const searchPattern = `%${subject || keyword}%`;
      const rows = await db
        .select()
        .from(ticketsTable)
        .where(
          or(
            ilike(ticketsTable.content, searchPattern),
            ilike(ticketsTable.title, searchPattern),
            ilike(ticketsTable.subdistrict, searchPattern)
          )
        )
        .limit(50);

      if (rows && rows.length > 0) {
        const tickets: RawTicket[] = rows.map((r) => ({
          id: r.id,
          ticketNo: r.ticketNo,
          title: r.title || undefined,
          summarizeTitle: r.summarizeTitle || undefined,
          createTime: r.createTime
            ? r.createTime.toISOString().slice(0, 19).replace("T", " ")
            : "2025-01-01 00:00:00",
          citizenPhone: r.citizenPhone || "",
          content: r.content,
          citizenName: r.citizenName || "市民*",
          district: r.district || "所属辖区",
          subdistrict: r.subdistrict || "未归属镇街",
          channel: r.channel || "市民服务热线",
          status: (r.status as any) || "PENDING",
        }));

        return NextResponse.json({
          success: true,
          themeId: id,
          total: tickets.length,
          data: tickets,
        });
      }
    }

    // 3. Fallback filter from mock
    const filtered = MOCK_RAW_TICKETS.slice(0, 20);
    return NextResponse.json({
      success: true,
      themeId: id,
      total: filtered.length,
      data: filtered,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to fetch theme tickets" },
      { status: 500 }
    );
  }
}
