import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  loadThemeMemberPage,
  THEME_MEMBER_PAGE,
  type ThemeMemberFilter,
  type ThemeMemberSort,
} from "@/lib/cluster-members";
import { ensureTicketThemesVerificationColumns } from "@/lib/ticket-themes-schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { requireAdmin } from "@/lib/auth/rbac";

const VALID_SORTS = new Set<ThemeMemberSort>([
  "time_desc",
  "confidence_asc",
  "confidence_desc",
]);
const VALID_FILTERS = new Set<ThemeMemberFilter>([
  "all",
  "low_confidence",
  "unverified",
  "verified",
]);

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db } = await getRegionDb(regionId);
    await ensureTicketThemesVerificationColumns(db, regionId);

    const themes = await db
      .select({
        id: themesTable.id,
        ticketCount: themesTable.ticketCount,
        canonicalSubject: themesTable.canonicalSubject,
      })
      .from(themesTable)
      .where(eq(themesTable.id, id))
      .limit(1);
    const theme = themes[0];
    if (!theme) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    const { searchParams } = new URL(req.url);
    const requested = Number(searchParams.get("limit") || THEME_MEMBER_PAGE);
    const limit = Number.isFinite(requested) ? requested : THEME_MEMBER_PAGE;
    const offsetRaw = searchParams.get("offset");
    const parsedOffset =
      offsetRaw !== null && offsetRaw !== "" ? Number(offsetRaw) : null;
    if (
      parsedOffset !== null &&
      (!Number.isFinite(parsedOffset) || parsedOffset < 0)
    ) {
      return NextResponse.json(
        { success: false, error: "offset 参数无效" },
        { status: 400 }
      );
    }
    const offset = parsedOffset !== null ? Math.floor(parsedOffset) : null;

    const sortRaw = (searchParams.get("sort") || "time_desc").trim() as ThemeMemberSort;
    const sort: ThemeMemberSort = VALID_SORTS.has(sortRaw) ? sortRaw : "time_desc";

    const filterRaw = (searchParams.get("filter") || "all").trim() as ThemeMemberFilter;
    const filter: ThemeMemberFilter = VALID_FILTERS.has(filterRaw) ? filterRaw : "all";

    const beforeId = (searchParams.get("beforeId") || "").trim() || null;
    const beforeTimeRaw = (searchParams.get("beforeTime") || "").trim();
    if (beforeTimeRaw && Number.isNaN(Date.parse(beforeTimeRaw))) {
      return NextResponse.json({ success: false, error: "beforeTime 不是时间" }, { status: 400 });
    }

    const page = await loadThemeMemberPage(db, theme, {
      limit,
      offset,
      beforeId,
      beforeTime: beforeTimeRaw || null,
      sort,
      filter,
      regionId,
    });
    return NextResponse.json({
      success: true,
      total: theme.ticketCount || 0,
      members: page.members,
      next: page.next,
      hasMore: page.hasMore,
      nextOffset: page.nextOffset,
      stats: page.stats,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
