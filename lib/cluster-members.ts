import type { DB } from "@/db/client";
import { ticketsTable, ticketThemesTable } from "@/db/schema";
import { mapTicketStatus, regionLabel } from "@/lib/civic-dto";
import {
  ensureTicketThemesVerificationColumns,
  loadThemeMemberStats,
  LOW_CONFIDENCE_THRESHOLD,
  type ThemeMemberStats,
} from "@/lib/ticket-themes-schema";
import { calendarDay } from "@/lib/work-order-date";
import { and, eq, ilike, inArray, or, sql, type SQL } from "drizzle-orm";

export const THEME_MEMBER_PAGE = 30;

export type ThemeMemberSort = "time_desc" | "confidence_asc" | "confidence_desc";
export type ThemeMemberFilter = "all" | "low_confidence" | "unverified" | "verified";

export type ThemeMemberCursor = { time: string | null; id: string; offset?: number | null };

export type ThemeMemberItem = {
  id: string;
  ticketId: string;
  title: string;
  category: string;
  region: string;
  createdAt: string;
  content: string;
  confidence: number | null;
  status: string;
  isFakeClosure: boolean;
  humanVerified: boolean;
  verifiedBy: string | null;
  verifiedAt: string | null;
  address: string | null;
  canonicalSubject: string | null;
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
  status?: string | null;
  isFakeClosure?: boolean | null;
  excerpt?: string | null;
  humanVerified?: boolean | null;
  verifiedBy?: string | null;
  verifiedAt?: Date | string | null;
  address?: string | null;
  canonicalSubject?: string | null;
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
    status: mapTicketStatus(row.status),
    isFakeClosure: Boolean(row.isFakeClosure),
    humanVerified: Boolean(row.humanVerified),
    verifiedBy: row.verifiedBy || null,
    verifiedAt: row.verifiedAt ? cursorTime(row.verifiedAt) : null,
    address: row.address || null,
    canonicalSubject: row.canonicalSubject || null,
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
  status: ticketsTable.status,
  isFakeClosure: ticketsTable.isFakeClosure,
  address: ticketsTable.address,
  canonicalSubject: ticketsTable.canonicalSubject,
  excerpt: sql<string>`left(coalesce(${ticketsTable.maskedContent}, ${ticketsTable.content}), 80)`,
};

function resolveOrderBy(sort: ThemeMemberSort): SQL {
  if (sort === "confidence_asc") {
    return sql`COALESCE(${ticketsTable.confidence}, 0) ASC, ${ticketThemesTable.humanVerified} ASC, ${ticketsTable.createTime} DESC NULLS LAST, ${ticketsTable.id} DESC`;
  }
  if (sort === "confidence_desc") {
    return sql`COALESCE(${ticketsTable.confidence}, 0) DESC, ${ticketsTable.createTime} DESC NULLS LAST, ${ticketsTable.id} DESC`;
  }
  return sql`${ticketsTable.createTime} DESC NULLS LAST, ${ticketsTable.id} DESC`;
}

export async function loadThemeMemberPage(
  db: DB,
  theme: PageTheme,
  query: {
    limit: number;
    offset?: number | null;
    beforeTime: string | null;
    beforeId: string | null;
    sort?: ThemeMemberSort;
    filter?: ThemeMemberFilter;
    regionId?: string;
  }
): Promise<{
  members: ThemeMemberItem[];
  next: ThemeMemberCursor | null;
  hasMore: boolean;
  nextOffset: number | null;
  stats: ThemeMemberStats;
}> {
  if (query.regionId) {
    await ensureTicketThemesVerificationColumns(db, query.regionId);
  } else {
    await ensureTicketThemesVerificationColumns(db, "default");
  }

  const limit = Math.min(50, Math.max(1, query.limit || THEME_MEMBER_PAGE));
  const sort: ThemeMemberSort =
    query.sort === "confidence_asc" || query.sort === "confidence_desc"
      ? query.sort
      : "time_desc";
  const filter: ThemeMemberFilter =
    query.filter === "low_confidence" ||
    query.filter === "unverified" ||
    query.filter === "verified"
      ? query.filter
      : "all";
  const safeOffset =
    query.offset != null && Number.isFinite(query.offset) && query.offset >= 0
      ? Math.floor(query.offset)
      : 0;
  const useOffsetPagination =
    (query.offset != null && query.offset >= 0) ||
    sort !== "time_desc" ||
    filter !== "all";

  const filters: SQL[] = [eq(ticketThemesTable.themeId, theme.id)];
  if (filter === "low_confidence") {
    filters.push(
      sql`coalesce(${ticketsTable.confidence}, 0) < ${LOW_CONFIDENCE_THRESHOLD} AND ${ticketThemesTable.humanVerified} = false`
    );
  } else if (filter === "unverified") {
    filters.push(eq(ticketThemesTable.humanVerified, false));
  } else if (filter === "verified") {
    filters.push(eq(ticketThemesTable.humanVerified, true));
  }

  if (!useOffsetPagination) {
    if (query.beforeId && query.beforeTime) {
      filters.push(sql`(
        ${ticketsTable.createTime} < ${query.beforeTime}::timestamptz
        OR (${ticketsTable.createTime} = ${query.beforeTime}::timestamptz AND ${ticketsTable.id} < ${query.beforeId})
        OR ${ticketsTable.createTime} IS NULL
      )`);
    } else if (query.beforeId) {
      filters.push(
        sql`${ticketsTable.createTime} IS NULL AND ${ticketsTable.id} < ${query.beforeId}`
      );
    }
  }

  const baseIdQuery = db
    .select({ id: ticketsTable.id, createTime: ticketsTable.createTime })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
    .where(and(...filters))
    .orderBy(resolveOrderBy(sort))
    .limit(limit + 1);

  const [idRows, stats] = await Promise.all([
    useOffsetPagination ? baseIdQuery.offset(safeOffset) : baseIdQuery,
    loadThemeMemberStats(db, theme.id),
  ]);

  if (idRows.length === 0 && !query.beforeId && safeOffset === 0 && filter === "all") {
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
        .orderBy(resolveOrderBy(sort))
        .limit(20);
      return {
        members: fallback.map((row) =>
          toListItem({ ...row, humanVerified: false, verifiedBy: null, verifiedAt: null })
        ),
        next: null,
        hasMore: false,
        nextOffset: null,
        stats,
      };
    }
    return { members: [], next: null, hasMore: false, nextOffset: null, stats };
  }

  const hasMore = idRows.length > limit;
  const page = idRows.slice(0, limit);
  const ids = page.map((row) => row.id);
  const details = ids.length
    ? asRows(
        await db
          .select({
            ...listColumns,
            humanVerified: ticketThemesTable.humanVerified,
            verifiedBy: ticketThemesTable.verifiedBy,
            verifiedAt: ticketThemesTable.verifiedAt,
          })
          .from(ticketThemesTable)
          .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
          .where(
            and(
              eq(ticketThemesTable.themeId, theme.id),
              inArray(ticketThemesTable.ticketId, ids)
            )
          )
      )
    : [];
  const byId = new Map(details.map((row) => [row.id, row]));
  const members = ids
    .map((id) => byId.get(id))
    .filter((row): row is NonNullable<typeof row> => row != null)
    .map((row) => toListItem(row));

  const nextOffset = safeOffset + page.length;
  const last = page[page.length - 1];
  const next =
    hasMore && last
      ? { time: cursorTime(last.createTime), id: last.id, offset: nextOffset }
      : null;

  return {
    members,
    next,
    hasMore,
    nextOffset: hasMore ? nextOffset : null,
    stats,
  };
}
