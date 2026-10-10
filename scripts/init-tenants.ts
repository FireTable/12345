import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import postgres from "postgres";
import fs from "fs";
import path from "path";
import {
  ensurePublicRegionsTable,
  registerRegion,
} from "../lib/tenant/schema-manager";

const url =
  process.env.DATABASE_URL ||
  "postgresql://postgres@localhost:5432/ticket_radar";

const sql = postgres(url, { max: 5 });

interface PresetData {
  id: string;
  name: string;
  city: string;
  province: string;
  svgMapPath?: string;
  description?: string;
  townships: Array<{
    name: string;
    fullName: string;
    aliases: string[];
    communities: string[];
    landmarks: string[];
  }>;
  departments: Array<{
    code: string;
    name: string;
    fullName: string;
    category: string;
  }>;
  categories: Array<{
    category: string;
    subItems: string[];
    leadDepartment: string;
  }>;
}

async function seedVocabForSchema(schemaName: string, preset: PresetData, customSql?: postgres.Sql) {
  console.log(`  🌱 正在为 [${schemaName}] 导入标准字典与别名库...`);
  const activeSql = customSql || sql;

  await activeSql.begin(async (tx) => {
    await tx.unsafe(`SET LOCAL search_path TO "${schemaName}", public;`);

    // 1. 清空旧字典
    await tx`DELETE FROM vocabularies;`;
    await tx`DELETE FROM aliases;`;

    // 2. 插入镇街
    for (const t of preset.townships) {
      const townId = `town-${preset.id}-${t.name}`;
      await tx`
        INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
        VALUES (
          ${townId},
          'TOWNSHIP',
          ${t.name},
          ${t.fullName},
          ${preset.name},
          ${JSON.stringify({
            aliases: t.aliases,
            communities: t.communities,
            landmarks: t.landmarks,
          })},
          ${`${preset.city}${preset.name}${t.fullName}`},
          true
        ) ON CONFLICT (id) DO NOTHING;
      `;

      // 别名
      for (const a of t.aliases) {
        if (!a || a === t.fullName) continue;
        await tx`
          INSERT INTO aliases (id, alias, canonical, type, source, usage_count)
          VALUES (
            ${`alias-${preset.id}-${a}`},
            ${a},
            ${t.fullName},
            'TOWNSHIP',
            'PRESET',
            1
          ) ON CONFLICT (alias) DO NOTHING;
        `;
      }

      // 地标别名
      for (const lm of t.landmarks) {
        await tx`
          INSERT INTO aliases (id, alias, canonical, type, source, usage_count)
          VALUES (
            ${`alias-${preset.id}-${lm}`},
            ${lm},
            ${`${t.fullName}${lm}`},
            'LOCATION',
            'PRESET',
            1
          ) ON CONFLICT (alias) DO NOTHING;
        `;
      }
    }

    // 3. 插入承办部门
    for (const d of preset.departments) {
      await tx`
        INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
        VALUES (
          ${`dept-${preset.id}-${d.code}`},
          'DEPARTMENT',
          ${d.name},
          ${d.fullName},
          ${preset.name},
          ${JSON.stringify({ category: d.category })},
          ${d.fullName},
          true
        ) ON CONFLICT (id) DO NOTHING;
      `;
    }

    // 4. 插入诉求分类
    for (const c of preset.categories) {
      await tx`
        INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)
        VALUES (
          ${`cat-${preset.id}-${c.category}`},
          'CATEGORY',
          ${c.category},
          ${c.category},
          ${preset.name},
          ${JSON.stringify({
            subItems: c.subItems,
            leadDepartment: c.leadDepartment,
          })},
          ${`民生核心分类: ${c.category}`},
          true
        ) ON CONFLICT (id) DO NOTHING;
      `;
    }
  });

  console.log(`  ✅ [${schemaName}] 字典初始化完毕: ${preset.townships.length} 个镇街/街道, ${preset.departments.length} 个部门, ${preset.categories.length} 个分类。`);
}

export async function initTenants(customSql?: postgres.Sql) {
  console.log("==================================================");
  console.log("🚀 开始执行多租户 Schema 初始化与标准站点注册...");
  console.log("==================================================\n");

  const sqlClient = customSql || postgres(url, { max: 5 });
  const shouldClose = !customSql;

  try {
    await ensurePublicRegionsTable(sqlClient);

    // 1. 加载预置
    const shundePresetPath = path.resolve(process.cwd(), "lib/presets/foshan_shunde.json");
    const tianhePresetPath = path.resolve(process.cwd(), "lib/presets/guangzhou_tianhe.json");

    const shundePreset: PresetData = JSON.parse(fs.readFileSync(shundePresetPath, "utf-8"));
    const tianhePreset: PresetData = JSON.parse(fs.readFileSync(tianhePresetPath, "utf-8"));

    // 2. 注册顺德站点
    console.log("📍 [1/2] 注册并初始化【佛山市顺德区】(Schema: region_fs_shunde)...");
    const shundeGeojson = fs.existsSync(path.join(process.cwd(), "public/civic/fs_shunde-townships.geojson"))
      ? fs.readFileSync(path.join(process.cwd(), "public/civic/fs_shunde-townships.geojson"), "utf8")
      : null;
    const shundeSubdistrictsPath = path.join(process.cwd(), "lib/presets/geodata/fs_shunde-subdistricts.geojson");
    const shundeSubdistrictsGeojson = fs.existsSync(shundeSubdistrictsPath)
      ? fs.readFileSync(shundeSubdistrictsPath, "utf8")
      : null;

    await registerRegion(sqlClient, {
      id: shundePreset.id,
      name: shundePreset.name,
      city: shundePreset.city,
      province: shundePreset.province,
      schemaName: "region_fs_shunde",
      svgMapPath: "",
      geojsonBoundary: shundeGeojson || undefined,
      subdistrictsGeojson: shundeSubdistrictsGeojson || undefined,
      description: "顺德区 10 大法定镇街政务研判站点",
      isDefault: true,
    });
    await seedVocabForSchema("region_fs_shunde", shundePreset, sqlClient);

    // 3. 注册广州天河站点
    console.log("\n📍 [2/2] 注册并初始化【广州市天河区】(Schema: region_gz_tianhe)...");
    const tianheGeojson = fs.existsSync(path.join(process.cwd(), "public/civic/gz_tianhe-townships.geojson"))
      ? fs.readFileSync(path.join(process.cwd(), "public/civic/gz_tianhe-townships.geojson"), "utf8")
      : null;
    const tianheSubdistrictsPath = path.join(process.cwd(), "lib/presets/geodata/gz_tianhe-subdistricts.geojson");
    const tianheSubdistrictsGeojson = fs.existsSync(tianheSubdistrictsPath)
      ? fs.readFileSync(tianheSubdistrictsPath, "utf8")
      : null;

    await registerRegion(sqlClient, {
      id: tianhePreset.id,
      name: tianhePreset.name,
      city: tianhePreset.city,
      province: tianhePreset.province,
      schemaName: "region_gz_tianhe",
      svgMapPath: tianhePreset.svgMapPath || "",
      geojsonBoundary: tianheGeojson || undefined,
      subdistrictsGeojson: tianheSubdistrictsGeojson || undefined,
      description: tianhePreset.description,
      isDefault: false,
    });
    await seedVocabForSchema("region_gz_tianhe", tianhePreset, sqlClient);

    console.log("\n🎉 多租户 Schema 初始化圆满成功！");
  } finally {
    if (shouldClose) {
      await sqlClient.end();
    }
  }
}

if (process.argv[1]?.endsWith("init-tenants.ts")) {
  initTenants()
    .then(() => process.exit(0))
    .catch((err) => {
      console.error("❌ 初始化失败:", err);
      process.exit(1);
    });
}
