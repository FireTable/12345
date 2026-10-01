import { getRegionDb, type DB } from "../db/client";
import type { RegionRecord } from "../db/schema";

/** 业务表在租户 schema。脚本未指定地区时用默认租户，指定了就必须找得到。 */
export async function resolveScriptRegion(argv: string[] = process.argv): Promise<{
  db: DB;
  region: RegionRecord | null;
  schemaName: string;
}> {
  const regionId = readRegionId(argv);
  const resolved = await getRegionDb(regionId || undefined);

  if (resolved.schemaName === "public") {
    const hint = regionId
      ? `未找到地区「${regionId}」。`
      : "没有默认地区租户。";
    console.error(`❌ ${hint}业务数据在 region_* schema 里，不能写入 public。请先运行 pnpm db:init-tenants。`);
    process.exit(1);
  }

  const who = resolved.region
    ? `${resolved.region.name} / ${resolved.region.id}`
    : resolved.schemaName;
  console.log(`🗄️  数据目标: ${resolved.schemaName}（${who}）`);
  return resolved;
}

export function readRegionId(argv: string[]): string | null {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if ((arg === "--region" || arg === "-r") && argv[i + 1]) {
      return argv[i + 1].trim();
    }
    if (arg.startsWith("--region=")) {
      return arg.slice("--region=".length).trim();
    }
  }
  const env = process.env.REGION_ID?.trim();
  return env || null;
}

export function stripRegionArgs(argv: string[]): string[] {
  const out: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--region" || arg === "-r") {
      i += 1;
      continue;
    }
    if (arg.startsWith("--region=")) continue;
    out.push(arg);
  }
  return out;
}
