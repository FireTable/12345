import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { buildCopilotPrompt } from "@/backend/prompt";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeSseDelta(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload);
    const delta = json?.choices?.[0]?.delta?.content;
    if (typeof delta === "string") return delta;
    if (Array.isArray(delta)) {
      return delta.map((p: { text?: string }) => p?.text || "").join("");
    }
    const content = json?.choices?.[0]?.message?.content;
    return typeof content === "string" ? content : "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const { prompt } = await req.json();
    const query = String(prompt || "").trim();
    if (!query) {
      return NextResponse.json({ success: false, error: "empty prompt" }, { status: 400 });
    }

    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalCount = Number(countRes[0]?.count || 0);

    const currentThemes = await db
      .select()
      .from(themesTable)
      .orderBy(desc(themesTable.ticketCount))
      .limit(10);

    const highRiskCount = currentThemes.filter((t) => t.riskLevel === "HIGH").length;
    const mediumRiskCount = currentThemes.filter((t) => t.riskLevel === "MEDIUM").length;

    const systemPrompt = buildCopilotPrompt({
      query,
      totalCount,
      currentThemes,
      highRiskCount,
      mediumRiskCount,
    });

    const apiKey = process.env.OPENAI_API_KEY || "mlx";
    const baseURL = (process.env.OPENAI_BASE_URL || "http://127.0.0.1:8080/v1").replace(/\/$/, "");
    const model = process.env.OPENAI_MODEL || "MiniCPM4.1-8B-MLX";

    const abort = new AbortController();
    const killer = setTimeout(() => abort.abort(), 60000);
    const upstream = await fetch(`${baseURL}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: JSON.stringify({
        model,
        temperature: 0.3,
        stream: true,
        messages: [{ role: "user", content: systemPrompt }],
      }),
      signal: abort.signal,
    }).finally(() => clearTimeout(killer));

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { success: false, error: errText || `upstream ${upstream.status}` },
        { status: 502 }
      );
    }

    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    const reader = upstream.body.getReader();
    let carry = "";

    const readable = new ReadableStream({
      async pull(controller) {
        const { done, value } = await reader.read();
        if (done) {
          carry += decoder.decode();
          if (carry.startsWith("data:")) {
            const text = decodeSseDelta(carry.replace(/^data:\s*/, "").trim());
            if (text) controller.enqueue(encoder.encode(text));
          }
          controller.close();
          return;
        }
        carry += decoder.decode(value, { stream: true });
        const lines = carry.split(/\r?\n/);
        carry = lines.pop() || "";
        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed.startsWith("data:")) continue;
          const text = decodeSseDelta(trimmed.replace(/^data:\s*/, "").trim());
          if (text) controller.enqueue(encoder.encode(text));
        }
      },
      cancel() {
        void reader.cancel();
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
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
