import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { buildTrends } from "@/lib/civic-stats";

export async function GET(req: Request) {
  try {
    const days = Number(new URL(req.url).searchParams.get("days") || 90);
    const [tickets, themes] = await Promise.all([
      db.select().from(ticketsTable),
      db.select({ createdAt: themesTable.createdAt, patternType: themesTable.patternType }).from(themesTable),
    ]);
    const cut = Date.now() - Math.max(1, days) * 86400000;
    const recentTickets = tickets.filter((t) => {
      if (!t.createTime) return false;
      return t.createTime.getTime() >= cut;
    });
    const trends = buildTrends(
      recentTickets.map((t) => ({ createTime: t.createTime })),
      themes
    );
    return NextResponse.json({ success: true, ...trends });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "trends failed" },
      { status: 500 }
    );
  }
}
