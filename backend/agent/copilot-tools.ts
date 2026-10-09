/**
 * 副驾驶工具。全部绑在一次请求的 regionId 上，模型不能改区。
 * 打开对话时不调用；只有 LangGraph 的工具节点会进来。
 */
import { tool } from "@langchain/core/tools";
import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { z } from "zod";
import { createEmbedClient } from "@civic/embed";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { embedEndpointsFromEnv } from "@/backend/embed-products";
import { ticketBodyForAI } from "@/backend/anonymizer";
import { searchTicketsByVector } from "@/lib/ticket-embeddings";

const loose = z.object({}).passthrough();

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

function keywordLike(value: unknown): string | null {
  const text = String(value || "")
    .replace(/[%_]/g, "")
    .trim()
    .slice(0, 40);
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

async function embedQuery(text: string): Promise<number[]> {
  const client = createEmbedClient({
    endpoints: embedEndpointsFromEnv(),
    profile: "online",
    apiKey: process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "",
  });
  const [vector] = await withTimeout(
    client.embed([text.trim().slice(0, 500) || "空查询"]),
    25_000,
    "工单向量检索超时"
  );
  return vector || [];
}

export function createCopilotTools(regionId: string) {
  const searchTickets = tool(
    async (input) => {
      const query = String(input.query || "").trim();
      if (!query) return JSON.stringify({ error: "缺少检索词" });
      try {
        const vector = await embedQuery(query);
        const hits = await searchTicketsByVector(regionId, vector, clampLimit(input.limit, 8, 8));
        if (hits.length === 0) return JSON.stringify({ hits: [], note: "本区没有找到相近工单" });
        return JSON.stringify({ hits });
      } catch (error) {
        const message = error instanceof Error ? error.message : "工单向量检索失败";
        return JSON.stringify({ error: message });
      }
    },
    {
      name: "search_tickets",
      description: "用本区已嵌入的工单向量做语义检索，返回最相近的工单。",
      schema: loose.extend({
        query: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      }),
    }
  );

  const searchThemes = tool(
    async (input) => {
      const like = keywordLike(input.keyword);
      const risk = String(input.riskLevel || "").toUpperCase();
      const riskOk = risk === "HIGH" || risk === "MEDIUM" || risk === "LOW";
      const filters = [];
      if (like) {
        filters.push(
          or(
            ilike(themesTable.title, like),
            ilike(themesTable.canonicalSubject, like),
            ilike(themesTable.canonicalLocation, like),
            ilike(themesTable.eventType, like)
          )
        );
      }
      if (riskOk) filters.push(eq(themesTable.riskLevel, risk));
      const { db } = await getRegionDb(regionId);
      const limit = clampLimit(input.limit, 8, 8);
      const base = db
        .select({
          id: themesTable.id,
          title: themesTable.title,
          subject: themesTable.canonicalSubject,
          location: themesTable.canonicalLocation,
          eventType: themesTable.eventType,
          category: themesTable.category,
          riskLevel: themesTable.riskLevel,
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
          ticketCount: row.ticketCount,
          summary: clip(row.summary, 180),
          action: clip(row.action, 180),
        })),
      });
    },
    {
      name: "search_themes",
      description: "在本区主题表里按关键词或风险等级检索，不传关键词时返回工单量最高的主题。",
      schema: loose.extend({
        keyword: z.string().optional(),
        riskLevel: z.string().optional(),
        limit: z.union([z.number(), z.string()]).optional(),
      }),
    }
  );

  const getTicket = tool(
    async (input) => {
      const ticketNo = String(input.ticketNo || "").trim().slice(0, 64);
      if (!ticketNo) return JSON.stringify({ error: "缺少工单号" });
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
          themeId: ticketsTable.primaryThemeId,
          createTime: ticketsTable.createTime,
        })
        .from(ticketsTable)
        .where(or(eq(ticketsTable.ticketNo, ticketNo), eq(ticketsTable.id, ticketNo)))
        .limit(1);
      const row = rows[0];
      if (!row) return JSON.stringify({ error: "本区没有这张工单" });
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
        themeId: row.themeId || "",
        body: clip(ticketBodyForAI(row), 320),
      });
    },
    {
      name: "get_ticket",
      description: "按工单号读取本区的一张工单。",
      schema: loose.extend({ ticketNo: z.string().optional() }),
    }
  );

  const getTheme = tool(
    async (input) => {
      const themeId = String(input.themeId || "").trim().slice(0, 64);
      if (!themeId) return JSON.stringify({ error: "缺少主题编号" });
      const { db } = await getRegionDb(regionId);
      const rows = await db.select().from(themesTable).where(eq(themesTable.id, themeId)).limit(1);
      const theme = rows[0];
      if (!theme) return JSON.stringify({ error: "本区没有这个主题" });
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
        ticketCount: theme.ticketCount,
        summary: clip(theme.aiSummary, 400),
        action: clip(theme.recommendedAction, 400),
        tickets: members.map((row) => ({ ticketNo: row.ticketNo, title: clip(row.title, 80) })),
      });
    },
    {
      name: "get_theme",
      description: "按主题编号读取本区的一个主题及其部分成员工单。",
      schema: loose.extend({ themeId: z.string().optional() }),
    }
  );

  const regionOverview = tool(
    async () => {
      const { db } = await getRegionDb(regionId);
      const result = await db.execute(sql`
        SELECT
          (SELECT count(*)::int FROM tickets) AS tickets,
          (SELECT count(*)::int FROM themes) AS themes,
          (SELECT count(*)::int FROM themes WHERE risk_level = 'HIGH') AS high_risk,
          (SELECT count(*)::int FROM ticket_embeddings WHERE model = 'BAAI/bge-m3') AS embedded
      `);
      const row = rowsOf(result)[0] || {};
      return JSON.stringify({
        tickets: Number(cell(row, "tickets") || 0),
        themes: Number(cell(row, "themes") || 0),
        highRiskThemes: Number(cell(row, "high_risk") || 0),
        embeddedTickets: Number(cell(row, "embedded") || 0),
      });
    },
    {
      name: "region_overview",
      description: "统计当前区的工单数、主题数、高风险主题数和已嵌入工单数。",
      schema: loose,
    }
  );

  const listTownships = tool(
    async () => {
      const { db } = await getRegionDb(regionId);
      const result = await db.execute(sql`
        SELECT COALESCE(NULLIF(btrim(subdistrict), ''), '未知') AS name, count(*)::int AS tickets
        FROM tickets
        GROUP BY 1
        ORDER BY tickets DESC
        LIMIT 12
      `);
      return JSON.stringify({
        townships: rowsOf(result).map((row) => ({
          name: cell(row, "name") || "未知",
          tickets: Number(cell(row, "tickets") || 0),
        })),
      });
    },
    {
      name: "list_townships",
      description: "列出当前区工单量最高的镇街。",
      schema: loose,
    }
  );

  return [searchTickets, searchThemes, getTicket, getTheme, regionOverview, listTownships];
}
