import { NextResponse } from "next/server";
import { db } from "@/db/client";
import { themesTable, ticketsTable, ticketThemesTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import { toClusterDto, toWorkorderDto } from "@/lib/civic-dto";

export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const themes = await db.select().from(themesTable).where(eq(themesTable.id, id)).limit(1);
    const theme = themes[0];
    if (!theme) return NextResponse.json({ success: false, error: "not found" }, { status: 404 });

    const junctions = await db.select().from(ticketThemesTable).where(eq(ticketThemesTable.themeId, id));
    const members = [];
    for (const j of junctions) {
      const rows = await db.select().from(ticketsTable).where(eq(ticketsTable.id, j.ticketId)).limit(1);
      if (rows[0]) members.push(rows[0]);
    }

    const dto = toClusterDto({ ...theme, tickets: members });
    return NextResponse.json({
      success: true,
      ...dto,
      members: members.map((m) => toWorkorderDto(m)),
    });
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 500 });
  }
}
