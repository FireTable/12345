import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import postgres from "postgres";
import { runMigrations } from "./db-migrate";
import { initTenants } from "./init-tenants";
import { initAdminUser } from "./init-admin";

const databaseUrl =
  process.env.DATABASE_URL ||
  "postgresql://postgres@localhost:5432/ticket_radar";

export async function dbInit() {
  console.log("==================================================");
  console.log("🚀 开始全量初始化 12345 民声智理分析系统 (db:init)");
  console.log(`   目标数据库: ${databaseUrl}`);
  console.log("==================================================\n");

  const sql = postgres(databaseUrl, { max: 5, onnotice: () => {} });

  try {
    // 1. 基础表结构迁移 (public.user, account, session, regions 等)
    console.log("📦 [1/3] 执行全局数据表迁移 (Drizzle Migrations)...");
    await runMigrations(sql);

    // 2. 多租户站点初始化与标准字典灌入 (顺德区 + 天河区)
    console.log("\n🏛️  [2/3] 初始化多租户站点与官方高精地理边界及数据字典...");
    await initTenants(sql);

    // 3. 初始化/重置默认系统管理员账号 (admin / admin)
    console.log("\n👤 [3/3] 检查并初始化默认系统管理员账号...");
    await initAdminUser();

    console.log("\n==================================================");
    console.log("🎉 恭喜！系统初始化圆满完成！");
    console.log("   📍 已就绪站点: 佛山市顺德区 (fs_shunde), 广州市天河区 (gz_tianhe)");
    console.log("   🗺️  地理底图: 天地图 CGCS2000 国家权威审图高精度边界");
    console.log("   📚 标准知识库: 镇街、部门、业务分类及别名词库均已全量就绪");
    console.log("   🔐 管理员账号: admin / admin");
    console.log("==================================================\n");
  } catch (err: any) {
    console.error("\n❌ 系统初始化失败:", err.message || err);
    throw err;
  } finally {
    await sql.end();
  }
}

if (process.argv[1]?.endsWith("db-init.ts")) {
  dbInit()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
