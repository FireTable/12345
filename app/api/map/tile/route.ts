import { NextRequest, NextResponse } from "next/server";
import { getTiandituTileUrl } from "@/lib/map/tianditu-service";

// 内存高速瓦片缓存池，最多保留 1000 块瓦片（约 20MB），缩放时毫秒级瞬时命中，避免天地图接口网络抖动与卡顿
const tileCache = new Map<string, { buffer: ArrayBuffer; contentType: string }>();
const MAX_TILE_CACHE = 1000;
const MAX_TILE_BYTES = 5 * 1024 * 1024;
const ALLOWED_TILE_TYPES = new Set(["vec", "cva", "img", "cia"] as const);
type TileType = "vec" | "cva" | "img" | "cia";

const TILE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

async function fetchValidatedImageTile(
  url: string
): Promise<
  | { ok: true; buffer: ArrayBuffer; contentType: string }
  | { ok: false; timedOut: boolean }
> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": TILE_USER_AGENT },
      signal: AbortSignal.timeout(6000),
    });
    if (!res || !res.ok) {
      return { ok: false, timedOut: false };
    }
    const contentType = (res.headers.get("content-type") || "").trim();
    if (!contentType.toLowerCase().startsWith("image/")) {
      return { ok: false, timedOut: false };
    }
    const contentLengthRaw = res.headers.get("content-length");
    if (contentLengthRaw) {
      const contentLength = Number(contentLengthRaw);
      if (Number.isFinite(contentLength) && contentLength > MAX_TILE_BYTES) {
        await res.body?.cancel().catch(() => {});
        return { ok: false, timedOut: false };
      }
    }
    const buffer = await res.arrayBuffer();
    if (!buffer || buffer.byteLength <= 0 || buffer.byteLength > MAX_TILE_BYTES) {
      return { ok: false, timedOut: false };
    }
    return { ok: true, buffer, contentType };
  } catch (err: any) {
    const timedOut = err?.name === "TimeoutError" || err?.name === "AbortError";
    return { ok: false, timedOut };
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const rawType = searchParams.has("type") ? (searchParams.get("type") ?? "") : "vec";
    if (!ALLOWED_TILE_TYPES.has(rawType as TileType)) {
      return new NextResponse("Invalid tile type", { status: 400 });
    }
    const type = rawType as TileType;

    const zRaw = searchParams.get("z") ?? "";
    const xRaw = searchParams.get("x") ?? "";
    const yRaw = searchParams.get("y") ?? "";
    if (!/^\d+$/.test(zRaw) || !/^\d+$/.test(xRaw) || !/^\d+$/.test(yRaw)) {
      return new NextResponse("Invalid tile coordinates", { status: 400 });
    }

    const z = Number(zRaw);
    const x = Number(xRaw);
    const y = Number(yRaw);
    if (!Number.isSafeInteger(z) || z < 0 || z > 18) {
      return new NextResponse("Invalid tile zoom", { status: 400 });
    }
    const maxCoord = 2 ** z;
    if (
      !Number.isSafeInteger(x) ||
      !Number.isSafeInteger(y) ||
      x < 0 ||
      x >= maxCoord ||
      y < 0 ||
      y >= maxCoord
    ) {
      return new NextResponse("Tile coordinates out of bounds", { status: 400 });
    }

    const cacheKey = `${type}_${z}_${x}_${y}`;
    const cached = tileCache.get(cacheKey);
    if (cached) {
      // 刷新 LRU 顺序并直接返回二进制，响应延迟 < 1ms
      tileCache.delete(cacheKey);
      tileCache.set(cacheKey, cached);
      return new NextResponse(cached.buffer.slice(0), {
        headers: {
          "Content-Type": cached.contentType,
          "Cache-Control": "public, max-age=2592000, immutable",
          "X-Tile-Cache": "HIT",
        },
      });
    }

    const tileUrl = getTiandituTileUrl(type, z, x, y);
    let result = await fetchValidatedImageTile(tileUrl);
    let sawTimeout = !result.ok && result.timedOut;

    // 若天地图受海外机房 WAF 拦截 (HTTP 418 / 非图片响应) 或网络异常，自动无缝降级到国内免 Key 高速图源 (高德)
    if (!result.ok) {
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
        result = await fetchValidatedImageTile(fallbackUrl);
        if (!result.ok) {
          sawTimeout = sawTimeout || result.timedOut;
        }
      }
    }

    if (!result.ok) {
      return new NextResponse(
        sawTimeout ? "Tile upstream timeout" : "Tile fetch failed",
        { status: sawTimeout ? 504 : 502 }
      );
    }

    // 仅在确认返回非空 image/* 瓦片后写入内存 LRU 缓存
    if (tileCache.size >= MAX_TILE_CACHE) {
      // 淘汰最老的一批（先插入的 key）
      const oldestKey = tileCache.keys().next().value;
      if (oldestKey) tileCache.delete(oldestKey);
    }
    tileCache.set(cacheKey, {
      buffer: result.buffer,
      contentType: result.contentType,
    });

    return new NextResponse(result.buffer.slice(0), {
      headers: {
        "Content-Type": result.contentType,
        "Cache-Control": "public, max-age=2592000, immutable",
        "X-Tile-Cache": "MISS",
      },
    });
  } catch (err: any) {
    return new NextResponse(`Internal error: ${err.message}`, { status: 500 });
  }
}
