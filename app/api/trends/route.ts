import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { buildTrends } from "@/lib/civic-stats";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";

export async function GET(req: Request) {
  try {
    const days = Number(new URL(req.url).searchParams.get("days") || 90);
    const [tickets, themes] = await Promise.all([
      db.select().from(ticketsTable),
      db.select({ createdAt: themesTable.createdAt, patternType: themesTable.patternType }).from(themesTable),
    ]);
    const latest = tickets.reduce((acc, t) => {
      const n = t.createTime ? t.createTime.getTime() : 0;
      return n > acc ? n : acc;
    }, 0);
    const win = days > 0 ? timeWindow(`近${days}天`, clampTimeRef(latest || null)) : {};
    const recentTickets =
      days > 0
        ? tickets.filter((t) => {
            if (!t.createTime) return false;
            const n = t.createTime.getTime();
            if (win.from && n < win.from.getTime()) return false;
            if (win.to && n >= win.to.getTime()) return false;
            return true;
          })
        : tickets;
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
