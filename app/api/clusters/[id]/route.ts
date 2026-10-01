import { NextResponse } from "next/server";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { eq, or, ilike } from "drizzle-orm";
import { toClusterDto, toWorkorderDto } from "@/lib/civic-dto";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const regionId = await resolveRequestRegionId(req);
    const { db } = await getRegionDb(regionId);
    const themes = await db.select().from(themesTable).where(eq(themesTable.id, id)).limit(1);
    const theme = themes[0];
    if (!theme) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    const junctions = await db.select().from(ticketThemesTable).where(eq(ticketThemesTable.themeId, id));
    const memberMap = new Map<string, any>();

    for (const j of junctions) {
      const rows = await db.select().from(ticketsTable).where(eq(ticketsTable.id, j.ticketId)).limit(1);
      if (rows[0]) memberMap.set(rows[0].id, rows[0]);
    }

    // 补充 primaryThemeId 匹配的工单
    const byPrimary = await db
      .select()
      .from(ticketsTable)
      .where(eq(ticketsTable.primaryThemeId, id))
      .limit(50);
    for (const t of byPrimary) {
      memberMap.set(t.id, t);
    }

    // 若仍为空且存在明确涉事主体，按主体匹配工单
    if (memberMap.size === 0 && theme.canonicalSubject && theme.canonicalSubject.length >= 3) {
      const bySubject = await db
        .select()
        .from(ticketsTable)
        .where(
          or(
            ilike(ticketsTable.content, `%${theme.canonicalSubject}%`),
            ilike(ticketsTable.title, `%${theme.canonicalSubject}%`),
            ilike(ticketsTable.summarizeTitle, `%${theme.canonicalSubject}%`)
          )
        )
        .limit(20);
      for (const t of bySubject) {
        memberMap.set(t.id, t);
      }
    }

    const members = Array.from(memberMap.values());
    const dto = toClusterDto({ ...theme, tickets: members, ticketCount: members.length || theme.ticketCount });

    return NextResponse.json({
      success: true,
      ...dto,
      members: members.map((m) => toWorkorderDto(m)),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
