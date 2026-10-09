/** 把占满 CPU 的循环切开，心跳和 HTTP 才能插进来。 */
export function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

export async function mapInChunks<T, R>(
  items: readonly T[],
  mapOne: (item: T, index: number) => R,
  chunkSize: number
): Promise<R[]> {
  const out = new Array<R>(items.length);
  const size = Math.max(1, chunkSize);
  for (let start = 0; start < items.length; start += size) {
    const end = Math.min(start + size, items.length);
    for (let index = start; index < end; index++) {
      out[index] = mapOne(items[index], index);
    }
    if (end < items.length) await yieldToEventLoop();
  }
  return out;
}
