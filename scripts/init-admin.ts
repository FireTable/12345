import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { auth } from "../lib/auth/config";
import { db } from "../db/client";
import { user as userTable, account as accountTable, session as sessionTable } from "../lib/auth/schema";
import { eq, or } from "drizzle-orm";

interface SeedUserConfig {
  email: string;
  username: string;
  password: string;
  name: string;
  role: "admin" | "user";
  label: string;
}

async function ensureSeedUser(cfg: SeedUserConfig) {
  console.log(`👤 检查${cfg.label}账号: 用户名="${cfg.username}", 邮箱="${cfg.email}", 角色="${cfg.role}"...`);

  const [existingUser] = await db
    .select()
    .from(userTable)
    .where(or(eq(userTable.email, cfg.email), eq(userTable.username, cfg.username)))
    .limit(1);

  if (existingUser) {
    const [existingAccount] = await db
      .select()
      .from(accountTable)
      .where(eq(accountTable.userId, existingUser.id))
      .limit(1);

    if (existingAccount && existingAccount.password) {
      if (existingUser.role !== cfg.role) {
        await db
          .update(userTable)
          .set({ role: cfg.role })
          .where(eq(userTable.id, existingUser.id));
        console.log(`✅ ${cfg.label}账号已存在 (ID: ${existingUser.id})，已将角色修正为 '${cfg.role}'。`);
      } else {
        console.log(`✅ ${cfg.label}账号已存在 (ID: ${existingUser.id}, 角色: ${existingUser.role})，凭据正常。`);
      }
      return { ...existingUser, role: cfg.role };
    }

    console.log(`⚠️ ${cfg.label}记录存在但缺少密码凭据，正在清理旧记录以便重新初始化...`);
    await db.delete(sessionTable).where(eq(sessionTable.userId, existingUser.id));
    await db.delete(accountTable).where(eq(accountTable.userId, existingUser.id));
    await db.delete(userTable).where(eq(userTable.id, existingUser.id));
  }

  try {
    const res = await auth.api.signUpEmail({
      body: {
        email: cfg.email,
        password: cfg.password,
        name: cfg.name,
        username: cfg.username,
      },
    });

    if (res?.user) {
      await db
        .update(userTable)
        .set({ role: cfg.role, emailVerified: true })
        .where(eq(userTable.id, res.user.id));
      console.log(`🎉 成功初始化默认${cfg.label}账号: 用户名="${cfg.username}", 角色="${cfg.role}"`);
      return { ...res.user, role: cfg.role };
    }
    console.log(`⚠️ 创建${cfg.label}响应未返回用户对象:`, res);
  } catch (err: any) {
    console.error(`❌ 初始化${cfg.label}失败:`, err?.message || err);
  }
  return null;
}

export async function initCitizenUser() {
  return ensureSeedUser({
    email: process.env.CITIZEN_EMAIL || "citizen@civic.local",
    username: process.env.CITIZEN_USERNAME || "citizen",
    password: process.env.CITIZEN_PASSWORD || "citizen123",
    name: process.env.CITIZEN_NAME || "市民体验账号",
    role: "user",
    label: "市民体验",
  });
}

export async function initAdminUser() {
  const adminUser = await ensureSeedUser({
    email: process.env.ADMIN_EMAIL || "admin@civic.local",
    username: process.env.ADMIN_USERNAME || "admin",
    password: process.env.ADMIN_PASSWORD || "admin",
    name: process.env.ADMIN_NAME || "系统管理员",
    role: "admin",
    label: "系统管理员",
  });

  await initCitizenUser();
  return adminUser;
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
