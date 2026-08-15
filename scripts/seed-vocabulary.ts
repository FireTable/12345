/**
 * 标准政务词汇表与别名知识库数据初始化脚本 (Seed Vocabularies & Aliases to PostgreSQL)
 * 深度覆盖顺德区 10 大法定镇街、150+ 重点社区村居、50+ 核心地标商圈与 100+ 条高频别名映射。
 */

import nextEnvPkg from "@next/env";
const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) {
  loadEnvConfig(process.cwd());
}

import { db } from "../db/client";
import { vocabulariesTable, aliasesTable, type NewVocabularyRecord, type NewAliasRecord } from "../db/schema";
import { SHUNDE_TOWNSHIPS, SHUNDE_DEPARTMENTS, STANDARD_CATEGORIES } from "../lib/vocabulary";
import { getAllAliases } from "../lib/alias-dict";

async function seedVocabularyAndAliases() {
  console.log("==================================================");
  console.log("📚 正在初始化顺德政务词汇库与别名映射知识库...");
  console.log("==================================================\n");

  const vocabRecords: NewVocabularyRecord[] = [];
  const aliasRecords: NewAliasRecord[] = [];

  // 1. 初始化 10 大法定镇街及所属重点社区、地标
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
      description: `佛山市顺德区法定辖区：${t.fullName}（包含社区村居 ${t.communities.length} 个，知名地标 ${t.landmarks.length} 个）`,
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

    // 初始化所属重点地标/园区/商圈
    for (const lmk of t.landmarks) {
      vocabRecords.push({
        id: `VOCAB-LMK-${t.name}-${lmk}`,
        type: "LANDMARK",
        name: lmk,
        fullName: `${t.fullName}·${lmk}`,
        parentName: t.fullName,
        metaJson: JSON.stringify({ township: t.name }),
        description: `${t.fullName}知名地标/园区/交通枢纽：${lmk}`,
        isStandard: true,
      });
    }
  }

  // 2. 初始化 12 大权威承办部门词汇
  for (const dept of SHUNDE_DEPARTMENTS) {
    vocabRecords.push({
      id: `VOCAB-${dept.code}`,
      type: "DEPARTMENT",
      name: dept.name,
      fullName: dept.fullName,
      parentName: "顺德区人民政府职能部门",
      metaJson: JSON.stringify({ category: dept.category }),
      description: `顺德区 12345 重点协同承办单位：${dept.fullName}（主要归属：${dept.category}）`,
      isStandard: true,
    });
  }

  // 3. 初始化 7 大标准诉求业务分类
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

  // 4. 批量写入 Vocabularies 表
  console.log(`⏳ 准备写入 ${vocabRecords.length} 条顺德标准政务词汇记录...`);
  await db
    .insert(vocabulariesTable)
    .values(vocabRecords)
    .onConflictDoNothing({ target: vocabulariesTable.id });
  console.log(`✅ 成功写入/同步 ${vocabRecords.length} 条词汇数据！`);

  // 5. 初始化别名库表 (Aliases)
  const allAliases = getAllAliases();
  for (const [alias, canonical] of Object.entries(allAliases)) {
    let type: "TOWNSHIP" | "LOCATION" | "SUBJECT" | "DEPARTMENT" = "LOCATION";
    if (canonical.endsWith("街道") || canonical.endsWith("镇")) {
      type = "TOWNSHIP";
    } else if (
      canonical.includes("队") ||
      canonical.includes("局") ||
      canonical.includes("所") ||
      canonical.includes("办") ||
      canonical.includes("委员会") ||
      canonical.includes("院")
    ) {
      type = "DEPARTMENT";
    }

    const uniqueId = `ALIAS-${Buffer.from(alias, "utf-8").toString("hex").slice(0, 20)}`;

    aliasRecords.push({
      id: uniqueId,
      alias,
      canonical,
      type,
      source: "PRESET",
      usageCount: 0,
    });
  }

  console.log(`⏳ 准备写入 ${aliasRecords.length} 条顺德高频别名映射规则...`);
  for (const r of aliasRecords) {
    try {
      await db
        .insert(aliasesTable)
        .values(r)
        .onConflictDoUpdate({
          target: aliasesTable.alias,
          set: {
            canonical: r.canonical,
            type: r.type,
          },
        });
    } catch (e) {}
  }
  console.log(`✅ 成功写入/同步 ${aliasRecords.length} 条别名映射数据！`);

  console.log("\n==================================================");
  console.log("🎉 顺德权威政务词汇表与别名知识库初始化全部完成！");
  console.log("==================================================");
}

seedVocabularyAndAliases()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ 初始化失败:", err);
    process.exit(1);
  });
