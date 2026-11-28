/**
 * 幂等同步天河区（region_gz_tianhe）标准字典与老广特色俗名库。
 * 用法：
 *   pnpm exec tsx scripts/sync-tianhe-dict.ts             # 直接同步至本地 DATABASE_URL
 *   pnpm exec tsx scripts/sync-tianhe-dict.ts --print-sql # 输出单事务 SQL，供管道导入线上 psql
 */

import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import fs from "fs";
import path from "path";
import postgres from "postgres";

interface TianhePreset {
  id: string;
  name: string;
  city: string;
  townships: Array<{
    name: string;
    fullName: string;
    aliases: string[];
    communities: string[];
    landmarks: string[];
  }>;
  colloquialAliases?: Array<{
    alias: string;
    canonical: string;
    type: "TOWNSHIP" | "LOCATION" | "ENTITY" | "DEPARTMENT";
    priority?: number;
  }>;
}

const DIRTY_AI_MINED_ALIASES = [
  "勒流镇大道中52号农贸市场",
  "元岗街道路92号社区卫生服务中心",
  "隧道风机配电箱",
  "云景花园健身广场",
  "保利香槟3栋2单元",
];

function sqlQuote(val: string): string {
  return `'${val.replace(/'/g, "''")}'`;
}

function makeAliasId(prefix: string, alias: string): string {
  const raw = `${prefix}-${alias}`;
  if (raw.length <= 64) return raw;
  const hex = Buffer.from(alias, "utf-8").toString("hex").slice(0, 24);
  return `${prefix}-${hex}`.slice(0, 64);
}

function buildSyncSqlBody(preset: TianhePreset): string {
  const lines: string[] = [
    'SET LOCAL search_path TO "region_gz_tianhe", public;',
    "",
    "-- 1. 更新 21 个法定街道的社区/地标/别名元数据",
  ];

  for (const t of preset.townships) {
    const townId = `town-${preset.id}-${t.name}`;
    const metaJson = JSON.stringify({
      aliases: t.aliases,
      communities: t.communities,
      landmarks: t.landmarks,
    });
    const desc = `${preset.city}${preset.name}${t.fullName}`;
    lines.push(
      `INSERT INTO vocabularies (id, type, name, full_name, parent_name, meta_json, description, is_standard)`,
      `VALUES (${sqlQuote(townId)}, 'TOWNSHIP', ${sqlQuote(t.name)}, ${sqlQuote(t.fullName)}, ${sqlQuote(preset.name)}, ${sqlQuote(metaJson)}, ${sqlQuote(desc)}, true)`,
      `ON CONFLICT (id) DO UPDATE SET meta_json = EXCLUDED.meta_json, full_name = EXCLUDED.full_name, description = EXCLUDED.description;`
    );
  }

  lines.push(
    "",
    "-- 2. 清理早期脏 AI_MINED 别名与误归属地标",
    `DELETE FROM aliases WHERE alias IN (${DIRTY_AI_MINED_ALIASES.map(sqlQuote).join(", ")});`,
    `DELETE FROM aliases WHERE source = 'PRESET' AND alias IN ('美林天地商圈', '美林M·LIVE天地（山姆会员店）') AND canonical LIKE '员村街道%';`
  );

  lines.push("", "-- 3. 写入常规预置镇街别名与地标（priority/usage_count = 1，不覆盖人工/高优词条）");
  const seenPreset = new Set<string>();
  const colloquialSet = new Set((preset.colloquialAliases || []).map((c) => c.alias));

  for (const t of preset.townships) {
    for (const a of t.aliases) {
      if (!a || a === t.fullName || seenPreset.has(a) || colloquialSet.has(a)) continue;
      seenPreset.add(a);
      const id = makeAliasId(`alias-${preset.id}`, a);
      lines.push(
        `INSERT INTO aliases (id, alias, canonical, type, source, usage_count)`,
        `VALUES (${sqlQuote(id)}, ${sqlQuote(a)}, ${sqlQuote(t.fullName)}, 'TOWNSHIP', 'PRESET', 1)`,
        `ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical, type = EXCLUDED.type WHERE aliases.source <> 'MANUAL';`
      );
    }
    for (const lm of t.landmarks) {
      if (!lm || seenPreset.has(lm) || colloquialSet.has(lm)) continue;
      seenPreset.add(lm);
      const id = makeAliasId(`alias-${preset.id}`, lm);
      lines.push(
        `INSERT INTO aliases (id, alias, canonical, type, source, usage_count)`,
        `VALUES (${sqlQuote(id)}, ${sqlQuote(lm)}, ${sqlQuote(`${t.fullName}${lm}`)}, 'LOCATION', 'PRESET', 1)`,
        `ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical, type = EXCLUDED.type WHERE aliases.source <> 'MANUAL';`
      );
    }
  }

  lines.push("", "-- 4. 写入并置顶老广特色俗名、简称与高频 ASR 错别字映射");
  for (const c of preset.colloquialAliases || []) {
    if (!c.alias || !c.canonical || c.alias === c.canonical) continue;
    const id = makeAliasId(`alias-${preset.id}-col`, c.alias);
    const usageCount = Math.max(50, Math.trunc(c.priority ?? 50));
    lines.push(
      `INSERT INTO aliases (id, alias, canonical, type, source, usage_count)`,
      `VALUES (${sqlQuote(id)}, ${sqlQuote(c.alias)}, ${sqlQuote(c.canonical)}, ${sqlQuote(c.type)}, 'PRESET', ${usageCount})`,
      `ON CONFLICT (alias) DO UPDATE SET canonical = EXCLUDED.canonical, type = EXCLUDED.type, source = 'PRESET', usage_count = EXCLUDED.usage_count WHERE aliases.source <> 'MANUAL';`
    );
  }

  return lines.join("\n");
}

async function main() {
  const presetPath = path.resolve(process.cwd(), "lib/presets/guangzhou_tianhe.json");
  const preset: TianhePreset = JSON.parse(fs.readFileSync(presetPath, "utf-8"));
  const bodySql = buildSyncSqlBody(preset);

  if (process.argv.includes("--print-sql")) {
    process.stdout.write(`BEGIN;\n${bodySql}\nCOMMIT;\n`);
    return;
  }

  const url = process.env.DATABASE_URL || "postgresql://postgres@localhost:5432/ticket_radar";
  const client = postgres(url, { max: 1 });
  try {
    await client.begin(async (tx) => {
      await tx.unsafe(bodySql);
    });
    const counts = await client.unsafe(`
      SELECT source, type, count(*)::int AS cnt, max(usage_count)::int AS max_usage
      FROM region_gz_tianhe.aliases
      GROUP BY source, type
      ORDER BY max_usage DESC, cnt DESC;
    `);
    console.log("✅ 本地 region_gz_tianhe 字典同步完成:", counts);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ 同步天河字典失败:", err);
  process.exit(1);
});
