import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { getChatModel } from "@/backend/model";
import { buildCopilotPrompt } from "@/backend/prompt";

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const query = String(prompt || "").trim();

    // 1. Fetch current macro context from DB
    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalCount = Number(countRes[0]?.count || 0);

    const currentThemes = await db
      .select()
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount))
      .limit(10);

    const highRiskCount = currentThemes.filter((t) => t.riskLevel === "HIGH").length;
    const mediumRiskCount = currentThemes.filter((t) => t.riskLevel === "MEDIUM").length;

    // 2. Call real LLM (gpt-5.6-terra) for intelligent governance Copilot
    const chat = getChatModel(0.3);
    const systemPrompt = buildCopilotPrompt({
      query,
      totalCount,
      currentThemes,
      highRiskCount,
      mediumRiskCount,
    });

    const res = await chat.invoke(systemPrompt);
    const reply = String(res.content);

    return NextResponse.json({
      success: true,
      data: {
        reply,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (err: any) {
    console.error("Copilot error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to process Copilot query" },
      { status: 500 }
    );
  }
}
