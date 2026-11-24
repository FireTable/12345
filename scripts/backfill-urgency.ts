import nextEnvPkg from "@next/env";
import { and, asc, eq, gt, inArray, sql as drizzleSql } from "drizzle-orm";
import { SystemOneEngine } from "@civic/system-one";
import { getRegionDb } from "../db/client";
import { ticketsTable } from "../db/schema";
import { getRegionVocabulary, loadPresetVocabulary } from "../lib/vocabulary";
import { invalidateCivicAggregates } from "../lib/civic-cache";

const { loadEnvConfig } = (nextEnvPkg as any).default || nextEnvPkg;
if (loadEnvConfig) loadEnvConfig(process.cwd());

interface BackfillOptions {
  regions: string[];
  batchSize: number;
  dryRun: boolean;
  allowFallback: boolean;
  limit?: number;
}

function parseArgs(argv: string[]): BackfillOptions {
  let regions = ["gz_tianhe", "fs_shunde"];
  let batchSize = 2000;
  let dryRun = false;
  let allowFallback = false;
  let limit: number | undefined;

  for (const arg of argv) {
    if (arg.startsWith("--regions=")) {
      regions = arg
        .slice("--regions=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
    } else if (arg.startsWith("--batch-size=")) {
      const n = Number(arg.slice("--batch-size=".length));
      if (Number.isFinite(n) && n > 0) batchSize = Math.min(5000, Math.round(n));
    } else if (arg === "--dry-run") {
      dryRun = true;
    } else if (arg === "--allow-fallback") {
      allowFallback = true;
    } else if (arg.startsWith("--limit=")) {
      const n = Number(arg.slice("--limit=".length));
      if (Number.isFinite(n) && n > 0) limit = Math.round(n);
    }
  }

  return { regions, batchSize, dryRun, allowFallback, limit };
}

async function queryUrgencyDistribution(regionId: string) {
  const { db: tenantDb } = await getRegionDb(regionId);
  const rows = await tenantDb
    .select({
      urgency: ticketsTable.urgency,
      count: drizzleSql<number>`count(*)::int`,
      stabTrue: drizzleSql<number>`count(*) filter (where ${ticketsTable.stabilityRisk} is true)::int`,
    })
    .from(ticketsTable)
    .groupBy(ticketsTable.urgency);
  return rows;
}

async function querySafetySamples(regionId: string) {
  const { db: tenantDb } = await getRegionDb(regionId);
  return tenantDb.execute(drizzleSql`
    SELECT ticket_no, left(coalesce(title, content), 48) AS title, urgency, sla_hours, stability_risk
    FROM tickets
    WHERE (title ~ '被困|井盖|火灾|燃气泄漏|漏电|塌陷|消防通道' OR content ~ '被困|井盖|火灾|燃气泄漏|漏电|塌陷|消防通道')
    ORDER BY created_at DESC
    LIMIT 6
  `);
}

async function backfillRegion(
  regionId: string,
  systemOne: SystemOneEngine,
  opts: BackfillOptions
): Promise<void> {
  const startedAt = Date.now();
  const { db: tenantDb } = await getRegionDb(regionId);
  const vocab = await getRegionVocabulary(regionId);
  const preset = loadPresetVocabulary(regionId);
  const townships = vocab.townships.length > 0 ? vocab.townships : preset.townships;

  console.log(`\n==================== [${regionId}] ====================`);
  console.log("Before urgency distribution:", await queryUrgencyDistribution(regionId));

  const counts = { URGENT: 0, MEDIUM: 0, NORMAL: 0 };
  let scanned = 0;
  let updated = 0;
  let lastId = "";
  const UPDATE_CHUNK = 800;

  while (true) {
    const remaining = opts.limit ? opts.limit - scanned : opts.batchSize;
    if (remaining <= 0) break;
    const take = Math.min(opts.batchSize, remaining);

    const rows = await tenantDb
      .select({
        id: ticketsTable.id,
        title: ticketsTable.title,
        content: ticketsTable.content,
        subdistrict: ticketsTable.subdistrict,
        urgency: ticketsTable.urgency,
        slaHours: ticketsTable.slaHours,
        stabilityRisk: ticketsTable.stabilityRisk,
      })
      .from(ticketsTable)
      .where(lastId ? gt(ticketsTable.id, lastId) : undefined)
      .orderBy(asc(ticketsTable.id))
      .limit(take);

    if (rows.length === 0) break;
    lastId = rows[rows.length - 1].id;

    const patchRows: Array<{
      id: string;
      urgency: "URGENT" | "MEDIUM" | "NORMAL";
      slaHours: number;
      stabilityRisk: boolean;
    }> = [];

    for (const row of rows) {
      scanned++;
      const decision = await systemOne.evaluate(
        {
          title: row.title || undefined,
          content: row.content || "",
          subdistrict: row.subdistrict || undefined,
        },
        { townships }
      );
      const nextUrgency: "URGENT" | "MEDIUM" | "NORMAL" =
        decision.stabilityRisk || decision.urgencyLevel === 3
          ? "URGENT"
          : decision.urgencyLevel === 2
            ? "MEDIUM"
            : "NORMAL";
      const nextSla = decision.stabilityRisk ? 2 : decision.slaHours;
      const nextStab = Boolean(decision.stabilityRisk);

      counts[nextUrgency]++;

      if (
        row.urgency !== nextUrgency ||
        row.slaHours !== nextSla ||
        Boolean(row.stabilityRisk) !== nextStab
      ) {
        patchRows.push({
          id: row.id,
          urgency: nextUrgency,
          slaHours: nextSla,
          stabilityRisk: nextStab,
        });
      }
    }

    if (!opts.dryRun && patchRows.length > 0) {
      for (let i = 0; i < patchRows.length; i += UPDATE_CHUNK) {
        const chunk = patchRows.slice(i, i + UPDATE_CHUNK);
        const valuesSql = drizzleSql.join(
          chunk.map(
            (p) =>
              drizzleSql`(${p.id}::varchar, ${p.urgency}::varchar, ${p.slaHours}::integer, ${p.stabilityRisk}::boolean)`
          ),
          drizzleSql`, `
        );
        await tenantDb.execute(drizzleSql`
          UPDATE tickets AS t
          SET
            urgency = v.urgency,
            sla_hours = v.sla_hours,
            stability_risk = v.stability_risk
          FROM (VALUES ${valuesSql}) AS v(id, urgency, sla_hours, stability_risk)
          WHERE t.id = v.id
        `);
        updated += chunk.length;
      }
    } else if (opts.dryRun) {
      updated += patchRows.length;
    }

    if (scanned % 10000 === 0 || rows.length < take) {
      const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(1);
      console.log(
        `[${regionId}] scanned=${scanned} ${opts.dryRun ? "wouldUpdate" : "updated"}=${updated} ` +
          `dist=(URGENT:${counts.URGENT}, MEDIUM:${counts.MEDIUM}, NORMAL:${counts.NORMAL}) elapsed=${elapsedSec}s`
      );
    }
  }

  if (!opts.dryRun) {
    invalidateCivicAggregates(regionId);
    console.log("After urgency distribution:", await queryUrgencyDistribution(regionId));
  } else {
    console.log("[dry-run] Computed distribution (DB unchanged):", counts);
  }
  console.log("Safety sample rows:", await querySafetySamples(regionId));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const systemOne = await SystemOneEngine.create();
  console.log(
    `[backfill-urgency] adapter=${systemOne.currentAdapter}, regions=${opts.regions.join(",")}, batchSize=${opts.batchSize}, dryRun=${opts.dryRun}`
  );

  if (systemOne.currentAdapter !== "onnx" && !opts.allowFallback) {
    await systemOne.close();
    throw new Error(
      `Expected ONNX adapter for production backfill, got '${systemOne.currentAdapter}'. Pass --allow-fallback to override.`
    );
  }

  try {
    for (const regionId of opts.regions) {
      await backfillRegion(regionId, systemOne, opts);
    }
  } finally {
    await systemOne.close();
  }
}

main()
  .then(() => {
    console.log("\n[backfill-urgency] Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error("[backfill-urgency] Failed:", err);
    process.exit(1);
  });
