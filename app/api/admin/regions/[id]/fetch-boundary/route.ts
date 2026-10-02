import { NextRequest } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import { fetchDistrictBoundary } from "@/lib/map/boundary-service";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

/**
 * POST /api/admin/regions/[id]/fetch-boundary
 * 从官方权威地图源在线拉取区县级高精行政区划边界，并持久化存放在该站点的元数据中
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { region } = await getRegionDb(id);
    if (!region) {
      return apiError(ApiCode.REGION_NOT_FOUND, "未找到目标站点", 404);
    }

    let manualAdcode: number | undefined;
    try {
      const body = await req.json();
      if (body.adcode) manualAdcode = parseInt(body.adcode, 10);
    } catch {}

    // 调用高精行政边界拉取服务
    const result = await fetchDistrictBoundary(region.name, region.city, manualAdcode);
    if (!result.success || !result.geojson) {
      return apiError(ApiCode.INTERNAL_ERROR, result.error || "拉取官方行政区划边界失败", 502);
    }

    const geojsonStr = JSON.stringify(result.geojson);

    // 持久化保存到站点管理中心的 regions 记录中
    await sql`
      UPDATE public.regions
      SET
        geojson_boundary = ${geojsonStr},
        updated_at = now()
      WHERE id = ${id};
    `;

    return apiSuccess({
      regionId: id,
      name: region.name,
      adcode: result.adcode,
      pointCount: result.pointCount,
      center: result.center,
      centroid: result.centroid,
      geojson: result.geojson,
    }, `已成功为「${region.name}」拉取并持久化官方高精行政边界 (${result.pointCount} 个顶点)`);
  } catch (error: any) {
    console.error("[admin/regions/fetch-boundary] Error:", error);
    return apiError(ApiCode.INTERNAL_ERROR, error.message, 500);
  }
}
