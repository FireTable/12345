type Entry = { value: unknown; expiresAt: number };

const store = new Map<string, Entry>();

export const CIVIC_CACHE_TTL_MS = 60_000;

export function cacheGet<T>(key: string): T | undefined {
  const hit = store.get(key);
  if (!hit) return undefined;
  if (hit.expiresAt <= Date.now()) {
    store.delete(key);
    return undefined;
  }
  return hit.value as T;
}

export function cacheSet<T>(key: string, value: T, ttlMs = CIVIC_CACHE_TTL_MS): void {
  store.set(key, { value, expiresAt: Date.now() + ttlMs });
}

export function cacheInvalidate(prefix?: string): number {
  if (!prefix) {
    const n = store.size;
    store.clear();
    return n;
  }
  let n = 0;
  for (const key of [...store.keys()]) {
    if (key.startsWith(prefix)) {
      store.delete(key);
      n += 1;
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
  const value = await loader();
  cacheSet(key, value, ttlMs);
  return { value, hit: false };
}

export function invalidateCivicAggregates(): void {
  cacheInvalidate("overview:");
  cacheInvalidate("trends:");
  cacheInvalidate("workorders:");
  cacheInvalidate("clusters:");
}
