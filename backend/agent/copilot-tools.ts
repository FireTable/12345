/**
 * 副驾驶工具。全部绑在一次请求的 regionId 上，模型不能改区。
 * 所有工具均为只读或待确认提案生成，绝不直接写入数据库。
 */
import { tool } from "@langchain/core/tools";
import { and, desc, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { createEmbedClient } from "@civic/embed";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { embedEndpointsFromEnv } from "@/backend/embed-products";
import { ticketBodyForAI } from "@/backend/anonymizer";
import { searchTicketsByVector } from "@/lib/ticket-embeddings";
import type { DomainType } from "@/lib/domain-profile";

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

function extractQueryTokens(rawQuery: string): { phrase: string; tokens: string[] } {
  const phrase = escapeLike(rawQuery);
  if (!phrase) return { phrase: "", tokens: [] };

  const rawParts = phrase
    .split(/[\s,，、；;+|/]+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 2);

  const nonStop = rawParts.filter((p) => !QUERY_STOPWORDS.has(p));
  const seedParts = nonStop.length > 0 ? nonStop : rawParts;

  const out: string[] = [];
  const seen = new Set<string>();
  const add = (tok: string) => {
    const clean = tok.trim();
    if (clean.length < 2 || seen.has(clean)) return;
    seen.add(clean);
    out.push(clean);
  };

  for (const part of seedParts) {
    add(part);
    if (/^[\u4e00-\u9fff]{4,16}$/.test(part)) {
      for (let i = 0; i + 2 <= part.length; i += 2) {
        add(part.slice(i, i + 2));
      }
      if (part.length % 2 === 1 && part.length >= 5) {
        add(part.slice(part.length - 2));
      }
    }
  }

  return { phrase, tokens: out.slice(0, 6) };
}

function isSemanticQuery(query: string): boolean {
  const trimmed = query.trim();
  if (trimmed.length < 2) return false;
  if (/^(?:EC|IN|GV|TK|SKU|TH|THEME)?[-_]?\d[\dA-Za-z-]*$/i.test(trimmed)) return false;
  return /[\u4e00-\u9fffA-Za-z]{2,}/.test(trimmed);
}

function withTimeout<T>(work: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    work.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

async function embedQuery(text: string, timeoutMs = 3500): Promise<number[]> {
  const client = createEmbedClient({
    endpoints: embedEndpointsFromEnv(),
    profile: "online",
    apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",
  });
  const [vector] = await withTimeout(
    client.embed([text.trim().slice(0, 500) || "空查询"]),
    timeoutMs,
    "工单向量检索超时"
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

export function createCopilotTools(regionId: string, domainType: DomainType = "GOV_12345") {
  const isEcommerce = domainType === "ECOMMERCE_CS";

  const searchTickets = tool(
    async (input) => {
      const rawQuery = String(input.query || "").trim();
      const statusFilter = normalizeStatusFilter(input.status);
      const urgencyFilter = normalizeUrgencyFilter(input.urgency);
      const subdistrictFilter = escapeLike(input.subdistrict);
      const categoryFilter = escapeLike(input.category);
      const isFakeClosureFilter = parseOptionalBool(input.isFakeClosure);
      const stabilityRiskFilter = parseOptionalBool(input.stabilityRisk);
      const limit = clampLimit(input.limit, 8, 12);

      const hasStructuredFilter = Boolean(
        statusFilter ||
          urgencyFilter ||
          subdistrictFilter ||
          categoryFilter ||
          isFakeClosureFilter !== undefined ||
          stabilityRiskFilter !== undefined
      );

      if (!rawQuery && !hasStructuredFilter) {
        return JSON.stringify({ error: "缺少检索词或筛选条件" });
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
      const { phrase, tokens } = extractQueryTokens(rawQuery);

      const sqlSearchPromise = (async () => {
        const whereParts: SQL[] = [...structuredFilters];
        const scoreParts: SQL[] = [];

        if (phrase) {
          const phrasePat = `%${phrase}%`;
          const queryMatchers: SQL[] = [buildTicketTermOrClause(phrasePat)];
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
          whereParts.push(or(...queryMatchers)!);

          scoreParts.push(
            sql`CASE WHEN lower(${ticketsTable.ticketNo}) = ${phrase.toLowerCase()} THEN 200 ELSE 0 END`
          );
          scoreParts.push(
            sql`CASE WHEN (coalesce(${ticketsTable.title}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.summarizeTitle}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.canonicalSubject}, '') ILIKE ${phrasePat}) THEN 80 WHEN (coalesce(${ticketsTable.content}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.address}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.subdistrict}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.sourceCategory}, '') ILIKE ${phrasePat} OR coalesce(${ticketsTable.ticketNo}, '') ILIKE ${phrasePat}) THEN 40 ELSE 0 END`
          );
          for (const tok of tokens) {
            if (tok === phrase) continue;
            const tPat = `%${tok}%`;
            scoreParts.push(
              sql`CASE WHEN (coalesce(${ticketsTable.title}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.summarizeTitle}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.canonicalSubject}, '') ILIKE ${tPat}) THEN 20 WHEN (coalesce(${ticketsTable.content}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.address}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.subdistrict}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.sourceCategory}, '') ILIKE ${tPat} OR coalesce(${ticketsTable.ticketNo}, '') ILIKE ${tPat}) THEN 10 ELSE 0 END`
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
          sql`(CASE WHEN ${ticketsTable.isFakeClosure} = true THEN 4 ELSE 0 END + CASE WHEN ${ticketsTable.stabilityRisk} = true THEN 4 ELSE 0 END + CASE WHEN upper(coalesce(${ticketsTable.urgency}, '')) = 'URGENT' THEN 2 ELSE 0 END)`
        );

        const scoreExpr =
          scoreParts.length > 1
            ? sql<number>`(${sql.join(scoreParts, sql` + `)})`
            : scoreParts[0]!;

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
            relevanceScore: scoreExpr,
          })
          .from(ticketsTable)
          .where(whereParts.length > 0 ? and(...whereParts) : undefined)
          .orderBy(desc(scoreExpr), desc(ticketsTable.createTime))
          .limit(limit);

        return rows;
      })();

      const vectorSearchPromise = (async () => {
        if (!rawQuery || !isSemanticQuery(rawQuery)) return [];
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
              const vector = await embedQuery(rawQuery, 3500);
              if (vector.length === 0) return [];
              return searchTicketsByVector(regionId, vector, Math.min(8, limit));
            })(),
            4200,
            "工单向量检索超时"
          );
          return hits;
        } catch {
          return [];
        }
      })();

      const [sqlRows, rawVectorHits] = await Promise.all([sqlSearchPromise, vectorSearchPromise]);

      const merged = new Map<string, TicketSearchHit>();

      for (const row of sqlRows) {
        const score = Number(row.relevanceScore || 0);
        merged.set(row.ticketNo, {
          ticketNo: row.ticketNo,
          title: row.summarizeTitle || row.title || "",
          township: town(row.subdistrict),
          category: row.category || "",
          subject: row.subject || "",
          eventType: row.eventType || "",
          address: row.address || "",
          urgency: row.urgency || "NORMAL",
          status: row.status || "PENDING",
          isFakeClosure: Boolean(row.isFakeClosure),
          stabilityRisk: Boolean(row.stabilityRisk),
          themeId: row.themeId || "",
          body: clip(ticketBodyForAI(row), 240),
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
                .where(and(inArray(ticketsTable.ticketNo, vecNos), ...structuredFilters))
            : [];

        const detailMap = new Map(vecDetails.map((d) => [d.ticketNo, d]));
        for (const vHit of rawVectorHits) {
          const detail = detailMap.get(vHit.ticketNo);
          if (!detail) continue;

          const existing = merged.get(vHit.ticketNo);
          const simScore = Number((vHit.similarity * 100).toFixed(2));
          if (existing) {
            existing.matchSource = "hybrid";
            existing.similarity = vHit.similarity;
            existing._rankScore += simScore + 50;
          } else {
            merged.set(vHit.ticketNo, {
              ticketNo: detail.ticketNo,
              title: detail.summarizeTitle || detail.title || vHit.title || "",
              township: town(detail.subdistrict),
              category: detail.category || vHit.category || "",
              subject: detail.subject || vHit.subject || "",
              eventType: detail.eventType || vHit.eventType || "",
              address: detail.address || vHit.address || "",
              urgency: detail.urgency || vHit.urgency || "NORMAL",
              status: detail.status || "PENDING",
              isFakeClosure: Boolean(detail.isFakeClosure),
              stabilityRisk: Boolean(detail.stabilityRisk),
              themeId: detail.themeId || vHit.themeId || "",
              body: clip(ticketBodyForAI(detail), 240),
              similarity: vHit.similarity,
              matchSource: "vector",
              _rankScore: simScore,
              _createTimeMs: detail.createTime ? new Date(detail.createTime).getTime() : 0,
            });
          }
        }
      }

      const sortedHits = Array.from(merged.values())
        .sort((a, b) => {
          if (b._rankScore !== a._rankScore) return b._rankScore - a._rankScore;
          return b._createTimeMs - a._createTimeMs;
        })
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
    async (input) => {
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
      const limit = clampLimit(input.limit, 8, 12);
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
          title: row.title,
          subject: row.subject,
          location: town(row.location),
          eventType: row.eventType,
          category: row.category || "",
          riskLevel: row.riskLevel,
          handlingStatus: row.handlingStatus || "PENDING",
          handlingOwner: row.handlingOwner || "",
          ticketCount: row.ticketCount,
          summary: clip(row.summary, 180),
          action: clip(row.action, 180),
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
    async (input) => {
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
        title: row.summarizeTitle || row.title || "",
        township: town(row.subdistrict),
        category: row.category || "",
        subject: row.subject || "",
        eventType: row.eventType || "",
        address: row.address || "",
        urgency: row.urgency || "",
        status: row.status || "",
        isFakeClosure: Boolean(row.isFakeClosure),
        stabilityRisk: Boolean(row.stabilityRisk),
        themeId: row.themeId || "",
        body: clip(ticketBodyForAI(row), 320),
      });
    },
    {
      name: "get_ticket",
      description: isEcommerce ? "按客诉单号读取当前站点的一张客诉工单。" : "按工单号读取本区的一张工单。",
      schema: loose.extend({ ticketNo: z.string().optional() }),
    }
  );

  const getTheme = tool(
    async (input) => {
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
        title: theme.title,
        subject: theme.canonicalSubject,
        location: town(theme.canonicalLocation),
        eventType: theme.eventType,
        category: theme.category || "",
        riskLevel: theme.riskLevel,
        handlingStatus: theme.handlingStatus || "PENDING",
        handlingOwner: theme.handlingOwner || "",
        handlingProgress: theme.handlingProgress ?? 0,
        ticketCount: theme.ticketCount,
        summary: clip(theme.aiSummary, 400),
        action: clip(theme.recommendedAction, 400),
        tickets: members.map((row) => ({ ticketNo: row.ticketNo, title: clip(row.title, 80) })),
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
        LIMIT 12
      `);
      return JSON.stringify({
        unitType: isEcommerce ? "渠道/仓网" : "镇街",
        townships: rowsOf(result).map((row) => ({
          name: cell(row, "name") || "未知",
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
          category: cell(row, "category") || "未分类",
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
    async (input) => {
      const { db } = await getRegionDb(regionId);
      const statusRaw = String(input.status || "").trim().toUpperCase();
      const levelRaw = String(input.autonomyLevel || "").trim().toUpperCase();
      const limit = clampLimit(input.limit, 10, 20);

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
            targetTitle: cell(row, "target_title"),
            channel: cell(row, "channel"),
            maskedContact: cell(row, "masked_contact") || null,
            missingSlots,
            suggestedOwner: cell(row, "suggested_owner") || null,
            reason: clip(cell(row, "reason"), 160),
            draftMessage: clip(cell(row, "draft_message"), 180),
            resultSummary: cell(row, "result_summary") || null,
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
    async (input) => {
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
        themeTitle: theme.title,
        action: actionRaw,
        ...(owner ? { owner } : {}),
        ...(eta ? { eta } : {}),
        ...(note ? { note } : {}),
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
