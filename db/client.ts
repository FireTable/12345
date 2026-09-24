import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

const url =
  process.env.DATABASE_URL ||
  "postgresql://FireTable@localhost:5432/ticket_radar";

declare global {
  var __pg: ReturnType<typeof postgres> | undefined;
  var __tenantSqls: Map<string, ReturnType<typeof postgres>> | undefined;
}

// 1. 公共默认数据库连接（针对 public schema，用于 Better Auth、regions 表等）
export const sql = globalThis.__pg ?? postgres(url, { max: 10 });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pg = sql;
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;

// 2. 租户连接池缓存（按 schema_name 维护，带严格的 search_path 物理隔离）
const tenantSqls: Map<string, ReturnType<typeof postgres>> =
  globalThis.__tenantSqls ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalThis.__tenantSqls = tenantSqls;
}

const tenantDbs = new Map<string, DB>();

/**
 * 缓存的地区 ID 到 Schema 映射
 */
const regionSchemaCache = new Map<string, { schemaName: string; region: schema.RegionRecord }>();
let cacheLastLoaded = 0;
const CACHE_TTL_MS = 60 * 1000; // 1 分钟缓存

/**
 * 刷新或获取全量地区配置
 */
export async function getAllRegions(): Promise<schema.RegionRecord[]> {
  try {
    const rows = await db
      .select()
      .from(schema.regionsTable)
      .where(eq(schema.regionsTable.status, "ACTIVE"));
    for (const r of rows) {
      regionSchemaCache.set(r.id, { schemaName: r.schemaName, region: r });
    }
    cacheLastLoaded = Date.now();
    return rows;
  } catch (err: any) {
    // 若尚未初始化 regions 表，返回空列表
    return [];
  }
}

/**
 * 获取默认激活地区
 */
export async function getDefaultRegion(): Promise<schema.RegionRecord | null> {
  const regions = await getAllRegions();
  if (regions.length === 0) return null;
  return regions.find((r) => r.isDefault) || regions[0];
}

/**
 * 根据地区 ID 或直接根据 Schema 名称获取隔离的 Drizzle 实例
 */
export async function getRegionDb(regionIdOrSchema?: string | null): Promise<{
  db: DB;
  region: schema.RegionRecord | null;
  schemaName: string;
}> {
  // 如果未指定，获取默认地区
  let targetId = regionIdOrSchema?.trim();
  let schemaName = "public";
  let targetRegion: schema.RegionRecord | null = null;

  if (Date.now() - cacheLastLoaded > CACHE_TTL_MS || regionSchemaCache.size === 0) {
    await getAllRegions();
  }

  if (!targetId || targetId === "default") {
    const def = await getDefaultRegion();
    if (def) {
      targetId = def.id;
      schemaName = def.schemaName;
      targetRegion = def;
    }
  } else if (regionSchemaCache.has(targetId)) {
    const cached = regionSchemaCache.get(targetId)!;
    schemaName = cached.schemaName;
    targetRegion = cached.region;
  } else if (targetId.startsWith("region_")) {
    schemaName = targetId;
  } else {
    // 重新查一次 DB 确认是否有新创建的地区
    await getAllRegions();
    if (regionSchemaCache.has(targetId)) {
      const cached = regionSchemaCache.get(targetId)!;
      schemaName = cached.schemaName;
      targetRegion = cached.region;
    }
  }

  // 获取该 Schema 专属的连接池实例
  if (!tenantSqls.has(schemaName)) {
    const tenantSql = postgres(url, {
      connection: {
        search_path: `${schemaName}, public`,
      },
      max: 8,
    });
    tenantSqls.set(schemaName, tenantSql);
    tenantDbs.set(schemaName, drizzle(tenantSql, { schema }));
  }

  return {
    db: tenantDbs.get(schemaName)!,
    region: targetRegion,
    schemaName,
  };
}
