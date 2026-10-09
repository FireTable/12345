import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { regionLabel, toClusterDto } from "@/lib/civic-dto";
import { clusterRegionLabel } from "@/lib/civic-queries";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db } = await getRegionDb(regionId);
    const themes = await db.select().from(themesTable).where(eq(themesTable.id, id)).limit(1);
    const theme = themes[0];
    if (!theme) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    const townRows = await db
      .select({ subdistrict: ticketsTable.subdistrict })
      .from(ticketThemesTable)
      .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
      .where(eq(ticketThemesTable.themeId, id))
      .groupBy(ticketsTable.subdistrict);

    const towns = new Set<string>();
    for (const row of townRows) {
      const town = regionLabel(row.subdistrict);
      if (town) towns.add(town);
    }

    const dto = toClusterDto({ ...theme, tickets: [], ticketCount: theme.ticketCount });
    dto.region = clusterRegionLabel(towns, theme.canonicalLocation);

    return NextResponse.json({
      success: true,
      ...dto,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
