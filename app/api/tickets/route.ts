import { NextResponse } from "next/server";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import type { RawTicket } from "@/backend/state";

export async function GET() {
  try {
    // Try to query PostgreSQL first
    const dbRows = await db.select().from(ticketsTable).limit(500);
    if (dbRows && dbRows.length > 0) {
      const tickets: RawTicket[] = dbRows.map((r) => ({
        id: r.id,
        ticketNo: r.ticketNo,
        createTime: r.createTime ? r.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00",
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
        source: "postgresql",
        total: tickets.length,
        data: tickets,
      });
    }
  } catch (e) {
    // DB not available or offline, fallback to memory mock data
  }

  return NextResponse.json({
    success: true,
    source: "memory",
    total: MOCK_RAW_TICKETS.length,
    data: MOCK_RAW_TICKETS,
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const newTickets = Array.isArray(body) ? body : [body];

    try {
      const records = newTickets.map((t: any, idx: number) => ({
        id: t.id || `tk-${Date.now()}-${idx}`,
        ticketNo: t.ticketNo || `GD-${Date.now()}-${idx}`,
        title: t.title || "市民诉求",
        content: t.content || "",
        citizenName: t.citizenName || "市民*",
        citizenPhone: t.citizenPhone || "138****0000",
        district: t.district || "顺德区",
        subdistrict: t.subdistrict || "大良街道",
        channel: t.channel || "市民服务热线",
        status: t.status || "PENDING",
        createTime: t.createTime ? new Date(t.createTime) : new Date(),
      }));

      await db.insert(ticketsTable).values(records).onConflictDoNothing();
    } catch (dbErr) {
      // Ignored if DB offline
    }

    return NextResponse.json({
      success: true,
      message: `成功接收 ${newTickets.length} 条新工单`,
      data: newTickets,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Invalid ticket payload" },
      { status: 400 }
    );
  }
}
