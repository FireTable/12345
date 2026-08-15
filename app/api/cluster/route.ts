import { NextResponse } from "next/server";
import { runTicketRadarPipeline } from "@/backend/agent";
import { MOCK_RAW_TICKETS } from "@/lib/mock-data";
import type { RawTicket } from "@/backend/state";

export async function GET() {
  try {
    // Run LangGraph Agent Pipeline on current ticket store
    const result = await runTicketRadarPipeline(MOCK_RAW_TICKETS, "session-main");
    return NextResponse.json({
      success: true,
      data: {
        themes: result.themes,
        stats: result.stats,
        graphData: result.graphData,
        enrichedTickets: result.enrichedTickets,
      },
    });
  } catch (err: any) {
    console.error("LangGraph Cluster error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to run LangGraph cluster" },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const tickets: RawTicket[] = body.tickets || MOCK_RAW_TICKETS;
    const threadId = body.threadId || `session-${Date.now()}`;

    // Execute LangGraph JS StateGraph pipeline
    const result = await runTicketRadarPipeline(tickets, threadId);

    return NextResponse.json({
      success: true,
      data: {
        themes: result.themes,
        stats: result.stats,
        graphData: result.graphData,
        enrichedTickets: result.enrichedTickets,
      },
    });
  } catch (err: any) {
    console.error("LangGraph Cluster error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to run LangGraph cluster" },
      { status: 500 }
    );
  }
}
