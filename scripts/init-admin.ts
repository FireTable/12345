import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { auth } from "../lib/auth/config";
import { db } from "../db/client";
import { user as userTable, account as accountTable, session as sessionTable } from "../lib/auth/schema";
import { eq, or } from "drizzle-orm";

export async function initAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@civic.local";
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
  const adminName = process.env.ADMIN_NAME || "系统管理员";

  console.log(`👤 检查系统管理员账号: 用户名="${adminUsername}", 邮箱="${adminEmail}"...`);

  // 1. 检查是否存在同名或同邮箱用户
  const [existingUser] = await db
    .select()
    .from(userTable)
    .where(or(eq(userTable.email, adminEmail), eq(userTable.username, adminUsername)))
    .limit(1);

  if (existingUser) {
    // 检查密码凭据是否完整
    const [existingAccount] = await db
      .select()
      .from(accountTable)
      .where(eq(accountTable.userId, existingUser.id))
      .limit(1);

    if (existingAccount && existingAccount.password) {
      console.log(`✅ 管理员账号已存在 (ID: ${existingUser.id}, 角色: ${existingUser.role})，凭据正常。`);
      if (existingUser.role !== "admin") {
        await db
          .update(userTable)
          .set({ role: "admin" })
          .where(eq(userTable.id, existingUser.id));
        console.log(`   已升级用户角色为 'admin'。`);
      }
      return existingUser;
    }

    console.log(`⚠️ 管理员记录存在但缺少密码凭据，正在清理旧记录以便重新初始化...`);
    await db.delete(sessionTable).where(eq(sessionTable.userId, existingUser.id));
    await db.delete(accountTable).where(eq(accountTable.userId, existingUser.id));
    await db.delete(userTable).where(eq(userTable.id, existingUser.id));
  }

  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: adminEmail,
        password: adminPassword,
        name: adminName,
        username: adminUsername,
      },
    });

    if (res?.user) {
      await db
        .update(userTable)
        .set({ role: "admin", emailVerified: true })
        .where(eq(userTable.id, res.user.id));
      console.log(`🎉 成功初始化默认系统管理员账号:`);
      console.log(`   账号: ${adminUsername}`);
      console.log(`   密码: ${adminPassword}`);
      console.log(`   角色: admin`);
      return res.user;
    } else {
      console.log(`⚠️ 创建响应未返回用户对象:`, res);
    }
  } catch (err: any) {
    console.error(`❌ 初始化管理员失败:`, err?.message || err);
  }
}

export const seedAdminUser = initAdminUser;

// If run directly via CLI
if (process.argv[1]?.endsWith("init-admin.ts") || process.argv[1]?.endsWith("seed-admin.ts")) {
  initAdminUser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
