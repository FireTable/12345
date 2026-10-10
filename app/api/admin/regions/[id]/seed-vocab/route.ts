import { NextRequest } from "next/server";
import { sql, getRegionDb } from "@/db/client";
import { invalidateVocabCache } from "@/lib/vocabulary";
import { apiSuccess, apiError, ApiCode } from "@/lib/api-codes";

/**
 * POST /api/admin/regions/[id]/seed-vocab
 * 将前端确认或 AI 生成的字典数据批量导入目标 Schema 的 vocabularies 表与 aliases 表
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await req.json();
    const { townships = [], departments = [], categories = [] } = body;

    const { region, schemaName } = await getRegionDb(id);
    if (!region) {
      return apiError(ApiCode.REGION_NOT_FOUND, undefined, 404);
    }

    console.log(`[seed-vocab] 开始为 [${schemaName}] 导入 ${townships.length} 个镇街, ${departments.length} 个部门...`);

    await sql.begin(async (tx) => {
      await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public;`);

      // 1. 清空当前 Schema 的字典与预置别名
      await tx`DELETE FROM vocabularies;`;
      await tx`DELETE FROM aliases WHERE source = 'PRESET';`;

      // 2. 插入镇街
      for (const t of townships) {
        const townId = `town-${id}-${t.name}`;
        await tx`
          INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
          VALUES (
            ${townId},
            'TOWNSHIP',
            ${t.name},
            ${t.fullName || t.name},
            ${region.name},
            ${JSON.stringify({
              aliases: t.aliases || [],
              communities: t.communities || [],
              landmarks: t.landmarks || [],
            })},
            ${`${region.city}${region.name}${t.fullName || t.name}`},
            true
          ) ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            meta_json = EXCLUDED.meta_json;
        `;

        // 别名
        if (Array.isArray(t.aliases)) {
          for (const a of t.aliases) {
            if (!a || a === t.fullName) continue;
            await tx`
              INSERT INTO aliases (id, alias, canonical, type, source, usage_count)
              VALUES (
                ${`alias-${id}-${a}`},
                ${a},
                ${t.fullName || t.name},
                'TOWNSHIP',
                'PRESET',
                1
              ) ON CONFLICT (alias) DO NOTHING;
            `;
          }
        }

        // 地标别名
        if (Array.isArray(t.landmarks)) {
          for (const lm of t.landmarks) {
            if (!lm) continue;
            await tx`
              INSERT INTO aliases (id, alias, canonical, type, source, usage_count)
              VALUES (
                ${`alias-${id}-${lm}`},
                ${lm},
                ${`${t.fullName || t.name}${lm}`},
                'LOCATION',
                'PRESET',
                1
              ) ON CONFLICT (alias) DO NOTHING;
            `;
          }
        }
      }

      // 3. 插入承办部门
      for (const d of departments) {
        const deptId = d.code || `dept-${id}-${d.name}`;
        await tx`
          INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
          VALUES (
            ${deptId},
            'DEPARTMENT',
            ${d.name},
            ${d.fullName || d.name},
            ${region.name},
            ${JSON.stringify({ category: d.category || "城市管理" })},
            ${d.fullName || d.name},
            true
          ) ON CONFLICT (id) DO UPDATE SET
            full_name = EXCLUDED.full_name,
            meta_json = EXCLUDED.meta_json;
        `;
      }

      // 4. 插入民生分类
      for (const c of categories) {
        const catId = `cat-${id}-${c.category}`;
        await tx`
          INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
          VALUES (
            ${catId},
            'CATEGORY',
            ${c.category},
            ${c.category},
            ${region.name},
            ${JSON.stringify({
              subItems: c.subItems || [],
              leadDepartment: c.leadDepartment || "",
            })},
            ${`民生核心分类: ${c.category}`},
            true
          ) ON CONFLICT (id) DO UPDATE SET
            meta_json = EXCLUDED.meta_json;
        `;
      }
    });

    invalidateVocabCache(id);

    return apiSuccess({
      regionId: id,
      regionName: region.name,
      townshipCount: townships.length,
      departmentCount: departments.length,
      categoryCount: categories.length,
    });
  } catch (error: any) {
    console.error("[admin/regions/seed-vocab] Error:", error);
    return apiError(ApiCode.VOCAB_SEED_FAILED, error.message, 500);
  }
}
