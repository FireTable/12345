/**
 * One-shot: persist a saved /api/cluster JSON payload after a giant insert failed.
 */
import { readFileSync } from "node:fs";
import nextEnv from "@next/env";

const { loadEnvConfig } = (nextEnv as { default?: { loadEnvConfig?: typeof import("@next/env").loadEnvConfig }; loadEnvConfig?: typeof import("@next/env").loadEnvConfig }).default || nextEnv;
if (typeof loadEnvConfig === "function") loadEnvConfig(process.cwd());

import { persistClusterResult } from "../lib/civic-persist";

const path = process.argv[2] || "/tmp/cluster-extracted-result.json";

async function main() {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as {
    data?: { themes?: Parameters<typeof persistClusterResult>[0]["themes"] };
  };
  const themes = parsed.data?.themes || [];
  if (themes.length === 0) {
    console.error("no themes in", path);
    process.exit(1);
  }
  console.log(`persisting ${themes.length} themes from ${path}`);
  await persistClusterResult({ tickets: [], themes, replaceThemes: true });
  console.log("persist ok");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
