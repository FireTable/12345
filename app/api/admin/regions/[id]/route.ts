import { NextRequest } from "next/server";
import { sql, getRegionDb, getAllRegions } from "@/db/client";
import { destroyRegionTenant } from "@/lib/tenant/schema-manager";
import { invalidateVocabCache } from "@/lib/vocabulary";
import { ApiCode, apiSuccess, apiError } from "@/lib/api-codes";

/**
 * GET /api/admin/regions/[id]
 * 查看特定地区的详细元数据
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { region } = await getRegionDb(id);
    if (!region) {
      return apiError(ApiCode.REGION_NOT_FOUND, undefined, 404);
    }
    return apiSuccess({ region });
  } catch (error: any) {
    return apiError(ApiCode.INTERNAL_ERROR, error.message, 500);
  }
}

/**
 * DELETE /api/admin/regions/[id]
 * 物理销毁指定地区的 PostgreSQL Schema 及所有数据表
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const all = await getAllRegions();

    if (all.length <= 1) {
      return apiError(ApiCode.FORBIDDEN, "系统至少需保留一个地区站点", 400);
    }

    const ok = await destroyRegionTenant(sql, id);
    if (!ok) {
      return apiError(ApiCode.REGION_NOT_FOUND, undefined, 404);
    }

    invalidateVocabCache(id);

    return apiSuccess({ id }, `已成功销毁站点 [${id}]`);
  } catch (error: any) {
    console.error("[admin/regions/[id]] DELETE failed:", error);
    return apiError(ApiCode.REGION_DROP_FAILED, error.message, 500);
  }
}

/**
 * PATCH /api/admin/regions/[id]
 * 更新地区站点的基本信息或设为默认
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { name, city, province, svgMapPath, isDefault, status } = body;

    if (isDefault) {
      await sql`UPDATE public.regions SET is_default = false WHERE is_default = true;`;
    }

    await sql`
      UPDATE public.regions
      SET
        name = COALESCE(${name}, name),
        city = COALESCE(${city}, city),
        province = COALESCE(${province}, province),
        svg_map_path = COALESCE(${svgMapPath}, svg_map_path),
        is_default = COALESCE(${isDefault}, is_default),
        status = COALESCE(${status}, status),
        updated_at = now()
      WHERE id = ${id};
    `;

    invalidateVocabCache(id);

    return apiSuccess({ id });
  } catch (error: any) {
    return apiError(ApiCode.INTERNAL_ERROR, error.message, 500);
  }
}
