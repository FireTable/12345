import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { desc } from "drizzle-orm";
import type { MultiFrequencyTheme } from "@/backend/state";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    // 页面实际用的是 /api/clusters。这里仍是主题目录，只取映射用到的列。
    const themeRows = await tenantDb
      .select({
        id: themesTable.id,
        title: themesTable.title,
        canonicalSubject: themesTable.canonicalSubject,
        canonicalLocation: themesTable.canonicalLocation,
        eventType: themesTable.eventType,
        category: themesTable.category,
        riskLevel: themesTable.riskLevel,
        riskReason: themesTable.riskReason,
        ticketCount: themesTable.ticketCount,
        timeSpanHours: themesTable.timeSpanHours,
        aiSummary: themesTable.aiSummary,
        recommendedAction: themesTable.recommendedAction,
      })
      .from(themesTable)
      .orderBy(desc(themesTable.createdAt));

    if (!themeRows || themeRows.length === 0) {
      return NextResponse.json({
        success: true,
        data: [],
      });
    }

    const lightweightThemes: MultiFrequencyTheme[] = themeRows.map((t) => ({
      id: t.id,
      title: t.title,
      canonicalSubject: t.canonicalSubject,
      canonicalLocation: t.canonicalLocation,
      eventType: t.eventType,
      category: t.category || "城市管理",
      riskLevel: (t.riskLevel as any) || "LOW",
      riskReason: t.riskReason || "",
      ticketCount: t.ticketCount || 0,
      timeSpanHours: t.timeSpanHours || 1,
      firstOccurrence: "",
      lastOccurrence: "",
      relatedSubjects: [],
      relatedLocations: [],
      status: "UNCHECKED",
      aiSummary: t.aiSummary || "",
      recommendedAction: t.recommendedAction || "",
      tickets: [], // loaded on-demand
    }));

    return NextResponse.json({
      success: true,
      data: lightweightThemes,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to query themes" },
      { status: 500 }
    );
  }
}
