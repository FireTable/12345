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
      defaultRegionId: defaultRegion?.id || regions[0]?.id || "shunde",
    });
  } catch (error: any) {
    console.error("[api/regions] Failed to list regions:", error);
    return NextResponse.json(
      {
        success: false,
        error: error.message || "Failed to load regions",
        regions: [
          {
            id: "shunde",
            name: "顺德区",
            city: "佛山市",
            province: "广东省",
            schemaName: "region_shunde",
            svgMapPath: "/civic/shunde-map.svg",
            isDefault: true,
          },
          {
            id: "gz_haizhu",
            name: "海珠区",
            city: "广州市",
            province: "广东省",
            schemaName: "region_gz_haizhu",
            svgMapPath: "/maps/haizhu.svg",
            isDefault: false,
          },
        ],
        defaultRegionId: "shunde",
      },
      { status: 200 }
    );
  }
}
