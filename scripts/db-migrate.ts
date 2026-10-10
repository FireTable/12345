import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres@localhost:5432/ticket_radar";

const SWALLOW = new Set(["42P07", "42710", "42P06", "42701", "42703"]);

async function applyContent(sql: postgres.Sql, content: string) {
  for (const chunk of content.split(/--> statement-breakpoint/g)) {
    const text = chunk.trim();
    if (!text) continue;
    try {
      await sql.unsafe(text);
    } catch (e: any) {
      if (!e.code || !SWALLOW.has(e.code)) {
        throw e;
      }
    }
  }
}

export async function runMigrations(customSql?: postgres.Sql) {
  console.log("==================================================");
  console.log("🐘 正在执行 Drizzle 数据库迁移 (db-migrate)...");
  console.log(`   目标数据库: ${databaseUrl}`);
  console.log("==================================================\n");

  const sql = customSql || postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const shouldClose = !customSql;

  try {
    const dir = join(process.cwd(), "db", "migrations");
    const sqlFiles = readdirSync(dir)
      .filter((f) => f.endsWith(".sql"))
      .sort();

    for (const f of sqlFiles) {
      const p = join(dir, f);
      console.log(`→ 执行迁移文件: ${f}`);
      const content = readFileSync(p, "utf-8");
      await applyContent(sql, content);
    }

    console.log("\n✅ 数据库迁移成功完成！所有表结构已建立。");
  } catch (err: any) {
    console.error("\n❌ 数据库迁移失败:", err.message);
    throw err;
  } finally {
    if (shouldClose) {
      await sql.end();
    }
  }
}

if (process.argv[1]?.endsWith("db-migrate.ts")) {
  runMigrations()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
