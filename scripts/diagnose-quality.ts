import { db } from "../db/client";
import { sql } from "drizzle-orm";
import {
  ticketsTable,
  themesTable,
  ticketThemesTable,
  reviewQueueTable,
  vocabulariesTable,
  aliasesTable
} from "../db/schema";

async function main() {
  console.log("==================================================================");
  console.log("🔍 顺德 12345 数据库深度数据质量与 Themes 聚类体检报告");
  console.log("==================================================================");

  // 1. 全局统计
  const [tTotal] = await db.select({ c: sql<number>`count(*)::int` }).from(ticketsTable);
  const [thTotal] = await db.select({ c: sql<number>`count(*)::int` }).from(themesTable);
  const [ttTotal] = await db.select({ c: sql<number>`count(*)::int` }).from(ticketThemesTable);

  console.log(`\n📌 数据规模: 工单 ${tTotal.c} 条, 主题群组 ${thTotal.c} 个, 关联关系 ${ttTotal.c} 条`);

  // 2. 检查工单镇街问题
  const townStats = await db.select({
    subdistrict: ticketsTable.subdistrict,
    count: sql<number>`count(*)::int`
  }).from(ticketsTable).groupBy(ticketsTable.subdistrict).orderBy(sql`count(*) DESC`);
  
  console.log("\n🏘️ 工单镇街分布:");
  console.table(townStats);

  // 3. 检查异常的工单摘要标题 (包含“未标明微观地点”、“特定诉求涉事方”等机器拼接生硬词)
  const badSummaryTickets = await db.select({
    id: ticketsTable.id,
    ticketNo: ticketsTable.ticketNo,
    title: ticketsTable.title,
    summarizeTitle: ticketsTable.summarizeTitle,
    address: ticketsTable.address,
    subdistrict: ticketsTable.subdistrict,
    category: ticketsTable.sourceCategory,
    content: ticketsTable.content
  }).from(ticketsTable)
    .where(sql`summarize_title LIKE '%未标明微观地点%' OR summarize_title LIKE '%特定诉求涉事方%' OR summarize_title LIKE '%关于只有其他城%' OR summarize_title IS NULL`);

  console.log(`\n⚠️ 发现模板拼接/低质量 summarize_title 的工单数: ${badSummaryTickets.length} / ${tTotal.c}`);
  if (badSummaryTickets.length > 0) {
    console.log("前 5 条典型案例:");
    badSummaryTickets.slice(0, 5).forEach((t, i) => {
      console.log(`  [${i+1}] ${t.ticketNo}:`);
      console.log(`      原标题: ${t.title}`);
      console.log(`      现摘要: ${t.summarizeTitle}`);
      console.log(`      正文: ${t.content.slice(0, 80)}...`);
    });
  }

  // 4. 检查 Themes 主题质量
  const allThemes = await db.select().from(themesTable).orderBy(sql`ticket_count DESC`);
  
  const singleTicketThemes = allThemes.filter(t => t.ticketCount === 1);
  const badTitleThemes = allThemes.filter(t => 
    t.title.includes("未标明") || 
    t.title.includes("特定诉求") ||
    t.title.includes("只有其他城") ||
    t.title.startsWith("THEME-") ||
    t.title.length < 5
  );

  console.log(`\n🎯 Themes 主题分析:`);
  console.log(`  - 总主题数: ${allThemes.length}`);
  console.log(`  - 单工单主题 (ticket_count = 1): ${singleTicketThemes.length} 个 (占 ${(singleTicketThemes.length / allThemes.length * 100).toFixed(1)}%)`);
  console.log(`  - 生硬/模板化标题的主题: ${badTitleThemes.length} 个`);

  if (badTitleThemes.length > 0) {
    console.log("\n❌ 发现的不规范 Themes 标题样例:");
    badTitleThemes.slice(0, 10).forEach(bt => {
      console.log(`  - [${bt.id}] "${bt.title}" (镇街: ${bt.subdistrict}, 工单数: ${bt.ticketCount}, 建议: ${bt.actionSuggestion?.slice(0, 40)}...)`);
    });
  }

  // 5. 检查 themes 模式类型分布 (DIVERGE / CONVERGE / INDIVIDUAL_REPEAT / SPATIAL_BURST 等)
  const patternStats = await db.select({
    patternType: themesTable.patternType,
    count: sql<number>`count(*)::int`,
    avgTickets: sql<number>`round(avg(ticket_count), 1)`
  }).from(themesTable).groupBy(themesTable.patternType);
  console.log("\n📊 主题聚类模式分布:");
  console.table(patternStats);

  // 6. 检查是否有 primary_theme_id 与关联表不一致的工单
  const brokenLinks = await db.select({
    tId: ticketsTable.id,
    pTheme: ticketsTable.primaryThemeId
  }).from(ticketsTable)
    .leftJoin(themesTable, sql`${ticketsTable.primaryThemeId} = ${themesTable.id}`)
    .where(sql`${ticketsTable.primaryThemeId} IS NOT NULL AND ${themesTable.id} IS NULL`);
  
  console.log(`\n🔗 孤立/失效的 primary_theme_id 关联数: ${brokenLinks.length}`);

  // 7. 检查无镇街工单的具体分布与内容
  const nullTownTickets = await db.select({
    id: ticketsTable.id,
    ticketNo: ticketsTable.ticketNo,
    title: ticketsTable.title,
    content: ticketsTable.content,
    address: ticketsTable.address
  }).from(ticketsTable).where(sql`subdistrict IS NULL OR subdistrict = ''`);
  console.log(`\n❓ 镇街为空的工单数: ${nullTownTickets.length}`);
  if (nullTownTickets.length > 0) {
    nullTownTickets.slice(0, 5).forEach(nt => {
      console.log(`  - [${nt.ticketNo}] ${nt.title} | 地址: ${nt.address} | 正文: ${nt.content.slice(0, 60)}...`);
    });
  }
}

main().catch(console.error).finally(() => process.exit(0));
