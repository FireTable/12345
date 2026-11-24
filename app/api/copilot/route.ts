import { NextResponse } from "next/server";
import { isAbortError } from "@civic/system-two";
import { getRegionDb } from "@/db/client";
import { streamCopilot, type CopilotTurnInput } from "@/backend/agent/copilot-agent";
import { formatCopilotStatuses } from "@/lib/copilot-protocol";
import { getRegionDomainProfile } from "@/lib/domain-profile";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { guardAgentRequest } from "@/lib/security/agent-guard";

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
    const guard = await guardAgentRequest(req, { role: "admin", scope: "copilot", maxPerMinute: 15 });
    if ("response" in guard) return guard.response;

    const regionId = await resolveRequestRegionId(req);
    const body = (await req.json().catch(() => ({}))) as { prompt?: unknown; messages?: unknown };
    const turns = readTurns(body);
    if (turns.length === 0) {
      return NextResponse.json({ success: false, error: "empty prompt" }, { status: 400 });
    }

    const [{ region }, domainProfile] = await Promise.all([
      getRegionDb(regionId),
      getRegionDomainProfile(regionId),
    ]);
    const domainType = domainProfile.domainType;
    const regionLabel = region ? `${region.city} · ${region.name}` : regionId;
    const encoder = new TextEncoder();
    const abortController = new AbortController();
    if (req.signal.aborted) {
      abortController.abort(req.signal.reason);
    }
    const onRequestAbort = () => {
      abortController.abort(req.signal.reason);
    };
    req.signal.addEventListener("abort", onRequestAbort, { once: true });

    const readable = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const event of streamCopilot({
            regionId,
            regionLabel,
            domainType,
            turns,
            signal: abortController.signal,
          })) {
            if (abortController.signal.aborted) break;
            const text =
              event.type === "status"
                ? formatCopilotStatuses(event.tools ?? [event.tool], event.domainType ?? domainType)
                : event.text;
            if (text) {
              controller.enqueue(encoder.encode(text));
            }
          }
          if (!abortController.signal.aborted) {
            try {
              controller.close();
            } catch {
              /* stream already closed */
            }
          }
        } catch (error) {
          if (abortController.signal.aborted || isAbortError(error)) {
            try {
              controller.close();
            } catch {
              /* client went away */
            }
            return;
          }
          const message = error instanceof Error ? error.message : "研判失败";
          try {
            controller.enqueue(encoder.encode(`研判失败：${message}`));
          } catch {
            /* client went away */
          }
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        } finally {
          req.signal.removeEventListener("abort", onRequestAbort);
        }
      },
      cancel() {
        abortController.abort();
      },
    });

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
