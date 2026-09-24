import { NextRequest, NextResponse } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import fs from "fs";
import path from "path";

/**
 * POST /api/admin/regions/[id]/upload-map
 * 上传该地区的矢量行政区划 SVG 地图
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { region } = await getRegionDb(id);
    if (!region) {
      return NextResponse.json(
        { success: false, error: `未找到地区 ID 为 [${id}] 的站点` },
        { status: 404 }
      );
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json(
        { success: false, error: "请上传 SVG 地图文件" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const textContent = buffer.toString("utf-8");

    if (!textContent.includes("<svg") || !textContent.includes("</svg>")) {
      return NextResponse.json(
        { success: false, error: "文件格式非法，必须为标准矢量 SVG 格式" },
        { status: 400 }
      );
    }

    const mapsDir = path.resolve(process.cwd(), "public", "maps");
    if (!fs.existsSync(mapsDir)) {
      fs.mkdirSync(mapsDir, { recursive: true });
    }

    const filename = `${id}.svg`;
    const targetPath = path.resolve(mapsDir, filename);
    fs.writeFileSync(targetPath, buffer);

    const relativeUrl = `/maps/${filename}`;

    await sql`
      UPDATE public.regions
      SET svg_map_path = ${relativeUrl}, updated_at = now()
      WHERE id = ${id};
    `;

    return NextResponse.json({
      success: true,
      message: `SVG 行政区划地图上传成功并已绑定至 [${region.name}]`,
      svgMapPath: relativeUrl,
    });
  } catch (error: any) {
    console.error("[admin/regions/upload-map] Error:", error);
    return NextResponse.json(
      { success: false, error: error.message || "上传地图失败" },
      { status: 500 }
    );
  }
}
