import { NextRequest } from "next/server";
import { createHash } from "node:crypto";
import { geocodeAddress, reverseGeocode } from "@/lib/map/tianditu-service";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { getRegionDb } from "@/db/client";
import { vocabulariesTable } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";
import { requireAdmin } from "@/lib/auth/rbac";

function buildLocationId(cleanAddress: string): string {
  return `LOC-${createHash("sha256").update(cleanAddress).digest("base64url").slice(0, 32)}`;
}

async function resolveLocationId(
  tenantDb: Awaited<ReturnType<typeof getRegionDb>>["db"],
  cleanAddress: string
): Promise<string> {
  const existing = await tenantDb
    .select({ id: vocabulariesTable.id })
    .from(vocabulariesTable)
    .where(
      and(
        eq(vocabulariesTable.type, "LOCATION"),
        eq(vocabulariesTable.name, cleanAddress)
      )
    )
    .limit(1);
  return existing[0]?.id ?? buildLocationId(cleanAddress);
}

function parseCoordinate(value: unknown, min: number, max: number): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) && value >= min && value <= max ? value : null;
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const num = Number(trimmed);
    return Number.isFinite(num) && num >= min && num <= max ? num : null;
  }
  return null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await requireAdmin(req);
    if ("response" in auth) return auth.response;

    let body: Record<string, unknown>;
    try {
      const raw = await req.json();
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return apiError(ApiCode.BAD_REQUEST, "请求体必须是有效的 JSON 对象", 400);
      }
      body = raw as Record<string, unknown>;
    } catch {
      return apiError(ApiCode.BAD_REQUEST, "请求体 JSON 格式无效", 400);
    }

    const explicitRegionId = typeof body.regionId === "string" ? body.regionId : undefined;
    const regionId = await resolveRequestRegionId(req, explicitRegionId);

    const rawMode = body.mode;
    if (rawMode !== undefined && rawMode !== "forward" && rawMode !== "reverse") {
      return apiError(ApiCode.BAD_REQUEST, "mode 参数仅支持 forward 或 reverse", 400);
    }
    const mode = rawMode ?? "forward";

    // 1. 逆地理编码（坐标反查行政区与详细地点，用于站点管理与地图点选）
    const isImplicitReverse =
      rawMode === undefined &&
      body.lng !== undefined &&
      body.lat !== undefined &&
      (body.address === undefined || body.address === null || body.address === "");
    if (mode === "reverse" || isImplicitReverse) {
      const numLng = parseCoordinate(body.lng, -180, 180);
      const numLat = parseCoordinate(body.lat, -90, 90);
      if (numLng === null || numLat === null) {
        return apiError(ApiCode.BAD_REQUEST, "经纬度格式或范围不正确", 400);
      }
      const rev = await reverseGeocode(numLng, numLat);
      if (!rev.success) {
        return apiError(ApiCode.INTERNAL_ERROR, rev.error || "反查位置失败", 502);
      }
      return apiSuccess(rev);
    }

    // 2. 正地理编码：地址解析为经纬度（优先查标准字典 Canonical 缓存）
    if (typeof body.address !== "string") {
      return apiError(ApiCode.BAD_REQUEST, "地址必须是非空字符串", 400);
    }
    const cleanAddress = body.address.trim();
    if (!cleanAddress || cleanAddress.length > 128) {
      return apiError(ApiCode.BAD_REQUEST, "地址不能为空且长度不能超过 128 个字符", 400);
    }

    let cleanFormattedAddress = cleanAddress;
    if (body.formattedAddress !== undefined && body.formattedAddress !== null) {
      if (typeof body.formattedAddress !== "string") {
        return apiError(ApiCode.BAD_REQUEST, "formattedAddress 必须是字符串", 400);
      }
      const trimmedFmt = body.formattedAddress.trim();
      if (trimmedFmt.length > 255) {
        return apiError(ApiCode.BAD_REQUEST, "formattedAddress 长度不能超过 255 个字符", 400);
      }
      if (trimmedFmt) {
        cleanFormattedAddress = trimmedFmt;
      }
    }

    let cleanTownship = "";
    if (body.township !== undefined && body.township !== null) {
      if (typeof body.township !== "string") {
        return apiError(ApiCode.BAD_REQUEST, "township 必须是字符串", 400);
      }
      const trimmedTownship = body.township.trim();
      if (trimmedTownship.length > 128) {
        return apiError(ApiCode.BAD_REQUEST, "township 长度不能超过 128 个字符", 400);
      }
      cleanTownship = trimmedTownship;
    }

    const hasOverrideLng = body.overrideLng !== undefined && body.overrideLng !== null;
    const hasOverrideLat = body.overrideLat !== undefined && body.overrideLat !== null;
    let overrideLng: number | null = null;
    let overrideLat: number | null = null;
    if (hasOverrideLng || hasOverrideLat) {
      overrideLng = parseCoordinate(body.overrideLng, -180, 180);
      overrideLat = parseCoordinate(body.overrideLat, -90, 90);
      if (overrideLng === null || overrideLat === null) {
        return apiError(ApiCode.BAD_REQUEST, "覆盖经纬度格式或范围不正确", 400);
      }
    }

    const { db: tenantDb } = await getRegionDb(regionId);

    // 2.0 若前端已通过国内直连 Key 成功解析出经纬度，直接将其沉淀写入标准词典并返回
    if (overrideLng !== null && overrideLat !== null) {
      try {
        const locationId = await resolveLocationId(tenantDb, cleanAddress);
        const meta = {
          lng: overrideLng,
          lat: overrideLat,
          score: 100,
          level: "前端直连",
          formattedAddress: cleanFormattedAddress,
          township: cleanTownship,
          source: "CLIENT_TIANDITU",
          updatedAt: new Date().toISOString(),
        };
        await tenantDb
          .insert(vocabulariesTable)
          .values({
            id: locationId,
            type: "LOCATION",
            name: cleanAddress,
            fullName: cleanFormattedAddress,
            parentName: cleanTownship || null,
            metaJson: JSON.stringify(meta),
            description: "前端直连天地图解析标准坐标",
            isStandard: true,
          })
          .onConflictDoUpdate({
            target: vocabulariesTable.id,
            set: {
              fullName: cleanFormattedAddress,
              ...(cleanTownship ? { parentName: cleanTownship } : {}),
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
        formattedAddress: cleanFormattedAddress,
        township: cleanTownship,
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
          const cachedLng = parseCoordinate(meta?.lng, -180, 180);
          const cachedLat = parseCoordinate(meta?.lat, -90, 90);
          if (cachedLng !== null && cachedLat !== null) {
            return apiSuccess({
              success: true,
              lng: cachedLng,
              lat: cachedLat,
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
    } catch {
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
      const locationId = await resolveLocationId(tenantDb, cleanAddress);
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
    return apiError(ApiCode.INTERNAL_ERROR, err?.message || "地理编码服务内部错误", 500);
  }
}
