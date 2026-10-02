import { NextRequest, NextResponse } from "next/server";
import { getTiandituTileUrl } from "@/lib/map/tianditu-service";

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

    const tileUrl = getTiandituTileUrl(type, z, x, y);
    const res = await fetch(tileUrl, {
      headers: {
        // 部分地图服务对 User-Agent 做校验
        "User-Agent": "CivicRadar/1.0 MapTileProxy",
      },
      next: { revalidate: 604800 }, // 静态瓦片缓存 7 天
    });

    if (!res.ok) {
      return new NextResponse(`Tile fetch failed: ${res.status}`, { status: res.status });
    }

    const contentType = res.headers.get("content-type") || "image/png";
    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "public, max-age=604800, s-maxage=604800, stale-while-revalidate=86400",
      },
    });
  } catch (err: any) {
    return new NextResponse(`Internal error: ${err.message}`, { status: 500 });
  }
}
