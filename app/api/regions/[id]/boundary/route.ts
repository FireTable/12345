import { NextRequest } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import { fetchDistrictBoundary } from "@/lib/map/boundary-service";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

/**
 * GET /api/regions/[id]/boundary
 * 获取特定站点持久化在站点管理中心的官方高精行政边界 GeoJSON
 * 若站点数据库中尚未持久化，将自动尝试首次官方拉取并沉淀
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { region } = await getRegionDb(id);
    if (!region) {
      return apiError(ApiCode.REGION_NOT_FOUND, "目标站点不存在", 404);
    }

    // 1. 优先读取已在站点管理中心持久化保存的高精边界
    const [row] = await sql`
      SELECT geojson_boundary FROM public.regions WHERE id = ${id} LIMIT 1;
    `;

    if (row?.geojson_boundary) {
      try {
        const geojson = JSON.parse(row.geojson_boundary);
        return apiSuccess({
          regionId: id,
          name: region.name,
          source: "DATABASE",
          geojson,
        });
      } catch (e) {}
    }

    // 2. 若尚未持久化，自动根据站点名称从官方 API 拉取并存入站点
    const fetchRes = await fetchDistrictBoundary(region.name, region.city);
    if (fetchRes.success && fetchRes.geojson) {
      const geojsonStr = JSON.stringify(fetchRes.geojson);
      await sql`
        UPDATE public.regions
        SET geojson_boundary = ${geojsonStr}, updated_at = now()
        WHERE id = ${id};
      `;

      return apiSuccess({
        regionId: id,
        name: region.name,
        source: "AUTO_FETCHED_AND_SAVED",
        geojson: fetchRes.geojson,
      });
    }

    return apiError(ApiCode.NOT_FOUND, "该站点尚未配置官方行政区划边界", 404);
  } catch (error: any) {
    console.error("[regions/[id]/boundary] Error:", error);
    return apiError(ApiCode.INTERNAL_ERROR, error.message, 500);
  }
}
