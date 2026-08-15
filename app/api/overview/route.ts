import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import { buildInsights, buildOverview } from "@/lib/civic-stats";

export async function GET() {
  try {
    const [tickets, themes, themeCountRes] = await Promise.all([
      db.select().from(ticketsTable),
      db.select().from(themesTable),
      db.select({ count: sql<number>`count(*)` }).from(themesTable),
    ]);
    const overview = buildOverview(
      tickets.map((t) => ({
        createTime: t.createTime,
        subdistrict: t.subdistrict,
        district: t.district,
        sourceCategory: t.sourceCategory,
        category: t.sourceCategory,
        primaryThemeId: t.primaryThemeId,
      })),
      Number(themeCountRes[0]?.count || 0)
    );
    const insights = buildInsights(
      themes.map((t) => ({
        id: t.id,
        title: t.title,
        category: t.category,
        patternType: t.patternType,
        ticketCount: t.ticketCount,
        trendPct: t.trendPct,
        canonicalSubject: t.canonicalSubject,
        canonicalLocation: t.canonicalLocation,
        recommendedAction: t.recommendedAction,
        riskLevel: t.riskLevel,
      }))
    );
    return NextResponse.json({ success: true, ...overview, insights });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "overview failed" },
      { status: 500 }
    );
  }
}
