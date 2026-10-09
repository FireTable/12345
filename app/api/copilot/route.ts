import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { streamCopilot, type CopilotTurnInput } from "@/backend/agent/copilot-agent";
import { formatCopilotStatus } from "@/lib/copilot-protocol";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readTurns(body: { prompt?: unknown; messages?: unknown }): CopilotTurnInput[] {
  const incoming = Array.isArray(body.messages) ? body.messages : [];
  const turns = incoming
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const record = item as { role?: unknown; content?: unknown };
      const role = record.role === "assistant" ? "assistant" : record.role === "user" ? "user" : "";
      const content = typeof record.content === "string" ? record.content.trim() : "";
      if (!role || !content) return null;
      return { role, content } as CopilotTurnInput;
    })
    .filter((item): item is CopilotTurnInput => item !== null)
    .slice(-8);
  if (turns.some((turn) => turn.role === "user")) return turns;
  const prompt = typeof body.prompt === "string" ? body.prompt.trim() : "";
  return prompt ? [{ role: "user", content: prompt }] : [];
}

export async function POST(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; messages?: unknown };
    const turns = readTurns(body);
    if (turns.length === 0) {
      return NextResponse.json({ success: false, error: "empty prompt" }, { status: 400 });
    }

    const { region } = await getRegionDb(regionId);
    const regionLabel = region ? `${region.city} · ${region.name}` : regionId;
    const encoder = new TextEncoder();
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    void (async () => {
      try {
        for await (const event of streamCopilot({ regionId, regionLabel, turns })) {
          const text = event.type === "status" ? formatCopilotStatus(event.tool) : event.text;
          if (text) await writer.write(encoder.encode(text));
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "研判失败";
        try {
          await writer.write(encoder.encode(`研判失败：${message}`));
        } catch {
          /* client went away */
        }
      } finally {
        try {
          await writer.close();
        } catch {
          /* already closed */
        }
      }
    })();

    return new Response(readable, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        "X-Accel-Buffering": "no",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process Copilot query";
    console.error("Copilot error:", message);
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
