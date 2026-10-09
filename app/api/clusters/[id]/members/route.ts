import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { loadThemeMemberPage, THEME_MEMBER_PAGE } from "@/lib/cluster-members";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db } = await getRegionDb(regionId);
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
    const beforeId = (searchParams.get("beforeId") || "").trim() || null;
    const beforeTimeRaw = (searchParams.get("beforeTime") || "").trim();
    if (beforeTimeRaw && Number.isNaN(Date.parse(beforeTimeRaw))) {
      return NextResponse.json({ success: false, error: "beforeTime 不是时间" }, { status: 400 });
    }

    const page = await loadThemeMemberPage(db, theme, {
      limit,
      beforeId,
      beforeTime: beforeTimeRaw || null,
    });
    return NextResponse.json({
      success: true,
      total: theme.ticketCount || 0,
      members: page.members,
      next: page.next,
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
