import { NextRequest } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import fs from "fs";
import path from "path";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

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
      return apiError(ApiCode.REGION_NOT_FOUND, undefined, 404);
    }

    const formData = await req.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return apiError(ApiCode.FILE_EMPTY, undefined, 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const textContent = buffer.toString("utf-8");

    if (!textContent.includes("<svg") || !textContent.includes("</svg>")) {
      return apiError(ApiCode.FILE_INVALID_FORMAT, undefined, 400);
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

    return apiSuccess({
      svgMapPath: relativeUrl,
      regionId: id,
    });
  } catch (error: any) {
    console.error("[admin/regions/upload-map] Error:", error);
    return apiError(ApiCode.FILE_UPLOAD_FAILED, error.message, 500);
  }
}
