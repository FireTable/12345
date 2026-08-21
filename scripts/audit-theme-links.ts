import { db } from "../db/client";
import { sql, eq } from "drizzle-orm";
import { ticketsTable, themesTable, ticketThemesTable } from "../db/schema";

async function main() {
  console.log("==================================================");
  console.log("🔍 深度审计 Theme 与工单关联逻辑与一致性体检");
  console.log("==================================================");

  // 1. 检查工单的 primary_theme_id 与 ticket_themes 的一致性
  const ticketsWithPrimary = await db.select({
    id: ticketsTable.id,
    ticketNo: ticketsTable.ticketNo,
    primaryThemeId: ticketsTable.primaryThemeId,
    subdistrict: ticketsTable.subdistrict,
    category: ticketsTable.sourceCategory
  }).from(ticketsTable).where(sql`primary_theme_id IS NOT NULL AND primary_theme_id != ''`);

  console.log(`\n📌 拥有 primary_theme_id 的工单数: ${ticketsWithPrimary.length}`);

  let missingInTicketThemes = 0;
  for (const t of ticketsWithPrimary) {
    const [relation] = await db.select()
      .from(ticketThemesTable)
      .where(sql`ticket_id = ${t.id} AND theme_id = ${t.primaryThemeId}`);
    if (!relation) {
      missingInTicketThemes++;
    }
  }
  console.log(`  - primary_theme_id 存在但在 ticket_themes 关联表缺失的工单数: ${missingInTicketThemes}`);

  // 2. 检查 Theme 内部工单跨镇街串扰 (Cross-Township Inconsistency)
  console.log("\n🏘️ 检查 Theme 内部是否存在【跨镇街串扰】...");
  const allThemes = await db.select().from(themesTable);
  
  let crossTownThemesCount = 0;
  const crossTownSamples: any[] = [];

  for (const th of allThemes) {
    const linkedTickets = await db.select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      subdistrict: ticketsTable.subdistrict,
      category: ticketsTable.sourceCategory,
      title: ticketsTable.title
    })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketThemesTable.ticketId, ticketsTable.id))
    .where(eq(ticketThemesTable.themeId, th.id));

    const towns = Array.from(new Set(linkedTickets.map(tk => tk.subdistrict).filter(Boolean)));
    if (towns.length > 1) {
      crossTownThemesCount++;
      if (crossTownSamples.length < 5) {
        crossTownSamples.push({
          themeId: th.id,
          themeTitle: th.title,
          themeTown: th.subdistrict,
          towns,
          tickets: linkedTickets.map(tk => `[${tk.subdistrict}] ${tk.ticketNo}: ${tk.title}`)
        });
      }
    }
  }

  console.log(`⚠️ 包含多个不同镇街工单的主题数: ${crossTownThemesCount} / ${allThemes.length}`);
  if (crossTownSamples.length > 0) {
    console.log("典型跨镇街主题案例:");
    crossTownSamples.forEach(s => {
      console.log(`\n- 主题 [${s.themeId}] "${s.themeTitle}" (标称镇街: ${s.themeTown}):`);
      console.log(`  包含不同镇街: ${s.towns.join(", ")}`);
      s.tickets.forEach((tk: string) => console.log(`    ${tk}`));
    });
  }

  // 3. 检查 Theme 内部工单跨大类串扰 (Cross-Category Inconsistency)
  console.log("\n📑 检查 Theme 内部工单的分类分布...");
  let crossCatThemesCount = 0;
  const crossCatSamples: any[] = [];

  for (const th of allThemes) {
    const linkedTickets = await db.select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      subdistrict: ticketsTable.subdistrict,
      category: ticketsTable.sourceCategory,
      title: ticketsTable.title
    })
    .from(ticketThemesTable)
    .innerJoin(ticketsTable, eq(ticketThemesTable.ticketId, ticketsTable.id))
    .where(eq(ticketThemesTable.themeId, th.id));

    const cats = Array.from(new Set(linkedTickets.map(tk => tk.category).filter(Boolean)));
    if (cats.length > 1) {
      crossCatThemesCount++;
      if (crossCatSamples.length < 5) {
        crossCatSamples.push({
          themeId: th.id,
          themeTitle: th.title,
          themeCat: th.category,
          cats,
          tickets: linkedTickets.map(tk => `[${tk.category}] ${tk.ticketNo}: ${tk.title}`)
        });
      }
    }
  }

  console.log(`⚠️ 包含多个不同分类工单的主题数: ${crossCatThemesCount} / ${allThemes.length}`);
  if (crossCatSamples.length > 0) {
    console.log("典型跨分类主题案例:");
    crossCatSamples.forEach(s => {
      console.log(`\n- 主题 [${s.themeId}] "${s.themeTitle}" (标称分类: ${s.themeCat}):`);
      console.log(`  包含分类: ${s.cats.join(", ")}`);
      s.tickets.forEach((tk: string) => console.log(`    ${tk}`));
    });
  }

  // 4. 检查是否有票数的 theme 与 ticket_themes 不符
  const countMismatches = await db.select({
    themeId: themesTable.id,
    title: themesTable.title,
    themeCount: themesTable.ticketCount,
    actualCount: sql<number>`count(${ticketThemesTable.ticketId})::int`
  })
  .from(themesTable)
  .leftJoin(ticketThemesTable, eq(themesTable.id, ticketThemesTable.themeId))
  .groupBy(themesTable.id, themesTable.title, themesTable.ticketCount)
  .having(sql`count(${ticketThemesTable.ticketId}) != ${themesTable.ticketCount}`);

  console.log(`\n🔢 记录工单数与实际关联表不一致的 Theme 数量: ${countMismatches.length}`);

  // 5. 检查主题关联中是否存在孤立工单 (无有效主题关联)
  const [orphanCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(sql`id NOT IN (SELECT ticket_id FROM ticket_themes)`);
  console.log(`\n孤立未聚类工单数 (未进入任何 theme): ${orphanCount.count} / 13659`);
}

main().catch(console.error).finally(() => process.exit(0));
