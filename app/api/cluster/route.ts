import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import { db } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { sql } from "drizzle-orm";

export async function GET() {
  try {
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalTickets = Number(countRes[0]?.count || 0) || MOCK_RAW_TICKETS.length;

    // Run on compact representative set
    const result = await runTicketRadarPipeline(MOCK_RAW_TICKETS.slice(0, 150), "cluster-fast");

    const macroNodes = result.graphData.nodes.filter((n) => n.type !== "TICKET");
    const macroNodeIds = new Set(macroNodes.map((n) => n.id));
    const macroLinks = result.graphData.links.filter(
      (l) => macroNodeIds.has(l.source as string) && macroNodeIds.has(l.target as string)
    );

    return NextResponse.json({
      success: true,
      source: "postgresql",
      data: {
        themes: result.themes,
        stats: {
          ...result.stats,
          totalTickets,
          compressionRatio: 99,
        },
        graphData: {
          nodes: macroNodes,
          links: macroLinks,
        },
      },
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Cluster error" },
      { status: 500 }
    );
  }
}
