import { NextRequest } from "next/server";
import { getRegionDb } from "@/db/client";
import { vocabulariesTable, aliasesTable, type AliasRecord, type VocabularyRecord } from "@/db/schema";
import { eq, desc, ilike, or } from "drizzle-orm";
import { normalizeAliasesInText, registerAlias, getAllAliases } from "@/lib/alias-dict";
import { getRegionVocabulary } from "@/lib/vocabulary";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

export async function GET(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { searchParams } = new URL(req.url);
    const q = (searchParams.get("q") || "").trim();
    const type = (searchParams.get("type") || "").trim();

    const { db: tenantDb, region } = await getRegionDb(regionId);
    const regionVocab = await getRegionVocabulary(regionId);

    let aliases: AliasRecord[] = [];
    let vocabularies: VocabularyRecord[] = [];

    // 1. 查询当前 Schema 的别名库
    try {
      if (q) {
        aliases = await tenantDb
          .select()
          .from(aliasesTable)
          .where(or(ilike(aliasesTable.alias, `%${q}%`), ilike(aliasesTable.canonical, `%${q}%`)))
          .orderBy(desc(aliasesTable.createdAt));
      } else {
        aliases = await tenantDb.select().from(aliasesTable).orderBy(desc(aliasesTable.createdAt));
      }
    } catch (e) {
      const memAliases = getAllAliases();
      aliases = Object.entries(memAliases).map(([alias, canonical], i) => ({
        id: `ALIAS-${i + 1}`,
        alias,
        canonical,
        type: canonical.endsWith("街道") || canonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY",
        source: "PRESET",
        usageCount: 0,
        createdAt: new Date(),
      }));
    }

    // 2. 查询当前 Schema 的标准词汇库
    try {
      if (type) {
        vocabularies = await tenantDb
          .select()
          .from(vocabulariesTable)
          .where(eq(vocabulariesTable.type, type))
          .orderBy(vocabulariesTable.id);
      } else {
        vocabularies = await tenantDb.select().from(vocabulariesTable).orderBy(vocabulariesTable.id);
      }
    } catch (e) {
      vocabularies = [];
    }

    const stats = {
      townshipCount: regionVocab.townships.length,
      categoryCount: regionVocab.categories.length,
      departmentCount: regionVocab.departments.length,
      aliasCount: aliases.length,
      presetAliasCount: aliases.filter((a) => a.source === "PRESET").length,
      minedAliasCount: aliases.filter((a) => a.source === "AI_MINED").length,
      manualAliasCount: aliases.filter((a) => a.source === "MANUAL").length,
    };

    return apiSuccess({
      region: {
        id: region?.id || regionId,
        name: region?.name || regionVocab.regionName,
        city: region?.city || regionVocab.cityName,
      },
      stats,
      townships: regionVocab.townships,
      categories: regionVocab.categories,
      departments: regionVocab.departments,
      vocabularies,
      aliases,
    });
  } catch (err: any) {
    console.error("[api/dict] GET error:", err);
    return apiError(ApiCode.INTERNAL_ERROR, err.message, 500);
  }
}

export async function POST(req: NextRequest) {
  try {
    const regionId = await resolveRequestRegionId(req);
    const { db: tenantDb } = await getRegionDb(regionId);
    const body = await req.json();
    const { action } = body;

    // 1. 测试别名规范化
    if (action === "normalize" || action === "test_replace") {
      const text = String(body.text || "");
      const normalized = normalizeAliasesInText(text);
      return apiSuccess({
        original: text,
        normalized,
      });
    }

    // 2. 新增或更新别名
    if (action === "add_alias") {
      const { alias, canonical, type } = body;
      if (!alias || !canonical) {
        return apiError(ApiCode.INVALID_PARAMS, "别名与规范名称均不能为空", 400);
      }

      const cleanAlias = String(alias).trim();
      const cleanCanonical = String(canonical).trim();
      const aliasType = type || (cleanCanonical.endsWith("街道") || cleanCanonical.endsWith("镇") ? "TOWNSHIP" : "ENTITY");

      // 注册到内存与当前 Schema 数据库
      registerAlias(cleanAlias, cleanCanonical, regionId);

      try {
        await tenantDb
          .insert(aliasesTable)
          .values({
            id: `ALIAS-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            alias: cleanAlias,
            canonical: cleanCanonical,
            type: aliasType,
            source: "MANUAL",
            usageCount: 0,
          })
          .onConflictDoUpdate({
            target: aliasesTable.alias,
            set: {
              canonical: cleanCanonical,
              type: aliasType,
            },
          });
      } catch (e) {}

      return apiSuccess({ alias: cleanAlias, canonical: cleanCanonical });
    }

    // 3. 删除别名
    if (action === "delete_alias") {
      const { id, alias } = body;
      if (id) {
        await tenantDb.delete(aliasesTable).where(eq(aliasesTable.id, id));
      } else if (alias) {
        await tenantDb.delete(aliasesTable).where(eq(aliasesTable.alias, alias));
      }
      return apiSuccess();
    }

    return apiError(ApiCode.BAD_REQUEST, "Unknown action", 400);
  } catch (err: any) {
    return apiError(ApiCode.INTERNAL_ERROR, err.message, 500);
  }
}
