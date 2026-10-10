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

export async function geocodeAddressClient(
  address: string,
  regionPrefix = ""
): Promise<ClientGeocodeResult> {
  const cleanAddress = (address || "").trim();
  if (!cleanAddress || cleanAddress === "辖区" || cleanAddress === "未指定") {
    return { success: false, error: "暂无有效微观地址" };
  }

  // 1. 优先尝试浏览器端前端 Key 直连天地图
  const tk =
    (typeof window !== "undefined" && (window as any).__TIANDITU_TK__) ||
    process.env.NEXT_PUBLIC_TIANDITU_TK;

  if (tk && tk.trim() && tk !== "your_tianditu_frontend_key_here") {
    try {
      const hasPrefix =
        (regionPrefix && cleanAddress.startsWith(regionPrefix)) ||
        /^(?:.+?[省市]|中国)/.test(cleanAddress);
      const queryAddress = hasPrefix ? cleanAddress : `${regionPrefix}${cleanAddress}`;

      const ds = JSON.stringify({ keyWord: queryAddress });
      const url = `https://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(ds)}&tk=${tk.trim()}`;

      const res = await fetch(url, { signal: AbortSignal.timeout(3500) });
      if (res.ok) {
        const data = await res.json();
        if (data.status === "0" || data.status === "001") {
          const loc = data.location || {};
          const lng = parseFloat(loc.lon);
          const lat = parseFloat(loc.lat);
          if (!isNaN(lng) && !isNaN(lat)) {
            // 异步沉淀至服务端标准字典缓存，不阻塞当前流程
            fetch("/api/map/geocode", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                address: cleanAddress,
                overrideLng: lng,
                overrideLat: lat,
                formattedAddress: loc.keyWord || queryAddress,
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
      // 客户端直连天地图失败（网络超时等），继续回退到后端服务
    }
  }

  // 2. 回退到服务端代理接口 /api/map/geocode (服务端自带 418 优雅兜底降级)
  try {
    const res = await fetch("/api/map/geocode", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: cleanAddress }),
    });
    const json = await res.json();
    const d = json.data || json;
    if (d.success && d.lng && d.lat) {
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
    return { success: false, error: err.message || "地理编码请求失败" };
  }
}
