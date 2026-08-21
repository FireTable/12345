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

async function inspect() {
  console.log("==================================================");
  console.log("🔍 顺德 12345 数据库全量数据质量与 Themes 深度诊断");
  console.log("==================================================");

  // 1. 基础表行数统计
  const [tCount] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketsTable);
  const [thCount] = await db.select({ count: sql<number>`count(*)::int` }).from(themesTable);
  const [ttCount] = await db.select({ count: sql<number>`count(*)::int` }).from(ticketThemesTable);
  const [rCount] = await db.select({ count: sql<number>`count(*)::int` }).from(reviewQueueTable);
  const [vCount] = await db.select({ count: sql<number>`count(*)::int` }).from(vocabulariesTable);
  const [aCount] = await db.select({ count: sql<number>`count(*)::int` }).from(aliasesTable);

  console.log(`\n📊 基础表数据量：`);
  console.log(`- 工单总数 (tickets): ${tCount.count}`);
  console.log(`- 主题总数 (themes): ${thCount.count}`);
  console.log(`- 工单-主题关联 (ticket_themes): ${ttCount.count}`);
  console.log(`- 人工复核队列 (review_queue): ${rCount.count}`);
  console.log(`- 权威词汇 (vocabularies): ${vCount.count}`);
  console.log(`- 别名映射 (aliases): ${aCount.count}`);

  // 2. 检查未关联主题的工单数
  const [unlinked] = await db.select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(sql`primary_theme_id IS NULL OR primary_theme_id = ''`);
  console.log(`\n⚠️ 未关联主题的工单数: ${unlinked.count} / ${tCount.count}`);

  // 3. 检查工单的镇街分布与异常镇街
  const townStats = await db.select({
    subdistrict: ticketsTable.subdistrict,
    count: sql<number>`count(*)::int`
  }).from(ticketsTable).groupBy(ticketsTable.subdistrict);
  console.log(`\n🏘️ 工单镇街分布 (检查是否有非顺德 10 镇街的异常值)：`);
  console.table(townStats);

  // 4. 检查工单的诉求分类分布
  const catStats = await db.select({
    category: ticketsTable.sourceCategory,
    count: sql<number>`count(*)::int`
  }).from(ticketsTable).groupBy(ticketsTable.sourceCategory);
  console.log(`\n📑 工单分类分布：`);
  console.table(catStats);

  // 5. 检查假闭环工单标记
  const [fakeCount] = await db.select({ count: sql<number>`count(*)::int` })
    .from(ticketsTable)
    .where(sql`is_fake_closure = true`);
  console.log(`\n🚨 标记为假闭环的工单数: ${fakeCount.count}`);

  // 6. 深度检查 themes 聚类质量
  console.log(`\n🎯 深度扫描 Themes 主题列表与质量问题：`);
  const allThemes = await db.select().from(themesTable).orderBy(sql`ticket_count DESC`);
  
  const issues: string[] = [];

  for (const t of allThemes) {
    // 检查主题下的关联工单数与记录的 ticket_count 是否一致
    const [realCount] = await db.select({ count: sql<number>`count(*)::int` })
      .from(ticketThemesTable)
      .where(sql`theme_id = ${t.id}`);
    
    if (realCount.count !== t.ticketCount) {
      issues.push(`主题 [${t.id}] "${t.title}": 记录工单数(${t.ticketCount}) 与实际关联表工单数(${realCount.count}) 不一致!`);
    }

    // 检查主题是否包含泛词或无意义标题
    if (t.title.includes("车主") && !t.title.includes("粤") && !t.title.includes("路") && !t.title.includes("小区")) {
      issues.push(`主题 [${t.id}] "${t.title}": 疑似空泛主体未绑定具体车牌或地点!`);
    }
  }

  console.log(`扫描发现 ${issues.length} 个主题潜在一致性/质量问题：`);
  issues.forEach(iss => console.log("  ❌ " + iss));

  // 打印前 15 个主题的标题、分类、镇街、模式、处置建议
  console.log(`\n📋 TOP 15 Themes 样例明细：`);
  allThemes.slice(0, 15).forEach((t, i) => {
    console.log(`\n[#${i + 1}] ID: ${t.id}`);
    console.log(`  标题: ${t.title}`);
    console.log(`  镇街: ${t.canonicalLocation} | 分类: ${t.category} | 模式: ${t.patternType}`);
    console.log(`  工单数: ${t.ticketCount} | 置信度: ${t.aiConfidence} | 风险等级: ${t.riskLevel}`);
    console.log(`  处置负责方: ${t.handlingOwner}`);
    console.log(`  处置建议: ${t.recommendedAction}`);
  });

  // 7. 检查是否有异常或乱码的工单标题/摘要
  const badTickets = await db.select({
    id: ticketsTable.id,
    ticketNo: ticketsTable.ticketNo,
    title: ticketsTable.title,
    summarizeTitle: ticketsTable.summarizeTitle,
    subdistrict: ticketsTable.subdistrict,
    address: ticketsTable.address,
    confidence: ticketsTable.confidence,
    primaryThemeId: ticketsTable.primaryThemeId
  }).from(ticketsTable)
    .where(sql`summarize_title IS NULL OR subdistrict IS NULL OR source_category IS NULL`)
    .limit(20);

  if (badTickets.length > 0) {
    console.log(`\n⚠️ 发现缺失关键字段的异常工单 (${badTickets.length} 条)：`);
    console.table(badTickets);
  } else {
    console.log(`\n✅ 全量工单关键字段 (summarizeTitle, subdistrict, sourceCategory) 完整度 100%！`);
  }
}

inspect().catch(console.error).finally(() => process.exit(0));
