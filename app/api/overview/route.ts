import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql } from "drizzle-orm";
import { buildInsights, buildOverview } from "@/lib/civic-stats";
import { clampTimeRef, timeWindow } from "@/lib/civic-time";

export async function GET(req: Request) {
  try {
    const days = Number(new URL(req.url).searchParams.get("days") || 0);
    const [tickets, themes, themeCountRes] = await Promise.all([
      db.select().from(ticketsTable),
      db.select().from(themesTable),
      db.select({ count: sql<number>`count(*)` }).from(themesTable),
    ]);
    const mapped = tickets.map((t) => ({
      createTime: t.createTime,
      subdistrict: t.subdistrict,
      district: t.district,
      sourceCategory: t.sourceCategory,
      category: t.sourceCategory,
      primaryThemeId: t.primaryThemeId,
      confidence: t.confidence,
      address: t.address,
    }));
    const overview = buildOverview(mapped, Number(themeCountRes[0]?.count || 0));
    const latest = tickets.reduce((acc, t) => {
      const n = t.createTime ? t.createTime.getTime() : 0;
      return n > acc ? n : acc;
    }, 0);
    const win = days > 0 ? timeWindow(`近${days}天`, clampTimeRef(latest || null)) : {};
    const scoped =
      days > 0
        ? mapped.filter((t) => {
            if (!t.createTime) return false;
            const n = t.createTime.getTime();
            if (win.from && n < win.from.getTime()) return false;
            if (win.to && n >= win.to.getTime()) return false;
            return true;
          })
        : mapped;
    const scopedOv = days > 0 ? buildOverview(scoped, Number(themeCountRes[0]?.count || 0)) : overview;
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
    return NextResponse.json({
      success: true,
      ...overview,
      regionDistribution: scopedOv.regionDistribution,
      categoryDistribution: scopedOv.categoryDistribution,
      regionCategory: scopedOv.regionCategory,
      insights,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "overview failed" },
      { status: 500 }
    );
  }
}
