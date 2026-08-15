import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { desc, eq } from "drizzle-orm";
import { toClusterDto } from "@/lib/civic-dto";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "";
    const region = searchParams.get("region") || "";
    const keyword = searchParams.get("keyword") || "";
    const status = searchParams.get("status") || "";

    const themeRows = await db.select().from(themesTable).orderBy(desc(themesTable.ticketCount));
    const junctions = await db.select().from(ticketThemesTable);
    const tickets = await db.select().from(ticketsTable);
    const ticketMap = new Map(tickets.map((t) => [t.id, t]));

    const samplesByTheme = new Map<string, typeof tickets>();
    for (const j of junctions) {
      const list = samplesByTheme.get(j.themeId) || [];
      const tk = ticketMap.get(j.ticketId);
      if (tk) list.push(tk);
      samplesByTheme.set(j.themeId, list);
    }

    let dtos = themeRows.map((t) =>
      toClusterDto({
        ...t,
        firstAt: t.firstAt,
        lastAt: t.lastAt,
        tickets: (samplesByTheme.get(t.id) || []).slice(0, 5),
      })
    );

    if (mode) dtos = dtos.filter((c) => c.mode === mode);
    if (region) dtos = dtos.filter((c) => c.region.includes(region));
    if (status) dtos = dtos.filter((c) => c.status.label === status);
    if (keyword) {
      const kw = keyword.toLowerCase();
      dtos = dtos.filter(
        (c) =>
          c.type.toLowerCase().includes(kw) ||
          c.region.toLowerCase().includes(kw) ||
          c.title.toLowerCase().includes(kw)
      );
    }

    const totalMultiFreq = dtos.reduce((a, c) => a + c.count, 0);
    return NextResponse.json({
      success: true,
      totalClusters: dtos.length,
      totalMultiFreq,
      topClusters: dtos,
      allClusters: dtos.map((c) => ({
        id: c.id,
        type: c.type,
        region: c.region,
        count: c.count,
        sample_ids: c.sample_ids,
        sample_titles: c.sample_titles,
        first_date: c.first_date,
        last_date: c.last_date,
        mode: c.mode,
      })),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
