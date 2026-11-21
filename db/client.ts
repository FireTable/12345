import { drizzle } from "drizzle-orm/postgres-js";
import { eq } from "drizzle-orm";
import postgres from "postgres";
import * as schema from "./schema";

if (!process.env.DATABASE_URL && typeof process.loadEnvFile === "function") {
  try {
    process.loadEnvFile(".env.local");
  } catch {}
}

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres@localhost:5432/ticket_radar";

type DeferredPoolClose = {
  sql: ReturnType<typeof postgres>;
  timer: ReturnType<typeof setTimeout>;
};

declare global {
  var __pg: ReturnType<typeof postgres> | undefined;
  var __tenantSqls: Map<string, ReturnType<typeof postgres>> | undefined;
  var __tenantDbs: Map<string, DB> | undefined;
  var __tenantPoolLastUsed: Map<string, number> | undefined;
  var __deferredClosingPools: Map<string, Set<DeferredPoolClose>> | undefined;
  var __regionSchemaCache: Map<string, { schemaName: string; region: schema.RegionRecord }> | undefined;
  var __regionCacheState:
    | { loadedAt: number; inFlight: Promise<schema.RegionRecord[]> | null }
    | undefined;
}

const MAX_TENANT_POOLS = 8;
const TENANT_POOL_MAX = 6;
const TENANT_IDLE_EVICT_MS = 10 * 60 * 1000;
const POOL_DEFERRED_END_MS = 5_000;
const POOL_IDLE_TIMEOUT_SEC = 30;
const POOL_CONNECT_TIMEOUT_SEC = 15;
const CACHE_TTL_MS = 60 * 1000; // 1 分钟缓存

// 1. 公共默认数据库连接（针对 public schema，用于 Better Auth、regions 表等）
export const sql =
  globalThis.__pg ??
  postgres(url, {
    max: 10,
    idle_timeout: POOL_IDLE_TIMEOUT_SEC,
    connect_timeout: POOL_CONNECT_TIMEOUT_SEC,
  });
if (process.env.NODE_ENV !== "production") {
  globalThis.__pg = sql;
}

export const db = drizzle(sql, { schema });
export type DB = typeof db;

// 2. 租户连接池缓存（按 schema_name 维护，带严格的 search_path 物理隔离与 LRU/空闲淘汰）
const tenantSqls: Map<string, ReturnType<typeof postgres>> =
  globalThis.__tenantSqls ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalThis.__tenantSqls = tenantSqls;
}

const tenantDbs: Map<string, DB> =
  globalThis.__tenantDbs ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalThis.__tenantDbs = tenantDbs;
}

const tenantPoolLastUsed: Map<string, number> =
  globalThis.__tenantPoolLastUsed ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalThis.__tenantPoolLastUsed = tenantPoolLastUsed;
}

const deferredClosingPools: Map<string, Set<DeferredPoolClose>> =
  globalThis.__deferredClosingPools ?? new Map();
if (process.env.NODE_ENV !== "production") {
  globalThis.__deferredClosingPools = deferredClosingPools;
}

/**
 * 缓存的地区 ID 到 Schema 映射（跨 chunk 共享状态）
 */
const regionSchemaCache: Map<string, { schemaName: string; region: schema.RegionRecord }> =
  globalThis.__regionSchemaCache ?? new Map();
globalThis.__regionSchemaCache = regionSchemaCache;

const regionCacheState =
  globalThis.__regionCacheState ?? { loadedAt: 0, inFlight: null };
globalThis.__regionCacheState = regionCacheState;

function deferClosePool(schemaName: string): void {
  const oldSql = tenantSqls.get(schemaName);
  tenantSqls.delete(schemaName);
  tenantDbs.delete(schemaName);
  tenantPoolLastUsed.delete(schemaName);
  if (!oldSql) return;

  let set = deferredClosingPools.get(schemaName);
  if (!set) {
    set = new Set();
    deferredClosingPools.set(schemaName, set);
  }
  const entry: DeferredPoolClose = {
    sql: oldSql,
    timer: setTimeout(() => {
      const currentSet = deferredClosingPools.get(schemaName);
      if (currentSet) {
        currentSet.delete(entry);
        if (currentSet.size === 0) {
          deferredClosingPools.delete(schemaName);
        }
      }
      void oldSql.end({ timeout: 5 }).catch(() => {});
    }, POOL_DEFERRED_END_MS),
  };
  entry.timer.unref?.();
  set.add(entry);
}

async function closeAndRemovePool(schemaName: string): Promise<void> {
  const oldSql = tenantSqls.get(schemaName);
  tenantSqls.delete(schemaName);
  tenantDbs.delete(schemaName);
  tenantPoolLastUsed.delete(schemaName);

  const sqlsToClose: Array<ReturnType<typeof postgres>> = [];
  if (oldSql) {
    sqlsToClose.push(oldSql);
  }
  const deferredSet = deferredClosingPools.get(schemaName);
  if (deferredSet) {
    deferredClosingPools.delete(schemaName);
    for (const entry of deferredSet) {
      clearTimeout(entry.timer);
      sqlsToClose.push(entry.sql);
    }
  }
  if (sqlsToClose.length > 0) {
    await Promise.all(sqlsToClose.map((s) => s.end({ timeout: 5 }).catch(() => {})));
  }
}

export async function evictTenantPool(schemaName: string, regionId?: string): Promise<void> {
  if (regionId) {
    regionSchemaCache.delete(regionId);
  }
  for (const [id, val] of Array.from(regionSchemaCache.entries())) {
    if (val.schemaName === schemaName) {
      regionSchemaCache.delete(id);
    }
  }
  regionCacheState.loadedAt = 0;
  await closeAndRemovePool(schemaName);
}

export function invalidateRegionCache(regionId?: string): void {
  if (regionId) {
    regionSchemaCache.delete(regionId);
  } else {
    regionSchemaCache.clear();
  }
  regionCacheState.loadedAt = 0;
}

export function getTenantPoolStats(): {
  size: number;
  maxPools: number;
  keys: string[];
} {
  return {
    size: tenantSqls.size,
    maxPools: MAX_TENANT_POOLS,
    keys: Array.from(tenantSqls.keys()),
  };
}

/**
 * 刷新或获取全量地区配置（TTL 缓存 + 单飞去重）
 */
export async function getAllRegions(opts?: {
  forceRefresh?: boolean;
}): Promise<schema.RegionRecord[]> {
  if (
    !opts?.forceRefresh &&
    regionSchemaCache.size > 0 &&
    Date.now() - regionCacheState.loadedAt < CACHE_TTL_MS
  ) {
    return Array.from(regionSchemaCache.values(), (v) => v.region);
  }

  if (regionCacheState.inFlight) {
    return regionCacheState.inFlight;
  }

  let flight: Promise<schema.RegionRecord[]> | undefined;
  flight = (async () => {
    try {
      const rows = await db
        .select({
          id: schema.regionsTable.id,
          name: schema.regionsTable.name,
          city: schema.regionsTable.city,
          province: schema.regionsTable.province,
          schemaName: schema.regionsTable.schemaName,
          svgMapPath: schema.regionsTable.svgMapPath,
          categoryConfigJson: schema.regionsTable.categoryConfigJson,
          status: schema.regionsTable.status,
          isDefault: schema.regionsTable.isDefault,
          description: schema.regionsTable.description,
          createdAt: schema.regionsTable.createdAt,
          updatedAt: schema.regionsTable.updatedAt,
        })
        .from(schema.regionsTable)
        .where(eq(schema.regionsTable.status, "ACTIVE"));
      const records: schema.RegionRecord[] = rows.map((r) => ({
        ...r,
        geojsonBoundary: null,
        subdistrictsGeojson: null,
      }));
      regionSchemaCache.clear();
      for (const r of records) {
        regionSchemaCache.set(r.id, { schemaName: r.schemaName, region: r });
      }
      regionCacheState.loadedAt = Date.now();
      return records;
    } catch {
      // 若尚未初始化 regions 表，返回空列表
      return [];
    } finally {
      if (regionCacheState.inFlight === flight) {
        regionCacheState.inFlight = null;
      }
    }
  })();

  regionCacheState.inFlight = flight;
  return flight;
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

  if (Date.now() - regionCacheState.loadedAt > CACHE_TTL_MS || regionSchemaCache.size === 0) {
    await getAllRegions();
  }

  // 别名与历史参数归一化
  if (targetId === "shunde") targetId = "fs_shunde";
  if (targetId === "haizhu") targetId = "gz_haizhu";

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
    // 超过 5 秒未刷新时查一次 DB 确认是否有新创建的地区
    if (Date.now() - regionCacheState.loadedAt > 5_000) {
      await getAllRegions({ forceRefresh: true });
    }
    if (regionSchemaCache.has(targetId)) {
      const cached = regionSchemaCache.get(targetId)!;
      schemaName = cached.schemaName;
      targetRegion = cached.region;
    } else {
      // 容错模糊匹配后缀（例如传了 shunde 匹配到 fs_shunde）
      for (const [id, val] of regionSchemaCache.entries()) {
        if (id.endsWith(`_${targetId}`) || id === targetId) {
          targetId = id;
          schemaName = val.schemaName;
          targetRegion = val.region;
          break;
        }
      }
    }
  }

  // 获取该 Schema 专属的连接池与 Drizzle 实例（维护 LRU 与空闲淘汰）
  const now = Date.now();
  if (tenantDbs.has(schemaName) && tenantSqls.has(schemaName)) {
    const existingSql = tenantSqls.get(schemaName)!;
    const existingDb = tenantDbs.get(schemaName)!;
    tenantSqls.delete(schemaName);
    tenantSqls.set(schemaName, existingSql);
    tenantDbs.delete(schemaName);
    tenantDbs.set(schemaName, existingDb);
    tenantPoolLastUsed.set(schemaName, now);
  } else {
    let tenantSql = tenantSqls.get(schemaName);
    if (!tenantSql) {
      tenantSql = postgres(url, {
        connection: {
          search_path: `${schemaName}, public`,
        },
        max: TENANT_POOL_MAX,
        idle_timeout: POOL_IDLE_TIMEOUT_SEC,
        connect_timeout: POOL_CONNECT_TIMEOUT_SEC,
      });
      tenantSqls.set(schemaName, tenantSql);
    }
    tenantDbs.set(schemaName, drizzle(tenantSql, { schema }));
    tenantPoolLastUsed.set(schemaName, now);
  }

  for (const [s, lastUsed] of Array.from(tenantPoolLastUsed.entries())) {
    if (s !== schemaName && now - lastUsed > TENANT_IDLE_EVICT_MS) {
      deferClosePool(s);
    }
  }
  while (tenantSqls.size > MAX_TENANT_POOLS) {
    let evicted = false;
    for (const s of tenantSqls.keys()) {
      if (s !== schemaName) {
        deferClosePool(s);
        evicted = true;
        break;
      }
    }
    if (!evicted) break;
  }

  const resolvedDb = tenantDbs.get(schemaName) ?? db;

  return {
    db: resolvedDb,
    region: targetRegion,
    schemaName,
  };
}
