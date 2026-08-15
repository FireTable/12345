import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql, ilike, or } from "drizzle-orm";
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
          createTime: r.createTime
            ? r.createTime.toISOString().slice(0, 19).replace("T", " ")
            : "2025-01-01 00:00:00",
          content: r.content,
          citizenName: r.citizenName || "市民*",
          citizenPhone: r.citizenPhone || "138****0000",
          district: r.district || "顺德区",
          subdistrict: r.subdistrict || "大良街道",
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

    // Fallback filter from mock
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
