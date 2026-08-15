import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import type { GraphData } from "@/backend/state";

let cachedGraph: GraphData | null = null;
let lastCacheTime = 0;

export async function GET() {
  try {
    const now = Date.now();
    if (!cachedGraph || now - lastCacheTime > 60000) {
      // Run on a clean representative batch
      const result = await runTicketRadarPipeline(MOCK_RAW_TICKETS.slice(0, 100), "graph-cache");
      // Keep macro nodes (THEME, SUBJECT, LOCATION), filter out individual raw ticket nodes to keep rendering blazing fast
      const macroNodes = result.graphData.nodes.filter((n) => n.type !== "TICKET");
      const macroNodeIds = new Set(macroNodes.map((n) => n.id));
      const macroLinks = result.graphData.links.filter(
        (l) => macroNodeIds.has(l.source as string) && macroNodeIds.has(l.target as string)
      );

      cachedGraph = {
        nodes: macroNodes,
        links: macroLinks,
      };
      lastCacheTime = now;
    }

    return NextResponse.json({
      success: true,
      data: cachedGraph,
    });
  } catch (err: any) {
    return NextResponse.json(
      { success: false, error: err.message || "Failed to load graph data" },
      { status: 500 }
    );
  }
}
