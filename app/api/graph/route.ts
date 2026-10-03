import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import type { GraphData, RawTicket } from "@/backend/state";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { desc } from "drizzle-orm";

const cachedGraphs = new Map<string, { graph: GraphData; timestamp: number }>();

export async function GET(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const now = Date.now();
    const cached = cachedGraphs.get(regionId);
    if (cached && now - cached.timestamp < 60000) {
      return NextResponse.json({
        success: true,
        data: cached.graph,
      });
    }

    // 1. Fetch real tickets from the tenant DB
    const dbRows = await tenantDb
      .select()
      .from(ticketsTable)
      .orderBy(desc(ticketsTable.createTime))
      .limit(100);

    if (!dbRows || dbRows.length === 0) {
      return NextResponse.json({
        success: true,
        data: {
          nodes: [],
          links: [],
        },
      });
    }

    const realTickets: RawTicket[] = dbRows.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      title: r.title || undefined,
      summarizeTitle: r.summarizeTitle || undefined,
      createTime: r.createTime ? r.createTime.toISOString().slice(0, 19).replace("T", " ") : "2025-01-01 00:00:00",
      citizenPhone: r.citizenPhone || "",
      content: r.content,
      citizenName: r.citizenName || "市民*",
      district: r.district || undefined,
      subdistrict: r.subdistrict || undefined,
      channel: r.channel || "市民服务热线",
      status: (r.status as any) || "PENDING",
    }));

    // 2. Run graph pipeline on real tickets
    const result = await runTicketRadarPipeline(realTickets, `graph-cache-${regionId}`);
    const macroNodes = result.graphData.nodes.filter((n) => n.type !== "TICKET");
    const macroNodeIds = new Set(macroNodes.map((n) => n.id));
    const macroLinks = result.graphData.links.filter(
      (l) => macroNodeIds.has(l.source as string) && macroNodeIds.has(l.target as string)
    );

    const freshGraph: GraphData = {
      nodes: macroNodes,
      links: macroLinks,
    };

    cachedGraphs.set(regionId, {
      graph: freshGraph,
      timestamp: now,
    });

    return NextResponse.json({
      success: true,
      data: freshGraph,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load graph data" },
      { status: 500 }
    );
  }
}
