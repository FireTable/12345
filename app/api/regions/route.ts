import { NextResponse } from "next/server";
import { getAllRegions } from "@/db/client";
import {
  ECOMMERCE_CS_PROFILE,
  GOV_12345_PROFILE,
  filterRegionsByAppDomain,
  getAppDomainMode,
  getFallbackRegionIdForDomain,
  parseDomainProfile,
} from "@/lib/domain-profile";

export const dynamic = "force-dynamic";

/**
 * GET /api/regions
 * 获取当前 APP_DOMAIN 模式下已启用的站点列表（供前端导航栏切换器与域识别使用）
 */
export async function GET() {
  const appDomain = getAppDomainMode();

  try {
    const allRegions = await getAllRegions();
    const regions = filterRegionsByAppDomain(allRegions, appDomain);
    const defaultRegion = regions.find((r) => r.isDefault) || regions[0] || null;
    const defaultRegionId = defaultRegion?.id || getFallbackRegionIdForDomain(appDomain);

    return NextResponse.json(
      {
        success: true,
        appDomain,
        regions: regions.map((r) => ({
          id: r.id,
          name: r.name,
          city: r.city,
          province: r.province,
          schemaName: r.schemaName,
          svgMapPath: r.svgMapPath,
          isDefault: r.isDefault,
          description: r.description,
          categoryConfigJson: r.categoryConfigJson ?? null,
          domainProfile: parseDomainProfile(r.categoryConfigJson),
        })),
        defaultRegionId,
      },
      {
        headers: {
          "cache-control": "public, max-age=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (error: any) {
    console.error("[api/regions] Failed to list regions:", error);
    const fallbackRegions =
      appDomain === "ECOMMERCE_CS"
        ? [
            {
              id: "ecom_demo",
              name: "全渠道电商客诉中心",
              city: "电商示范",
              province: "跨行业域",
              schemaName: "region_ecom_demo",
              svgMapPath: "",
              isDefault: false,
              domainProfile: ECOMMERCE_CS_PROFILE,
            },
          ]
        : [
            {
              id: "gz_tianhe",
              name: "天河区",
              city: "广州市",
              province: "广东省",
              schemaName: "region_gz_tianhe",
              svgMapPath: "",
              isDefault: true,
              domainProfile: GOV_12345_PROFILE,
            },
            {
              id: "fs_shunde",
              name: "顺德区",
              city: "佛山市",
              province: "广东省",
              schemaName: "region_fs_shunde",
              svgMapPath: "",
              isDefault: false,
              domainProfile: GOV_12345_PROFILE,
            },
          ];

    return NextResponse.json(
      {
        success: false,
        appDomain,
        error: error.message || "Failed to load regions",
        regions: fallbackRegions,
        defaultRegionId: getFallbackRegionIdForDomain(appDomain),
      },
      {
        status: 200,
        headers: {
          "cache-control": "no-store",
        },
      }
    );
  }
}
