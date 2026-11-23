/**
 * 副驾驶工具。全部绑在一次请求的 regionId 上，模型不能改区。
 * 所有工具均为只读或待确认提案生成，绝不直接写入数据库。
 */
import { tool } from "@langchain/core/tools";
import { and, desc, eq, ilike, inArray, notInArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { embedEndpointsFromEnv, getSharedEmbedClient } from "@/backend/embed-products";
import { anonymize, deanonymize, ticketBodyForAI } from "@/backend/anonymizer";
import { getRerankModel } from "@/backend/model";
import { searchTicketsByVector } from "@/lib/ticket-embeddings";
import type { DomainType } from "@/lib/domain-profile";

export interface CopilotToolsOptions {
  sessionKeymap?: Record<string, string>;
  signal?: AbortSignal;
}

const loose = z.object({}).passthrough();

const QUERY_STOPWORDS = new Set([
  "工单",
  "客诉",
  "投诉",
  "诉求",
  "问题",
  "情况",
  "记录",
  "查询",
  "搜索",
  "检索",
  "帮我",
  "一下",
  "有关",
  "关于",
]);

function clip(text: string | null | undefined, max = 280): string {
  const clean = (text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  return `${clean.slice(0, max)}…`;
}

function town(value: string | null | undefined): string {
  const text = (value || "").trim();
  return text || "未知";
}

function clampLimit(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(1, Math.trunc(parsed)));
}

function escapeLike(value: unknown): string {
  return String(value || "")
    .replace(/[%_\\]/g, "")
    .trim()
    .slice(0, 60);
}

function keywordLike(value: unknown): string | null {
  const text = escapeLike(value).slice(0, 40);
  return text ? `%${text}%` : null;
}

function rowsOf(result: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(result)) return result as Array<Record<string, unknown>>;
  if (result && typeof result === "object" && Array.isArray((result as { rows?: unknown[] }).rows)) {
    return (result as { rows: Array<Record<string, unknown>> }).rows;
  }
  return [];
}

function cell(row: Record<string, unknown>, key: string): string {
  const value = row[key] ?? row[key.toLowerCase()] ?? "";
  return value == null ? "" : String(value);
}

function isMissingRelationError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const errObj = error as { code?: unknown; cause?: { code?: unknown }; message?: unknown };
  if (errObj.code === "42P01" || errObj.cause?.code === "42P01") return true;
  const msg = error instanceof Error ? error.message : String(errObj.message || "");
  return /relation .* does not exist|does not exist/i.test(msg);
}

function parseOptionalBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value === "string") {
    const s = value.trim().toLowerCase();
    if (!s) return undefined;
    if (s === "true" || s === "1" || s === "yes" || s === "是") return true;
    if (s === "false" || s === "0" || s === "no" || s === "否") return false;
  }
  return undefined;
}

function normalizeStatusFilter(value: unknown): string | undefined {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return undefined;
  if (s === "PENDING" || s === "待处置" || s === "待处理") return "PENDING";
  if (s === "IN_PROGRESS" || s === "处置中" || s === "处理中") return "IN_PROGRESS";
  if (s === "RESOLVED" || s === "已办结" || s === "已解决" || s === "CLOSED") return "RESOLVED";
  if (s === "REOPENED" || s === "重开" || s === "已重开") return "REOPENED";
  return undefined;
}

function normalizeUrgencyFilter(value: unknown): string | undefined {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return undefined;
  if (s === "HIGH") return "HIGH";
  if (s === "URGENT" || s === "紧急" || s === "高危" || s === "加急") return "URGENT";
  if (s === "MEDIUM" || s === "较急" || s === "中") return "MEDIUM";
  if (s === "NORMAL" || s === "一般" || s === "普通") return "NORMAL";
  return undefined;
}

function normalizeRiskFilter(value: unknown): string | undefined {
  const s = String(value || "").trim().toUpperCase();
  if (!s) return undefined;
  if (s === "HIGH" || s === "高" || s === "高风险" || s === "高危") return "HIGH";
  if (s === "MEDIUM" || s === "中" || s === "中风险") return "MEDIUM";
  if (s === "LOW" || s === "低" || s === "低风险") return "LOW";
  return undefined;
}

function createAbortError(signal?: AbortSignal): Error {
  const reason = signal?.reason;
  if (reason instanceof Error) {
    if (reason.name !== "AbortError") reason.name = "AbortError";
    return reason;
  }
  const message = typeof reason === "string" && reason.trim() ? reason : "The operation was aborted";
  const err = new Error(message);
  err.name = "AbortError";
  return err;
}

function isAbortError(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && (error as { name?: unknown }).name === "AbortError");
}

export function deanonymizeArgs<T>(input: T, sessionKeymap?: Record<string, string>): T {
  if (!input || !sessionKeymap || Object.keys(sessionKeymap).length === 0) {
    return input;
  }
  if (typeof input === "string") {
    return deanonymize(input, sessionKeymap) as unknown as T;
  }
  if (Array.isArray(input)) {
    return input.map((item) => deanonymizeArgs(item, sessionKeymap)) as unknown as T;
  }
  if (typeof input === "object") {
    const record = input as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(record)) {
      out[k] = deanonymizeArgs(v, sessionKeymap);
    }
    return out as T;
  }
  return input;
}

const PLATE_CAPTURE_REGEX =
  /([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Za-z])[·•・\-\s]?([A-Za-z0-9]{3,5}[A-Za-z0-9挂学警港澳])/g;
const NORMALIZED_PLATE_REGEX =
  /^[粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Z][A-Z0-9]{3,5}[A-Z0-9挂学警港澳]$/;
const ZH_WORD_SEGMENTER = new Intl.Segmenter("zh-CN", { granularity: "word" });
const QUERY_FILLER_WORDS = new Set([
  "今天",
  "昨天",
  "前天",
  "刚才",
  "刚刚",
  "目前",
  "现在",
  "一点",
  "两点",
  "三点",
  "左右",
  "已经",
  "一直",
  "导致",
  "附近",
  "无法",
  "正常",
  "超过",
  "以及",
  "因为",
  "所以",
  "如果",
  "然后",
  "可以",
  "需要",
  "进行",
  "存在",
  "出现",
  "希望",
  "要求",
  "反映",
  "投诉",
  "市民",
]);
const SINGLE_CHAR_STOP = new Set([
  "的",
  "了",
  "和",
  "与",
  "及",
  "对",
  "把",
  "被",
  "给",
  "从",
  "到",
  "向",
  "为",
  "因",
  "在",
  "有",
  "无",
  "不",
  "很",
  "太",
  "最",
  "都",
  "也",
  "又",
  "再",
  "还",
  "就",
  "却",
  "而",
  "并",
  "或",
  "但",
]);

function buildPlateVariants(plate: string): string[] {
  const upper = plate.trim().toUpperCase();
  if (!NORMALIZED_PLATE_REGEX.test(upper)) return [plate];
  const prefix = upper.slice(0, 2);
  const suffix = upper.slice(2);
  return Array.from(
    new Set([upper, `${prefix}·${suffix}`, `${prefix}-${suffix}`, `${prefix}・${suffix}`])
  );
}

export function extractQueryTokens(rawQuery: string): {
  phrase: string;
  anchorTerms: string[];
  tokens: string[];
} {
  const rawCleaned = String(rawQuery || "")
    .replace(/[%_\\]/g, "")
    .replace(
      PLATE_CAPTURE_REGEX,
      (_match, prefix: string, suffix: string) => `${prefix.toUpperCase()}${suffix.toUpperCase()}`
    );

  const phrase = rawCleaned
    .replace(/[，。？！、；：""''“”‘’（）()【】「」『』《》〈〉·•・…—～~`!@#$%^&*+=|<>?/,:\[\]{};"']+/g, " ")
    .replace(/(?<![A-Za-z0-9])[.-]|[.-](?![A-Za-z0-9])/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

  if (!phrase) return { phrase: "", anchorTerms: [], tokens: [] };

  const rawParts = phrase
    .split(/\s+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  const nonStop = rawParts.filter((p) => !QUERY_STOPWORDS.has(p));
  const sourceParts = nonStop.length > 0 ? nonStop : rawParts;
  const interleavedParts: string[] = [];
  if (sourceParts.length > 6) {
    for (let lo = 0, hi = sourceParts.length - 1; lo <= hi; lo += 1, hi -= 1) {
      interleavedParts.push(sourceParts[lo]!);
      if (lo < hi) {
        interleavedParts.push(sourceParts[hi]!);
      }
    }
  } else {
    interleavedParts.push(...sourceParts);
  }
  const anchorTerms = interleavedParts.slice(0, 6);

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (tok: string) => {
    const clean = tok.trim();
    if (clean.length < 2 || QUERY_STOPWORDS.has(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  const chineseSegments: string[] = [];
  const seenSeg = new Set<string>();

  for (const part of anchorTerms) {
    add(part);

    const plateSuffixes = new Set<string>();
    for (const plate of part.match(PLATE_CAPTURE_REGEX) || []) {
      const upper = plate.trim().toUpperCase();
      plateSuffixes.add(upper.slice(1));
      for (const variant of buildPlateVariants(plate)) {
        add(variant);
      }
    }
    const partWithoutPlates = part.replace(PLATE_CAPTURE_REGEX, " ");
    for (const code of partWithoutPlates.match(/[A-Za-z0-9]+(?:-[A-Za-z0-9]+)*/g) || []) {
      const upperCode = code.toUpperCase();
      const isPlatePart = Array.from(plateSuffixes).some(
        (ps) => ps === upperCode || ps.startsWith(upperCode)
      );
      if (code.length >= 2 && !isPlatePart) add(code);
    }
    for (const mixed of part.match(/\d+[号栋座室路街期区楼层线]{1,2}/g) || []) {
      add(mixed);
    }
    for (const seg of part.match(/[\u4e00-\u9fff]{2,}/g) || []) {
      if (!seenSeg.has(seg)) {
        seenSeg.add(seg);
        chineseSegments.push(seg);
      }
    }
  }

  for (const seg of chineseSegments) {
    add(seg);
  }

  // Word-segmented Chinese tokens + adjacent 1-char pairs + balanced start/tail/middle bigrams
  const segPrimary: string[][] = [];
  const segSecondary: string[][] = [];
  const segFallback: string[][] = [];

  for (const seg of chineseSegments) {
    if (seg.length < 3) continue;
    const primary: string[] = [];
    const secondary: string[] = [];
    const fallback: string[] = [];
    const wordParts = Array.from(ZH_WORD_SEGMENTER.segment(seg)).filter((item) => item.isWordLike);

    for (let idx = 0; idx < wordParts.length; idx += 1) {
      const part = wordParts[idx];
      if (part.segment.length >= 2) {
        if (QUERY_FILLER_WORDS.has(part.segment)) {
          secondary.push(part.segment);
        } else {
          primary.push(part.segment);
        }
        if (part.segment.length >= 4) {
          for (let i = 0; i + 2 <= part.segment.length; i += 1) {
            fallback.push(part.segment.slice(i, i + 2));
          }
        }
      } else if (part.segment.length === 1) {
        const next = wordParts[idx + 1];
        if (
          next &&
          next.segment.length === 1 &&
          part.index + 1 === next.index &&
          !SINGLE_CHAR_STOP.has(part.segment) &&
          !SINGLE_CHAR_STOP.has(next.segment)
        ) {
          const pair = `${part.segment}${next.segment}`;
          if (QUERY_FILLER_WORDS.has(pair)) {
            secondary.push(pair);
          } else {
            primary.push(pair);
          }
        } else if (part.index + 2 <= seg.length && !SINGLE_CHAR_STOP.has(part.segment)) {
          fallback.push(seg.slice(part.index, part.index + 2));
        }
      }
    }

    // Spread remaining sliding bigrams across start, tail, and middle
    const totalBigrams = seg.length - 1;
    for (let step = 0; step < totalBigrams; step += 1) {
      const pos = step % 2 === 0 ? Math.floor(step / 2) : totalBigrams - 1 - Math.floor(step / 2);
      if (pos >= 0 && pos + 2 <= seg.length) {
        fallback.push(seg.slice(pos, pos + 2));
      }
    }

    // Interleave primary words from start and tail so long queries retain both leading context and trailing complaint keywords
    const interleavedPrimary: string[] = [];
    for (let lo = 0, hi = primary.length - 1; lo <= hi; lo += 1, hi -= 1) {
      interleavedPrimary.push(primary[lo]!);
      if (lo < hi) {
        interleavedPrimary.push(primary[hi]!);
      }
    }

    segPrimary.push(interleavedPrimary);
    segSecondary.push(secondary);
    segFallback.push(fallback);
  }

  for (const group of [segPrimary, segSecondary, segFallback]) {
    const maxLen = group.reduce((m, arr) => Math.max(m, arr.length), 0);
    for (let i = 0; i < maxLen && out.length < 12; i += 1) {
      for (const arr of group) {
        if (i < arr.length && out.length < 12) {
          add(arr[i]);
        }
      }
    }
  }

  return { phrase, anchorTerms, tokens: out.slice(0, 12) };
}

export function isSemanticQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2) return false;
  if (/^(?:\{\{[A-Z0-9_]+\}\}\s*)+$/.test(trimmed)) return false;
  if (/^(?:EC|IN|GV|TK|SKU|TH|THEME)?[-_]?(?=[A-Z0-9-]*\d)[A-Za-z0-9-]{2,}$/i.test(trimmed)) {
    return false;
  }
  if (
    /^[粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵青藏川宁琼][A-Z][·•・\-\s]?[A-Z0-9]{3,5}[A-Z0-9挂学警港澳]$/i.test(
      trimmed
    )
  ) {
    return false;
  }
  return /[\u4e00-\u9fffA-Za-z]{2,}/.test(trimmed);
}

function withTimeout<T>(
  work: Promise<T>,
  ms: number,
  message: string,
  signal?: AbortSignal
): Promise<T> {
  if (signal?.aborted) {
    return Promise.reject(createAbortError(signal));
  }
  return new Promise((resolve, reject) => {
    let settled = false;
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(createAbortError(signal));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener("abort", onAbort);
      reject(new Error(message));
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });

    work.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(error);
      }
    );
  });
}

async function embedQuery(
  text: string,
  timeoutMs = 3500,
  signal?: AbortSignal
): Promise<number[]> {
  if (signal?.aborted) {
    throw createAbortError(signal);
  }
  const client = getSharedEmbedClient({
    endpoints: embedEndpointsFromEnv(),
    profile: "online",
    apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",
  });
  const [vector] = await withTimeout(
    client.embed([text.trim().slice(0, 500) || "空查询"], { signal, timeoutMs }),
    timeoutMs,
    "工单向量检索超时",
    signal
  );
  return vector || [];
}

function buildTicketTermOrClause(pattern: string): SQL {
  return or(
    ilike(ticketsTable.ticketNo, pattern),
    ilike(ticketsTable.title, pattern),
    ilike(ticketsTable.summarizeTitle, pattern),
    ilike(ticketsTable.content, pattern),
    ilike(ticketsTable.canonicalSubject, pattern),
    ilike(ticketsTable.address, pattern),
    ilike(ticketsTable.subdistrict, pattern),
    ilike(ticketsTable.sourceCategory, pattern)
  )!;
}

function buildTicketTermOrClauseForTerm(term: string): SQL {
  const variants = buildPlateVariants(term);
  if (variants.length <= 1) {
    return buildTicketTermOrClause(`%${term}%`);
  }
  return or(...variants.map((v) => buildTicketTermOrClause(`%${v}%`)))!;
}

function buildOverlapTerms(phrase: string, anchorTerms: string[], tokens: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const add = (term: string) => {
    const clean = term.trim().toLowerCase();
    if (clean.length < 2 || QUERY_STOPWORDS.has(clean) || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  if (anchorTerms.length >= 2) {
    for (const a of anchorTerms) {
      if (a.length <= 6) {
        add(a);
      } else {
        for (const t of tokens) {
          if (t !== a && a.includes(t)) add(t);
        }
        if (!out.some((x) => a.toLowerCase().includes(x))) add(a);
      }
    }
    for (const t of tokens) {
      if (t !== phrase && !anchorTerms.includes(t) && t.length <= 8) {
        add(t);
      }
    }
  } else {
    for (const t of tokens) {
      if (t !== phrase || tokens.length === 1) {
        add(t);
      }
    }
    if (out.length === 0 && phrase) add(phrase);
  }
  return out;
}

interface TicketSearchHit {
  ticketNo: string;
  title: string;
  township: string;
  category: string;
  subject: string;
  eventType: string;
  address: string;
  urgency: string;
  status: string;
  isFakeClosure: boolean;
  stabilityRisk: boolean;
  themeId: string;
  body: string;
  similarity?: number;
  matchSource: "hybrid" | "sql" | "vector";
  _rankScore: number;
  _createTimeMs: number;
}

export function createCopilotTools(
  regionId: string,
  domainType: DomainType = "GOV_12345",
  options?: CopilotToolsOptions
) {
  const isEcommerce = domainType === "ECOMMERCE_CS";
  const sessionKeymap = options?.sessionKeymap;
  const toolSignal = options?.signal;

  const restoreArgs = <T>(input: T): T => deanonymizeArgs(input, sessionKeymap);

  const maskText = (value: string | null | undefined): string => {
    const raw = (value || "").trim();
    if (!raw) return "";
    const res = anonymize(raw, sessionKeymap ? { seedKeymap: sessionKeymap } : undefined);
    if (sessionKeymap && res.keymap && Object.keys(res.keymap).length > 0) {
      Object.assign(sessionKeymap, res.keymap);
    }
    return res.text;
  };

  const bodyForAI = (row: { content?: string | null; maskedContent?: string | null }): string => {
    if (sessionKeymap) {
      return row.content && row.content.length > 0
        ? row.content
        : row.maskedContent || "";
    }
    return ticketBodyForAI(row);
  };

  const searchTickets = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) {
        throw createAbortError(activeSignal);
      }
      const input = restoreArgs(rawInput);
      const rawQuery = String(input.query || "").trim();
      const maskedQuery = maskText(rawQuery);
      const statusFilter = normalizeStatusFilter(input.status);
      const urgencyFilter = normalizeUrgencyFilter(input.urgency);
      const subdistrictFilter = escapeLike(input.subdistrict);
      const categoryFilter = escapeLike(input.category);
      const isFakeClosureFilter = parseOptionalBool(input.isFakeClosure);
      const stabilityRiskFilter = parseOptionalBool(input.stabilityRisk);
      const limit = clampLimit(input.limit, 8, 12);
      const recallLimit = Math.min(48, Math.max(limit * 4, 24));
      const vectorLimit = Math.min(32, Math.max(limit * 3, 16));

      const hasStructuredFilter = Boolean(
        statusFilter ||
          urgencyFilter ||
          subdistrictFilter ||
          categoryFilter ||
          isFakeClosureFilter !== undefined ||
          stabilityRiskFilter !== undefined
      );

      const { phrase, anchorTerms, tokens } = extractQueryTokens(rawQuery);
      if (!phrase && !hasStructuredFilter) {
        return JSON.stringify({
          hits: [],
          retrievalMode: "none",
          note: "请提供有效关键词或筛选条件",
        });
      }

      const structuredFilters: SQL[] = [];
      if (statusFilter) {
        structuredFilters.push(sql`upper(coalesce(${ticketsTable.status}, 'PENDING')) = ${statusFilter}`);
      }
      if (urgencyFilter) {
        structuredFilters.push(sql`upper(coalesce(${ticketsTable.urgency}, 'NORMAL')) = ${urgencyFilter}`);
      }
      if (subdistrictFilter) {
        structuredFilters.push(ilike(ticketsTable.subdistrict, `%${subdistrictFilter}%`));
      }
      if (categoryFilter) {
        structuredFilters.push(ilike(ticketsTable.sourceCategory, `%${categoryFilter}%`));
      }
      if (isFakeClosureFilter === true) {
        structuredFilters.push(eq(ticketsTable.isFakeClosure, true));
      } else if (isFakeClosureFilter === false) {
        structuredFilters.push(sql`coalesce(${ticketsTable.isFakeClosure}, false) = false`);
      }
      if (stabilityRiskFilter === true) {
        structuredFilters.push(eq(ticketsTable.stabilityRisk, true));
      } else if (stabilityRiskFilter === false) {
        structuredFilters.push(sql`coalesce(${ticketsTable.stabilityRisk}, false) = false`);
      }

      const { db } = await getRegionDb(regionId);
      const anchorSet = new Set(anchorTerms);

      const ticketSelectFields = {
        ticketNo: ticketsTable.ticketNo,
        title: ticketsTable.title,
        summarizeTitle: ticketsTable.summarizeTitle,
        content: ticketsTable.content,
        maskedContent: ticketsTable.maskedContent,
        subdistrict: ticketsTable.subdistrict,
        category: ticketsTable.sourceCategory,
        subject: ticketsTable.canonicalSubject,
        eventType: ticketsTable.eventType,
        address: ticketsTable.address,
        urgency: ticketsTable.urgency,
        status: ticketsTable.status,
        isFakeClosure: ticketsTable.isFakeClosure,
        stabilityRisk: ticketsTable.stabilityRisk,
        themeId: ticketsTable.primaryThemeId,
        createTime: ticketsTable.createTime,
      };

      const sqlSearchPromise = (async () => {
        const scoreParts: SQL[] = [];

        if (phrase) {
          const phrasePat = `%${phrase}%`;
          scoreParts.push(
            sql`CASE WHEN lower(${ticketsTable.ticketNo}) = ${phrase.toLowerCase()} THEN 200 ELSE 0 END`
          );
          scoreParts.push(
            sql`CASE WHEN (coalesce(${ticketsTable.title}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.summarizeTitle}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.canonicalSubject}, '') ILIKE ${phrasePat}) THEN 80 WHEN (coalesce(${ticketsTable.content}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.address}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.subdistrict}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.sourceCategory}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.ticketNo}, '') ILIKE ${phrasePat}) THEN 40 ELSE 0 END`
          );
          for (const anchor of anchorTerms) {
            if (anchor === phrase) continue;
            const aPat = `%${anchor}%`;
            scoreParts.push(
              sql`CASE WHEN (coalesce(${ticketsTable.title}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.summarizeTitle}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.canonicalSubject}, '') ILIKE ${aPat}) THEN 32 WHEN (coalesce(${ticketsTable.content}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.address}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.subdistrict}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.sourceCategory}, '') ILIKE ${aPat} OR coalesce(${ticketsTable.ticketNo}, '') ILIKE ${aPat}) THEN 16 ELSE 0 END`
            );
          }
          for (const tok of tokens) {
            if (tok === phrase || anchorSet.has(tok)) continue;
            const tPat = `%${tok}%`;
            scoreParts.push(
              sql`CASE WHEN (coalesce(${ticketsTable.title}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.summarizeTitle}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.canonicalSubject}, '') ILIKE ${tPat}) THEN 16 WHEN (coalesce(${ticketsTable.content}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.address}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.subdistrict}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.sourceCategory}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.ticketNo}, '') ILIKE ${tPat}) THEN 8 ELSE 0 END`
            );
          }
          if (isFakeClosureFilter === undefined && /假闭环|反复投诉/.test(phrase)) {
            scoreParts.push(sql`CASE WHEN ${ticketsTable.isFakeClosure} = true THEN 30 ELSE 0 END`);
          }
          if (stabilityRiskFilter === undefined && /红线|涉稳/.test(phrase)) {
            scoreParts.push(sql`CASE WHEN ${ticketsTable.stabilityRisk} = true THEN 30 ELSE 0 END`);
          }
        }

        scoreParts.push(
          sql`(CASE WHEN ${ticketsTable.isFakeClosure} = true THEN 4 ELSE 0 END + CASE WHEN ${ticketsTable.stabilityRisk} = true THEN 4 ELSE 0 END + CASE WHEN upper(coalesce(${ticketsTable.urgency}, '')) IN ('URGENT', 'HIGH') THEN 2 ELSE 0 END)`
        );

        const scoreExpr =
          scoreParts.length > 1
            ? sql<number>`(${sql.join(scoreParts, sql` + `)})`
            : scoreParts[0]!;

        // Phase 1: AND-first precision across anchorTerms (or exact phrase when <= 1 anchorTerm)
        const phase1WhereParts: SQL[] = [...structuredFilters];
        if (anchorTerms.length >= 2) {
          for (const anchor of anchorTerms.slice(0, 4)) {
            phase1WhereParts.push(buildTicketTermOrClauseForTerm(anchor));
          }
        } else if (phrase) {
          phase1WhereParts.push(buildTicketTermOrClauseForTerm(phrase));
        }

        const phase1Rows = await db
          .select({
            ...ticketSelectFields,
            relevanceScore: scoreExpr,
          })
          .from(ticketsTable)
          .where(phase1WhereParts.length > 0 ? and(...phase1WhereParts) : undefined)
          .orderBy(desc(scoreExpr), desc(ticketsTable.createTime))
          .limit(recallLimit);

        // Phase 2: OR fallback/supplement if Phase 1 returned fewer than limit (or < min supplement threshold)
        const needFallback =
          Boolean(phrase) &&
          phase1Rows.length < Math.min(recallLimit, Math.max(limit * 2, 12)) &&
          (tokens.length > 0 ||
            (isFakeClosureFilter === undefined && /假闭环|反复投诉/.test(phrase)) ||
            (stabilityRiskFilter === undefined && /红线|涉稳/.test(phrase)));

        if (!needFallback) {
          return phase1Rows;
        }

        const queryMatchers: SQL[] = [buildTicketTermOrClause(`%${phrase}%`)];
        for (const tok of tokens) {
          if (tok !== phrase) {
            queryMatchers.push(buildTicketTermOrClause(`%${tok}%`));
          }
        }
        if (isFakeClosureFilter === undefined && /假闭环|反复投诉/.test(phrase)) {
          queryMatchers.push(eq(ticketsTable.isFakeClosure, true));
        }
        if (stabilityRiskFilter === undefined && /红线|涉稳/.test(phrase)) {
          queryMatchers.push(eq(ticketsTable.stabilityRisk, true));
        }

        const phase2WhereParts: SQL[] = [...structuredFilters, or(...queryMatchers)!];
        const seenNos = phase1Rows.map((r) => r.ticketNo).filter(Boolean);
        if (seenNos.length > 0) {
          phase2WhereParts.push(notInArray(ticketsTable.ticketNo, seenNos));
        }

        const phase2Rows = await db
          .select({
            ...ticketSelectFields,
            relevanceScore: scoreExpr,
          })
          .from(ticketsTable)
          .where(and(...phase2WhereParts))
          .orderBy(desc(scoreExpr), desc(ticketsTable.createTime))
          .limit(recallLimit - phase1Rows.length);

        return [...phase1Rows, ...phase2Rows];
      })();

      const vectorSearchPromise = (async () => {
        if (!phrase || !maskedQuery || !isSemanticQuery(maskedQuery)) return [];
        if (activeSignal?.aborted) {
          throw createAbortError(activeSignal);
        }
        try {
          const existsRes = await db.execute(
            sql`SELECT 1 FROM ticket_embeddings WHERE model = 'BAAI/bge-m3' LIMIT 1`
          );
          if (rowsOf(existsRes).length === 0) return [];
        } catch {
          return [];
        }

        try {
          const hits = await withTimeout(
            (async () => {
              const vector = await embedQuery(maskedQuery, 3500, activeSignal);
              if (vector.length === 0) return [];
              return searchTicketsByVector(regionId, vector, vectorLimit, {
                status: statusFilter,
                urgency: urgencyFilter,
                subdistrict: subdistrictFilter || undefined,
                category: categoryFilter || undefined,
                isFakeClosure: isFakeClosureFilter,
                stabilityRisk: stabilityRiskFilter,
              });
            })(),
            4200,
            "工单向量检索超时",
            activeSignal
          );
          return hits;
        } catch (err) {
          if (activeSignal?.aborted) {
            throw err;
          }
          return [];
        }
      })();

      const [sqlRows, rawVectorHits] = await Promise.all([sqlSearchPromise, vectorSearchPromise]);
      if (activeSignal?.aborted) {
        throw createAbortError(activeSignal);
      }

      const overlapTerms = buildOverlapTerms(phrase, anchorTerms, tokens);
      const countLexicalOverlap = (row: {
        ticketNo?: string | null;
        title?: string | null;
        summarizeTitle?: string | null;
        subject?: string | null;
        content?: string | null;
        maskedContent?: string | null;
        address?: string | null;
        subdistrict?: string | null;
        category?: string | null;
      }): number => {
        if (overlapTerms.length === 0) return 0;
        const haystack = [
          row.ticketNo,
          row.title,
          row.summarizeTitle,
          row.subject,
          row.content,
          row.maskedContent,
          row.address,
          row.subdistrict,
          row.category,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        let hits = 0;
        for (const term of overlapTerms) {
          if (haystack.includes(term)) hits += 1;
        }
        return hits;
      };

      const merged = new Map<string, TicketSearchHit>();

      for (const row of sqlRows) {
        const overlap = countLexicalOverlap(row);
        const multiTokenBonus = overlap >= 2 ? overlap * 35 : 0;
        const score = Number(row.relevanceScore || 0) + multiTokenBonus;
        merged.set(row.ticketNo, {
          ticketNo: row.ticketNo,
          title: maskText(row.summarizeTitle || row.title || ""),
          township: town(maskText(row.subdistrict)),
          category: row.category || "",
          subject: maskText(row.subject || ""),
          eventType: maskText(row.eventType || ""),
          address: maskText(row.address || ""),
          urgency: row.urgency || "NORMAL",
          status: row.status || "PENDING",
          isFakeClosure: Boolean(row.isFakeClosure),
          stabilityRisk: Boolean(row.stabilityRisk),
          themeId: row.themeId || "",
          body: clip(maskText(bodyForAI(row).replace(/\s+/g, " ").slice(0, 800)), 240),
          matchSource: "sql",
          _rankScore: score,
          _createTimeMs: row.createTime ? new Date(row.createTime).getTime() : 0,
        });
      }

      if (rawVectorHits.length > 0) {
        const vecNos = rawVectorHits.map((h) => h.ticketNo).filter(Boolean);
        const vecDetails =
          vecNos.length > 0
            ? await db
                .select(ticketSelectFields)
                .from(ticketsTable)
                .where(and(inArray(ticketsTable.ticketNo, vecNos), ...structuredFilters))
            : [];

        const detailMap = new Map(vecDetails.map((d) => [d.ticketNo, d]));
        for (const vHit of rawVectorHits) {
          const detail = detailMap.get(vHit.ticketNo);
          if (!detail) continue;

          const existing = merged.get(vHit.ticketNo);
          const simScore = Number((vHit.similarity * 35).toFixed(2));
          if (existing) {
            existing.matchSource = "hybrid";
            existing.similarity = vHit.similarity;
            existing._rankScore += simScore + 25;
          } else {
            const overlap = countLexicalOverlap(detail);
            const multiTokenBonus = overlap >= 2 ? overlap * 35 : overlap === 1 ? 8 : 0;
            merged.set(vHit.ticketNo, {
              ticketNo: detail.ticketNo,
              title: maskText(detail.summarizeTitle || detail.title || vHit.title || ""),
              township: town(maskText(detail.subdistrict)),
              category: detail.category || vHit.category || "",
              subject: maskText(detail.subject || vHit.subject || ""),
              eventType: maskText(detail.eventType || vHit.eventType || ""),
              address: maskText(detail.address || vHit.address || ""),
              urgency: detail.urgency || vHit.urgency || "NORMAL",
              status: detail.status || "PENDING",
              isFakeClosure: Boolean(detail.isFakeClosure),
              stabilityRisk: Boolean(detail.stabilityRisk),
              themeId: detail.themeId || vHit.themeId || "",
              body: clip(maskText(bodyForAI(detail).replace(/\s+/g, " ").slice(0, 800)), 240),
              similarity: vHit.similarity,
              matchSource: "vector",
              _rankScore: simScore + multiTokenBonus,
              _createTimeMs: detail.createTime ? new Date(detail.createTime).getTime() : 0,
            });
          }
        }
      }

      const candidates = Array.from(merged.values()).sort((a, b) => {
        if (b._rankScore !== a._rankScore) return b._rankScore - a._rankScore;
        return b._createTimeMs - a._createTimeMs;
      });

      if (phrase && maskedQuery && isSemanticQuery(maskedQuery) && candidates.length >= 2 && !activeSignal?.aborted) {
        const reranker = getRerankModel();
        if (reranker) {
          try {
            const topK = candidates.slice(0, Math.min(candidates.length, Math.max(limit * 2, 16)));
            const docs = topK.map(
              (h) => `${h.title} | ${h.subject} | ${h.township} | ${h.category} | ${h.body}`
            );
            const reranked = await withTimeout(
              reranker.rerank(maskedQuery, docs, docs.length),
              1500,
              "工单重排超时",
              activeSignal
            );
            for (const item of reranked) {
              const target = topK[item.index];
              if (!target || typeof item.score !== "number" || !Number.isFinite(item.score)) continue;
              target._rankScore = (target._rankScore >= 200 ? 200 : 0) + target._rankScore * 0.4 + item.score * 100;
            }
            candidates.sort((a, b) => {
              if (b._rankScore !== a._rankScore) return b._rankScore - a._rankScore;
              return b._createTimeMs - a._createTimeMs;
            });
          } catch (err) {
            if (activeSignal?.aborted) {
              throw err;
            }
            // Rerank failure/timeout falls back silently to hybrid score
          }
        }
      }

      const sortedHits = candidates
        .slice(0, limit)
        .map(({ _rankScore, _createTimeMs, ...rest }) => rest);

      const hasSql = sortedHits.some((h) => h.matchSource === "sql" || h.matchSource === "hybrid");
      const hasVec = sortedHits.some((h) => h.matchSource === "vector" || h.matchSource === "hybrid");
      const retrievalMode: "hybrid" | "sql" | "vector" =
        hasSql && hasVec ? "hybrid" : hasVec ? "vector" : "sql";

      if (sortedHits.length === 0) {
        return JSON.stringify({
          retrievalMode,
          hits: [],
          note: isEcommerce ? "当前站点没有找到符合条件的客诉工单" : "本区没有找到符合条件的工单",
        });
      }

      return JSON.stringify({
        retrievalMode,
        hits: sortedHits,
      });
    },
    {
      name: "search_tickets",
      description: isEcommerce
        ? "混合检索当前电商站点的售后客诉工单（SQL多列模糊+结构化过滤+可选语义向量），支持关键词、SKU/订单号、状态、紧急度、渠道/仓网、分类及假闭环/红线筛选。"
        : "混合检索本区工单（SQL多列模糊+结构化过滤+可选语义向量），支持关键词、工单号、状态、紧急度、镇街、分类及假闭环/涉稳筛选。",
      schema: loose.extend({
        query: z.string().optional(),
        status: z.string().optional(),
        urgency: z.string().optional(),
        subdistrict: z.string().optional(),
        category: z.string().optional(),
        isFakeClosure: z.union([z.boolean(), z.string()]).optional(),
        stabilityRisk: z.union([z.boolean(), z.string()]).optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      }),
    }
  );

  const searchThemes = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) throw createAbortError(activeSignal);
      const input = restoreArgs(rawInput);
      const like = keywordLike(input.keyword);
      const risk = normalizeRiskFilter(input.riskLevel);
      const handlingStatus = normalizeStatusFilter(input.handlingStatus);
      const categoryFilter = escapeLike(input.category);

      const filters: SQL[] = [];
      if (like) {
        filters.push(
          or(
            ilike(themesTable.title, like),
            ilike(themesTable.canonicalSubject, like),
            ilike(themesTable.canonicalLocation, like),
            ilike(themesTable.eventType, like),
            ilike(themesTable.category, like)
          )!
        );
      }
      if (risk) filters.push(sql`upper(coalesce(${themesTable.riskLevel}, 'LOW')) = ${risk}`);
      if (handlingStatus) {
        filters.push(sql`upper(coalesce(${themesTable.handlingStatus}, 'PENDING')) = ${handlingStatus}`);
      }
      if (categoryFilter) {
        filters.push(ilike(themesTable.category, `%${categoryFilter}%`));
      }

      const { db } = await getRegionDb(regionId);
      const limit = clampLimit(input.limit, 6, 10);
      const base = db
        .select({
          id: themesTable.id,
          title: themesTable.title,
          subject: themesTable.canonicalSubject,
          location: themesTable.canonicalLocation,
          eventType: themesTable.eventType,
          category: themesTable.category,
          riskLevel: themesTable.riskLevel,
          handlingStatus: themesTable.handlingStatus,
          handlingOwner: themesTable.handlingOwner,
          ticketCount: themesTable.ticketCount,
          summary: themesTable.aiSummary,
          action: themesTable.recommendedAction,
        })
        .from(themesTable)
        .orderBy(desc(themesTable.ticketCount))
        .limit(limit);
      const rows = filters.length ? await base.where(and(...filters)) : await base;
      return JSON.stringify({
        themes: rows.map((row) => ({
          themeId: row.id,
          title: maskText(row.title),
          subject: maskText(row.subject),
          location: town(maskText(row.location)),
          eventType: maskText(row.eventType),
          category: row.category || "",
          riskLevel: row.riskLevel,
          handlingStatus: row.handlingStatus || "PENDING",
          handlingOwner: maskText(row.handlingOwner),
          ticketCount: row.ticketCount,
          summary: clip(maskText(row.summary), 90),
          action: clip(maskText(row.action), 90),
        })),
      });
    },
    {
      name: "search_themes",
      description: isEcommerce
        ? "在当前站点客诉案卷表里按关键词、风险等级、处置状态或分类检索，不传条件时返回客诉量最高的案卷。"
        : "在本区主题表里按关键词、风险等级、处置状态或分类检索，不传条件时返回工单量最高的主题。",
      schema: loose.extend({
        keyword: z.string().optional(),
        riskLevel: z.string().optional(),
        handlingStatus: z.string().optional(),
        category: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      }),
    }
  );

  const getTicket = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) throw createAbortError(activeSignal);
      const input = restoreArgs(rawInput);
      const ticketNo = String(input.ticketNo || "").trim().slice(0, 64);
      if (!ticketNo) return JSON.stringify({ error: isEcommerce ? "缺少客诉单号" : "缺少工单号" });
      const { db } = await getRegionDb(regionId);
      const rows = await db
        .select({
          ticketNo: ticketsTable.ticketNo,
          title: ticketsTable.title,
          summarizeTitle: ticketsTable.summarizeTitle,
          content: ticketsTable.content,
          maskedContent: ticketsTable.maskedContent,
          subdistrict: ticketsTable.subdistrict,
          category: ticketsTable.sourceCategory,
          subject: ticketsTable.canonicalSubject,
          eventType: ticketsTable.eventType,
          address: ticketsTable.address,
          urgency: ticketsTable.urgency,
          status: ticketsTable.status,
          isFakeClosure: ticketsTable.isFakeClosure,
          stabilityRisk: ticketsTable.stabilityRisk,
          themeId: ticketsTable.primaryThemeId,
          createTime: ticketsTable.createTime,
        })
        .from(ticketsTable)
        .where(or(eq(ticketsTable.ticketNo, ticketNo), eq(ticketsTable.id, ticketNo)))
        .limit(1);
      const row = rows[0];
      if (!row) {
        return JSON.stringify({ error: isEcommerce ? "当前站点没有这张客诉工单" : "本区没有这张工单" });
      }
      return JSON.stringify({
        ticketNo: row.ticketNo,
        title: maskText(row.summarizeTitle || row.title || ""),
        township: town(maskText(row.subdistrict)),
        category: row.category || "",
        subject: maskText(row.subject || ""),
        eventType: maskText(row.eventType || ""),
        address: maskText(row.address || ""),
        urgency: row.urgency || "",
        status: row.status || "",
        isFakeClosure: Boolean(row.isFakeClosure),
        stabilityRisk: Boolean(row.stabilityRisk),
        themeId: row.themeId || "",
        body: clip(maskText(bodyForAI(row).replace(/\s+/g, " ").slice(0, 800)), 320),
      });
    },
    {
      name: "get_ticket",
      description: isEcommerce ? "按客诉单号读取当前站点的一张客诉工单。" : "按工单号读取本区的一张工单。",
      schema: loose.extend({ ticketNo: z.string().optional() }),
    }
  );

  const getTheme = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) throw createAbortError(activeSignal);
      const input = restoreArgs(rawInput);
      const themeId = String(input.themeId || "").trim().slice(0, 64);
      if (!themeId) return JSON.stringify({ error: isEcommerce ? "缺少客诉案卷编号" : "缺少主题编号" });
      const { db } = await getRegionDb(regionId);
      const rows = await db.select().from(themesTable).where(eq(themesTable.id, themeId)).limit(1);
      const theme = rows[0];
      if (!theme) {
        return JSON.stringify({ error: isEcommerce ? "当前站点没有这个客诉案卷" : "本区没有这个主题" });
      }
      const members = await db
        .select({ ticketNo: ticketsTable.ticketNo, title: ticketsTable.summarizeTitle })
        .from(ticketThemesTable)
        .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
        .where(eq(ticketThemesTable.themeId, themeId))
        .limit(5);
      return JSON.stringify({
        themeId: theme.id,
        title: maskText(theme.title),
        subject: maskText(theme.canonicalSubject),
        location: town(maskText(theme.canonicalLocation)),
        eventType: maskText(theme.eventType),
        category: theme.category || "",
        riskLevel: theme.riskLevel,
        handlingStatus: theme.handlingStatus || "PENDING",
        handlingOwner: maskText(theme.handlingOwner),
        handlingProgress: theme.handlingProgress ?? 0,
        ticketCount: theme.ticketCount,
        summary: clip(maskText(theme.aiSummary), 400),
        action: clip(maskText(theme.recommendedAction), 400),
        tickets: members.map((row) => ({
          ticketNo: row.ticketNo,
          title: clip(maskText(row.title), 80),
        })),
      });
    },
    {
      name: "get_theme",
      description: isEcommerce
        ? "按案卷编号读取当前站点的一个客诉案卷及其部分成员客诉单。"
        : "按主题编号读取本区的一个主题及其部分成员工单。",
      schema: loose.extend({ themeId: z.string().optional() }),
    }
  );

  const regionOverview = tool(
    async () => {
      const { db } = await getRegionDb(regionId);
      const [ticketAggRes, themeAggRes, embeddedCount, agentPendingTasks] = await Promise.all([
        db.execute(sql`
          SELECT
            count(*)::int AS tickets,
            count(*) FILTER (WHERE upper(coalesce(status, 'PENDING')) = 'PENDING')::int AS pending,
            count(*) FILTER (WHERE upper(coalesce(status, '')) = 'IN_PROGRESS')::int AS in_progress,
            count(*) FILTER (WHERE upper(coalesce(status, '')) = 'RESOLVED' OR upper(coalesce(closure_status, '')) = 'RESOLVED')::int AS resolved,
            count(*) FILTER (WHERE is_fake_closure = true)::int AS fake_closure,
            count(*) FILTER (WHERE stability_risk = true)::int AS stability_risk
          FROM tickets
        `),
        db.execute(sql`
          SELECT
            count(*)::int AS themes,
            count(*) FILTER (WHERE upper(coalesce(risk_level, '')) = 'HIGH')::int AS high_risk
          FROM themes
        `),
        (async () => {
          try {
            const r = await db.execute(
              sql`SELECT count(*)::int AS embedded FROM ticket_embeddings WHERE model = 'BAAI/bge-m3'`
            );
            return Number(cell(rowsOf(r)[0] || {}, "embedded") || 0);
          } catch (err) {
            if (isMissingRelationError(err)) return 0;
            return 0;
          }
        })(),
        (async () => {
          try {
            const r = await db.execute(
              sql`SELECT count(*) FILTER (WHERE upper(coalesce(status, 'PENDING')) NOT IN ('EXECUTED', 'REJECTED'))::int AS pending_tasks FROM agent_tasks`
            );
            return Number(cell(rowsOf(r)[0] || {}, "pending_tasks") || 0);
          } catch (err) {
            if (isMissingRelationError(err)) return 0;
            return 0;
          }
        })(),
      ]);

      const tRow = rowsOf(ticketAggRes)[0] || {};
      const thRow = rowsOf(themeAggRes)[0] || {};
      return JSON.stringify({
        tickets: Number(cell(tRow, "tickets") || 0),
        pending: Number(cell(tRow, "pending") || 0),
        inProgress: Number(cell(tRow, "in_progress") || 0),
        resolved: Number(cell(tRow, "resolved") || 0),
        fakeClosure: Number(cell(tRow, "fake_closure") || 0),
        stabilityRisk: Number(cell(tRow, "stability_risk") || 0),
        themes: Number(cell(thRow, "themes") || 0),
        highRiskThemes: Number(cell(thRow, "high_risk") || 0),
        embeddedTickets: embeddedCount,
        agentPendingTasks,
      });
    },
    {
      name: "region_overview",
      description: isEcommerce
        ? "统计当前电商站点的客诉总量、待处置、处置中、已办结、假闭环、红线客诉、案卷数、高风险案卷数、已嵌入条数及主动待办数。"
        : "统计当前区的工单总量、待处置、处置中、已办结、假闭环、涉稳风险、主题数、高风险主题数、已嵌入工单数及主动待办数。",
      schema: loose,
    }
  );

  const listTownships = tool(
    async () => {
      const { db } = await getRegionDb(regionId);
      const result = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(btrim(subdistrict), ''), '未知') AS name,
          count(*)::int AS tickets,
          count(*) FILTER (WHERE upper(coalesce(status, 'PENDING')) = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE upper(coalesce(urgency, '')) = 'URGENT' OR stability_risk = true)::int AS urgent
        FROM tickets
        GROUP BY 1
        ORDER BY tickets DESC
        LIMIT 10
      `);
      return JSON.stringify({
        unitType: isEcommerce ? "渠道/仓网" : "镇街",
        townships: rowsOf(result).map((row) => ({
          name: maskText(cell(row, "name")) || "未知",
          tickets: Number(cell(row, "tickets") || 0),
          pending: Number(cell(row, "pending") || 0),
          urgent: Number(cell(row, "urgent") || 0),
        })),
      });
    },
    {
      name: "list_townships",
      description: isEcommerce
        ? "列出当前电商站点客诉量最高的渠道或仓网及其待处置数、紧急/红线数。"
        : "列出当前区工单量最高的镇街及其待处置数、紧急/高危数。",
      schema: loose,
    }
  );

  const categoryStats = tool(
    async () => {
      const { db } = await getRegionDb(regionId);
      const result = await db.execute(sql`
        SELECT
          COALESCE(NULLIF(btrim(source_category), ''), '未分类') AS category,
          count(*)::int AS tickets,
          count(*) FILTER (WHERE upper(coalesce(status, 'PENDING')) = 'PENDING')::int AS pending,
          count(*) FILTER (WHERE upper(coalesce(urgency, '')) = 'URGENT' OR stability_risk = true)::int AS urgent
        FROM tickets
        GROUP BY 1
        ORDER BY tickets DESC
        LIMIT 20
      `);
      return JSON.stringify({
        categories: rowsOf(result).map((row) => ({
          category: maskText(cell(row, "category")) || "未分类",
          tickets: Number(cell(row, "tickets") || 0),
          pending: Number(cell(row, "pending") || 0),
          urgent: Number(cell(row, "urgent") || 0),
        })),
      });
    },
    {
      name: "category_stats",
      description: isEcommerce
        ? "统计当前电商站点各售后客诉分类的工单量、待处置数与紧急/红线数。"
        : "统计本区各业务分类的工单量、待处置数与紧急/高危数。",
      schema: loose,
    }
  );

  const listAgentTasks = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) throw createAbortError(activeSignal);
      const input = restoreArgs(rawInput);
      const { db } = await getRegionDb(regionId);
      const statusRaw = String(input.status || "").trim().toUpperCase();
      const levelRaw = String(input.autonomyLevel || "").trim().toUpperCase();
      const limit = clampLimit(input.limit, 6, 12);

      try {
        const filters: SQL[] = [];
        if (statusRaw) filters.push(sql`upper(coalesce(status, '')) = ${statusRaw}`);
        if (levelRaw) filters.push(sql`upper(coalesce(autonomy_level, '')) = ${levelRaw}`);
        const whereSql = filters.length > 0 ? sql`WHERE ${sql.join(filters, sql` AND `)}` : sql``;

        const [summaryRes, rowsRes] = await Promise.all([
          db.execute(sql`
            SELECT
              count(*)::int AS total,
              count(*) FILTER (WHERE upper(coalesce(status, '')) = 'PENDING')::int AS pending,
              count(*) FILTER (WHERE upper(coalesce(status, '')) = 'BLOCKED')::int AS blocked,
              count(*) FILTER (WHERE upper(coalesce(status, '')) NOT IN ('EXECUTED', 'REJECTED'))::int AS active,
              count(*) FILTER (WHERE upper(coalesce(status, '')) NOT IN ('EXECUTED', 'REJECTED') AND upper(coalesce(autonomy_level, '')) = 'L1_AUTO')::int AS l1_count,
              count(*) FILTER (WHERE upper(coalesce(status, '')) NOT IN ('EXECUTED', 'REJECTED') AND upper(coalesce(autonomy_level, '')) = 'L2_APPROVAL')::int AS l2_count,
              count(*) FILTER (WHERE upper(coalesce(status, '')) NOT IN ('EXECUTED', 'REJECTED') AND upper(coalesce(autonomy_level, '')) = 'L3_BLOCKED')::int AS l3_count
            FROM agent_tasks
          `),
          db.execute(sql`
            SELECT
              id, task_type, autonomy_level, status, target_type, target_id, target_title,
              channel, masked_contact, missing_slots_json, draft_message, suggested_owner,
              reason, result_summary, updated_at
            FROM agent_tasks
            ${whereSql}
            ORDER BY
              CASE WHEN upper(coalesce(status, '')) IN ('BLOCKED', 'PENDING') THEN 0 ELSE 1 END,
              updated_at DESC,
              created_at DESC
            LIMIT ${sql.raw(String(limit))}
          `),
        ]);

        const sRow = rowsOf(summaryRes)[0] || {};
        const tasks = rowsOf(rowsRes).map((row) => {
          let missingSlots: string[] = [];
          try {
            const parsed = JSON.parse(cell(row, "missing_slots_json") || "[]");
            if (Array.isArray(parsed)) missingSlots = parsed.map(String).filter(Boolean);
          } catch {
            missingSlots = [];
          }
          return {
            id: cell(row, "id"),
            taskType: cell(row, "task_type"),
            autonomyLevel: cell(row, "autonomy_level"),
            status: cell(row, "status"),
            targetType: cell(row, "target_type"),
            targetId: cell(row, "target_id"),
            targetTitle: maskText(cell(row, "target_title")),
            channel: cell(row, "channel"),
            maskedContact: cell(row, "masked_contact") ? maskText(cell(row, "masked_contact")) : null,
            missingSlots,
            suggestedOwner: cell(row, "suggested_owner") ? maskText(cell(row, "suggested_owner")) : null,
            reason: clip(maskText(cell(row, "reason")), 100),
            draftMessage: clip(maskText(cell(row, "draft_message")), 90),
            resultSummary: cell(row, "result_summary") ? maskText(cell(row, "result_summary")) : null,
          };
        });

        return JSON.stringify({
          available: true,
          summary: {
            total: Number(cell(sRow, "total") || 0),
            pending: Number(cell(sRow, "pending") || 0),
            blocked: Number(cell(sRow, "blocked") || 0),
            active: Number(cell(sRow, "active") || 0),
            l1Count: Number(cell(sRow, "l1_count") || 0),
            l2Count: Number(cell(sRow, "l2_count") || 0),
            l3Count: Number(cell(sRow, "l3_count") || 0),
          },
          tasks,
        });
      } catch (err) {
        if (isMissingRelationError(err)) {
          return JSON.stringify({
            available: false,
            summary: {
              total: 0,
              pending: 0,
              blocked: 0,
              active: 0,
              l1Count: 0,
              l2Count: 0,
              l3Count: 0,
            },
            tasks: [],
            note: "当前区域尚未初始化主动治理待办队列",
          });
        }
        throw err;
      }
    },
    {
      name: "list_agent_tasks",
      description: isEcommerce
        ? "读取当前电商站点主动治理待办队列（L1自动/L2审批/L3红线熔断摘要及待办列表，含48h假闭环回访与食安/12315熔断单）。"
        : "读取本区主动治理待办队列（L1自动/L2审批/L3红线熔断摘要及待办列表，含缺失要素核查、超期催办、48h回访和涉稳拦截任务）。",
      schema: loose.extend({
        status: z.string().optional(),
        autonomyLevel: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      }),
    }
  );

  const proposeThemeAction = tool(
    async (rawInput, config?: { signal?: AbortSignal }) => {
      const activeSignal = config?.signal ?? toolSignal;
      if (activeSignal?.aborted) throw createAbortError(activeSignal);
      const input = restoreArgs(rawInput);
      const themeId = String(input.themeId || "").trim().slice(0, 64);
      if (!themeId) {
        return JSON.stringify({ error: isEcommerce ? "缺少案卷编号 themeId" : "缺少主题编号 themeId" });
      }
      const actionRaw = String(input.action || "").trim().toUpperCase();
      if (actionRaw !== "DISPATCH" && actionRaw !== "ESCALATE" && actionRaw !== "RESOLVE") {
        return JSON.stringify({ error: "action 仅支持 DISPATCH、ESCALATE 或 RESOLVE" });
      }

      const { db } = await getRegionDb(regionId);
      const rows = await db
        .select({
          id: themesTable.id,
          title: themesTable.title,
          handlingOwner: themesTable.handlingOwner,
          recommendedAction: themesTable.recommendedAction,
          handlingStatus: themesTable.handlingStatus,
        })
        .from(themesTable)
        .where(eq(themesTable.id, themeId))
        .limit(1);
      const theme = rows[0];
      if (!theme) {
        return JSON.stringify({
          error: isEcommerce ? `当前站点没有客诉案卷 ${themeId}` : `本区没有主题 ${themeId}`,
        });
      }

      const rawOwner = typeof input.owner === "string" ? input.owner.trim() : "";
      let owner = rawOwner || (theme.handlingOwner || "").trim();
      if (!owner && actionRaw === "DISPATCH") {
        const rec = (theme.recommendedAction || "").trim();
        const match = rec.match(/(?:牵头部门|责任部门|责任团队|承办单位)\s*[:：]\s*([^\n；;。，,]+)/);
        owner =
          (match?.[1] || "").trim() ||
          (isEcommerce ? "售后客诉协同专班" : "热线协同督办组");
      }

      const rawEta = typeof input.eta === "string" ? input.eta.trim() : "";
      const eta =
        rawEta ||
        (actionRaw === "DISPATCH"
          ? new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
          : "");
      const rawNote = typeof input.note === "string" ? input.note.trim() : "";
      const defaultNote =
        actionRaw === "DISPATCH"
          ? `建议派单至${owner || (isEcommerce ? "责任团队" : "牵头部门")}协同核查处置`
          : actionRaw === "ESCALATE"
            ? isEcommerce
              ? "建议升级为重点高危客诉督办事项"
              : "建议升级为重点高危督办事项"
            : isEcommerce
              ? "建议核验赔付或整改结果后办结归档"
              : "建议按处置结果核验后办结归档";
      const note = rawNote || defaultNote;

      const proposal = {
        themeId: theme.id,
        themeTitle: maskText(theme.title),
        action: actionRaw,
        ...(owner ? { owner: maskText(owner) } : {}),
        ...(eta ? { eta } : {}),
        ...(note ? { note: maskText(note) } : {}),
      };

      return JSON.stringify({
        ok: true,
        executable: false,
        requiresConfirmation: true,
        currentStatus: theme.handlingStatus || "PENDING",
        proposal,
        actionBlock: `\`\`\`civic-action\n${JSON.stringify(proposal)}\n\`\`\``,
      });
    },
    {
      name: "propose_theme_action",
      description: isEcommerce
        ? "校验当前站点客诉案卷存在并生成派单(DISPATCH)/升级督办(ESCALATE)/办结(RESOLVE)的待确认行动提案（不直接执行改库）。"
        : "校验当前区主题存在并生成派单(DISPATCH)/升级督办(ESCALATE)/办结(RESOLVE)的待确认行动提案（不直接执行改库）。",
      schema: loose.extend({
        themeId: z.string().optional(),
        action: z.string().optional(),
        owner: z.string().optional(),
        eta: z.string().optional(),
        note: z.string().optional(),
      }),
    }
  );

  return [
    searchTickets,
    searchThemes,
    getTicket,
    getTheme,
    regionOverview,
    listTownships,
    categoryStats,
    listAgentTasks,
    proposeThemeAction,
  ];
}
