/**
 * 只给已有主题补摘要和处置建议，不重抽工单、不重做聚类。
 * 用法：npx tsx scripts/fill-theme-advice.ts
 */
import type { MultiFrequencyTheme } from "../backend/state";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

async function main() {
  const { eq } = await import("drizzle-orm");
  const { getRegionDb } = await import("../db/client");
  const { themesTable, ticketsTable } = await import("../db/schema");
  const { enrichThemeBatchWithLLM } = await import("../backend/node/summary-node");

  const regionId = process.env.REGION_ID || "fs_shunde";
  const { db } = await getRegionDb(regionId);
  const themes = await db.select().from(themesTable);
  const tickets = await db.select().from(ticketsTable);

  const byTheme = new Map<string, typeof tickets>();
  for (const ticket of tickets) {
    const themeId = ticket.primaryThemeId;
    if (!themeId) continue;
    const list = byTheme.get(themeId) || [];
    list.push(ticket);
    byTheme.set(themeId, list);
  }

  const input: MultiFrequencyTheme[] = themes.map((theme) => ({
    id: theme.id,
    title: theme.title,
    canonicalSubject: theme.canonicalSubject,
    canonicalLocation: theme.canonicalLocation,
    eventType: theme.eventType,
    category: theme.category || "",
    riskLevel: (theme.riskLevel as MultiFrequencyTheme["riskLevel"]) || "LOW",
    riskReason: theme.riskReason || "",
    ticketCount: theme.ticketCount,
    timeSpanHours: theme.timeSpanHours,
    firstOccurrence: "",
    lastOccurrence: "",
    aiSummary: "",
    recommendedAction: "",
    status: "CONFIRMED",
    relatedSubjects: [],
    relatedLocations: [],
    tickets: (byTheme.get(theme.id) || []).slice(0, 2).map((ticket) => ({
      id: ticket.id,
      ticketNo: ticket.ticketNo,
      title: ticket.title || "",
      summarizeTitle: ticket.summarizeTitle || "",
      content: (ticket.content || "").slice(0, 180),
      createTime: "",
      citizenName: ticket.citizenName || "",
      citizenPhone: "",
      subdistrict: ticket.subdistrict || "",
      channel: ticket.channel || "",
      status: "PENDING",
    })) as MultiFrequencyTheme["tickets"],
  }));

  console.log(`[fill-theme-advice] ${input.length} 个主题，向本地模型要各自的建议`);
  const advice = await enrichThemeBatchWithLLM(input);
  let written = 0;
  for (let i = 0; i < input.length; i++) {
    const item = advice[i];
    const summary = (item?.aiSummary || "").trim();
    const action = (item?.recommendedAction || "").trim();
    if (!summary && !action) {
      console.warn(`[fill-theme-advice] ${input[i].id} 没有得到建议`);
      continue;
    }
    await db
      .update(themesTable)
      .set({
        aiSummary: summary || null,
        recommendedAction: action || null,
      })
      .where(eq(themesTable.id, input[i].id));
    written += 1;
    console.log(`\n${input[i].id} ${input[i].title}`);
    console.log(`摘要: ${summary}`);
    console.log(`建议: ${action}`);
  }

  if (written !== input.length) {
    console.error(`[fill-theme-advice] 只写上 ${written}/${input.length}`);
    process.exit(1);
  }
  console.log(`\n[fill-theme-advice] 已写上 ${written} 个主题`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
