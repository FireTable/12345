import { NextRequest } from "next/server";
import { sql, getAllRegions } from "@/db/client";
import { registerRegion } from "@/lib/tenant/schema-manager";
import { invalidateVocabCache } from "@/lib/vocabulary";
import { ApiCode, apiSuccess, apiError } from "@/lib/api-codes";
import {
  ECOMMERCE_CS_PROFILE,
  filterRegionsByAppDomain,
  getAppDomainMode,
  isDomainAllowed,
  parseDomainProfile,
} from "@/lib/domain-profile";

export const dynamic = "force-dynamic";

/**
 * GET /api/admin/regions
 * 超管查看当前 APP_DOMAIN 下纳管站点及各 Schema 的数据统计（工单数、多频主题数、字典数）
 */
export async function GET() {
  try {
    const appDomain = getAppDomainMode();
    const regions = filterRegionsByAppDomain(await getAllRegions(), appDomain);

    const statsList = await Promise.all(
      regions.map(async (r) => {
        const domainProfile = parseDomainProfile(r.categoryConfigJson);
        try {
          const [tRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".tickets;`
          );
          const [thRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".themes;`
          );
          const [vRow] = await sql.unsafe(
            `SELECT count(*)::int as count FROM "${r.schemaName}".vocabularies;`
          );

          return {
            ...r,
            domainProfile,
            ticketCount: tRow?.count || 0,
            themeCount: thRow?.count || 0,
            vocabCount: vRow?.count || 0,
          };
        } catch {
          return {
            ...r,
            domainProfile,
            ticketCount: 0,
            themeCount: 0,
            vocabCount: 0,
          };
        }
      })
    );

    return Response.json({
      success: true,
      code: ApiCode.OK,
      message: "操作成功",
      appDomain,
      regions: statsList,
      data: { appDomain, regions: statsList },
    });
  } catch (error: any) {
    console.error("[admin/regions] GET failed:", error);
    return apiError(ApiCode.INTERNAL_ERROR, error.message, 500);
  }
}

/**
 * POST /api/admin/regions
 * 超级管理员创建新站点，自动在 PostgreSQL 物理创建 Schema 命名空间与标准数据表
 */
export async function POST(req: NextRequest) {
  try {
    const appDomain = getAppDomainMode();
    const body = await req.json();
    const { id, name, city, province, svgMapPath, description, isDefault, domainType } = body;

    if (!id || !name || !city) {
      return apiError(ApiCode.INVALID_PARAMS, "缺少必要参数: id, name, city 为必填项", 400);
    }

    // 格式化标识符
    const cleanId = id.trim().toLowerCase().replace(/[^a-z0-9_]/g, "_");
    const schemaName = `region_${cleanId}`;
    const shouldTagEcommerce =
      appDomain === "ECOMMERCE_CS" ||
      (domainType === "ECOMMERCE_CS" && isDomainAllowed("ECOMMERCE_CS", appDomain));

    await registerRegion(sql, {
      id: cleanId,
      name: name.trim(),
      city: city.trim(),
      province: (province || "广东省").trim(),
      schemaName,
      svgMapPath: svgMapPath?.trim() || null,
      categoryConfigJson: shouldTagEcommerce
        ? JSON.stringify({ domainProfile: ECOMMERCE_CS_PROFILE })
        : undefined,
      description: description?.trim() || null,
      isDefault: Boolean(isDefault),
    });

    invalidateVocabCache(cleanId);

    return apiSuccess(
      {
        region: {
          id: cleanId,
          name,
          city,
          province: province || "广东省",
          schemaName,
          svgMapPath,
        },
      },
      `成功初始化地区站点 [${name}]`
    );
  } catch (error: any) {
    console.error("[admin/regions] POST failed:", error);
    return apiError(ApiCode.REGION_INIT_FAILED, error.message, 500);
  }
}
