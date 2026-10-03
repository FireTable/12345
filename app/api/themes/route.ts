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

    const themeRows = await tenantDb
      .select()
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
