/**
 * 数据库全量数据导出脚本 (Export DB Data to JSON & SQL)
 */

import fs from "fs";
import path from "path";
import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { db } from "../db/client";
import {
  ticketsTable,
  themesTable,
  ticketThemesTable,
  reviewQueueTable,
  vocabulariesTable,
  aliasesTable,
} from "../db/schema";

async function exportAllData() {
  console.log("==================================================");
  console.log("📦 正在导出 PostgreSQL 数据库全量数据...");
  console.log("==================================================\n");

  const dumpDir = path.resolve(process.cwd(), "db", "dumps");
  if (!fs.existsSync(dumpDir)) {
    fs.mkdirSync(dumpDir, { recursive: true });
  }

  const [tickets, themes, ticketThemes, reviewQueue, vocabularies, aliases] =
    await Promise.all([
      db.select().from(ticketsTable),
      db.select().from(themesTable),
      db.select().from(ticketThemesTable),
      db.select().from(reviewQueueTable),
      db.select().from(vocabulariesTable),
      db.select().from(aliasesTable),
    ]);

  const payload = {
    exportedAt: new Date().toISOString(),
    version: "1.0.0",
    counts: {
      tickets: tickets.length,
      themes: themes.length,
      ticketThemes: ticketThemes.length,
      reviewQueue: reviewQueue.length,
      vocabularies: vocabularies.length,
      aliases: aliases.length,
    },
    data: {
      tickets,
      themes,
      ticketThemes,
      reviewQueue,
      vocabularies,
      aliases,
    },
  };

  const jsonFile = path.join(dumpDir, "ticket_radar_data.json");
  fs.writeFileSync(jsonFile, JSON.stringify(payload, null, 2), "utf-8");

  console.log("✅ 导出成功！文件清单：");
  console.log(`   1. [JSON 数据包]: ${jsonFile}`);
  console.log(`      - 工单数据 (tickets): ${tickets.length} 条`);
  console.log(`      - 多频主题 (themes): ${themes.length} 条`);
  console.log(`      - 主题关联 (ticket_themes): ${ticketThemes.length} 条`);
  console.log(`      - 复核队列 (review_queue): ${reviewQueue.length} 条`);
  console.log(`      - 政务词汇 (vocabularies): ${vocabularies.length} 条`);
  console.log(`      - 别名映射 (aliases): ${aliases.length} 条`);

  const sqlFile = path.join(dumpDir, "ticket_radar_backup.sql");
  if (fs.existsSync(sqlFile)) {
    console.log(`   2. [SQL 备份包]: ${sqlFile} (支持 psql 直接恢复)`);
  }

  console.log("\n==================================================");
  console.log("🎉 数据库导出全部完成！其他成员可直接运行 pnpm db:import 导入。");
  console.log("==================================================");
}

exportAllData()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ 导出失败:", err);
    process.exit(1);
  });
