import { NextRequest } from "next/server";
import { geocodeAddress, reverseGeocode } from "@/lib/map/tianditu-service";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getRegionDb } from "@/db/client";
import { vocabulariesTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

export async function POST(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const body = await req.json();
    const { address, lng, lat, mode = "forward" } = body;

    // 1. 逆地理编码（坐标反查行政区与详细地点，用于站点管理与地图点选）
    if (mode === "reverse" || (lng !== undefined && lat !== undefined && !address)) {
      const numLng = parseFloat(lng);
      const numLat = parseFloat(lat);
      if (isNaN(numLng) || isNaN(numLat)) {
        return apiError(ApiCode.BAD_REQUEST, "经纬度格式不正确", 400);
      }
      const rev = await reverseGeocode(numLng, numLat);
      if (!rev.success) {
        return apiError(ApiCode.INTERNAL_ERROR, rev.error || "反查位置失败", 502);
      }
      return apiSuccess(rev);
    }

    // 2. 正地理编码：地址解析为经纬度（优先查标准字典 Canonical 缓存）
    const cleanAddress = (address || "").trim();
    if (!cleanAddress) {
      return apiError(ApiCode.BAD_REQUEST, "地址不能为空", 400);
    }

    const { db: tenantDb } = await getRegionDb(regionId);

    // 2.0 若前端已通过国内直连 Key 成功解析出经纬度，直接将其沉淀写入标准词典并返回
    const overrideLng = parseFloat(body.overrideLng);
    const overrideLat = parseFloat(body.overrideLat);
    if (!isNaN(overrideLng) && !isNaN(overrideLat)) {
      try {
        const locationId = `LOC-${Buffer.from(cleanAddress).toString("base64url").slice(0, 32)}`;
        const meta = {
          lng: overrideLng,
          lat: overrideLat,
          score: 100,
          level: "前端直连",
          formattedAddress: body.formattedAddress || cleanAddress,
          township: body.township || "",
          source: "CLIENT_TIANDITU",
          updatedAt: new Date().toISOString(),
        };
        await tenantDb
          .insert(vocabulariesTable)
          .values({
            id: locationId,
            type: "LOCATION",
            name: cleanAddress,
            fullName: body.formattedAddress || cleanAddress,
            parentName: body.township || null,
            metaJson: JSON.stringify(meta),
            description: "前端直连天地图解析标准坐标",
            isStandard: true,
          })
          .onConflictDoUpdate({
            target: vocabulariesTable.id,
            set: {
              fullName: body.formattedAddress || cleanAddress,
              metaJson: JSON.stringify(meta),
            },
          });
      } catch (err) {
        console.warn("[Geocode] 写入前端直连坐标失败:", err);
      }
      return apiSuccess({
        success: true,
        lng: overrideLng,
        lat: overrideLat,
        formattedAddress: body.formattedAddress || cleanAddress,
        township: body.township || "",
        fromCache: false,
        canonical: cleanAddress,
      });
    }

    // 2.1 检查标准字典中是否已有该 Canonical 地点的坐标缓存
    try {
      const cached = await tenantDb
        .select()
        .from(vocabulariesTable)
        .where(
          and(
            eq(vocabulariesTable.type, "LOCATION"),
            eq(vocabulariesTable.name, cleanAddress)
          )
        )
        .limit(1);

      if (cached.length > 0 && cached[0].metaJson) {
        try {
          const meta = JSON.parse(cached[0].metaJson);
          if (meta.lng && meta.lat) {
            return apiSuccess({
              success: true,
              lng: parseFloat(meta.lng),
              lat: parseFloat(meta.lat),
              score: meta.score || 100,
              level: meta.level || "标准字典",
              formattedAddress: meta.formattedAddress || cached[0].fullName || cleanAddress,
              township: cached[0].parentName || meta.township || "",
              fromCache: true,
              canonical: cached[0].name,
            });
          }
        } catch {}
      }
    } catch (e) {
      // 租户未建表或缓存未命中，继续请求外部服务
    }

    // 2.2 调用天地图地理编码
    const geo = await geocodeAddress(cleanAddress);
    if (!geo.success || geo.lng === undefined || geo.lat === undefined) {
      return apiError(ApiCode.NOT_FOUND, geo.error || "未能解析出精确经纬度", 404);
    }

    // 2.3 反查所属镇街，以补全所属行政区
    let township = "";
    try {
      const rev = await reverseGeocode(geo.lng, geo.lat);
      if (rev.success && rev.township) {
        township = rev.township;
      }
    } catch {}

    // 2.4 将解析出的准确坐标沉淀存入标准字典 (type: LOCATION, Canonical)
    try {
      const locationId = `LOC-${Buffer.from(cleanAddress).toString("base64url").slice(0, 32)}`;
      const meta = {
        lng: geo.lng,
        lat: geo.lat,
        score: geo.score,
        level: geo.level,
        formattedAddress: geo.formattedAddress,
        township,
        source: "TIANDITU_GEOCODE",
        updatedAt: new Date().toISOString(),
      };

      await tenantDb
        .insert(vocabulariesTable)
        .values({
          id: locationId,
          type: "LOCATION",
          name: cleanAddress,
          fullName: geo.formattedAddress || cleanAddress,
          parentName: township || null,
          metaJson: JSON.stringify(meta),
          description: `天地图解析标准坐标 (${geo.level || "地点"})`,
          isStandard: true,
        })
        .onConflictDoUpdate({
          target: vocabulariesTable.id,
          set: {
            parentName: township || undefined,
            metaJson: JSON.stringify(meta),
          },
        });
    } catch (dbErr) {
      console.warn("[Geocode] 写入标准字典缓存失败 (不影响本次返回):", dbErr);
    }

    return apiSuccess({
      success: true,
      lng: geo.lng,
      lat: geo.lat,
      score: geo.score,
      level: geo.level,
      formattedAddress: geo.formattedAddress,
      township,
      fromCache: false,
      canonical: cleanAddress,
    });
  } catch (err: any) {
    return apiError(err.message || "地理编码服务内部错误", ApiCode.INTERNAL_ERROR, 500);
  }
}
