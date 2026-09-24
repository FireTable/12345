import { NextRequest, NextResponse } from "next/server";
import { sql, getRegionDb, getAllRegions } from "@/db/client";
import { destroyRegionTenant } from "@/lib/tenant/schema-manager";
import { invalidateVocabCache } from "@/lib/vocabulary";

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
      return NextResponse.json(
        { success: false, error: `未找到地区 ID 为 [${id}] 的站点` },
        { status: 404 }
      );
    }
    return NextResponse.json({ success: true, region });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message },
      { status: 500 }
    );
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
      return NextResponse.json(
        { success: false, error: "系统至少需要保留一个地区站点，严禁全部删除" },
        { status: 400 }
      );
    }

    const ok = await destroyRegionTenant(sql, id);
    if (!ok) {
      return NextResponse.json(
        { success: false, error: `删除失败，未找到该地区站点` },
        { status: 404 }
      );
    }

    invalidateVocabCache(id);

    return NextResponse.json({
      success: true,
      message: `已成功彻底销毁地区站点 [${id}] 及其独立的物理 Schema 数据库`,
    });
  } catch (error: any) {
    console.error("[admin/regions/[id]] DELETE failed:", error);
    return NextResponse.json(
      { success: false, error: error.message || "删除地区站点失败" },
      { status: 500 }
    );
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

    return NextResponse.json({
      success: true,
      message: "地区站点信息已更新",
    });
  } catch (error: any) {
    return NextResponse.json(
      { success: false, error: error.message || "更新失败" },
      { status: 500 }
    );
  }
}
