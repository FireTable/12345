import { and, inArray, sql } from "drizzle-orm";
import { createAbortError, linkAbortSignals } from "@civic/system-two";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { updateTaskProgress } from "@/lib/task-progress";
import { stagePercent } from "@/lib/pipeline-progress";
import { yieldToEventLoop } from "@/lib/yield-loop";
import { LLM_TIMEOUTS, LLM_TOKENS } from "@/lib/tokens";
import { getSystemTwoEngine } from "@/backend/model";
import { getLlmPool } from "@/backend/llm-pool";
import {
  BatchThemeEnrichmentSchema,
  buildBatchThemeEnrichmentPrompt,
} from "@/backend/prompt";
import type { EnrichedTicket, MultiFrequencyTheme, RiskLevel } from "@/backend/state";

const CHUNK = 3;
const BACKFILL_MAX_TOKENS = Math.min(2048, LLM_TOKENS.THEME_ADVICE);
const SAMPLE_IDS = 400;

export function themeNeedsAdvice(action: string | null | undefined): boolean {
  return !action || !action.trim();
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key] ?? row[key.toLowerCase()];
  return value == null ? "" : String(value);
}

function asRisk(value: string | null | undefined): RiskLevel {
  if (value === "HIGH" || value === "高危") return "HIGH";
  if (value === "MEDIUM" || value === "中") return "MEDIUM";
  return "LOW";
}

function sampleTicket(row: { title: string; summarizeTitle: string; subdistrict: string }): EnrichedTicket {
  return {
    id: "",
    ticketNo: "",
    title: row.title,
    summarizeTitle: row.summarizeTitle,
    subdistrict: row.subdistrict,
    createTime: "",
    citizenName: "",
    citizenPhone: "",
    content: "",
    channel: "",
    status: "PENDING",
    entities: [],
    relations: [],
    themes: [],
    canonicalSubject: "",
    canonicalLocation: "",
    eventType: "",
  };
}

export async function countThemesMissingAdvice(regionId: string): Promise<number> {
  const { db } = await getRegionDb(regionId);
  const result = await db.execute(sql`
    SELECT count(*)::int AS missing
    FROM themes
    WHERE recommended_action IS NULL OR btrim(recommended_action) = ''
  `);
  return Number(cell(rowsOf(result)[0] || {}, "missing") || 0);
}

async function enrichBackfillBatchWithLLM(
  themeBatch: MultiFrequencyTheme[],
  signal?: AbortSignal
): Promise<Array<Partial<MultiFrequencyTheme>>> {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
  if (themeBatch.length === 0) return [];
  const linked = linkAbortSignals(LLM_TIMEOUTS.EXTRACTION, signal);

  try {
    const merged = themeBatch.map((theme) => ({
      aiSummary: theme.aiSummary || "",
      recommendedAction: "",
    }));
    for (let attempt = 0; attempt < 2; attempt++) {
      if (signal?.aborted) {
        throw createAbortError(signal);
      }
      if (linked.signal.aborted) break;
      if (attempt > 0 && merged.every((row) => row.recommendedAction.trim())) break;
      try {
        const systemTwo = await getSystemTwoEngine();
        if (signal?.aborted) {
          throw createAbortError(signal);
        }
        const prompt = buildBatchThemeEnrichmentPrompt(themeBatch);
        const { data } = await systemTwo.createJSON(BatchThemeEnrichmentSchema, {
          messages: [{ role: "user", content: prompt }],
          enableThinking: false,
          maxTokens: BACKFILL_MAX_TOKENS,
          temperature: 0.2,
          signal: linked.signal,
        });
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          const resultMap = new Map<number, any>();
          data.results.forEach((row) => resultMap.set(row.themeIndex, row));
          themeBatch.forEach((theme, index) => {
            const row = resultMap.get(index + 1) || data.results[index];
            if (!row) return;
            if (!merged[index].aiSummary.trim()) {
              merged[index].aiSummary =
                (typeof row.aiSummary === "string" ? row.aiSummary : "") || theme.aiSummary || "";
            }
            if (!merged[index].recommendedAction.trim()) {
              merged[index].recommendedAction =
                typeof row.recommendedAction === "string" ? row.recommendedAction : "";
            }
          });
        }
      } catch (err: any) {
        if (signal?.aborted) {
          throw createAbortError(signal);
        }
        if (linked.signal.aborted) break;
        console.warn(`[advice-backfill] System-2 chunk error attempt ${attempt + 1}:`, err?.message);
      }
      if (merged.every((row) => row.recommendedAction.trim())) return merged;
      if (attempt < 1) {
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }
    return merged;
  } finally {
    linked.cleanup();
  }
}

/**
 * 只给还没有处置建议的聚类补摘要和建议。不改成员，不删主题。
 * 模型处于离线兜底时停下来，避免把空结果再写一遍。
 */
export async function fillThemesMissingAdvice(
  regionId: string,
  taskId?: string,
  options?: { themeIds?: string[] }
): Promise<number> {
  if (options?.themeIds && options.themeIds.length === 0) return 0;

  const { db } = await getRegionDb(regionId);
  const missingCondition = sql`${themesTable.recommendedAction} IS NULL OR btrim(${themesTable.recommendedAction}) = ''`;
  const whereClause =
    options?.themeIds && options.themeIds.length > 0
      ? and(missingCondition, inArray(themesTable.id, options.themeIds))
      : missingCondition;

  const missingRows = await db
    .select({
      id: themesTable.id,
      title: themesTable.title,
      canonicalSubject: themesTable.canonicalSubject,
      canonicalLocation: themesTable.canonicalLocation,
      eventType: themesTable.eventType,
      category: themesTable.category,
      riskLevel: themesTable.riskLevel,
      riskReason: themesTable.riskReason,
      ticketCount: themesTable.ticketCount,
      timeSpanHours: themesTable.timeSpanHours,
      aiSummary: themesTable.aiSummary,
    })
    .from(themesTable)
    .where(whereClause);

  if (missingRows.length === 0) return 0;

  const samples = new Map<string, EnrichedTicket[]>();
  for (let offset = 0; offset < missingRows.length; offset += SAMPLE_IDS) {
    const ids = missingRows.slice(offset, offset + SAMPLE_IDS).map((row) => row.id);
    const idList = sql.join(ids.map((id) => sql`${id}`), sql`, `);
    const result = await db.execute(sql`
      SELECT theme_id, summarize_title, title, subdistrict
      FROM (
        SELECT tt.theme_id, t.summarize_title, t.title, t.subdistrict,
               row_number() OVER (PARTITION BY tt.theme_id ORDER BY t.create_time DESC NULLS LAST) AS rn
        FROM ticket_themes tt
        JOIN tickets t ON t.id = tt.ticket_id
        WHERE tt.theme_id IN (${idList})
      ) ranked
      WHERE rn <= 2
    `);
    for (const row of rowsOf(result)) {
      const themeId = cell(row, "theme_id");
      const list = samples.get(themeId) || [];
      list.push(sampleTicket({
        title: cell(row, "title"),
        summarizeTitle: cell(row, "summarize_title"),
        subdistrict: cell(row, "subdistrict"),
      }));
      samples.set(themeId, list);
    }
    await yieldToEventLoop();
  }

  const themes: MultiFrequencyTheme[] = missingRows.map((row) => ({
    id: row.id,
    title: row.title,
    canonicalSubject: row.canonicalSubject,
    canonicalLocation: row.canonicalLocation,
    eventType: row.eventType,
    category: row.category || "",
    riskLevel: asRisk(row.riskLevel),
    riskReason: row.riskReason || "",
    ticketCount: row.ticketCount,
    timeSpanHours: row.timeSpanHours || 1,
    firstOccurrence: "",
    lastOccurrence: "",
    aiSummary: row.aiSummary || "",
    recommendedAction: "",
    tickets: samples.get(row.id) || [],
    relatedSubjects: [],
    relatedLocations: [],
    status: "CONFIRMED",
  }));

  let filled = 0;
  let finished = 0;
  let emptyStreak = 0;
  let stopped = false;
  let invalidatedAt = 0;
  console.log(`[summary] 补建议：${themes.length} 个聚类还没有处置建议`);

  // 和抽取一样进共用队列；小批 CHUNK=3 + 交互请求让行，防止长期占用单槽位本地大模型
  const queue = getLlmPool();
  const waitIfInteractiveBusy = async () => {
    for (let wait = 0; wait < 20; wait++) {
      const stats = queue.getStats();
      if (stats.interactiveQueued === 0 && stats.activeInteractive === 0) break;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    await yieldToEventLoop();
  };

  for (let index = 0; index < themes.length; index += CHUNK) {
    if (stopped) break;
    await waitIfInteractiveBusy();
    if (stopped) break;
    const batch = themes.slice(index, index + CHUNK);
    await queue.add(
      async ({ signal }) => {
        if (stopped) return;
        const results = await enrichBackfillBatchWithLLM(batch, signal);
        let wrote = 0;
        for (let offset = 0; offset < batch.length; offset++) {
          const theme = batch[offset];
          const advice = (results[offset]?.recommendedAction || "").trim();
          if (!advice) continue;
          const summary = (results[offset]?.aiSummary || theme.aiSummary || "").trim();
          await db
            .update(themesTable)
            .set({
              aiSummary: summary || null,
              recommendedAction: advice,
            })
            .where(sql`${themesTable.id} = ${theme.id} AND (${themesTable.recommendedAction} IS NULL OR btrim(${themesTable.recommendedAction}) = '')`);
          wrote += 1;
        }
        filled += wrote;
        finished += batch.length;
        const done = Math.min(finished, themes.length);
        console.log(`[summary] 补建议 ${done}/${themes.length}，已写入 ${filled}`);
        if (taskId) {
          updateTaskProgress(taskId, regionId, {
            stage: "SYNTHESIZING",
            stageText: `正在补写没有建议的聚类 (${done}/${themes.length})`,
            percent: stagePercent("SUMMARY", done, themes.length),
            themeCount: themes.length,
          });
        }
        if (wrote === 0) {
          emptyStreak += 1;
          const backend = (await getSystemTwoEngine()).getActiveBackend();
          if (!stopped && (backend.includes("Fallback") || emptyStreak >= 2)) {
            stopped = true;
            console.warn(`[summary] 补建议停下：连续没有写出建议（${backend}），已写入 ${filled}`);
          }
        } else {
          emptyStreak = 0;
        }
        const bucket = Math.floor(filled / 100);
        if (bucket > invalidatedAt) {
          invalidatedAt = bucket;
          invalidateCivicAggregates(regionId);
        }
      },
      { lane: "batch" }
    );
  }

  if (filled > 0) invalidateCivicAggregates(regionId);
  return filled;
}
