/**
 * 客户端天地图高精地理编码与双轨容灾服务
 * 
 * 架构优势：
 * 1. 优先使用国内用户浏览器直连天地图官方 CDN (NEXT_PUBLIC_TIANDITU_TK)；
 *    由于不经过海外 VPS，天然具备国内客户端原生 IP，彻底规避华为云 WAF 418 海外机房拦截；
 * 2. 具备静默沉淀机制：浏览器端解析到精确经纬度后，自动异步上报给服务端写入标准词典，永久 0ms 命中；
 * 3. 若浏览器网络受限或无 Key，无缝回退至服务端容灾代理 /api/map/geocode。
 */

export type ClientGeocodeResult = {
  success: boolean;
  lng?: number;
  lat?: number;
  formattedAddress?: string;
  township?: string;
  error?: string;
};

export type GeocodeClientOptions = {
  signal?: AbortSignal;
  regionId?: string;
};

export function isValidCoordinate(lng: unknown, lat: unknown): boolean {
  return (
    typeof lng === "number" &&
    Number.isFinite(lng) &&
    typeof lat === "number" &&
    Number.isFinite(lat)
  );
}

export async function runWithConcurrency<T, R>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>,
  signal?: AbortSignal
): Promise<Array<R | undefined>> {
  const limit = Number.isFinite(concurrency)
    ? Math.max(1, Math.floor(concurrency))
    : concurrency === Infinity
      ? Math.max(1, items.length)
      : 1;
  const results: Array<R | undefined> = new Array(items.length);
  let cursor = 0;

  async function next(): Promise<void> {
    while (cursor < items.length) {
      if (signal?.aborted) return;
      const idx = cursor++;
      results[idx] = await worker(items[idx], idx);
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, () => next());
  await Promise.all(workers);
  return results;
}

function createLinkedSignal(
  timeoutMs: number,
  externalSignal?: AbortSignal
): { signal: AbortSignal; cleanup: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Timeout", "TimeoutError"));
  }, timeoutMs);

  const onExternalAbort = () => {
    controller.abort(externalSignal?.reason);
  };

  if (externalSignal) {
    if (externalSignal.aborted) {
      clearTimeout(timer);
      controller.abort(externalSignal.reason);
    } else {
      externalSignal.addEventListener("abort", onExternalAbort, { once: true });
    }
  }

  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      externalSignal?.removeEventListener("abort", onExternalAbort);
    },
  };
}

export async function geocodeAddressClient(
  address: string,
  regionPrefix = "",
  options?: GeocodeClientOptions
): Promise<ClientGeocodeResult> {
  const cleanAddress = (address || "").trim();
  if (!cleanAddress || cleanAddress === "辖区" || cleanAddress === "未指定") {
    return { success: false, error: "暂无有效微观地址" };
  }
  if (options?.signal?.aborted) {
    return { success: false, error: "请求已取消" };
  }

  const regionHeaders: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options?.regionId ? { "x-region-id": options.regionId } : {}),
  };

  // 1. 优先尝试浏览器端前端 Key 直连天地图
  const tk =
    (typeof window !== "undefined" && (window as any).__TIANDITU_TK__) ||
    process.env.NEXT_PUBLIC_TIANDITU_TK;

  if (tk && tk.trim() && tk !== "your_tianditu_frontend_key_here") {
    const linked = createLinkedSignal(3500, options?.signal);
    try {
      const hasPrefix =
        (regionPrefix && cleanAddress.startsWith(regionPrefix)) ||
        /^(?:.+?[省市]|中国)/.test(cleanAddress);
      const queryAddress = hasPrefix ? cleanAddress : `${regionPrefix}${cleanAddress}`;

      const ds = JSON.stringify({ keyWord: queryAddress });
      const url = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(ds)}&tk=${tk.trim()}`;

      const res = await fetch(url, { signal: linked.signal });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "0" || data.status === "001") {
          const loc = data.location || {};
          const lng = parseFloat(loc.lon);
          const lat = parseFloat(loc.lat);
          if (Number.isFinite(lng) && Number.isFinite(lat)) {
            // 异步沉淀至服务端标准字典缓存，不阻塞当前流程
            fetch("/api/map/geocode", {
              method: "POST",
              headers: regionHeaders,
              signal: options?.signal,
              body: JSON.stringify({
                address: cleanAddress,
                overrideLng: lng,
                overrideLat: lat,
                formattedAddress: loc.keyWord || queryAddress,
                ...(options?.regionId ? { regionId: options.regionId } : {}),
              }),
            }).catch(() => {});

            return {
              success: true,
              lng,
              lat,
              formattedAddress: loc.keyWord || queryAddress,
            };
          }
        }
      }
    } catch {
      if (options?.signal?.aborted) {
        return { success: false, error: "请求已取消" };
      }
      // 客户端直连天地图失败（网络超时等），继续回退到后端服务
    } finally {
      linked.cleanup();
    }
  }

  if (options?.signal?.aborted) {
    return { success: false, error: "请求已取消" };
  }

  // 2. 回退到服务端代理接口 /api/map/geocode (服务端自带 418 优雅兜底降级)
  const fallbackLinked = createLinkedSignal(10000, options?.signal);
  try {
    const res = await fetch("/api/map/geocode", {
      method: "POST",
      headers: regionHeaders,
      signal: fallbackLinked.signal,
      body: JSON.stringify({
        address: cleanAddress,
        ...(options?.regionId ? { regionId: options.regionId } : {}),
      }),
    });
    const json = await res.json();
    const d = json.data || json;
    if (d.success && isValidCoordinate(d.lng, d.lat)) {
      return {
        success: true,
        lng: d.lng,
        lat: d.lat,
        formattedAddress: d.formattedAddress || cleanAddress,
        township: d.township,
      };
    }
    return { success: false, error: d.error || "未匹配到坐标" };
  } catch (err: any) {
    if (options?.signal?.aborted || err?.name === "AbortError") {
      return { success: false, error: "请求已取消" };
    }
    return { success: false, error: err.message || "地理编码请求失败" };
  } finally {
    fallbackLinked.cleanup();
  }
}
