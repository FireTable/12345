import { auth } from "../lib/auth/config";
import { db } from "../db/client";
import { user as userTable, account as accountTable, session as sessionTable } from "../lib/auth/schema";
import { eq, or } from "drizzle-orm";

export async function seedAdminUser() {
  const adminEmail = process.env.ADMIN_EMAIL || "admin@civic.local";
  const adminUsername = process.env.ADMIN_USERNAME || "admin";
  const adminPassword = process.env.ADMIN_PASSWORD || "admin";
  const adminName = process.env.ADMIN_NAME || "系统管理员";

  console.log(`[Seed] Checking admin account: username="${adminUsername}", email="${adminEmail}"...`);

  // Check if admin user exists
  const [existingUser] = await db
    .select()
    .from(userTable)
    .where(or(eq(userTable.email, adminEmail), eq(userTable.username, adminUsername)))
    .limit(1);

  if (existingUser) {
    // Check if account credential exists
    const [existingAccount] = await db
      .select()
      .from(accountTable)
      .where(eq(accountTable.userId, existingUser.id))
      .limit(1);

    if (existingAccount && existingAccount.password) {
      console.log(`[Seed] Admin user already exists with credentials (id: ${existingUser.id}, role: ${existingUser.role}).`);
      if (existingUser.role !== "admin") {
        await db
          .update(userTable)
          .set({ role: "admin" })
          .where(eq(userTable.id, existingUser.id));
        console.log(`[Seed] Updated role to 'admin'.`);
      }
      return;
    }

    console.log(`[Seed] Admin user exists but lacks account credentials. Cleaning up to re-seed...`);
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
      console.log(`[Seed] Successfully created default admin account (${adminUsername} / ${adminPassword}) with role 'admin'.`);
    } else {
      console.log(`[Seed] Sign up response:`, res);
    }
  } catch (err: any) {
    console.error(`[Seed] Failed to seed admin user:`, err?.message || err);
  }
}

// If run directly via CLI
if (process.argv[1]?.endsWith("seed-admin.ts")) {
  seedAdminUser()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
