import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { desc, sql } from "drizzle-orm";
import type { MultiFrequencyTheme } from "@/backend/state";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { requireAdmin } from "@/lib/auth/rbac";
import { clampPage, clampSize, LIST_SIZE_MAX } from "@/lib/api-bounds";
import { cacheGetOrLoad } from "@/lib/civic-cache";

export async function GET(req: Request) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const regionId = await resolveRequestRegionId(req);
    const { searchParams } = new URL(req.url);
    const pageParam = searchParams.get("page");
    const limitParam = searchParams.get("limit") ?? searchParams.get("size");
    const page = pageParam ? clampPage(pageParam) : 1;
    const limit = limitParam ? clampSize(limitParam) : LIST_SIZE_MAX;
    const offset = (page - 1) * limit;

    const { value: payload } = await cacheGetOrLoad(
      `themes:${regionId}:p${page}:s${limit}`,
      async () => {
        const { db: tenantDb } = await getRegionDb(regionId);
        // 页面实际用的是 /api/clusters。这里按分页上限取目录列并缓存。
        const [themeRows, countRows] = await Promise.all([
          tenantDb
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
            .orderBy(desc(themesTable.createdAt))
            .limit(limit)
            .offset(offset),
          tenantDb.select({ count: sql<number>`count(*)::int` }).from(themesTable),
        ]);

        const total = Number(countRows[0]?.count || 0);
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

        return {
          success: true as const,
          page,
          limit,
          total,
          data: lightweightThemes,
        };
      }
    );

    return NextResponse.json(payload);
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to query themes" },
      { status: 500 }
    );
  }
}
