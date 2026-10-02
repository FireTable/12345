import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import postgres from "postgres";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres@localhost:5432/ticket_radar";

export async function clearAllDatabase() {
  console.log("==================================================");
  console.log("🗑️  正在执行 PostgreSQL 全量数据库彻底清空 (db:clear)...");
  console.log(`   目标数据库: ${databaseUrl}`);
  console.log("==================================================\n");

  const sql = postgres(databaseUrl, { max: 5, onnotice: () => {} });

  try {
    // 1. 查找并物理销毁所有多租户 Schema (如 region_fs_shunde, region_gz_tianhe, region_gz_haizhu 等)
    console.log("🧹 [1/3] 扫描并销毁所有多租户物理 Schema...");
    const tenantSchemas = await sql`
      SELECT schema_name 
      FROM information_schema.schemata 
      WHERE schema_name LIKE 'region_%'
    `;

    if (tenantSchemas.length > 0) {
      for (const row of tenantSchemas) {
        const schemaName = row.schema_name;
        console.log(`   → 彻底销毁租户 Schema: "${schemaName}" (包含工单、主题、字典全部数据)...`);
        await sql.unsafe(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE;`);
      }
      console.log(`   ✅ 共销毁 ${tenantSchemas.length} 个多租户物理隔离 Schema。`);
    } else {
      console.log("   ℹ️  未发现残留的租户 Schema。");
    }

    // 2. 清空多租户站点管理中心花名册 (public.regions)
    console.log("\n🧹 [2/3] 清空多站点注册表 (public.regions)...");
    try {
      await sql`TRUNCATE TABLE public.regions CASCADE;`;
      console.log("   ✅ public.regions 站点花名册已彻底清空。");
    } catch (e: any) {
      // 若表尚未建立则忽略
      console.log("   ℹ️  public.regions 表不存在或已被重置。");
    }

    // 3. 清空系统用户、登录会话与凭据 (Better Auth 表)
    console.log("\n🧹 [3/3] 清空系统用户与 Session 会话表 (Auth Users / Sessions)...");
    try {
      await sql`TRUNCATE TABLE public.session, public.account, public.verification, public."user" CASCADE;`;
      console.log("   ✅ 用户账号与 Session 会话已清空，彻底消灭无效 Session 脏数据。");
    } catch (e: any) {
      console.log("   ℹ️  Auth 相关表暂未初始化或已被重置。");
    }

    console.log("\n==================================================");
    console.log("✨ 数据库已全量彻底清空！已恢复为干净白纸状态。");
    console.log("💡 下一步提示: 执行 [pnpm db:init] 可一键完成表迁移、");
    console.log("   初始化【佛山顺德】与【广州天河】双站点及默认管理员账号。");
    console.log("==================================================\n");
  } catch (err: any) {
    console.error("❌ 清空数据库失败:", err.message || err);
    throw err;
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("db-clear.ts")) {
  clearAllDatabase()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
