import { NextResponse } from "next/server";
import { getAllRegions, getDefaultRegion } from "@/db/client";

/**
 * GET /api/regions
 * 获取所有已启用的地区站点列表（供前端导航栏下拉切换器使用）
 */
export async function GET() {
  try {
    const regions = await getAllRegions();
    const defaultRegion = await getDefaultRegion();

    return NextResponse.json({
      success: true,
      regions: regions.map((r) => ({
        id: r.id,
        name: r.name,
        city: r.city,
        province: r.province,
        schemaName: r.schemaName,
        svgMapPath: r.svgMapPath,
        isDefault: r.isDefault,
        description: r.description,
      })),
      defaultRegionId: defaultRegion?.id || regions[0]?.id || "gz_tianhe",
    });
  } catch (error: any) {
    console.error("[api/regions] Failed to list regions:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load regions",
        regions: [
          {
            id: "gz_tianhe",
            name: "天河区",
            city: "广州市",
            province: "广东省",
            schemaName: "region_gz_tianhe",
            svgMapPath: "",
            isDefault: true,
          },
          {
            id: "fs_shunde",
            name: "顺德区",
            city: "佛山市",
            province: "广东省",
            schemaName: "region_fs_shunde",
            svgMapPath: "",
            isDefault: false,
          },
        ],
        defaultRegionId: "gz_tianhe",
      },
      { status: 200 }
    );
  }
}
