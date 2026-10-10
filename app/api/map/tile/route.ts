import { NextRequest, NextResponse } from "next/server";
import { getTiandituTileUrl } from "@/lib/map/tianditu-service";

// 内存高速瓦片缓存池，最多保留 1000 块瓦片（约 20MB），缩放时毫秒级瞬时命中，避免天地图接口网络抖动与卡顿
const tileCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
const MAX_TILE_CACHE = 1000;

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const type = (searchParams.get("type") || "vec") as "vec" | "cva" | "img" | "cia";
    const z = parseInt(searchParams.get("z") || "", 10);
    const x = parseInt(searchParams.get("x") || "", 10);
    const y = parseInt(searchParams.get("y") || "", 10);

    if (isNaN(z) || isNaN(x) || isNaN(y)) {
      return new NextResponse("Invalid tile coordinates", { status: 400 });
    }

    const cacheKey = `${type}_${z}_${x}_${y}`;
    const cached = tileCache.get(cacheKey);
    if (cached) {
      // 命中内存缓存，直接返回二进制，响应延迟 < 1ms
      return new NextResponse(cached.buffer.slice(0), {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=2592000, immutable",
          "X-Tile-Cache": "HIT",
        },
      });
    }

    const tileUrl = getTiandituTileUrl(type, z, x, y);
    let res = await fetch(tileUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
      },
    }).catch(() => null as Response | null);

    // 若天地图受海外机房 WAF 拦截 (HTTP 418) 或网络异常，自动无缝降级到国内免 Key 高速图源 (高德)
    if (!res || !res.ok) {
      const s = ((x + y) % 4) + 1;
      let fallbackUrl = "";
      if (type === "cva" || type === "cia") {
        fallbackUrl = `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&lang=zh_cn&size=1&scale=1&style=8`;
      } else if (type === "vec") {
        fallbackUrl = `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&lang=zh_cn&size=1&scale=1&style=7`;
      } else if (type === "img") {
        fallbackUrl = `https://wprd0${s}.is.autonavi.com/appmaptile?x=${x}&y=${y}&z=${z}&lang=zh_cn&size=1&scale=1&style=6`;
      }

      if (fallbackUrl) {
        res = await fetch(fallbackUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        }).catch(() => null as Response | null);
      }
    }

    if (!res || !res.ok) {
      return new NextResponse(`Tile fetch failed: ${res?.status || 502}`, { status: res?.status || 502 });
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const arrayBuffer = await res.arrayBuffer();

    // 写入内存 LRU 缓存
    if (tileCache.size >= MAX_TILE_CACHE) {
      // 淘汰最老的一批（先插入的 key）
      const oldestKey = tileCache.keys().next().value;
      if (oldestKey) tileCache.delete(oldestKey);
    }
    tileCache.set(cacheKey, { buffer: arrayBuffer, contentType });

    return new NextResponse(arrayBuffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Tile-Cache": "MISS",
      },
    });
  } catch (err: any) {
    return new NextResponse(`Internal error: ${err.message}`, { status: 500 });
  }
}
