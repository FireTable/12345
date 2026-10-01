/**
 * 数据库全量数据导入与一键恢复脚本 (Import DB Data from JSON)
 * 支持跨平台、跨环境一键导入，无需依赖外部 psql 命令行工具。
 */

import fs from "fs";
import path from "path";
import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

async function importAllData() {
  console.log("==================================================");
  console.log("📥 正在执行 PostgreSQL 数据库全量恢复 (db-import)...");
  console.log("==================================================\n");

  const jsonFile = path.resolve(
    process.cwd(),
    "db",
    "dumps",
    "ticket_radar_data.json"
  );

  if (!fs.existsSync(jsonFile)) {
    console.error(`❌ 未找到导入数据包: ${jsonFile}`);
    process.exit(1);
  }

  const raw = fs.readFileSync(jsonFile, "utf-8");
  const payload = JSON.parse(raw);
  const { data } = payload;

  console.log(`📄 读取数据备份，生成于: ${payload.exportedAt || "未知时间"}`);

  const { resolveScriptRegion } = await import("./region-target");
  const {
    ticketsTable,
    themesTable,
    ticketThemesTable,
    reviewQueueTable,
    vocabulariesTable,
    aliasesTable,
  } = await import("../db/schema");
  const target = await resolveScriptRegion();
  const db = target.db;
  if (payload.schemaName && payload.schemaName !== target.schemaName) {
    console.log(`ℹ️  备份来自 ${payload.schemaName}，本次写入 ${target.schemaName}`);
  }

  try {
    // 1. 导入 Vocabularies
    if (Array.isArray(data.vocabularies) && data.vocabularies.length > 0) {
      console.log(`⏳ 正在恢复标准词汇表 (${data.vocabularies.length} 条)...`);
      const vRecords = data.vocabularies.map((v: any) => ({
        ...v,
        createdAt: v.createdAt ? new Date(v.createdAt) : new Date(),
      }));
      await db
        .insert(vocabulariesTable)
        .values(vRecords)
        .onConflictDoNothing({ target: vocabulariesTable.id });
      console.log(`   ✅ 词汇表恢复完成！`);
    }

    // 2. 导入 Aliases
    if (Array.isArray(data.aliases) && data.aliases.length > 0) {
      console.log(`⏳ 正在恢复别名知识库 (${data.aliases.length} 条)...`);
      const aRecords = data.aliases.map((a: any) => ({
        ...a,
        createdAt: a.createdAt ? new Date(a.createdAt) : new Date(),
      }));
      await db
        .insert(aliasesTable)
        .values(aRecords)
        .onConflictDoNothing({ target: aliasesTable.alias });
      console.log(`   ✅ 别名库恢复完成！`);
    }

    // 3. 导入 Tickets
    if (Array.isArray(data.tickets) && data.tickets.length > 0) {
      console.log(`⏳ 正在恢复工单主表 (${data.tickets.length} 条)...`);
      const tRecords = data.tickets.map((t: any) => ({
        ...t,
        createTime: t.createTime ? new Date(t.createTime) : null,
        closedAt: t.closedAt ? new Date(t.closedAt) : null,
        createdAt: t.createdAt ? new Date(t.createdAt) : new Date(),
      }));
      await db
        .insert(ticketsTable)
        .values(tRecords)
        .onConflictDoNothing({ target: ticketsTable.ticketNo });
      console.log(`   ✅ 工单主表恢复完成！`);
    }

    // 4. 导入 Themes
    if (Array.isArray(data.themes) && data.themes.length > 0) {
      console.log(`⏳ 正在恢复多频主题表 (${data.themes.length} 条)...`);
      const thRecords = data.themes.map((th: any) => ({
        ...th,
        firstAt: th.firstAt ? new Date(th.firstAt) : null,
        lastAt: th.lastAt ? new Date(th.lastAt) : null,
        handlingEta: th.handlingEta ? new Date(th.handlingEta) : null,
        createdAt: th.createdAt ? new Date(th.createdAt) : new Date(),
      }));
      await db
        .insert(themesTable)
        .values(thRecords)
        .onConflictDoNothing({ target: themesTable.id });
      console.log(`   ✅ 多频主题恢复完成！`);
    }

    // 5. 导入 TicketThemes Junction
    if (Array.isArray(data.ticketThemes) && data.ticketThemes.length > 0) {
      console.log(`⏳ 正在恢复工单-主题关联关系 (${data.ticketThemes.length} 条)...`);
      const ttRecords = data.ticketThemes.map((tt: any) => ({
        ...tt,
        createdAt: tt.createdAt ? new Date(tt.createdAt) : new Date(),
      }));
      await db
        .insert(ticketThemesTable)
        .values(ttRecords)
        .onConflictDoNothing();
      console.log(`   ✅ 关联关系恢复完成！`);
    }

    // 6. 导入 ReviewQueue
    if (Array.isArray(data.reviewQueue) && data.reviewQueue.length > 0) {
      console.log(`⏳ 正在恢复人工复核队列 (${data.reviewQueue.length} 条)...`);
      const rqRecords = data.reviewQueue.map((rq: any) => ({
        ...rq,
        createdAt: rq.createdAt ? new Date(rq.createdAt) : new Date(),
        reviewedAt: rq.reviewedAt ? new Date(rq.reviewedAt) : null,
      }));
      await db
        .insert(reviewQueueTable)
        .values(rqRecords)
        .onConflictDoNothing({ target: reviewQueueTable.id });
      console.log(`   ✅ 复核队列恢复完成！`);
    }

    console.log("\n==================================================");
    console.log("🎉 数据库全量数据导入恢复成功！");
    console.log("==================================================");
  } catch (err: any) {
    console.error("\n❌ 数据库恢复失败:", err.message);
    process.exit(1);
  }
}

importAllData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ 异常:", err);
    process.exit(1);
  });
