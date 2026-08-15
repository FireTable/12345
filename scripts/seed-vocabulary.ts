/**
 * 标准政务词汇表与别名知识库数据初始化脚本 (Seed Vocabularies & Aliases to PostgreSQL)
 */

import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { db } from "../db/client";
import { vocabulariesTable, aliasesTable, type NewVocabularyRecord, type NewAliasRecord } from "../db/schema";
import { SHUNDE_TOWNSHIPS, STANDARD_CATEGORIES } from "../lib/vocabulary";
import { getAllAliases } from "../lib/alias-dict";

async function seedVocabularyAndAliases() {
  console.log("==================================================");
  console.log("📚 正在初始化政务词汇表与别名库 (Vocabularies & Aliases Seeding)...");
  console.log("==================================================\n");

  const vocabRecords: NewVocabularyRecord[] = [];
  const aliasRecords: NewAliasRecord[] = [];

  // 1. 初始化 10 大法定镇街
  for (const t of SHUNDE_TOWNSHIPS) {
    vocabRecords.push({
      id: `VOCAB-TOWN-${t.name}`,
      type: "TOWNSHIP",
      name: t.name,
      fullName: t.fullName,
      parentName: "顺德区",
      metaJson: JSON.stringify({
        aliases: t.aliases,
        communities: t.communities,
        landmarks: t.landmarks,
      }),
      description: `佛山市顺德区法定辖区：${t.fullName}`,
      isStandard: true,
    });

    // 初始化所属重点社区/村居
    for (const com of t.communities) {
      vocabRecords.push({
        id: `VOCAB-COM-${t.name}-${com}`,
        type: "COMMUNITY",
        name: com,
        fullName: `${t.fullName}${com}`,
        parentName: t.fullName,
        metaJson: JSON.stringify({ township: t.name }),
        description: `${t.fullName}下辖社区/村居：${com}`,
        isStandard: true,
      });
    }
  }

  // 2. 初始化 7 大标准诉求业务分类
  for (const c of STANDARD_CATEGORIES) {
    vocabRecords.push({
      id: `VOCAB-CAT-${c.category}`,
      type: "CATEGORY",
      name: c.category,
      fullName: `政务服务诉求·${c.category}`,
      parentName: "12345民生诉求分类体系",
      metaJson: JSON.stringify({
        subItems: c.subItems,
        leadDepartment: c.leadDepartment,
      }),
      description: `牵头处置部门：${c.leadDepartment}；包含子项：${c.subItems.join("、")}`,
      isStandard: true,
    });
  }

  // 3. 批量写入 Vocabularies 表
  console.log(`⏳ 准备写入 ${vocabRecords.length} 条标准政务词汇记录...`);
  await db
    .insert(vocabulariesTable)
    .values(vocabRecords)
    .onConflictDoNothing({ target: vocabulariesTable.id });
  console.log(`✅ 成功写入/同步 ${vocabRecords.length} 条词汇数据！`);

  // 4. 初始化别名库表 (Aliases)
  const allAliases = getAllAliases();
  let idx = 1;
  for (const [alias, canonical] of Object.entries(allAliases)) {
    let type: "TOWNSHIP" | "LOCATION" | "SUBJECT" | "DEPARTMENT" = "LOCATION";
    if (canonical.endsWith("街道") || canonical.endsWith("镇")) {
      type = "TOWNSHIP";
    } else if (canonical.includes("队") || canonical.includes("局") || canonical.includes("所") || canonical.includes("办")) {
      type = "DEPARTMENT";
    }

    aliasRecords.push({
      id: `ALIAS-${String(idx++).padStart(3, "0")}`,
      alias,
      canonical,
      type,
      source: "PRESET",
      usageCount: 0,
    });
  }

  console.log(`⏳ 准备写入 ${aliasRecords.length} 条别名映射规则...`);
  await db
    .insert(aliasesTable)
    .values(aliasRecords)
    .onConflictDoNothing({ target: aliasesTable.alias });
  console.log(`✅ 成功写入/同步 ${aliasRecords.length} 条别名映射数据！`);

  console.log("\n==================================================");
  console.log("🎉 词汇表与别名库初始化全部完成！");
  console.log("==================================================");
}

seedVocabularyAndAliases()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ 初始化失败:", err);
    process.exit(1);
  });
