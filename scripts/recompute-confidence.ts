/**
 * 一次性脚本：用最新的 theme-metrics 公式重算 themes 表里所有
 * aiConfidence / features / radar。不重跑 LLM 提取链，仅刷新主题级指标。
 *
 * 用法：pnpm tsx scripts/recompute-confidence.ts
 *       或 npx tsx scripts/recompute-confidence.ts
 */
import { db } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { eq, inArray } from "drizzle-orm";
import { deriveThemeMetrics } from "@/backend/theme-metrics";
import type { EnrichedTicket, PatternType } from "@/backend/state";

async function main() {
  const themes = await db.select().from(themesTable);
  if (themes.length === 0) {
    console.log("[recompute] themes 表为空，无需处理");
    return;
  }
  console.log(`[recompute] 共 ${themes.length} 个主题，开始重算…`);

  let updated = 0;
  for (const t of themes) {
    const junctions = await db
      .select()
      .from(ticketThemesTable)
      .where(eq(ticketThemesTable.themeId, t.id));
    const ticketIds = junctions.map((j) => j.ticketId);
    const rows = ticketIds.length
      ? await db.select().from(ticketsTable).where(inArray(ticketsTable.id, ticketIds))
      : [];

    const tickets = rows.map((r) => ({
      id: r.id,
      ticketNo: r.ticketNo,
      title: r.title,
      summarizeTitle: r.summarizeTitle,
      content: r.content,
      maskedContent: r.maskedContent,
      citizenName: r.citizenName,
      citizenPhone: r.citizenPhone,
      address: r.address,
      subdistrict: r.subdistrict,
      district: r.district,
      confidence: r.confidence ?? 0,
      themes: r.sourceCategory ? [r.sourceCategory] : [],
      eventType: r.sourceCategory ?? "",
      canonicalSubject: r.summarizeTitle ?? "",
      canonicalLocation: r.address ?? "",
      createTime: r.createTime?.toISOString() ?? "",
      primaryThemeId: r.primaryThemeId ?? undefined,
      // ponytail: entities/relations 在 deriveThemeMetrics 里用不到，置空即可
      entities: [],
      relations: [],
      channel: "市民服务热线",
      status: "PENDING" as const,
      clusterId: t.id,
    })) as unknown as EnrichedTicket[];

    const m = deriveThemeMetrics({
      eventType: t.eventType,
      canonicalLocation: t.canonicalLocation,
      tickets,
      patternType: (t.patternType as PatternType | null) ?? undefined,
    });

    await db
      .update(themesTable)
      .set({
        aiConfidence: m.aiConfidence,
        featuresJson: JSON.stringify(m.features),
        radarJson: JSON.stringify(m.radar),
      })
      .where(eq(themesTable.id, t.id));

    updated++;
    console.log(
      `  [${updated}/${themes.length}] ${t.id} ${t.canonicalSubject || ""} → confidence ${m.aiConfidence}%`
    );
  }

  console.log(`\n[recompute] 完成，共更新 ${updated} 个主题。`);
}

main().catch((e) => {
  console.error("[recompute] 失败:", e);
  process.exit(1);
});