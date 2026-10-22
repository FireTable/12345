import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { username } from "better-auth/plugins";
import { db } from "@/db/client";
import * as authSchema from "@/lib/auth/schema";

const secret =
  process.env.BETTER_AUTH_SECRET || "civic-12345-auth-secret-key-production-dev-mode";
const baseURL = process.env.BETTER_AUTH_URL || "http://localhost:3000";

const envOrigins = (process.env.BETTER_AUTH_TRUSTED_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const trustedOrigins = Array.from(
  new Set([
    baseURL,
    "http://localhost:3000",
    "http://localhost:3001",
    "http://localhost:3002",
    "http://127.0.0.1:3000",
    "http://127.0.0.1:3001",
    "http://127.0.0.1:3002",
    ...envOrigins,
  ])
);

declare global {
  // biome-ignore lint/suspicious/noExplicitAny: HMR cache
  var __auth: any;
}

if (process.env.NODE_ENV !== "production") {
  delete globalThis.__auth;
}

export const auth =
  globalThis.__auth ??
  betterAuth({
    baseURL,
    secret,
    database: drizzleAdapter(db, {
      provider: "pg",
      schema: {
        user: authSchema.user,
        session: authSchema.session,
        account: authSchema.account,
        verification: authSchema.verification,
      },
    }),
    emailAndPassword: {
      enabled: true,
      minPasswordLength: 4,
      requireEmailVerification: false,
    },
    plugins: [
      username({
        minUsernameLength: 3,
        maxUsernameLength: 32,
      }),
    ],
    user: {
      additionalFields: {
        role: {
          type: "string",
          defaultValue: "user",
          input: false,
        },
      },
    },
    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // 1 day
    },
    trustedOrigins,
  });

if (process.env.NODE_ENV !== "production") {
  globalThis.__auth = auth;
}

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
