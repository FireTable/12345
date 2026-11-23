type Entry = {
  value: unknown;
  /** 软过期时间戳：超过后仍命中旧值并在后台单飞刷新（SWR） */
  staleAt: number;
  /** 硬过期时间戳：超过后彻底失效并阻塞回源 */
  expiresAt: number;
};

declare global {
  // eslint-disable-next-line no-var
  var __civicCacheStore: Map<string, Entry> | undefined;
  // eslint-disable-next-line no-var
  var __civicCacheInFlight: Map<string, Promise<unknown>> | undefined;
}

/**
 * 挂在 globalThis 上，确保 Next.js standalone 多 route chunk 共享同一份缓存与失效信号。
 */
const store: Map<string, Entry> =
  globalThis.__civicCacheStore ?? (globalThis.__civicCacheStore = new Map<string, Entry>());
const inFlight: Map<string, Promise<unknown>> =
  globalThis.__civicCacheInFlight ??
  (globalThis.__civicCacheInFlight = new Map<string, Promise<unknown>>());

/** 默认软过期时间（SWR 触发线）：60 秒 */
export const CIVIC_CACHE_TTL_MS = 60_000;
/** 默认硬过期时间（彻底淘汰线）：10 分钟 */
export const CIVIC_CACHE_HARD_TTL_MS = 10 * 60_000;
export const MAX_CACHE_ENTRIES = 500;

function resolveHardTtlMs(softTtlMs: number, hardTtlMs?: number): number {
  if (typeof hardTtlMs === "number" && Number.isFinite(hardTtlMs)) {
    return Math.max(softTtlMs, hardTtlMs);
  }
  return Math.max(softTtlMs, Math.min(CIVIC_CACHE_HARD_TTL_MS, softTtlMs * 10));
}

function pruneExpired(now = Date.now()): void {
  for (const [key, entry] of store.entries()) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    }
  }
}

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  const now = Date.now();
  if (hit.expiresAt <= now) {
    store.delete(key);
    return undefined;
  }
  if (hit.staleAt <= now) {
    return undefined;
  }
  // 刷新 LRU 访问顺序
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(
  key: string,
  value: T,
  ttlMs = CIVIC_CACHE_TTL_MS,
  hardTtlMs?: number
): void {
  if (ttlMs <= 0) {
    store.delete(key);
    return;
  }
  const now = Date.now();
  const effectiveHardTtl = resolveHardTtlMs(ttlMs, hardTtlMs);
  if (store.has(key)) {
    store.delete(key);
  } else if (store.size >= MAX_CACHE_ENTRIES) {
    pruneExpired(now);
    while (store.size >= MAX_CACHE_ENTRIES) {
      const oldest = store.keys().next().value;
      if (oldest === undefined) break;
      store.delete(oldest);
    }
  }
  store.set(key, {
    value,
    staleAt: now + ttlMs,
    expiresAt: now + effectiveHardTtl,
  });
}

export function cacheInvalidate(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    inFlight.clear();
    return n;
  }
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      n += 1;
    }
  }
  for (const key of [...inFlight.keys()]) {
    if (key.startsWith(prefix)) {
      inFlight.delete(key);
    }
  }
  return n;
}

function invalidateKeyOrScopedPrefix(base: string): number {
  const colonPrefix = `${base}:`;
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key === base || key.startsWith(colonPrefix)) {
      store.delete(key);
      n += 1;
    }
  }
  for (const key of [...inFlight.keys()]) {
    if (key === base || key.startsWith(colonPrefix)) {
      inFlight.delete(key);
    }
  }
  return n;
}

function startFlight<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs: number,
  hardTtlMs?: number
): Promise<T> {
  let flight: Promise<T> | undefined;
  flight = (async () => {
    try {
      const value = await loader();
      // 若期间发生过 cacheInvalidate，inFlight.get(key) 已被清理或替换为新任务，避免脏写回
      if (inFlight.get(key) === flight) {
        cacheSet(key, value, ttlMs, hardTtlMs);
      }
      return value;
    } finally {
      if (inFlight.get(key) === flight) {
        inFlight.delete(key);
      }
    }
  })();
  inFlight.set(key, flight);
  return flight;
}

export async function cacheGetOrLoad<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = CIVIC_CACHE_TTL_MS,
  options?: { hardTtlMs?: number }
): Promise<{ value: T; hit: boolean; stale?: boolean }> {
  const now = Date.now();
  const entry = store.get(key);

  if (entry) {
    if (entry.expiresAt <= now) {
      store.delete(key);
    } else {
      // 刷新 LRU 访问顺序
      store.delete(key);
      store.set(key, entry);

      if (entry.staleAt > now) {
        return { value: entry.value as T, hit: true, stale: false };
      }

      // 软过期（SWR）：立即返回旧值，同时触发后台单飞异步刷新
      if (ttlMs > 0 && !inFlight.has(key)) {
        const bgFlight = startFlight(key, loader, ttlMs, options?.hardTtlMs);
        bgFlight.catch((err) => {
          console.warn(
            `[civic-cache] background SWR refresh failed for "${key}":`,
            err instanceof Error ? err.message : String(err)
          );
        });
      }
      return { value: entry.value as T, hit: true, stale: true };
    }
  }

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) {
    const value = await pending;
    return { value, hit: true, stale: false };
  }

  const flight = startFlight(key, loader, ttlMs, options?.hardTtlMs);
  const value = await flight;
  return { value, hit: false, stale: false };
}

export function invalidateCivicAggregates(regionId?: string): void {
  const trimmed = regionId?.trim();
  if (trimmed) {
    invalidateKeyOrScopedPrefix(`overview:${trimmed}`);
    invalidateKeyOrScopedPrefix(`trends:${trimmed}`);
    invalidateKeyOrScopedPrefix(`workorders:stats:${trimmed}`);
    invalidateKeyOrScopedPrefix(`clusters:bundle:v2:${trimmed}`);
    invalidateKeyOrScopedPrefix(`clusters:json:v2:${trimmed}`);
    invalidateKeyOrScopedPrefix(`clusters:${trimmed}`);
    invalidateKeyOrScopedPrefix(`themes:${trimmed}`);
    invalidateKeyOrScopedPrefix(`cockpit:snapshot:${trimmed}`);
    invalidateKeyOrScopedPrefix(`cockpit:${trimmed}`);
    invalidateKeyOrScopedPrefix(`stats:${trimmed}`);
    return;
  }
  cacheInvalidate("overview:");
  cacheInvalidate("trends:");
  cacheInvalidate("workorders:");
  cacheInvalidate("clusters:");
  cacheInvalidate("themes:");
  cacheInvalidate("cockpit:");
  cacheInvalidate("stats:");
}
