import type { DB } from "@/db/client";
import { ticketsTable, ticketThemesTable } from "@/db/schema";
import { regionLabel } from "@/lib/civic-dto";
import { calendarDay } from "@/lib/work-order-date";
import { and, eq, ilike, inArray, or, sql } from "drizzle-orm";

export const THEME_MEMBER_PAGE = 30;

export type ThemeMemberCursor = { time: string | null; id: string };

export type ThemeMemberItem = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  createdAt: string;
  content: string;
  confidence: number | null;
};

type PageTheme = {
  id: string;
  ticketCount?: number | null;
  canonicalSubject?: string | null;
};

function asRows<T>(result: T[] | { rows?: T[] }): T[] {
  if (Array.isArray(result)) return result;
  return result.rows || [];
}

function cursorTime(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function toListItem(row: {
  id: string;
  ticketNo?: string | null;
  title?: string | null;
  summarizeTitle?: string | null;
  sourceCategory?: string | null;
  subdistrict?: string | null;
  createTime?: Date | string | null;
  confidence?: number | null;
  excerpt?: string | null;
}): ThemeMemberItem {
  const created = calendarDay(row.createTime);
  return {
    id: row.ticketNo || row.id,
    ticketId: row.id,
    title: row.summarizeTitle || row.title || "市民诉求",
    category: row.sourceCategory || "",
    region: regionLabel(row.subdistrict),
    createdAt: typeof created === "string" ? created.slice(0, 10) : "",
    content: row.excerpt || "",
    confidence: row.confidence ?? null,
  };
}

const listColumns = {
  id: ticketsTable.id,
  ticketNo: ticketsTable.ticketNo,
  title: ticketsTable.title,
  summarizeTitle: ticketsTable.summarizeTitle,
  sourceCategory: ticketsTable.sourceCategory,
  subdistrict: ticketsTable.subdistrict,
  createTime: ticketsTable.createTime,
  confidence: ticketsTable.confidence,
  excerpt: sql<string>`left(coalesce(${ticketsTable.maskedContent}, ${ticketsTable.content}), 80)`,
};

export async function loadThemeMemberPage(
  db: DB,
  theme: PageTheme,
  query: { limit: number; beforeTime: string | null; beforeId: string | null }
): Promise<{ members: ThemeMemberItem[]; next: ThemeMemberCursor | null }> {
  const limit = Math.min(50, Math.max(1, query.limit || THEME_MEMBER_PAGE));
  const filters = [eq(ticketThemesTable.themeId, theme.id)];
  if (query.beforeId && query.beforeTime) {
    filters.push(sql`(
      ${ticketsTable.createTime} < ${query.beforeTime}::timestamptz
      OR (${ticketsTable.createTime} = ${query.beforeTime}::timestamptz AND ${ticketsTable.id} < ${query.beforeId})
      OR ${ticketsTable.createTime} IS NULL
    )`);
  } else if (query.beforeId) {
    filters.push(sql`${ticketsTable.createTime} IS NULL AND ${ticketsTable.id} < ${query.beforeId}`);
  }

  // 先按时间取出一页 id。正文留到后面 30 行再截断，排序不会带上整组原文。
  const idRows = await db
    .select({ id: ticketsTable.id, createTime: ticketsTable.createTime })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
    .where(and(...filters))
    .orderBy(sql`${ticketsTable.createTime} DESC NULLS LAST, ${ticketsTable.id} DESC`)
    .limit(limit + 1);

  if (idRows.length === 0 && !query.beforeId) {
    const subject = (theme.canonicalSubject || "").trim();
    if (subject.length >= 3) {
      const fallback = await db
        .select(listColumns)
        .from(ticketsTable)
        .where(
          or(
            ilike(ticketsTable.title, `%${subject}%`),
            ilike(ticketsTable.summarizeTitle, `%${subject}%`),
            ilike(ticketsTable.content, `%${subject}%`)
          )
        )
        .orderBy(sql`${ticketsTable.createTime} DESC NULLS LAST, ${ticketsTable.id} DESC`)
        .limit(20);
      return { members: fallback.map(toListItem), next: null };
    }
    return { members: [], next: null };
  }

  const hasMore = idRows.length > limit;
  const page = idRows.slice(0, limit);
  const ids = page.map((row) => row.id);
  const details = ids.length
    ? asRows(await db.select(listColumns).from(ticketsTable).where(inArray(ticketsTable.id, ids)))
    : [];
  const byId = new Map(details.map((row) => [row.id, row]));
  const members = ids.map((id) => byId.get(id)).filter((row) => row != null).map((row) => toListItem(row));
  const last = page[page.length - 1];
  const next = hasMore && last ? { time: cursorTime(last.createTime), id: last.id } : null;
  return { members, next };
}
