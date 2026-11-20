type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();
const inFlight = new Map<string, Promise<unknown>>();

export const CIVIC_CACHE_TTL_MS = 60_000;
export const MAX_CACHE_ENTRIES = 500;

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
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  // 刷新 LRU 访问顺序
  store.delete(key);
  store.set(key, hit);
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = CIVIC_CACHE_TTL_MS): void {
  if (ttlMs <= 0) {
    store.delete(key);
    return;
  }
  const now = Date.now();
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
  store.set(key, { value, expiresAt: now + ttlMs });
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

export async function cacheGetOrLoad<T>(
  key: string,
  loader: () => Promise<T>,
  ttlMs = CIVIC_CACHE_TTL_MS
): Promise<{ value: T; hit: boolean }> {
  const existing = cacheGet<T>(key);
  if (existing !== undefined) return { value: existing, hit: true };

  const pending = inFlight.get(key) as Promise<T> | undefined;
  if (pending) {
    const value = await pending;
    return { value, hit: true };
  }

  let flight: Promise<T> | undefined;
  flight = (async () => {
    try {
      const value = await loader();
      if (inFlight.get(key) === flight) {
        cacheSet(key, value, ttlMs);
      }
      return value;
    } finally {
      if (inFlight.get(key) === flight) {
        inFlight.delete(key);
      }
    }
  })();

  inFlight.set(key, flight);
  const value = await flight;
  return { value, hit: false };
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
