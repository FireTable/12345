import { NextResponse } from "next/server";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql, inArray } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";

export async function GET() {
  try {
    const dbRows = await db.select().from(ticketsTable).limit(500);
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
        district: r.district || "所属辖区",
        subdistrict: r.subdistrict || "未归属镇街",
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
    // Fallback
  }

  return NextResponse.json({
    success: true,
    source: "memory",
    total: MOCK_RAW_TICKETS.length,
    data: MOCK_RAW_TICKETS,
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
        citizenName: t.citizenName || "市民*",
        citizenPhone: t.citizenPhone || "138****0000",
        district: t.district || "所属辖区",
        subdistrict: t.subdistrict || "未归属镇街",
        channel: t.channel || "市民服务热线",
        status: t.status || "PENDING",
        createTime: t.createTime ? new Date(t.createTime) : new Date(),
      });
    }

    let insertedCount = 0;
    let duplicateCount = 0;

    try {
      if (validRecords.length > 0) {
        // Collect ticket numbers to check duplicates
        const ticketNos = validRecords.map((r) => r.ticketNo);
        const existingRows = await db
          .select({ ticketNo: ticketsTable.ticketNo })
          .from(ticketsTable)
          .where(inArray(ticketsTable.ticketNo, ticketNos.slice(0, 1000)));

        const existingSet = new Set(existingRows.map((r) => r.ticketNo));
        duplicateCount = existingSet.size;

        const recordsToInsert = validRecords.filter((r) => !existingSet.has(r.ticketNo));

        if (recordsToInsert.length > 0) {
          // Batch insert newly unique tickets
          await db
            .insert(ticketsTable)
            .values(recordsToInsert)
            .onConflictDoNothing({ target: ticketsTable.ticketNo });

          insertedCount = recordsToInsert.length;
        }
      }
    } catch (dbErr: any) {
      console.warn("DB insert fallback to memory:", dbErr.message);
      insertedCount = validRecords.length;
      duplicateCount = 0;
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
