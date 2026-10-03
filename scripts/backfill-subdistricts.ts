import nextEnvPkg from "@next/env";
import { getRegionDb } from "../db/client";
import { ticketsTable } from "../db/schema";
import { eq, isNull, or } from "drizzle-orm";
import { getRegionVocabulary } from "../lib/vocabulary";
import { profileTicket } from "../backend/ticket-profile";
import { invalidateCivicAggregates } from "../lib/civic-cache";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

export async function backfillSubdistricts(regionId: string = "fs_shunde"): Promise<{
  totalChecked: number;
  updatedCount: number;
  stillUnknownCount: number;
  distribution: Record<string, number>;
}> {
  const { db: tenantDb } = await getRegionDb(regionId);
  const vocab = await getRegionVocabulary(regionId);

  // 查出所有 subdistrict 为空或空的工单
  const rows = await tenantDb
    .select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      title: ticketsTable.title,
      content: ticketsTable.content,
      subdistrict: ticketsTable.subdistrict,
      sourceCategory: ticketsTable.sourceCategory,
    })
    .from(ticketsTable);

  let updatedCount = 0;
  const distribution: Record<string, number> = {};

  const { loadPresetVocabulary } = await import("../lib/vocabulary");
  const preset = loadPresetVocabulary(regionId);
  const effectiveTownships = preset.townships && preset.townships.length > 0 ? preset.townships : vocab.townships;

  for (const r of rows) {
    let currentSub = (r.subdistrict || "").trim();
    let currentCat = (r.sourceCategory || "").trim();
    let needsUpdate = false;
    let targetSub = currentSub;
    let targetCat = currentCat;

    if (!currentSub || currentSub === "未知" || currentSub === "未指定") {
      const profile = profileTicket(
        { title: r.title, content: r.content },
        effectiveTownships
      );
      if (profile.township) {
        targetSub = profile.township;
        needsUpdate = true;
      }
      if (!currentCat && profile.category) {
        targetCat = profile.category;
        needsUpdate = true;
      }
    }

    if (needsUpdate) {
      await tenantDb
        .update(ticketsTable)
        .set({
          subdistrict: targetSub || null,
          sourceCategory: targetCat || null,
        })
        .where(eq(ticketsTable.id, r.id));
      updatedCount++;
    }

    const finalLabel = targetSub || "未知";
    distribution[finalLabel] = (distribution[finalLabel] || 0) + 1;
  }

  await invalidateCivicAggregates();

  return {
    totalChecked: rows.length,
    updatedCount,
    stillUnknownCount: distribution["未知"] || 0,
    distribution,
  };
}

async function main() {
  console.log("Starting subdistrict backfill for fs_shunde...");
  const result = await backfillSubdistricts("fs_shunde");
  console.log("Backfill result:", result);
  process.exit(0);
}

if (process.argv[1] && process.argv[1].endsWith("backfill-subdistricts.ts")) {
  main().catch((err) => {
    console.error("Backfill failed:", err);
    process.exit(1);
  });
}
