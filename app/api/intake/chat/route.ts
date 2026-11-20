import { NextResponse } from "next/server";
import { guardAgentRequest } from "@/lib/security/agent-guard";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import {
  processIntakeChat,
  type IntakeChatMessage,
  type IntakeDraft,
} from "@/lib/agent-governance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function normalizeMessages(raw: unknown): IntakeChatMessage[] {
  if (!Array.isArray(raw)) return [];
  const out: IntakeChatMessage[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const rec = item as { role?: unknown; content?: unknown };
    const role = rec.role === "assistant" ? "assistant" : rec.role === "user" ? "user" : null;
    const content = typeof rec.content === "string" ? rec.content.trim() : "";
    if (!role || !content) continue;
    out.push({ role, content });
  }
  return out.slice(-20);
}

export async function POST(req: Request) {
  try {
    const guard = await guardAgentRequest(req, {
      role: "any",
      scope: "intake-chat",
    });
    if ("response" in guard) return guard.response;

    const body = (await req.json().catch(() => null)) as {
      messages?: unknown;
      draft?: Partial<IntakeDraft>;
      regionId?: unknown;
    } | null;

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { success: false, code: "BAD_REQUEST", error: "无效的请求体" },
        { status: 400 }
      );
    }

    const regionId = await resolveRequestRegionId(
      req,
      typeof body.regionId === "string" ? body.regionId : undefined
    );
    const messages = normalizeMessages(body.messages);
    const draft = body.draft && typeof body.draft === "object" ? body.draft : undefined;

    const result = await processIntakeChat({
      regionId,
      messages,
      draft,
    });

    return NextResponse.json({
      success: true,
      ...result,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to process intake chat";
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
