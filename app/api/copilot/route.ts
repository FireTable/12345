import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { ticketsTable, themesTable } from "@/db/schema";
import { sql, desc } from "drizzle-orm";
import { buildCopilotPrompt } from "@/backend/prompt";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function decodeSseDelta(payload: string): string {
  if (!payload || payload === "[DONE]") return "";
  try {
    const json = JSON.parse(payload);
    // ponytail: 同时支持 OpenAI 兼容 SSE (choices[0].delta.content) 和 ollama 原生
    // /api/generate (jsonl: {response: "..."})。reasoning_content / thinking 是模型内部思考,
    // 永远不外泄给用户。
    if (typeof json?.response === "string") return json.response;
    const choice = json?.choices?.[0];
    if (choice?.delta?.content && typeof choice.delta.content === "string") {
      return choice.delta.content;
    }
    return "";
  } catch {
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);

    const { prompt } = await req.json();
    const query = String(prompt || "").trim();
    if (!query) {
      return NextResponse.json({ success: false, error: "empty prompt" }, { status: 400 });
    }

    const countRes = await tenantDb.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const totalCount = Number(countRes[0]?.count || 0);

    const currentThemes = await tenantDb
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

    // ponytail: 走 ollama /api/generate + raw 模式,绕过 ollama 内置 chat template 强制注入的
    // thinking envelope(qwen3/minicpm 都中招),让模型直接出答复。
    // 非 ollama 端点(OpenAI 兼容 /v1/chat/completions)走标准 chat 路径。
    const isOllama = baseURL.includes("11434");
    const upstreamURL = isOllama ? `${baseURL.replace(/\/v1$/, "")}/api/generate` : `${baseURL}/chat/completions`;
    const upstreamBody = isOllama
      ? JSON.stringify({
          model,
          prompt: `<|im_start|>user\n${systemPrompt}<|im_end|>\n<|im_start|>assistant\n`,
          stream: true,
          raw: true,
          options: { temperature: 0.3, num_predict: 1024 },
        })
      : JSON.stringify({
          model,
          temperature: 0.3,
          stream: true,
          messages: [{ role: "user", content: systemPrompt }],
        });

    const abort = new AbortController();
    const killer = setTimeout(() => abort.abort(), 60000);
    const upstream = await fetch(upstreamURL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
      body: upstreamBody,
      signal: abort.signal,
    }).finally(() => clearTimeout(killer));

    if (!upstream.ok || !upstream.body) {
      const errText = await upstream.text().catch(() => "");
      return NextResponse.json(
        { success: false, error: errText || `upstream ${upstream.status}` },
        { status: 502 }
      );
    }

    // ponytail: 用 TransformStream + 直接 pipe ollama body,避开 Next.js dev mode 对自定义
    // ReadableStream 的 buffering bug;同时关掉 instrumentation hint,让 stream 真走 chunked。
    if (!upstream.body) {
      return NextResponse.json(
        { success: false, error: "upstream returned no body" },
        { status: 502 }
      );
    }
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const encoder = new TextEncoder();
    const decoder = new TextDecoder();
    let carry = "";

    void (async () => {
      const reader = upstream.body!.getReader();
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            carry += decoder.decode();
            const text = decodeSseDelta(carry.trim());
            if (text) await writer.write(encoder.encode(text));
            break;
          }
          carry += decoder.decode(value, { stream: true });
          const lines = carry.split(/\r?\n/);
          carry = lines.pop() || "";
          for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed) continue;
            const body = trimmed.startsWith("data:") ? trimmed.replace(/^data:\s*/, "").trim() : trimmed;
            if (body === "[DONE]") continue;
            const text = decodeSseDelta(body);
            if (text) await writer.write(encoder.encode(text));
          }
        }
      } finally {
        try { await writer.close(); } catch { /* already closed */ }
      }
    })();

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
