/**
 * 天地图 (Tianditu) 服务端安全代理服务
 * 
 * 1. 严格使用服务端的环境变量 TIANDITU_SERVER_KEY，绝不暴露到客户端；
 * 2. 提供正地理编码 (Geocoding): 地址文本 -> [lng, lat]；
 * 3. 提供逆地理编码 (Reverse Geocoding): [lng, lat] -> 行政区划与街道详细信息（站点管理自动反查）；
 * 4. 提供瓦片底图代理与缓存。
 */

function getTiandituKey(): string {
  const key = process.env.TIANDITU_SERVER_KEY || "";
  if (!key || key === "your_tianditu_server_key_here") {
    console.warn("[Tianditu] TIANDITU_SERVER_KEY is not configured in environment");
  }
  return key;
}

export type GeocodeResult = {
  success: boolean;
  lng?: number;
  lat?: number;
  score?: number;
  level?: string;
  formattedAddress?: string;
  raw?: unknown;
  error?: string;
};

export type ReverseGeocodeResult = {
  success: boolean;
  formattedAddress?: string;
  province?: string;
  city?: string;
  district?: string;
  township?: string;
  road?: string;
  poi?: string;
  townCode?: string;
  raw?: unknown;
  error?: string;
};

/**
 * 正向地理编码：地址解析为经纬度
 */
export async function geocodeAddress(address: string): Promise<GeocodeResult> {
  const key = getTiandituKey();
  if (!key) {
    return { success: false, error: "天地图 Key 未配置" };
  }

  const trimmed = (address || "").trim();
  if (!trimmed) {
    return { success: false, error: "地址不能为空" };
  }

  // 拼接前缀以提高顺德/佛山本地解析精度
  const queryAddress = trimmed.startsWith("广东") || trimmed.startsWith("佛山") || trimmed.startsWith("顺德")
    ? trimmed
    : `广东省佛山市顺德区${trimmed}`;

  try {
    const ds = JSON.stringify({ keyWord: queryAddress });
    const url = `http://api.tianditu.gov.cn/geocoder?ds=${encodeURIComponent(ds)}&tk=${key}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return { success: false, error: `天地图 HTTP 错误 ${res.status}` };
    }
    const data = await res.json();
    if (data.status === "0" || data.status === "001") {
      const loc = data.location || {};
      const lng = parseFloat(loc.lon);
      const lat = parseFloat(loc.lat);
      if (!isNaN(lng) && !isNaN(lat)) {
        return {
          success: true,
          lng,
          lat,
          score: loc.score,
          level: loc.level,
          formattedAddress: loc.keyWord || queryAddress,
          raw: data,
        };
      }
    }
    return { success: false, error: data.msg || "无法解析该地址" };
  } catch (err: any) {
    return { success: false, error: err.message || "请求天地图服务异常" };
  }
}

/**
 * 逆向地理编码：经纬度反查行政区与详细地点（用于站点管理、反查网格区域）
 */
export async function reverseGeocode(lng: number, lat: number): Promise<ReverseGeocodeResult> {
  const key = getTiandituKey();
  if (!key) {
    return { success: false, error: "天地图 Key 未配置" };
  }

  try {
    const postStr = JSON.stringify({ lon: lng, lat, ver: 1 });
    const url = `http://api.tianditu.gov.cn/geocoder?postStr=${encodeURIComponent(postStr)}&type=geocode&tk=${key}`;
    const res = await fetch(url, { next: { revalidate: 86400 } });
    if (!res.ok) {
      return { success: false, error: `天地图 HTTP 错误 ${res.status}` };
    }
    const data = await res.json();
    if (data.status === "0" && data.result) {
      const r = data.result;
      const comp = r.addressComponent || {};
      return {
        success: true,
        formattedAddress: r.formatted_address || "",
        province: comp.province || "",
        city: comp.city || "",
        district: comp.county || "",
        township: comp.town || "",
        road: comp.road || comp.address || "",
        poi: comp.poi || "",
        townCode: comp.town_code || "",
        raw: data,
      };
    }
    return { success: false, error: data.msg || "无法反查该坐标" };
  } catch (err: any) {
    return { success: false, error: err.message || "反查天地图服务异常" };
  }
}

/**
 * 构造天地图瓦片请求 URL (后端代理使用)
 * @param type vec (矢量底图) | cva (中文注记) | img (影像底图) | cia (影像中文注记)
 */
export function getTiandituTileUrl(type: "vec" | "cva" | "img" | "cia", z: number, x: number, y: number): string {
  const key = getTiandituKey();
  const subdomains = ["t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7"];
  const sub = subdomains[(x + y) % subdomains.length];
  const layer = type;
  return `http://${sub}.tianditu.gov.cn/${layer}_w/wmts?SERVICE=WMTS&REQUEST=GetTile&VERSION=1.0.0&LAYER=${layer}&STYLE=default&TILEMATRIXSET=w&FORMAT=tiles&TILEMATRIX=${z}&TILEROW=${y}&TILECOL=${x}&tk=${key}`;
}
