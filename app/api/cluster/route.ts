import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import type { RawTicket } from "@/backend/state";

async function getTicketsFromDatabase(limit = 10000): Promise<{ tickets: RawTicket[]; totalCount: number }> {
  try {
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalCount = Number(countRes[0]?.count || 0);

    if (totalCount > 0) {
      const rows = await db
        .select()
        .from(ticketsTable)
        .orderBy(sql`${ticketsTable.createTime} DESC`)
        .limit(limit);

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

      return { tickets, totalCount };
    }
  } catch (err) {
    console.warn("Could not query PostgreSQL, fallback to mock:", err);
  }

  return { tickets: MOCK_RAW_TICKETS, totalCount: MOCK_RAW_TICKETS.length };
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const limit = parseInt(searchParams.get("limit") || "10000", 10);

    const { tickets, totalCount } = await getTicketsFromDatabase(limit);

    // Run LangGraph Agent Pipeline
    const result = await runTicketRadarPipeline(tickets, "session-main");

    // Augment stats with actual full database count
    const stats = {
      ...result.stats,
      totalTickets: totalCount,
    };

    return NextResponse.json({
      success: true,
      source: totalCount > MOCK_RAW_TICKETS.length ? "postgresql" : "memory",
      data: {
        themes: result.themes,
        stats,
        graphData: result.graphData,
        enrichedTickets: result.enrichedTickets,
      },
    });
  } catch (err: any) {
    console.error("LangGraph Cluster error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to run LangGraph cluster" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const threadId = body.threadId || `session-${Date.now()}`;

    let tickets: RawTicket[] = body.tickets;
    let totalCount = tickets?.length || 0;

    if (!tickets || tickets.length === 0) {
      const dbData = await getTicketsFromDatabase(10000);
      tickets = dbData.tickets;
      totalCount = dbData.totalCount;
    }

    // Execute LangGraph JS StateGraph pipeline
    const result = await runTicketRadarPipeline(tickets, threadId);

    const stats = {
      ...result.stats,
      totalTickets: totalCount || result.stats.totalTickets,
    };

    return NextResponse.json({
      success: true,
      data: {
        themes: result.themes,
        stats,
        graphData: result.graphData,
        enrichedTickets: result.enrichedTickets,
      },
    });
  } catch (err: any) {
    console.error("LangGraph Cluster error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to run LangGraph cluster" },
      { status: 500 }
    );
  }
}
