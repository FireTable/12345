import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { desc } from "drizzle-orm";
import { mapTicketStatus, regionLabel, toClusterDto } from "@/lib/civic-dto";
import { explicitAdmin } from "@/lib/admin-area";
import { deriveClusterUrgency, spanDays, urgentCutFromUnprocessed } from "@/lib/civic-cluster";

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const mode = searchParams.get("mode") || "";
    const region = searchParams.get("region") || "";
    const keyword = searchParams.get("keyword") || "";
    const status = searchParams.get("status") || "";
    const urgency = searchParams.get("urgency") || "";
    const tab = searchParams.get("tab") || "";

    const themeRows = await db.select().from(themesTable).orderBy(desc(themesTable.ticketCount));
    const junctions = await db.select().from(ticketThemesTable);
    const tickets = await db.select().from(ticketsTable);
    const ticketMap = new Map(tickets.map((t) => [t.id, t]));

    const samplesByTheme = new Map<string, typeof tickets>();
    const pendingByTheme = new Map<string, number>();
    const townsByTheme = new Map<string, Set<string>>();
    for (const j of junctions) {
      const tk = ticketMap.get(j.ticketId);
      if (!tk) continue;
      const list = samplesByTheme.get(j.themeId) || [];
      list.push(tk);
      samplesByTheme.set(j.themeId, list);
      if (mapTicketStatus(tk.status) === "PENDING") {
        pendingByTheme.set(j.themeId, (pendingByTheme.get(j.themeId) || 0) + 1);
      }
      const town = explicitAdmin(tk.subdistrict);
      if (town) {
        const set = townsByTheme.get(j.themeId) || new Set<string>();
        set.add(regionLabel(town));
        townsByTheme.set(j.themeId, set);
      }
    }

    const pendingValues = themeRows.map((t) => {
      const label = t.handlingStatus || "未处理";
      if (label === "已办结") return 0;
      return pendingByTheme.get(t.id) ?? Math.round((t.ticketCount || 0) * (label === "处置中" ? 0.4 : 0.7));
    });
    const cut = urgentCutFromUnprocessed(pendingValues);

    let dtos = themeRows.map((t, idx) => {
      const base = toClusterDto({
        ...t,
        firstAt: t.firstAt,
        lastAt: t.lastAt,
        tickets: (samplesByTheme.get(t.id) || []).slice(0, 5),
      });
      const label = base.status.label || "未处理";
      const unprocessed =
        label === "已办结"
          ? 0
          : pendingByTheme.get(t.id) ?? Math.round(base.count * (label === "处置中" ? 0.4 : 0.7));
      return {
        ...base,
        unprocessed,
        urgency: deriveClusterUrgency(unprocessed, base.type, cut),
        days: spanDays(base.first_date, base.last_date),
        communities: townsByTheme.get(t.id)?.size || 0,
        code: `GC-${String(idx + 1).padStart(3, "0")}`,
      };
    });

    if (mode) dtos = dtos.filter((c) => c.mode === mode);
    if (region) dtos = dtos.filter((c) => c.region.includes(region));
    if (status) dtos = dtos.filter((c) => c.status.label === status);
    if (urgency) dtos = dtos.filter((c) => c.urgency === urgency);
    if (tab === "pending") dtos = dtos.filter((c) => c.status.label === "未处理");
    else if (tab === "progress") dtos = dtos.filter((c) => c.status.label === "处置中");
    else if (tab === "done") dtos = dtos.filter((c) => c.status.label === "已办结");
    else if (tab === "urgent") dtos = dtos.filter((c) => c.urgency === "urgent");
    if (keyword) {
      const kw = keyword.toLowerCase();
      dtos = dtos.filter(
        (c) =>
          c.type.toLowerCase().includes(kw) ||
          c.region.toLowerCase().includes(kw) ||
          c.title.toLowerCase().includes(kw) ||
          c.code.toLowerCase().includes(kw)
      );
    }

    const allForFacets = themeRows.map((t) => {
      const base = toClusterDto({
        ...t,
        firstAt: t.firstAt,
        lastAt: t.lastAt,
        tickets: (samplesByTheme.get(t.id) || []).slice(0, 1),
      });
      return base.region;
    });

    const totalMultiFreq = dtos.reduce((a, c) => a + c.count, 0);
    const todayKey = new Date().toISOString().slice(0, 10);
    const latestDay = dtos.reduce((acc, c) => (c.last_date > acc ? c.last_date : acc), "");
    const todayNew = dtos.filter((c) => c.last_date === todayKey || c.first_date === todayKey).length;

    return NextResponse.json({
      success: true,
      totalClusters: dtos.length,
      totalMultiFreq,
      todayNew,
      latestDay,
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
        unprocessed: c.unprocessed,
        urgency: c.urgency,
        status: c.status.label,
      })),
      facets: {
        regions: [...new Set(allForFacets.filter((r) => r && r !== "未归属"))].sort((a, b) =>
          a.localeCompare(b, "zh-CN")
        ),
      },
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
