/**
 * Drives shipped clamp, cache, overview-from-buckets, and (when DB is up)
 * the real GET handlers. Does not reimplement route logic.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import nextEnvPkg from "@next/env";

const { loadEnvConfig } = (nextEnvPkg as { default?: { loadEnvConfig?: typeof import("@next/env").loadEnvConfig }; loadEnvConfig?: typeof import("@next/env").loadEnvConfig }).default || nextEnvPkg;
if (typeof loadEnvConfig === "function") loadEnvConfig(process.cwd());
import {
  LIST_SIZE_MAX,
  clampDays,
  clampPage,
  clampSize,
} from "../lib/api-bounds";
import {
  cacheGetOrLoad,
  cacheInvalidate,
  invalidateCivicAggregates,
} from "../lib/civic-cache";
import { buildOverviewFromBuckets, buildTrendsFromBuckets } from "../lib/civic-stats";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function assert(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? " — " + detail : ""}`);
  if (!ok) process.exitCode = 1;
}

function read(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

// --- clamp (same functions the routes import) ---
assert("size=9999 caps at LIST_SIZE_MAX", clampSize("9999") === LIST_SIZE_MAX, String(clampSize("9999")));
assert("size=0 falls back to default", clampSize("0") === 10);
assert("page=0 becomes 1", clampPage("0") === 1);
assert("page omitted becomes 1", clampPage(null) === 1);
assert("days=99999 caps at 366", clampDays("99999") === 366);
assert("days=0 stays all-time aggregate", clampDays("0", 0) === 0);
assert("days omitted uses fallback 90", clampDays(undefined, 90) === 90);

// --- cache: miss+fill → hit → invalidate → miss ---
cacheInvalidate();
let loads = 0;
const loader = async () => {
  loads += 1;
  return { n: loads };
};
const first = await cacheGetOrLoad("overview:0", loader);
const second = await cacheGetOrLoad("overview:0", loader);
assert("first cache call is a miss and fills", first.hit === false && first.value.n === 1);
assert("second identical call is a hit and skips loader", second.hit === true && second.value.n === 1 && loads === 1);
invalidateCivicAggregates();
const third = await cacheGetOrLoad("overview:0", loader);
assert("invalidate restores a miss", third.hit === false && third.value.n === 2 && loads === 2);

// --- shipped bucket assembly (what SQL feeds) ---
const ov = buildOverviewFromBuckets({
  total: 120000,
  analyzed: 80000,
  multifreq: 4000,
  minTime: new Date("2026-01-01T00:00:00.000Z"),
  maxTime: new Date("2026-01-10T00:00:00.000Z"),
  themeCount: 80,
  regionRows: [
    { subdistrict: "北滘镇", n: 10 },
    { subdistrict: "未归属", n: 3 },
  ],
  categoryRows: [{ category: "城市管理", n: 12 }],
  regionCategoryRows: [{ subdistrict: "北滘镇", category: "城市管理", n: 8 }],
  monthlyRows: [{ month: "2026-01", n: 120000 }],
});
assert("overview buckets do not carry a tickets array", !("tickets" in ov) && ov.totalWorkorders === 120000);
assert("overview folds town labels from grouped rows", ov.regionDistribution["北滘"] === 10);
assert("overview ignores non-town groups", ov.regionDistribution["未归属"] == null);

const tr = buildTrendsFromBuckets({
  dailyRows: [
    { day: "2026-01-01", n: 5 },
    { day: "2026-01-02", n: 7 },
  ],
  clusterDayRows: [{ day: "2026-01-01", n: 2 }],
});
assert("trends daily comes from grouped days", tr.daily["2026-01-01"] === 5 && tr.daily["2026-01-02"] === 7);
assert("trends has no per-ticket list", !Array.isArray((tr as { tickets?: unknown }).tickets));

// --- static: routes no longer full-scan tickets ---
const overviewSrc = read("app/api/overview/route.ts");
const trendsSrc = read("app/api/trends/route.ts");
const clustersSrc = read("app/api/clusters/route.ts");
const workordersSrc = read("app/api/workorders/route.ts");
assert("overview route uses clampDays + cacheGetOrLoad + loadOverview", /clampDays/.test(overviewSrc) && /cacheGetOrLoad/.test(overviewSrc) && /loadOverview/.test(overviewSrc));
assert("overview route has no bare tickets select", !/ticketsTable/.test(overviewSrc));
assert("trends route uses clampDays + loadTrends", /clampDays/.test(trendsSrc) && /loadTrends/.test(trendsSrc));
assert("clusters route uses loadClusterBundle not ticketsTable", /loadClusterBundle/.test(clustersSrc) && !/ticketsTable/.test(clustersSrc));
assert("workorders uses clampPage/clampSize", /clampPage/.test(workordersSrc) && /clampSize/.test(workordersSrc));
assert("workorders list query is limited", /\.limit\(\s*size\s*\)/.test(workordersSrc));
assert("workorders stats come from loadWorkorderStats", /loadWorkorderStats/.test(workordersSrc));
assert("workorders has no full snapshot select of all ticket rows", !/snapshot/.test(workordersSrc));

const queriesSrc = read("lib/civic-queries.ts");
assert(
  "civic-queries uses count/groupBy not a bare select-all tickets",
  /count\(\*\)/.test(queriesSrc) && /groupBy/.test(queriesSrc) && !/db\.select\(\)\s*\.from\(\s*ticketsTable\s*\)/.test(queriesSrc)
);

const schemaSrc = read("db/schema.ts");
for (const idx of [
  "idx_tickets_status",
  "idx_tickets_urgency",
  "idx_tickets_source_category",
  "idx_tickets_primary_theme_id",
  "idx_tickets_create_time",
  "idx_tickets_subdistrict",
  "idx_tt_ticket_id",
  "idx_tt_theme_id",
]) {
  assert(`schema declares ${idx}`, schemaSrc.includes(idx));
}
const mig = read("db/migrations/0008_ticket_filter_indexes.sql");
assert("migration creates status/urgency/category/theme indexes", /idx_tickets_status/.test(mig) && /idx_tickets_primary_theme_id/.test(mig));

const persistSrc = read("lib/civic-persist.ts");
const uploadSrc = read("app/api/tickets/upload/route.ts");
assert("cluster persist invalidates civic cache", persistSrc.includes("invalidateCivicAggregates"));
assert("upload invalidates civic cache", uploadSrc.includes("invalidateCivicAggregates"));

// --- live GET handlers if DB is reachable ---
async function liveHandlers() {
  const { GET: getOverview } = await import("../app/api/overview/route");
  const { GET: getTrends } = await import("../app/api/trends/route");
  const { GET: getClusters } = await import("../app/api/clusters/route");
  const { GET: getWorkorders } = await import("../app/api/workorders/route");

  async function call(handler: (req: Request) => Promise<Response>, url: string) {
    const started = Date.now();
    const res = await handler(new Request(url));
    const text = await res.text();
    let json: any = {};
    try {
      json = JSON.parse(text);
    } catch {
      json = { parseError: true, text: text.slice(0, 200) };
    }
    return { ms: Date.now() - started, bytes: Buffer.byteLength(text), json, status: res.status };
  }

  cacheInvalidate();
  const ov0 = await call(getOverview, "http://local/api/overview?days=0");
  const ovHit = await call(getOverview, "http://local/api/overview?days=0");
  const tr0 = await call(getTrends, "http://local/api/trends?days=0");
  const wo = await call(getWorkorders, "http://local/api/workorders?page=0&size=9999");
  const cl = await call(getClusters, "http://local/api/clusters");

  const ovHasTicketArray = Array.isArray(ov0.json?.data) || Array.isArray(ov0.json?.tickets);
  const clHasTickets = Array.isArray(cl.json?.tickets);
  const woLen = Array.isArray(wo.json?.data) ? wo.json.data.length : -1;

  assert("live overview days=0 succeeds", ov0.json?.success === true, JSON.stringify(ov0.json?.error || ov0.status));
  assert("live overview has no unbounded ticket array", !ovHasTicketArray);
  assert("live trends days=0 has no ticket array", !Array.isArray(tr0.json?.tickets) && tr0.json?.success === true);
  assert(
    "live workorders size=9999 is capped",
    wo.json?.size === LIST_SIZE_MAX && woLen >= 0 && woLen <= LIST_SIZE_MAX,
    `size=${wo.json?.size} len=${woLen}`
  );
  assert("live clusters has no tickets[] dump", !clHasTickets && Array.isArray(cl.json?.topClusters));
  console.log(
    `LIVE  overview ${ov0.ms}ms/${ov0.bytes}b then ${ovHit.ms}ms/${ovHit.bytes}b  workorders ${wo.ms}ms data=${woLen}  trends ${tr0.ms}ms  clusters ${cl.ms}ms`
  );
  return { ov0, ovHit, tr0, wo, cl };
}

try {
  const live = await liveHandlers();
  (globalThis as { __apiPerfLive?: unknown }).__apiPerfLive = live;
} catch (err: any) {
  console.log(`SKIP live handlers — ${err?.message || err}`);
}

if (process.exitCode) {
  console.error("verify-api-perf failed");
  process.exit(process.exitCode);
}
console.log("verify-api-perf ok");
process.exit(0);
