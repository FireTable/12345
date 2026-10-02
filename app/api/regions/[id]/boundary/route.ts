import { NextRequest } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import { fetchDistrictBoundary } from "@/lib/map/boundary-service";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

/**
 * GET /api/regions/[id]/boundary?level=district|subdistricts
 * 获取特定站点持久化在站点管理中心的官方高精行政边界 GeoJSON
 * - level=district (默认): 区县级权威审图轮廓
 * - level=subdistricts: 第四级镇街多边形网格面
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

    const { searchParams } = new URL(req.url);
    const level = searchParams.get("level") || "district";

    // 1. 读取站点数据库中持久化的空间数据
    const [row] = await sql`
      SELECT geojson_boundary, subdistricts_geojson FROM public.regions WHERE id = ${id} LIMIT 1;
    `;

    // 2. 如果请求第四级镇街边界
    if (level === "subdistricts") {
      if (row?.subdistricts_geojson) {
        try {
          const geojson = JSON.parse(row.subdistricts_geojson);
          return apiSuccess({
            regionId: id,
            name: region.name,
            level: "subdistricts",
            source: "DATABASE",
            geojson,
          });
        } catch (e) {}
      }
      return apiError(ApiCode.NOT_FOUND, "该站点尚未配置第四级镇街多边形数据", 404);
    }

    // 3. 默认请求区县级权威边界
    if (row?.geojson_boundary) {
      try {
        const geojson = JSON.parse(row.geojson_boundary);
        let subdistricts = null;
        if (row?.subdistricts_geojson) {
          try {
            subdistricts = JSON.parse(row.subdistricts_geojson);
          } catch (e) {}
        }

        return apiSuccess({
          regionId: id,
          name: region.name,
          level: "district",
          source: "DATABASE",
          geojson,
          hasSubdistricts: Boolean(subdistricts),
          subdistrictsGeojson: subdistricts,
        });
      } catch (e) {}
    }

    // 4. 若区级边界尚未持久化，自动根据站点名称从官方 API 拉取并沉淀
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
        level: "district",
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
