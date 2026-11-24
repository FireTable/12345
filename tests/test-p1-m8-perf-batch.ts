/**
 * M8 验收测试：P1 #3（聚合缓存/SQL并行/Graph UNION/连接池LRU/region TTL+M3兜底）、
 * P1 #4（批量落库 + SSE/task-progress 节流）、P1 #7（loadThemeMemberVectors L2 归一化质心）
 *
 * 严格使用临时 schema（verify_p1_m8_*），try/finally 全量清理，零基线污染。
 */
import { NextRequest } from "next/server";
import { sql as drizzleSql, eq } from "drizzle-orm";
import {
  sql,
  getRegionDb,
  getAllRegions,
  invalidateRegionCache,
  getTenantPoolStats,
} from "../db/client";
import {
  ticketsTable,
  themesTable,
  ticketThemesTable,
  reviewQueueTable,
  taskProgressTable,
} from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { resolveRequestRegionId } from "../lib/tenant/request-region";
import { cacheGet, cacheSet, invalidateCivicAggregates } from "../lib/civic-cache";
import { GET as publicOverviewGet } from "../app/api/public/overview/route";
import { GET as pipelineStateGet } from "../app/api/workbench/pipeline-state/route";
import { GET as graphGet } from "../app/api/graph/route";
import {
  upsertTicketEmbeddings,
  deleteIneligibleEmbeddings,
  loadThemeMemberVectors,
  searchTicketsByVector,
} from "../lib/ticket-embeddings";
import {
  persistTicketAnalysis,
  persistClusterResult,
  persistIncrementalResult,
} from "../lib/civic-persist";
import { seedReviewQueue, listReviewQueue } from "../lib/review-queue";
import { insertRecordsBatch } from "../lib/ticket-ingest";
import {
  initTaskProgress,
  updateTaskProgress,
  getTaskProgress,
  getLatestTaskProgress,
  flushTaskProgressPersist,
  clearTaskProgressStore,
} from "../lib/task-progress";
import {
  registerController,
  unregisterController,
  broadcastTaskProgress,
  broadcastDataRefresh,
  _resetSseBroadcasterForTesting,
} from "../lib/sse-broadcaster";
import type { EnrichedTicket, MultiFrequencyTheme } from "../backend/state";
import { withAuthHeaders } from "./_auth-helper";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
  ecom_demo: { schema: "region_ecom_demo", tickets: 3240, themes: 40 },
} as const;

const SUFFIX = `${process.pid}_${Date.now()}`;
const TEMP_REGION_A = `verify_p1_m8_a_${SUFFIX}`;
const TEMP_REGION_B = `verify_p1_m8_b_${SUFFIX}`;
const TEMP_SCHEMA_A = `region_${TEMP_REGION_A}`;
const TEMP_SCHEMA_B = `region_${TEMP_REGION_B}`;
const EXTRA_REGIONS = Array.from({ length: 10 }, (_, i) => {
  const id = `verify_p1_m8_pool_${i}_${SUFFIX}`;
  return { id, schemaName: `region_${id}` };
});

let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${msg}`);
  }
}

function unitVec(dim: number, value = 1): number[] {
  const vec = new Array<number>(1024).fill(0);
  vec[dim] = value;
  return vec;
}

function l2Norm(vec: number[]): number {
  let sum = 0;
  for (const v of vec) sum += v * v;
  return Math.sqrt(sum);
}

async function assertBaselineUnchanged(stage: string) {
  for (const [id, exp] of Object.entries(BASELINE)) {
    const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${exp.schema}".tickets`);
    const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${exp.schema}".themes`);
    const tc = Number(tRow?.c ?? -1);
    const thc = Number(thRow?.c ?? -1);
    assert(
      tc === exp.tickets && thc === exp.themes,
      `[${stage}] ${id} 基线完整 (tickets=${tc}/${exp.tickets}, themes=${thc}/${exp.themes})`
    );
  }
  const [cnRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM public.compute_nodes`);
  const [csRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM public.citizen_submissions`);
  assert(
    Number(cnRow?.c ?? -1) === 0 && Number(csRow?.c ?? -1) === 0,
    `[${stage}] public.compute_nodes=${cnRow?.c}, public.citizen_submissions=${csRow?.c}`
  );
}

async function makeAdminReq(path: string, headers?: Record<string, string>) {
  const merged = await withAuthHeaders(headers, "admin");
  return new NextRequest(`http://localhost:3000${path}`, { headers: merged });
}

function makeMockController() {
  const chunks: string[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue(chunk: Uint8Array) {
      chunks.push(decoder.decode(chunk, { stream: true }));
    },
    close() {},
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  return { controller, chunks };
}

function makeTicket(id: string, ticketNo: string, overrides?: Partial<EnrichedTicket>): EnrichedTicket {
  return {
    id,
    ticketNo,
    title: `测试工单 ${ticketNo}`,
    content: `测试诉求内容 "${ticketNo}" '引号'`,
    citizenName: "测试市民",
    citizenPhone: "",
    district: "测试区",
    subdistrict: "测试街道",
    sourceCategory: "城市管理",
    channel: "市民服务热线",
    status: "PENDING",
    urgency: "NORMAL",
    slaHours: 48,
    stabilityRisk: false,
    confidence: 88,
    createTime: "2026-05-03 00:00:00",
    summarizeTitle: `摘要 ${ticketNo}`,
    canonicalSubject: "测试主体",
    canonicalLocation: "测试地点1号",
    eventType: "占道经营",
    themes: ["城市管理"],
    entities: [],
    relations: [],
    ...overrides,
  };
}

async function testPublicOverviewCache() {
  console.log("\n=== 1. /api/public/overview Cache & Invalidation ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);
  await dbA.insert(ticketsTable).values([
    { id: `pub-1-${SUFFIX}`, ticketNo: `GD-20260501-${SUFFIX}-1`, title: "p1", content: "c1", confidence: 90, status: "PENDING" },
    { id: `pub-2-${SUFFIX}`, ticketNo: `GD-20260501-${SUFFIX}-2`, title: "p2", content: "c2", confidence: 0, status: "PENDING" },
    { id: `pub-3-${SUFFIX}`, ticketNo: `GD-20260501-${SUFFIX}-3`, title: "p3", content: "c3", confidence: null, status: "PENDING" },
  ]);

  invalidateCivicAggregates(TEMP_REGION_A);
  invalidateCivicAggregates(TEMP_REGION_B);

  const r1 = await publicOverviewGet(new NextRequest(`http://localhost:3000/api/public/overview?region=${TEMP_REGION_A}`));
  const j1 = await r1.json();
  assert(
    r1.status === 200 && j1.regionId === TEMP_REGION_A && j1.totalWorkorders === 3 && j1.analyzedCount === 2,
    `public/overview 首次加载准确 (total=${j1.totalWorkorders}, analyzed=${j1.analyzedCount})`
  );

  // 直接插库不失效缓存：应命中缓存
  await dbA.insert(ticketsTable).values({
    id: `pub-4-${SUFFIX}`,
    ticketNo: `GD-20260501-${SUFFIX}-4`,
    title: "p4",
    content: "c4",
    confidence: 85,
    status: "PENDING",
  });
  const r2 = await publicOverviewGet(new NextRequest(`http://localhost:3000/api/public/overview?region=${TEMP_REGION_A}`));
  const j2 = await r2.json();
  assert(j2.totalWorkorders === 3 && j2.analyzedCount === 2, `public/overview 命中缓存 (total=${j2.totalWorkorders})`);

  // 失效缓存后读取最新值，且不影响 TEMP_REGION_B
  invalidateCivicAggregates(TEMP_REGION_A);
  const r3 = await publicOverviewGet(new NextRequest(`http://localhost:3000/api/public/overview?region=${TEMP_REGION_A}`));
  const j3 = await r3.json();
  const rB = await publicOverviewGet(new NextRequest(`http://localhost:3000/api/public/overview?region=${TEMP_REGION_B}`));
  const jB = await rB.json();
  assert(
    j3.totalWorkorders === 4 && j3.analyzedCount === 3 && jB.regionId === TEMP_REGION_B && jB.totalWorkorders === 0,
    `public/overview 按 region 精准失效且跨区隔离 (A=${j3.totalWorkorders}, B=${jB.totalWorkorders})`
  );
}

async function testPipelineStateMergedAndLiveProgress() {
  console.log("\n=== 2. /api/workbench/pipeline-state Merged Scan + Live taskProgress ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);
  await dbA.insert(ticketsTable).values({
    id: `pipe-1-${SUFFIX}`,
    ticketNo: `GD-20260502-${SUFFIX}-1`,
    title: "急单涉稳假闭环",
    content: "内容",
    subdistrict: "大良街道",
    sourceCategory: "交通管理",
    urgency: "URGENT",
    stabilityRisk: true,
    isFakeClosure: true,
    confidence: 92,
    canonicalSubject: "路段施工",
    status: "PENDING",
  });
  await dbA.insert(themesTable).values({
    id: `THEME-PIPE-${SUFFIX}`,
    title: "施工主题",
    canonicalSubject: "路段施工",
    canonicalLocation: "大良",
    eventType: "占道",
    riskLevel: "HIGH",
    ticketCount: 1,
    handlingStatus: "IN_PROGRESS",
  });

  invalidateCivicAggregates(TEMP_REGION_A);
  const tpId = `task-pipe-${SUFFIX}`;
  initTaskProgress(tpId, TEMP_REGION_A, 10);
  updateTaskProgress(tpId, TEMP_REGION_A, { processed: 3, percent: 30 });
  await flushTaskProgressPersist(tpId);

  const res1 = await pipelineStateGet(await makeAdminReq(`/api/workbench/pipeline-state?region=${TEMP_REGION_A}`));
  const json1 = await res1.json();
  assert(
    res1.status === 200 &&
      json1.data?.metrics?.totalTickets === 5 &&
      json1.data?.metrics?.urgentTickets === 1 &&
      json1.data?.metrics?.stabilityRiskTickets === 1 &&
      json1.data?.disposalMetrics?.fakeClosureTickets === 1 &&
      json1.data?.disposalMetrics?.inProgressThemes === 1 &&
      json1.data?.taskProgress?.processed === 3,
    `pipeline-state 合并扫描指标与实时进度一致 (total=${json1.data?.metrics?.totalTickets}, processed=${json1.data?.taskProgress?.processed})`
  );

  // 缓存命中期间修改 DB 不应改变指标，但 taskProgress 必须实时更新
  await dbA.insert(ticketsTable).values({
    id: `pipe-2-${SUFFIX}`,
    ticketNo: `GD-20260502-${SUFFIX}-2`,
    title: "新增不刷新缓存",
    content: "内容2",
    status: "PENDING",
  });
  updateTaskProgress(tpId, TEMP_REGION_A, { processed: 7, percent: 70 });

  const res2 = await pipelineStateGet(await makeAdminReq(`/api/workbench/pipeline-state?region=${TEMP_REGION_A}`));
  const json2 = await res2.json();
  assert(
    json2.data?.metrics?.totalTickets === 5 && json2.data?.taskProgress?.processed === 7,
    `pipeline-state DB 快照命中缓存同时 taskProgress 实时更新 (cachedTotal=${json2.data?.metrics?.totalTickets}, liveProcessed=${json2.data?.taskProgress?.processed})`
  );

  invalidateCivicAggregates(TEMP_REGION_A);
  const res3 = await pipelineStateGet(await makeAdminReq(`/api/workbench/pipeline-state?region=${TEMP_REGION_A}`));
  const json3 = await res3.json();
  assert(json3.data?.metrics?.totalTickets === 6, `pipeline-state 失效后返回最新指标 (total=${json3.data?.metrics?.totalTickets})`);

  await sql`DELETE FROM public.task_progress WHERE task_id = ${tpId}`;
  clearTaskProgressStore();
}

async function testGraphUnionAndCache() {
  console.log("\n=== 3. /api/graph UNION Parity, EXPLAIN & Panorama Cache ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);
  const themeId = `THEME-G-${SUFFIX}`;
  await dbA.insert(themesTable).values({
    id: themeId,
    title: "图谱测试主题",
    canonicalSubject: "某工程队",
    canonicalLocation: "测试路",
    eventType: "噪音",
    riskLevel: "MEDIUM",
    ticketCount: 2,
  });
  await dbA.insert(ticketsTable).values([
    {
      id: `gt-1-${SUFFIX}`,
      ticketNo: `GD-G-${SUFFIX}-1`,
      title: "主归属工单",
      content: "c1",
      primaryThemeId: themeId,
      createTime: new Date("2026-05-01T10:00:00Z"),
    },
    {
      id: `gt-2-${SUFFIX}`,
      ticketNo: `GD-G-${SUFFIX}-2`,
      title: "仅关联表工单",
      content: "c2",
      primaryThemeId: null,
      isFakeClosure: true,
      createTime: new Date("2026-05-02T10:00:00Z"),
    },
  ]);
  await dbA.insert(ticketThemesTable).values([
    { ticketId: `gt-1-${SUFFIX}`, themeId },
    { ticketId: `gt-2-${SUFFIX}`, themeId },
  ]);

  invalidateCivicAggregates(TEMP_REGION_A);
  const gThemeRes = await graphGet(await makeAdminReq(`/api/graph?region=${TEMP_REGION_A}&themeId=${themeId}`));
  const gThemeJson = await gThemeRes.json();
  const ticketNodes = (gThemeJson.data?.nodes || []).filter((n: any) => n.type === "TICKET");
  assert(
    gThemeRes.status === 200 &&
      ticketNodes.length === 2 &&
      ticketNodes[0].id === `gt-2-${SUFFIX}` &&
      ticketNodes[0].isFakeClosure === true &&
      ticketNodes[1].id === `gt-1-${SUFFIX}`,
    `graph?themeId 正确合并 primary_theme_id 与 ticket_themes 并按 create_time 降序去重`
  );

  // 404 不应被缓存
  const missingThemeId = `THEME-MISSING-${SUFFIX}`;
  const miss1 = await graphGet(await makeAdminReq(`/api/graph?region=${TEMP_REGION_A}&themeId=${missingThemeId}`));
  assert(miss1.status === 404, `不存在 themeId 返回 404`);

  // 全景图缓存验证
  const pan1 = await graphGet(await makeAdminReq(`/api/graph?region=${TEMP_REGION_A}`));
  const pan1Json = await pan1.json();
  await dbA.insert(themesTable).values({
    id: `THEME-G2-${SUFFIX}`,
    title: "新全景主题",
    canonicalSubject: "主体2",
    canonicalLocation: "地点2",
    eventType: "积水",
    riskLevel: "LOW",
    ticketCount: 5,
  });
  const pan2 = await graphGet(await makeAdminReq(`/api/graph?region=${TEMP_REGION_A}`));
  const pan2Json = await pan2.json();
  const countPan1 = (pan1Json.data?.nodes || []).filter((n: any) => n.type === "THEME").length;
  const countPan2 = (pan2Json.data?.nodes || []).filter((n: any) => n.type === "THEME").length;
  assert(countPan1 === countPan2, `graph 全景命中缓存 (${countPan1} === ${countPan2})`);

  invalidateCivicAggregates(TEMP_REGION_A);
  const pan3 = await graphGet(await makeAdminReq(`/api/graph?region=${TEMP_REGION_A}`));
  const pan3Json = await pan3.json();
  const countPan3 = (pan3Json.data?.nodes || []).filter((n: any) => n.type === "THEME").length;
  assert(countPan3 === countPan1 + 1, `graph 全景失效后反映新主题 (${countPan3})`);

  // 在 gz_tianhe 只读比对 THEME-1127 与 THEME-1 的 UNION 结果与 EXPLAIN 计划
  const { db: tianheDb } = await getRegionDb("gz_tianhe");
  for (const tid of ["THEME-1127", "THEME-1"]) {
    const legacyRows = await tianheDb.execute(drizzleSql`
      SELECT id FROM tickets
      WHERE primary_theme_id = ${tid}
         OR EXISTS (SELECT 1 FROM ticket_themes tt WHERE tt.theme_id = ${tid} AND tt.ticket_id = tickets.id)
      ORDER BY create_time DESC NULLS LAST, id DESC
      LIMIT 30
    `);
    const apiRes = await graphGet(await makeAdminReq(`/api/graph?region=gz_tianhe&themeId=${tid}`));
    const apiJson = await apiRes.json();
    const apiIds = (apiJson.data?.nodes || []).filter((n: any) => n.type === "TICKET").map((n: any) => n.id);
    const legacyIds = (Array.isArray(legacyRows) ? legacyRows : (legacyRows as any).rows).map((r: any) => r.id);
    const exactMatch =
      apiIds.length === legacyIds.length && apiIds.every((id: string, idx: number) => id === legacyIds[idx]);
    assert(exactMatch, `gz_tianhe ${tid} graph UNION 与原 OR+EXISTS 30条行级完全一致`);
  }

  const explainRes = await tianheDb.execute(drizzleSql`
    EXPLAIN (ANALYZE, FORMAT TEXT)
    WITH member_ids AS (
      (SELECT id FROM tickets WHERE primary_theme_id = 'THEME-1127' ORDER BY create_time DESC NULLS LAST, id DESC LIMIT 30)
      UNION
      (SELECT t.id FROM ticket_themes tt INNER JOIN tickets t ON t.id = tt.ticket_id WHERE tt.theme_id = 'THEME-1127' ORDER BY t.create_time DESC NULLS LAST, t.id DESC LIMIT 30)
    )
    SELECT t.id FROM member_ids m INNER JOIN tickets t ON t.id = m.id ORDER BY t.create_time DESC NULLS LAST, t.id DESC LIMIT 30
  `);
  const planLines = (Array.isArray(explainRes) ? explainRes : (explainRes as any).rows)
    .map((r: any) => String(r["QUERY PLAN"] ?? Object.values(r)[0] ?? ""))
    .join("\n");
  assert(!/Seq Scan on tickets/i.test(planLines), `gz_tianhe THEME-1127 EXPLAIN 无 Seq Scan on tickets`);
}

async function testPoolGovernanceAndRegionTtl() {
  console.log("\n=== 4. Pool LRU Governance, getAllRegions TTL & APP_DOMAIN=ALL Fallback ===");
  for (let i = 0; i < EXTRA_REGIONS.length; i++) {
    const r = EXTRA_REGIONS[i];
    await registerRegion(sql, {
      id: r.id,
      name: `M8连接池测试区${i}`,
      city: "测试市",
      schemaName: r.schemaName,
    });
  }

  // 在超过 MAX_TENANT_POOLS=8 时触发 LRU 淘汰，并验证淘汰池上正在进行的查询仍能正常完成
  const firstRegion = EXTRA_REGIONS[0];
  const { db: firstDb } = await getRegionDb(firstRegion.id);
  const inflightSlowQuery = firstDb.execute(drizzleSql`SELECT pg_sleep(0.15), current_setting('search_path') AS sp`);

  for (const r of EXTRA_REGIONS.slice(1)) {
    const { db: extraDb } = await getRegionDb(r.id);
    await extraDb.execute(drizzleSql`SELECT 1`);
  }
  await getRegionDb(TEMP_REGION_A);
  await getRegionDb(TEMP_REGION_B);

  const slowResult = await inflightSlowQuery;
  assert(Boolean(slowResult), "被 LRU 淘汰的连接池在宽限期内完成在途慢查询");

  // 并发 12 个真实 region_* schema（超过 MAX_TENANT_POOLS=8）同时 getRegionDb + pg_sleep(0.3)，断言 12/12 零 CONNECTION_ENDED
  const twelveRegions = [
    { id: TEMP_REGION_A, schemaName: TEMP_SCHEMA_A },
    { id: TEMP_REGION_B, schemaName: TEMP_SCHEMA_B },
    ...EXTRA_REGIONS,
  ];
  const concurrentResults = await Promise.all(
    twelveRegions.map(async (r) => {
      const { db: rdb, schemaName } = await getRegionDb(r.id);
      const res = await rdb.execute(
        drizzleSql`SELECT pg_sleep(0.3), current_setting('search_path') AS sp`
      );
      const rows = Array.isArray(res) ? res : (res as any).rows;
      return {
        id: r.id,
        expectedSchema: r.schemaName,
        resolvedSchema: schemaName,
        sp: String(rows?.[0]?.sp ?? ""),
      };
    })
  );
  assert(
    concurrentResults.length === 12 &&
      concurrentResults.every(
        (x) => x.resolvedSchema === x.expectedSchema && x.sp.includes(x.expectedSchema)
      ),
    `并发 12 个 region_* schema 超池上限 Promise.all 12/12 成功且零 CONNECTION_ENDED`
  );

  const poolStats = getTenantPoolStats();
  assert(
    poolStats.size <= poolStats.maxPools,
    `tenantSqls 数量受控 (${poolStats.size} <= ${poolStats.maxPools})`
  );

  // 验证 destroyRegionTenant 立即取消延迟关闭计时器并清理池与 schema（即使曾进入 LRU 淘汰队列）
  const targetDestroy = EXTRA_REGIONS[0];
  const destroyed = await destroyRegionTenant(sql, targetDestroy.id);
  const afterDestroyStats = getTenantPoolStats();
  const [schemaExists] = await sql.unsafe(
    `SELECT count(*)::int AS c FROM information_schema.schemata WHERE schema_name = '${targetDestroy.schemaName}'`
  );
  assert(
    destroyed === true &&
      !afterDestroyStats.keys.includes(targetDestroy.schemaName) &&
      Number(schemaExists?.c ?? -1) === 0,
    `destroyRegionTenant 立即取消延迟计时器并清理池与 schema`
  );

  // getAllRegions TTL 缓存 + invalidateRegionCache
  invalidateRegionCache();
  const regions1 = await getAllRegions();
  const regions2 = await getAllRegions();
  assert(
    regions1.length >= 3 && regions1.length === regions2.length,
    `getAllRegions TTL 缓存返回一致站点列表 (${regions1.length})`
  );

  // APP_DOMAIN=ALL + ?region=大良 (非租户镇街名) 不再返回 "大良"
  const prevDomain = process.env.APP_DOMAIN;
  try {
    process.env.APP_DOMAIN = "ALL";
    const townNoCookie = await resolveRequestRegionId(
      new NextRequest("http://localhost:3000/api/workorders?region=%E5%A4%A7%E8%89%AF")
    );
    const townWithCookie = await resolveRequestRegionId(
      new NextRequest("http://localhost:3000/api/workorders?region=%E5%A4%A7%E8%89%AF", {
        headers: { cookie: "active_region=fs_shunde" },
      })
    );
    const ecomChannelOverview = await publicOverviewGet(
      new NextRequest("http://localhost:3000/api/public/overview?region=%E5%A4%A9%E7%8C%AB%E6%97%97%E8%88%B0%E5%BA%97")
    );
    const ecomExplicit = await resolveRequestRegionId(
      new NextRequest("http://localhost:3000/api/workorders?region=ecom_demo")
    );
    assert(
      townNoCookie === "gz_tianhe" &&
        townWithCookie === "fs_shunde" &&
        ecomChannelOverview.status === 200 &&
        ecomExplicit === "ecom_demo",
      `APP_DOMAIN=ALL ?region=<镇街/渠道> 安全回退 (${townNoCookie}/${townWithCookie}/status=${ecomChannelOverview.status}/${ecomExplicit})`
    );
  } finally {
    if (prevDomain === undefined) delete process.env.APP_DOMAIN;
    else process.env.APP_DOMAIN = prevDomain;
  }
}

async function testEmbeddingsAndCentroid() {
  console.log("\n=== 5. ticket-embeddings Batch Upsert & L2 Centroid ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);

  const ticketRows = Array.from({ length: 122 }, (_, i) => ({
    id: `emb-tk-${i}-${SUFFIX}`,
    ticketNo: `GD-EMB-${i}-${SUFFIX}`,
    title: `向量工单 ${i}`,
    content: `内容 ${i}`,
    subdistrict: "测试街道",
    sourceCategory: "城市管理",
    confidence: 90,
  }));
  await dbA.insert(ticketsTable).values(ticketRows);

  const embedInputs = ticketRows.map((t, i) => ({
    ticketId: t.id,
    productHash: `hash-${i}`,
    model: "BAAI/bge-m3",
    vector: unitVec(i % 10, 1),
  }));
  // 注入同一批重复 ticketId（验证去重与后写覆盖，不报 PG 21000）
  embedInputs.push({
    ticketId: ticketRows[0].id,
    productHash: "hash-0-updated",
    model: "BAAI/bge-m3",
    vector: unitVec(55, 1),
  });
  await upsertTicketEmbeddings(TEMP_REGION_A, embedInputs);

  const [embCountRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${TEMP_SCHEMA_A}".ticket_embeddings`);
  const [updatedHashRow] = await sql.unsafe(
    `SELECT product_hash FROM "${TEMP_SCHEMA_A}".ticket_embeddings WHERE ticket_id = '${ticketRows[0].id}'`
  );
  assert(
    Number(embCountRow?.c) === 122 && updatedHashRow?.product_hash === "hash-0-updated",
    `upsertTicketEmbeddings 122条+同批重复去重成功 (count=${embCountRow?.c}, hash=${updatedHashRow?.product_hash})`
  );

  // 质心测试：3 个正交单位向量 [e1, e2, e3] -> 归一化质心 [1/sqrt(3), 1/sqrt(3), 1/sqrt(3), 0...]
  // 零向量测试：2 个相互抵消向量 [+e4, -e4] -> 应跳过不写入 NaN/0 向量
  const themeCentroid = `THEME-CENTROID-${SUFFIX}`;
  const themeZero = `THEME-ZERO-${SUFFIX}`;
  await dbA.insert(themesTable).values([
    {
      id: themeCentroid,
      title: "质心主题",
      canonicalSubject: "质心",
      canonicalLocation: "测试",
      eventType: "测试",
      riskLevel: "LOW",
      ticketCount: 3,
    },
    {
      id: themeZero,
      title: "零范数主题",
      canonicalSubject: "零",
      canonicalLocation: "测试",
      eventType: "测试",
      riskLevel: "LOW",
      ticketCount: 2,
    },
  ]);

  await dbA.insert(ticketsTable).values([
    { id: `cen-1-${SUFFIX}`, ticketNo: `GD-CEN-1-${SUFFIX}`, title: "c1", content: "c1" },
    { id: `cen-2-${SUFFIX}`, ticketNo: `GD-CEN-2-${SUFFIX}`, title: "c2", content: "c2" },
    { id: `cen-3-${SUFFIX}`, ticketNo: `GD-CEN-3-${SUFFIX}`, title: "c3", content: "c3" },
    { id: `zer-1-${SUFFIX}`, ticketNo: `GD-ZER-1-${SUFFIX}`, title: "z1", content: "z1" },
    { id: `zer-2-${SUFFIX}`, ticketNo: `GD-ZER-2-${SUFFIX}`, title: "z2", content: "z2" },
  ]);
  await upsertTicketEmbeddings(TEMP_REGION_A, [
    { ticketId: `cen-1-${SUFFIX}`, productHash: "c1", model: "BAAI/bge-m3", vector: unitVec(1, 1) },
    { ticketId: `cen-2-${SUFFIX}`, productHash: "c2", model: "BAAI/bge-m3", vector: unitVec(2, 1) },
    { ticketId: `cen-3-${SUFFIX}`, productHash: "c3", model: "BAAI/bge-m3", vector: unitVec(3, 1) },
    { ticketId: `zer-1-${SUFFIX}`, productHash: "z1", model: "BAAI/bge-m3", vector: unitVec(4, 1) },
    { ticketId: `zer-2-${SUFFIX}`, productHash: "z2", model: "BAAI/bge-m3", vector: unitVec(4, -1) },
  ]);
  await dbA.insert(ticketThemesTable).values([
    { ticketId: `cen-1-${SUFFIX}`, themeId: themeCentroid },
    { ticketId: `cen-2-${SUFFIX}`, themeId: themeCentroid },
    { ticketId: `cen-3-${SUFFIX}`, themeId: themeCentroid },
    { ticketId: `zer-1-${SUFFIX}`, themeId: themeZero },
    { ticketId: `zer-2-${SUFFIX}`, themeId: themeZero },
  ]);

  const centroidMap = await loadThemeMemberVectors(TEMP_REGION_A, [themeCentroid, themeZero]);
  const cVec = centroidMap.get(themeCentroid);
  const expectedCoord = 1 / Math.sqrt(3);
  assert(
    Boolean(cVec) &&
      cVec!.length === 1024 &&
      Math.abs(l2Norm(cVec!) - 1) < 1e-4 &&
      Math.abs(cVec![1] - expectedCoord) < 1e-3 &&
      Math.abs(cVec![2] - expectedCoord) < 1e-3 &&
      Math.abs(cVec![3] - expectedCoord) < 1e-3 &&
      !centroidMap.has(themeZero),
    `loadThemeMemberVectors 返回 L2 归一化质心且过滤零范数主题 (norm=${cVec ? l2Norm(cVec).toFixed(5) : "missing"}, hasZero=${centroidMap.has(themeZero)})`
  );

  // 验证 M5 searchTicketsByVector 仍然正常
  const vecHits = await searchTicketsByVector(TEMP_REGION_A, unitVec(55, 1), 5, {
    subdistrict: "测试街道",
  });
  assert(vecHits.length >= 1 && vecHits[0].ticketNo === ticketRows[0].ticketNo, `searchTicketsByVector M5 下推过滤正常`);

  await deleteIneligibleEmbeddings(TEMP_REGION_A, [`zer-1-${SUFFIX}`, `zer-2-${SUFFIX}`]);
}

async function testCivicPersistBatch() {
  console.log("\n=== 6. civic-persist Batch Updates & Conditional Fields ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);

  const preservedCreateTime = new Date("2025-01-15T08:00:00Z");
  const baseTickets = Array.from({ length: 85 }, (_, i) => ({
    id: `cp-tk-${i}-${SUFFIX}`,
    ticketNo: i === 0 ? `CUSTOM-NO-${SUFFIX}` : `GD-20260503-${SUFFIX}-${i}`,
    title: `批量持久化 ${i}`,
    content: `内容 ${i}`,
    createTime: i === 0 ? preservedCreateTime : new Date("2026-05-03T00:00:00Z"),
    isFakeClosure: i === 0 ? true : false,
    closureStatus: i === 0 ? "REOPENED" : null,
  }));
  await dbA.insert(ticketsTable).values(baseTickets);

  const enriched: EnrichedTicket[] = baseTickets.map((t, i) =>
    makeTicket(t.id, t.ticketNo, {
      isFakeClosure: i === 1 ? true : false,
      closureStatus: i === 1 ? "REOPENED" : undefined,
    })
  );

  const clusterThemes: MultiFrequencyTheme[] = Array.from({ length: 15 }, (_, ti) => ({
    id: `THEME-CP-${ti}-${SUFFIX}`,
    title: `批量主题 ${ti}`,
    canonicalSubject: "批量主体",
    canonicalLocation: "批量地点",
    eventType: "占道经营",
    category: "城市管理",
    riskLevel: ti === 0 ? "HIGH" : "LOW",
    riskReason: ti === 0 ? "高发频次" : "常规",
    ticketCount: 5,
    timeSpanHours: 12,
    firstOccurrence: "2026-05-03 00:00:00",
    lastOccurrence: "2026-05-03 12:00:00",
    aiSummary: `AI 摘要 ${ti}`,
    recommendedAction: "按责核查",
    relatedSubjects: ["批量主体"],
    relatedLocations: ["批量地点"],
    status: "UNCHECKED",
    tickets: enriched.slice(ti * 5, ti * 5 + 5),
  }));

  // 先写入 REGION_B 缓存，确认 persistClusterResult 只失效 TEMP_REGION_A 不跨区清缓存
  cacheSet(`overview:${TEMP_REGION_B}:0`, { totalWorkorders: 999 });
  cacheSet(`overview:${TEMP_REGION_A}:0`, { totalWorkorders: 999 });

  await persistClusterResult({
    tickets: enriched,
    themes: clusterThemes,
    regionId: TEMP_REGION_A,
  });

  const stillCachedB = cacheGet<{ totalWorkorders: number }>(`overview:${TEMP_REGION_B}:0`);
  const clearedA = cacheGet<{ totalWorkorders: number }>(`overview:${TEMP_REGION_A}:0`);
  const [tk0] = await dbA.select().from(ticketsTable).where(eq(ticketsTable.id, baseTickets[0].id));
  const [tk1] = await dbA.select().from(ticketsTable).where(eq(ticketsTable.id, baseTickets[1].id));

  assert(
    stillCachedB?.totalWorkorders === 999 &&
      clearedA === undefined &&
      tk0.isFakeClosure === true &&
      tk0.closureStatus === "REOPENED" &&
      tk0.createTime?.getTime() === preservedCreateTime.getTime() &&
      tk0.primaryThemeId === `THEME-CP-0-${SUFFIX}` &&
      tk1.isFakeClosure === true &&
      tk1.closureStatus === "REOPENED",
    `persistClusterResult 批量写入保留条件字段且按 regionId 精确失效缓存`
  );

  // persistIncrementalResult：attachedTheme 省略 handlingStatus / handlingProgress 时保留旧值
  await dbA.insert(themesTable).values({
    id: `THEME-ATT-${SUFFIX}`,
    title: "存量主题",
    canonicalSubject: "主体A",
    canonicalLocation: "地点A",
    eventType: "噪音",
    riskLevel: "MEDIUM",
    ticketCount: 2,
    handlingStatus: "DISPATCHED",
    handlingProgress: 65,
  });

  await persistIncrementalResult({
    tickets: [enriched[80]],
    attachedThemes: [
      {
        id: `THEME-ATT-${SUFFIX}`,
        title: "存量主题",
        canonicalSubject: "主体A",
        canonicalLocation: "地点A",
        eventType: "噪音",
        category: "城市管理",
        riskLevel: "HIGH",
        riskReason: "复发",
        ticketCount: 3,
        timeSpanHours: 24,
        firstOccurrence: "2026-05-01 08:00:00",
        lastOccurrence: "2026-05-02 08:00:00",
        aiSummary: "复发主题摘要",
        recommendedAction: "重点督办",
        relatedSubjects: ["主体A"],
        relatedLocations: ["地点A"],
        status: "UNCHECKED",
        reopenCount: 1,
        reopenTicketIds: [enriched[80].id],
        tickets: [enriched[80]],
      },
    ],
    newThemes: [],
    regionId: TEMP_REGION_A,
  });

  const [attRow] = await dbA.select().from(themesTable).where(eq(themesTable.id, `THEME-ATT-${SUFFIX}`));
  assert(
    attRow.ticketCount === 3 &&
      attRow.riskLevel === "HIGH" &&
      attRow.handlingStatus === "DISPATCHED" &&
      attRow.handlingProgress === 65,
    `persistIncrementalResult 保留未传入的 handlingStatus/handlingProgress`
  );

  // NaN / Infinity ticketCount & timeSpanHours 防护
  await persistIncrementalResult({
    tickets: [],
    attachedThemes: [
      {
        id: `THEME-ATT-${SUFFIX}`,
        title: "存量主题",
        canonicalSubject: "主体A",
        canonicalLocation: "地点A",
        eventType: "噪音",
        category: "城市管理",
        riskLevel: "HIGH",
        riskReason: "数值容错",
        ticketCount: Number.NaN,
        timeSpanHours: Number.POSITIVE_INFINITY,
        firstOccurrence: "2026-05-01 08:00:00",
        lastOccurrence: "2026-05-02 08:00:00",
        aiSummary: "NaN/Inf 容错",
        recommendedAction: "按责核查",
        relatedSubjects: ["主体A"],
        relatedLocations: ["地点A"],
        status: "UNCHECKED",
        tickets: [],
      },
    ],
    newThemes: [],
    regionId: TEMP_REGION_A,
  });
  const [nanGuardRow] = await dbA.select().from(themesTable).where(eq(themesTable.id, `THEME-ATT-${SUFFIX}`));
  assert(
    nanGuardRow.ticketCount === 0 && nanGuardRow.timeSpanHours === 0,
    `persistIncrementalResult NaN/Infinity ticketCount/timeSpanHours 兜底为 0`
  );

  // 触发单条 persistTicketAnalysis 路径
  await persistTicketAnalysis([enriched[84]], { regionId: TEMP_REGION_A });
}

async function testReviewSeedAndIngestBatch() {
  console.log("\n=== 7. seedReviewQueue Batch + listReviewQueue + insertRecordsBatch ===");
  const { db: dbA } = await getRegionDb(TEMP_REGION_A);

  const rqTickets = Array.from({ length: 420 }, (_, i) => ({
    id: `rq-tk-${i}-${SUFFIX}`,
    ticketNo: `GD-RQ-${i}-${SUFFIX}`,
    title: `复核工单 ${i}`,
    content: `复核内容 ${i}`,
    confidence: 45,
  }));
  await dbA.insert(ticketsTable).values(rqTickets);

  // 预置 1 条 PENDING（应跳过）+ 1 条 REVIEWED（应允许再次入队）
  await dbA.insert(reviewQueueTable).values([
    {
      id: `rev-pre-p-${SUFFIX}`,
      ticketId: rqTickets[0].id,
      status: "PENDING",
      confidence: 30,
      reason: "PRE_PENDING",
    },
    {
      id: `rev-pre-r-${SUFFIX}`,
      ticketId: rqTickets[1].id,
      status: "REVIEWED",
      confidence: 40,
      reason: "PRE_REVIEWED",
    },
  ]);

  const seedInput = [
    ...rqTickets.map((t) => ({ ticketId: t.id, confidence: 45, reason: "LOW_CONFIDENCE" })),
    { ticketId: rqTickets[2].id, confidence: 45, reason: "DUP_IN_INPUT" },
    { ticketId: `NON-EXISTENT-FK-${SUFFIX}`, confidence: 10, reason: "BAD_FK" },
  ];

  const seedRes = await seedReviewQueue(seedInput, TEMP_REGION_A);
  const pageRes = await listReviewQueue(TEMP_REGION_A, "PENDING", { page: 1, size: 10 });
  assert(
    seedRes.inserted === 419 && pageRes.total === 420 && pageRes.data.length === 10,
    `seedReviewQueue 批量去重+FK容错插入419条，listReviewQueue M3分页正常 (inserted=${seedRes.inserted}, total=${pageRes.total})`
  );

  // insertRecordsBatch：30 新建 + 10 重复并更新 createTime
  const newCreateTime = new Date("2026-06-01T12:00:00Z");
  const ingestRows = [
    ...Array.from({ length: 10 }, (_, i) => ({
      id: `ing-dup-${i}-${SUFFIX}`,
      ticketNo: rqTickets[i].ticketNo,
      title: `dup ${i}`,
      content: `dup content ${i}`,
      createTime: newCreateTime,
    })),
    ...Array.from({ length: 30 }, (_, i) => ({
      id: `ing-new-${i}-${SUFFIX}`,
      ticketNo: `GD-ING-NEW-${i}-${SUFFIX}`,
      title: `new ${i}`,
      content: `new content ${i}`,
      createTime: newCreateTime,
    })),
  ];
  const ingRes = await insertRecordsBatch(ingestRows, TEMP_REGION_A);
  const [dupRow] = await dbA
    .select({ createTime: ticketsTable.createTime })
    .from(ticketsTable)
    .where(eq(ticketsTable.ticketNo, rqTickets[0].ticketNo));
  assert(
    ingRes.insertedCount === 30 &&
      ingRes.duplicateCount === 10 &&
      ingRes.failedCount === 0 &&
      dupRow?.createTime?.getTime() === newCreateTime.getTime(),
    `insertRecordsBatch 批量去重与 createTime 更新正确 (inserted=${ingRes.insertedCount}, dup=${ingRes.duplicateCount})`
  );
}

async function testTaskProgressAndSseThrottle() {
  console.log("\n=== 8. task-progress & sse-broadcaster Throttling & Terminal Flush ===");
  clearTaskProgressStore();
  _resetSseBroadcasterForTesting();

  const taskId = `task-th-${SUFFIX}`;
  initTaskProgress(taskId, TEMP_REGION_A, 20);
  for (let i = 1; i <= 19; i++) {
    updateTaskProgress(taskId, TEMP_REGION_A, { processed: i, percent: i * 4 });
  }
  const latestInMem = await getLatestTaskProgress(TEMP_REGION_A);
  assert(latestInMem?.processed === 19, `task-progress 内存状态立即可见 (processed=${latestInMem?.processed})`);

  await flushTaskProgressPersist(taskId);
  const [dbRowAfterFlush] = await sql<Array<{ processed: number; stage: string; status: string }>>`
    SELECT processed, stage, status FROM public.task_progress WHERE task_id = ${taskId}
  `;
  assert(
    dbRowAfterFlush?.processed === 19 && dbRowAfterFlush?.status === "RUNNING",
    `task-progress flush 落库最新 processed=${dbRowAfterFlush?.processed}`
  );

  // stage 切换立即触发落库
  updateTaskProgress(taskId, TEMP_REGION_A, { stage: "EMBEDDING", processed: 19, percent: 80 });
  await new Promise((r) => setTimeout(r, 40));
  const [dbAfterStage] = await sql<Array<{ stage: string }>>`
    SELECT stage FROM public.task_progress WHERE task_id = ${taskId}
  `;
  assert(dbAfterStage?.stage === "EMBEDDING", `stage 切换立即落库 (${dbAfterStage?.stage})`);

  // 终态立即落库，且后续 RUNNING 写入不得覆盖 COMPLETED（RACE1: 内存与 getTaskProgress 直读均不回退）
  updateTaskProgress(taskId, TEMP_REGION_A, {
    status: "COMPLETED",
    stage: "COMPLETED",
    processed: 20,
    percent: 100,
  });
  await flushTaskProgressPersist(taskId);
  // 模拟延迟的 RUNNING 更新（先查内存保护，再清内存模拟跨进程/重启后迟到更新）
  updateTaskProgress(taskId, TEMP_REGION_A, { status: "RUNNING", stage: "CLUSTERING", percent: 50 });
  const directAfterRace1Mem = await getTaskProgress(taskId);
  clearTaskProgressStore();
  updateTaskProgress(taskId, TEMP_REGION_A, { status: "RUNNING", stage: "EXTRACTING", percent: 50 });
  const directAfterRace1Db = await getTaskProgress(taskId);
  await flushTaskProgressPersist(taskId);
  const [dbFinal] = await sql<Array<{ status: string; stage: string; percent: number }>>`
    SELECT status, stage, percent FROM public.task_progress WHERE task_id = ${taskId}
  `;
  assert(
    dbFinal?.status === "COMPLETED" &&
      dbFinal?.stage === "COMPLETED" &&
      dbFinal?.percent === 100 &&
      directAfterRace1Mem?.status === "COMPLETED" &&
      directAfterRace1Mem?.percent === 100 &&
      directAfterRace1Db?.status === "COMPLETED" &&
      directAfterRace1Db?.percent === 100,
    `RACE1 阻断延迟 RUNNING 覆盖 DB 与 getTaskProgress(taskId) (${directAfterRace1Mem?.status}/${directAfterRace1Db?.status})`
  );

  // pendingImmediate: initTaskProgress 后 1ms 立即切 stage=EMBEDDING，应在 ~150ms 内落库而不等待 1000ms
  const immTaskId = `task-imm-${SUFFIX}`;
  initTaskProgress(immTaskId, TEMP_REGION_A, 10);
  await new Promise((r) => setTimeout(r, 1));
  updateTaskProgress(immTaskId, TEMP_REGION_A, { stage: "EMBEDDING" });
  await new Promise((r) => setTimeout(r, 150));
  const [immDbRow] = await sql<Array<{ stage: string }>>`
    SELECT stage FROM public.task_progress WHERE task_id = ${immTaskId}
  `;
  assert(
    immDbRow?.stage === "EMBEDDING",
    `pendingImmediate 在 inFlight 写入期间保留 stage=EMBEDDING 并于 ~150ms 内立即落库 (${immDbRow?.stage})`
  );
  await flushTaskProgressPersist(immTaskId);
  await sql`DELETE FROM public.task_progress WHERE task_id = ${immTaskId}`;

  // 清掉前一个任务的 task_progress 记录，避免 registerController 异步初始快照干扰帧计数
  await sql`DELETE FROM public.task_progress WHERE task_id = ${taskId}`;
  clearTaskProgressStore();

  // SSE 节流 + 角色隔离 + 跨区独立
  const adminA = makeMockController();
  const userA = makeMockController();
  const adminB = makeMockController();
  const cleanAdminA = registerController(TEMP_REGION_A, adminA.controller, "admin");
  const cleanUserA = registerController(TEMP_REGION_A, userA.controller, "user");
  const cleanAdminB = registerController(TEMP_REGION_B, adminB.controller, "admin");

  // 等待 registerController 的异步初始快照检查完成
  await new Promise((r) => setTimeout(r, 80));
  const baseAdminACount = adminA.chunks.length;

  // 1) Leading edge 立即送达
  await broadcastTaskProgress(TEMP_REGION_A, { taskId, status: "RUNNING", percent: 10, processed: 1 });
  assert(
    adminA.chunks.length === baseAdminACount + 1 && userA.chunks.length === 0,
    `SSE leading-edge 立即送达 admin 且对 user 隔离`
  );

  // 2) 窗口内突发 10 帧合并为 1 帧尾帧
  for (let p = 2; p <= 11; p++) {
    await broadcastTaskProgress(TEMP_REGION_A, { taskId, status: "RUNNING", percent: p * 5, processed: p });
  }
  assert(
    adminA.chunks.length === baseAdminACount + 1,
    `SSE 250ms 窗口内突发帧被合并节流 (${adminA.chunks.length})`
  );

  // TEMP_REGION_B 不受 TEMP_REGION_A 节流影响
  await broadcastTaskProgress(TEMP_REGION_B, { taskId: `b-${SUFFIX}`, status: "RUNNING", percent: 15 });
  assert(adminB.chunks.some((c) => c.includes(`b-${SUFFIX}`)), `SSE 节流按 regionId 隔离`);

  await new Promise((r) => setTimeout(r, 320));
  assert(
    adminA.chunks.length === baseAdminACount + 2 && adminA.chunks[adminA.chunks.length - 1].includes(`"processed":11`),
    `SSE 尾部定时器补发最新帧 processed=11`
  );

  // 3) 终态立即强制刷新送达
  await broadcastTaskProgress(TEMP_REGION_A, {
    taskId,
    status: "COMPLETED",
    stage: "COMPLETED",
    percent: 100,
    processed: 20,
  });
  assert(
    adminA.chunks[adminA.chunks.length - 1].includes(`"status":"COMPLETED"`),
    `SSE 终态立即绕过节流送达`
  );

  broadcastDataRefresh(TEMP_REGION_A);
  assert(
    userA.chunks.some((c) => c.includes("civic-data-refresh")),
    `user 仅接收 civic-data-refresh，不接收 task-progress`
  );

  // RACE2: 背靠背并发 RUNNING -> COMPLETED 必须保证 COMPLETED 为最终送达帧（绝不出现 COMPLETED 后又出现 RUNNING）
  cleanAdminA();
  cleanUserA();
  cleanAdminB();
  _resetSseBroadcasterForTesting();
  clearTaskProgressStore();

  const race2Controller = makeMockController();
  const cleanRace2 = registerController(TEMP_REGION_A, race2Controller.controller, "admin");
  await new Promise((r) => setTimeout(r, 80));

  const race2DirectId = `task-race2-direct-${SUFFIX}`;
  const pRun = broadcastTaskProgress(TEMP_REGION_A, {
    taskId: race2DirectId,
    status: "RUNNING",
    stage: "EXTRACTING",
    processed: 1,
    percent: 10,
  });
  const pDone = broadcastTaskProgress(TEMP_REGION_A, {
    taskId: race2DirectId,
    status: "COMPLETED",
    stage: "COMPLETED",
    processed: 10,
    percent: 100,
  });
  await Promise.all([pRun, pDone]);

  const directFrames = race2Controller.chunks
    .map((chunk) => {
      try {
        return JSON.parse(chunk.replace(/^data:\s*/, "").trim());
      } catch {
        return null;
      }
    })
    .filter((m) => m?.type === "task-progress" && m?.taskProgress?.taskId === race2DirectId);
  const lastDirect = directFrames[directFrames.length - 1];
  const seenCompletedThenRunningDirect = directFrames.some(
    (m, idx) =>
      m.taskProgress.status === "COMPLETED" &&
      directFrames.slice(idx + 1).some((n) => n.taskProgress.status === "RUNNING")
  );
  assert(
    directFrames.length >= 1 &&
      lastDirect?.taskProgress?.status === "COMPLETED" &&
      !seenCompletedThenRunningDirect,
    `RACE2 (direct broadcastTaskProgress) 背靠背 RUNNING->COMPLETED 终态始终最后送达 (${directFrames.map((f) => f.taskProgress.status).join(" -> ")})`
  );

  const race2UpdateId = `task-race2-update-${SUFFIX}`;
  updateTaskProgress(race2UpdateId, TEMP_REGION_A, { status: "RUNNING", processed: 1, percent: 10 });
  updateTaskProgress(race2UpdateId, TEMP_REGION_A, {
    status: "COMPLETED",
    stage: "COMPLETED",
    processed: 10,
    percent: 100,
  });
  await new Promise((r) => setTimeout(r, 150));
  await flushTaskProgressPersist(race2UpdateId);

  const updateFrames = race2Controller.chunks
    .map((chunk) => {
      try {
        return JSON.parse(chunk.replace(/^data:\s*/, "").trim());
      } catch {
        return null;
      }
    })
    .filter((m) => m?.type === "task-progress" && m?.taskProgress?.taskId === race2UpdateId);
  const lastUpdate = updateFrames[updateFrames.length - 1];
  const seenCompletedThenRunningUpdate = updateFrames.some(
    (m, idx) =>
      m.taskProgress.status === "COMPLETED" &&
      updateFrames.slice(idx + 1).some((n) => n.taskProgress.status === "RUNNING")
  );
  assert(
    updateFrames.length >= 1 &&
      lastUpdate?.taskProgress?.status === "COMPLETED" &&
      !seenCompletedThenRunningUpdate,
    `RACE2 (updateTaskProgress) 背靠背 RUNNING->COMPLETED 终态始终最后送达 (${updateFrames.map((f) => f.taskProgress.status).join(" -> ")})`
  );

  cleanRace2();
  await sql`DELETE FROM public.task_progress WHERE task_id IN (${taskId}, ${race2UpdateId})`;
  clearTaskProgressStore();
  _resetSseBroadcasterForTesting();
}

async function main() {
  await assertBaselineUnchanged("前置");
  try {
    await registerRegion(sql, {
      id: TEMP_REGION_A,
      name: "M8测试区A",
      city: "测试市",
      schemaName: TEMP_SCHEMA_A,
    });
    await registerRegion(sql, {
      id: TEMP_REGION_B,
      name: "M8测试区B",
      city: "测试市",
      schemaName: TEMP_SCHEMA_B,
    });

    await testPublicOverviewCache();
    await testPipelineStateMergedAndLiveProgress();
    await testGraphUnionAndCache();
    await testPoolGovernanceAndRegionTtl();
    await testEmbeddingsAndCentroid();
    await testCivicPersistBatch();
    await testReviewSeedAndIngestBatch();
    await testTaskProgressAndSseThrottle();
  } finally {
    _resetSseBroadcasterForTesting();
    clearTaskProgressStore();
    await destroyRegionTenant(sql, TEMP_REGION_A).catch(() => {});
    await destroyRegionTenant(sql, TEMP_REGION_B).catch(() => {});
    for (const r of EXTRA_REGIONS) {
      await destroyRegionTenant(sql, r.id).catch(() => {});
      await sql.unsafe(`DROP SCHEMA IF EXISTS "${r.schemaName}" CASCADE;`).catch(() => {});
      await sql`DELETE FROM public.regions WHERE id = ${r.id}`.catch(() => {});
    }
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEMP_SCHEMA_A}" CASCADE;`).catch(() => {});
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEMP_SCHEMA_B}" CASCADE;`).catch(() => {});
    await sql`DELETE FROM public.regions WHERE id IN (${TEMP_REGION_A}, ${TEMP_REGION_B})`.catch(() => {});
    await sql`DELETE FROM public.task_progress WHERE task_id LIKE ${`%${SUFFIX}%`}`.catch(() => {});
    invalidateRegionCache();
    invalidateCivicAggregates();
    await assertBaselineUnchanged("清理后");
  }

  if (failed > 0) {
    console.error(`\n❌ M8 验收失败: ${failed} 项未通过`);
    process.exit(1);
  }
  console.log("\n✅ M8 性能优化与批量落库/SSE节流全量验收通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
