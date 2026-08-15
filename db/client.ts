import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

const url =
  process.env.DATABASE_URL ||
  "postgres://postgres:postgres@localhost:5432/ticket_radar";

declare global {
  var __pg: ReturnType<typeof postgres> | undefined;
}

// Singleton pool for HMR in Next.js development
const sql = globalThis.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pg = sql;
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;
