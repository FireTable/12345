import nextEnvPkg from "@next/env";
import { sql } from "drizzle-orm";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

async function clearDatabase() {
  console.log("==================================================");
  console.log("🗑️  正在清空 PostgreSQL 数据库表数据...");
  console.log("==================================================\n");

  const { resolveScriptRegion } = await import("./region-target");
  const { ticketsTable, themesTable, ticketThemesTable } = await import("../db/schema");
  const { db } = await resolveScriptRegion();

  try {
    await db.delete(ticketThemesTable);
    await db.delete(themesTable);
    await db.delete(ticketsTable);

    const countRes = await db.select({ count: sql<number>`count(*)` }).from(ticketsTable);
    const remaining = Number(countRes[0]?.count || 0);

    console.log(`✅ 数据库清空完成！当前 tickets 表记录数: ${remaining} 条`);
  } catch (err: any) {
    console.error("❌ 清空失败:", err.message);
    process.exit(1);
  }

  process.exit(0);
}

clearDatabase().catch((err) => {
  console.error("❌ 清空失败:", err);
  process.exit(1);
});
