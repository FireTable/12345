import { NextRequest, NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { eq, or } from "drizzle-orm";
import { toWorkorderDto } from "@/lib/civic-dto";
import { MODE_META, civicModeFromPattern } from "@/backend/theme-metrics";
import type { CivicMode, PatternType } from "@/backend/state";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const rows = await tenantDb
      .select()
      .from(ticketsTable)
      .where(or(eq(ticketsTable.id, id), eq(ticketsTable.ticketNo, id)))
      .limit(1);
    const row = rows[0];
    if (!row) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    let cluster_info = null;
    if (row.primaryThemeId) {
      const themes = await tenantDb
        .select({
          id: themesTable.id,
          title: themesTable.title,
          civicMode: themesTable.civicMode,
          patternType: themesTable.patternType,
          aiConfidence: themesTable.aiConfidence,
        })
        .from(themesTable)
        .where(eq(themesTable.id, row.primaryThemeId))
        .limit(1);
      const th = themes[0];
      if (th) {
        const mode = (th.civicMode as CivicMode) || civicModeFromPattern(th.patternType as PatternType);
        cluster_info = {
          id: th.id,
          title: th.title,
          mode_name: MODE_META[mode].name,
          ai_confidence: th.aiConfidence,
        };
      }
    }

    return NextResponse.json({
      success: true,
      ...toWorkorderDto(row),
      content: row.content,
      cluster_info,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
