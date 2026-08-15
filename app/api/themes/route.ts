import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import type { RawTicket, MultiFrequencyTheme } from "@/backend/state";

let cachedThemes: MultiFrequencyTheme[] | null = null;
let lastCacheTime = 0;

async function fetchSampleTickets(): Promise<RawTicket[]> {
  try {
    const rows = await db
      .select()
      .from(ticketsTable)
      .orderBy(sql`${ticketsTable.createTime} DESC`)
      .limit(600);

    if (rows && rows.length > 0) {
      return rows.map((r) => ({
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
    }
  } catch (e) {
    // Fallback
  }

  return [];
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const forceRefresh = searchParams.get("refresh") === "true";
    const now = Date.now();

    if (forceRefresh || !cachedThemes || now - lastCacheTime > 60000) {
      const tickets = await fetchSampleTickets();
      if (tickets.length === 0) {
        cachedThemes = [];
        lastCacheTime = now;
        return NextResponse.json({
          success: true,
          data: [],
        });
      }

      const result = await runTicketRadarPipeline(tickets, "theme-cache-session");
      cachedThemes = result.themes;
      lastCacheTime = now;
    }

    const lightweightThemes = (cachedThemes || []).map((t) => ({
      id: t.id,
      title: t.title,
      canonicalSubject: t.canonicalSubject,
      canonicalLocation: t.canonicalLocation,
      eventType: t.eventType,
      category: t.category,
      riskLevel: t.riskLevel,
      riskReason: t.riskReason,
      ticketCount: t.ticketCount,
      timeSpanHours: t.timeSpanHours,
      firstOccurrence: t.firstOccurrence,
      lastOccurrence: t.lastOccurrence,
      relatedSubjects: t.relatedSubjects,
      aiSummary: t.aiSummary,
      recommendedAction: t.recommendedAction,
      tickets: [],
    }));

    return NextResponse.json({
      success: true,
      data: lightweightThemes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load themes" },
      { status: 500 }
    );
  }
}
