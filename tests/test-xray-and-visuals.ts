/**
 * 阶段 2 可视化与 X-Ray 透视演练端到端验收测试（Verifier 独立编写）
 *
 * 红线守卫：
 * 1. 所有演练与测试数据仅在独立临时租户 verify_xray_visuals (schema: region_verify_xray_visuals) 执行；
 * 2. 全程严禁触碰 region_gz_tianhe (103397 / 5748) 与 region_fs_shunde (135666 / 9222)；
 * 3. try/finally 保证测试结束后物理销毁临时租户与 schema，并再次核验基线零变动。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { sql, getRegionDb } from "../db/client";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import {
  aliasesTable,
  reviewQueueTable,
  themesTable,
  ticketThemesTable,
  ticketsTable,
} from "../db/schema";
import { POST as xrayPost } from "../app/api/sandbox/xray/route";
import { GET as graphGet } from "../app/api/graph/route";
import { GET as pipelineStateGet } from "../app/api/workbench/pipeline-state/route";
import { GET as cockpitGet } from "../app/api/cockpit/route";
import { loadCockpitSnapshot } from "../lib/cockpit-read";

const TEST_REGION_ID = "verify_xray_visuals";
const TEST_SCHEMA_NAME = "region_verify_xray_visuals";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
} as const;

let failedAssertions = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failedAssertions += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS ${message}`);
  }
}

async function readRegionCounts(schemaName: string): Promise<{ tickets: number; themes: number }> {
  const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".tickets`);
  const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".themes`);
  return {
    tickets: Number(tRow?.c ?? 0),
    themes: Number(thRow?.c ?? 0),
  };
}

async function assertBaselineUnchanged(stage: string) {
  const tianhe = await readRegionCounts(BASELINE.gz_tianhe.schema);
  const shunde = await readRegionCounts(BASELINE.fs_shunde.schema);
  assert(
    tianhe.tickets === BASELINE.gz_tianhe.tickets && tianhe.themes === BASELINE.gz_tianhe.themes,
    `[${stage}] gz_tianhe 基线零变动 (tickets=${tianhe.tickets}/${BASELINE.gz_tianhe.tickets}, themes=${tianhe.themes}/${BASELINE.gz_tianhe.themes})`
  );
  assert(
    shunde.tickets === BASELINE.fs_shunde.tickets && shunde.themes === BASELINE.fs_shunde.themes,
    `[${stage}] fs_shunde 基线零变动 (tickets=${shunde.tickets}/${BASELINE.fs_shunde.tickets}, themes=${shunde.themes}/${BASELINE.fs_shunde.themes})`
  );
}

function makeRequest(
  pathWithQuery: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string>; regionId?: string }
) {
  const regionId = init?.regionId ?? TEST_REGION_ID;
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = `http://civic.test${pathWithQuery}${sep}region=${encodeURIComponent(regionId)}`;
  const headers = new Headers({
    "x-region-id": regionId,
    ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(init?.headers ?? {}),
  });
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

function collectFiles(dir: string): string[] {
  const entries = readdirSync(dir);
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      files.push(...collectFiles(full));
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

async function cleanupTestTenant() {
  try {
    await destroyRegionTenant(sql, TEST_REGION_ID);
  } catch {
    // fallback below ensures complete cleanup
  }
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEST_SCHEMA_NAME}" CASCADE;`);
  await sql`DELETE FROM public.regions WHERE id = ${TEST_REGION_ID};`;
}

async function main() {
  await assertBaselineUnchanged("前置");
  await cleanupTestTenant();

  try {
    // 1. 创建独立临时验证租户
    await registerRegion(sql, {
      id: TEST_REGION_ID,
      name: "可视化验收临时区",
      city: "佛山市测试市",
      province: "广东省",
      schemaName: TEST_SCHEMA_NAME,
      isDefault: false,
      description: "Stage 2 X-Ray & visuals verification ephemeral tenant",
    });

    const { db: tenantDb, schemaName } = await getRegionDb(TEST_REGION_ID);
    assert(schemaName === TEST_SCHEMA_NAME, `临时租户绑定到独立 schema (${schemaName})`);

    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const t09 = new Date("2026-11-18T09:15:00+08:00");
    const t14 = new Date("2026-11-18T14:30:00+08:00");
    const t21 = new Date("2026-11-18T21:45:00+08:00");

    // 2. 注入测试别名、主题、工单与复核样本
    await tenantDb.insert(aliasesTable).values({
      id: "AL-X1",
      alias: "老菜市路口",
      canonical: "大良街道清晖东路",
      type: "LOCATION",
      source: "MANUAL",
      usageCount: 1,
    });

    await tenantDb.insert(themesTable).values([
      {
        id: "THEME-X1",
        title: "大良街道清晖东路 · 夜间烧烤油烟扰民",
        canonicalSubject: "清晖东路夜间烧烤排档",
        canonicalLocation: "大良街道清晖东路",
        eventType: "油烟扰民",
        category: "生态环境",
        riskLevel: "HIGH",
        riskReason: "办结后再次回潮",
        ticketCount: 2,
        timeSpanHours: 5,
        aiSummary: "清晖东路夜间烧烤排档油烟直排扰民。",
        recommendedAction: "牵头部门：区生态环境分局；响应时限：24小时内核查",
        patternType: "REPEAT",
        civicMode: "repeat",
        aiConfidence: 91,
        firstAt: t09,
        lastAt: t14,
        handlingStatus: "RESOLVED",
        handlingProgress: 100,
        handlingOwner: "区生态环境分局",
        handlingEta: oneDayAgo,
      },
      {
        id: "THEME-X2",
        title: "大良街道金榜上街 · 占道违停",
        canonicalSubject: "金榜上街占道车辆",
        canonicalLocation: "大良街道金榜上街",
        eventType: "占道违停",
        category: "交通出行",
        riskLevel: "MEDIUM",
        ticketCount: 1,
        timeSpanHours: 1,
        handlingStatus: "IN_PROGRESS",
        handlingProgress: 40,
      },
      {
        id: "THEME-X3",
        title: "容桂街道天佑城 · 施工噪音",
        canonicalSubject: "天佑城施工项目",
        canonicalLocation: "容桂街道天佑城",
        eventType: "施工噪音",
        category: "生态环境",
        riskLevel: "LOW",
        ticketCount: 0,
        timeSpanHours: 1,
        handlingStatus: "PENDING",
        handlingProgress: 0,
      },
    ]);

    await tenantDb.insert(ticketsTable).values([
      {
        id: "TK-X1",
        ticketNo: "X-2026-0001",
        title: "老菜市路口夜宵油烟大",
        summarizeTitle: "清晖东路烧烤油烟扰民",
        content: "大良街道清晖东路夜宵烧烤摊油烟直排，楼上居民不敢开窗。",
        maskedContent: "大良街道清晖东路夜宵烧烤摊油烟直排，楼上居民不敢开窗。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "生态环境",
        urgency: "NORMAL",
        canonicalSubject: "清晖东路夜间烧烤排档",
        eventType: "油烟扰民",
        address: "大良街道清晖东路12号",
        confidence: 90,
        primaryThemeId: "THEME-X1",
        status: "RESOLVED",
        closedAt: oneDayAgo,
        closureStatus: "RESOLVED",
        isFakeClosure: false,
        createTime: t09,
      },
      {
        id: "TK-X2",
        ticketNo: "X-2026-0002",
        title: "清晖东路烧烤油烟再次复发",
        summarizeTitle: "清晖东路烧烤油烟复发回潮",
        content: "大良街道清晖东路夜宵烧烤摊昨晚又开始油烟直排。",
        maskedContent: "大良街道清晖东路夜宵烧烤摊昨晚又开始油烟直排。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "生态环境",
        urgency: "URGENT",
        canonicalSubject: "清晖东路夜间烧烤排档",
        eventType: "油烟扰民",
        address: "大良街道清晖东路15号",
        confidence: 92,
        primaryThemeId: "THEME-X1",
        status: "RESOLVED",
        closedAt: oneDayAgo,
        closureStatus: "REOPENED",
        isFakeClosure: true,
        createTime: t14,
      },
      {
        id: "TK-X3",
        ticketNo: "X-2026-0003",
        title: "金榜上街厢式货车违停",
        summarizeTitle: "金榜上街货车夜间占道",
        content: "金榜上街口货车占道违停影响出行。",
        maskedContent: "金榜上街口货车占道违停影响出行。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "交通出行",
        urgency: "NORMAL",
        canonicalSubject: "金榜上街占道车辆",
        eventType: "占道违停",
        address: "大良街道金榜上街",
        confidence: 88,
        primaryThemeId: null,
        status: "IN_PROGRESS",
        isFakeClosure: false,
        createTime: t21,
      },
    ]);

    await tenantDb.insert(ticketThemesTable).values([
      { ticketId: "TK-X1", themeId: "THEME-X1" },
      { ticketId: "TK-X2", themeId: "THEME-X1" },
    ]);

    await tenantDb.insert(reviewQueueTable).values({
      id: "REV-X1",
      ticketId: "TK-X3",
      confidence: 62,
      reason: "LOW_CONFIDENCE",
      status: "PENDING",
    });

    // 3. 校验 POST /api/sandbox/xray (persist: false) 全 6 阶段与零写入
    const countsBeforeXray = await readRegionCounts(TEST_SCHEMA_NAME);
    const xrayRes = await xrayPost(
      makeRequest("/api/sandbox/xray", {
        method: "POST",
        body: {
          title: "老菜市路口烧烤油烟再次直排",
          subdistrict: "大良街道",
          content: "老菜市路口昨晚夜宵烧烤油烟直排，市民李先生（13800138000）再次反映未整改。",
          regionId: TEST_REGION_ID,
          persist: false,
        },
      })
    );
    const xrayJson = await xrayRes.json();
    const countsAfterXray = await readRegionCounts(TEST_SCHEMA_NAME);

    assert(xrayRes.status === 200 && xrayJson.success === true, "POST /api/sandbox/xray 返回 200 且 success=true");
    assert(xrayJson.persist === false, "X-Ray 返回 persist=false");
    assert(
      countsBeforeXray.tickets === countsAfterXray.tickets &&
        countsBeforeXray.themes === countsAfterXray.themes,
      `POST /api/sandbox/xray (persist: false) 调用前后租户计数严格零写入 (tickets=${countsBeforeXray.tickets}->${countsAfterXray.tickets})`
    );
    assert(
      typeof xrayJson.step1_anonymize?.maskedText === "string" &&
        !xrayJson.step1_anonymize.maskedText.includes("13800138000") &&
        Array.isArray(xrayJson.step1_anonymize?.entities) &&
        xrayJson.step1_anonymize.entities.length >= 1 &&
        Number(xrayJson.step1_anonymize?.durationUs) > 0,
      "step1_anonymize 真实脱敏手机号并返回 entities 与 durationUs"
    );
    assert(
      Boolean(xrayJson.step2_systemOne?.intent) &&
        Boolean(xrayJson.step2_systemOne?.category) &&
        typeof xrayJson.step2_systemOne?.stabilityRisk === "boolean" &&
        Number(xrayJson.step2_systemOne?.durationMs) > 0,
      "step2_systemOne 返回四头决策、adapter 与 durationMs"
    );
    assert(
      Array.isArray(xrayJson.step3_vocab?.aliasHits) &&
        xrayJson.step3_vocab.aliasHits.some((h: { alias: string }) => h.alias === "老菜市路口") &&
        Number(xrayJson.step3_vocab?.durationMs) > 0,
      "step3_vocab 真实命中别名映射 (老菜市路口) 与 durationMs"
    );
    assert(
      Boolean(xrayJson.step4_systemTwo?.summarizeTitle) &&
        Boolean(xrayJson.step4_systemTwo?.eventType) &&
        Boolean(xrayJson.step4_systemTwo?.backend) &&
        Number(xrayJson.step4_systemTwo?.durationMs) > 0,
      `step4_systemTwo 返回结构化抽取与执行后端 (${xrayJson.step4_systemTwo?.backend})`
    );
    assert(
      Array.isArray(xrayJson.step5_clusterMatch?.similarTickets) &&
        typeof xrayJson.step5_clusterMatch?.willTriggerFakeClosure === "boolean" &&
        typeof xrayJson.step5_clusterMatch?.threshold === "number" &&
        Number(xrayJson.step5_clusterMatch?.durationMs) > 0,
      "step5_clusterMatch 返回相似工单、阈值与假闭环探测结果"
    );
    assert(
      Boolean(xrayJson.step6_restoreAndAdvice?.recommendedAction) &&
        Boolean(xrayJson.step6_restoreAndAdvice?.leadDepartment) &&
        Boolean(xrayJson.step6_restoreAndAdvice?.slaHint) &&
        !xrayJson.step6_restoreAndAdvice?.persistedTicketNo,
      "step6_restoreAndAdvice 返回还原建议且未写入工单"
    );

    // 4. 校验 GET /api/graph?themeId=THEME-X1 与全局图谱
    const themeGraphRes = await graphGet(makeRequest("/api/graph?themeId=THEME-X1"));
    const themeGraphJson = await themeGraphRes.json();
    const gNodes = (themeGraphJson.data?.nodes || []) as Array<{ id: string; type: string; isFakeClosure?: boolean }>;
    const gLinks = (themeGraphJson.data?.links || []) as Array<{ source: string; target: string; relation: string; isFakeClosure?: boolean }>;
    assert(
      themeGraphRes.status === 200 &&
        gNodes.some((n) => n.id === "THEME-X1" && n.type === "THEME") &&
        gNodes.some((n) => n.type === "SUBJECT") &&
        gNodes.some((n) => n.type === "LOCATION") &&
        gNodes.filter((n) => n.type === "TICKET").length === 2 &&
        gNodes.some((n) => n.id === "TK-X2" && n.isFakeClosure === true) &&
        gLinks.some((l) => l.source === "TK-X2" && l.isFakeClosure === true),
      `GET /api/graph?themeId=THEME-X1 返回主题/主体/地点/工单节点与假闭环连边 (nodes=${gNodes.length}, links=${gLinks.length})`
    );

    const globalGraphRes = await graphGet(makeRequest("/api/graph"));
    const globalGraphJson = await globalGraphRes.json();
    assert(
      globalGraphRes.status === 200 && (globalGraphJson.data?.nodes || []).length >= 3,
      "GET /api/graph 不传 themeId 保持全局图谱兼容"
    );

    // 5. 校验 GET /api/workbench/pipeline-state 返回 disposalMetrics
    const pipeRes = await pipelineStateGet(makeRequest("/api/workbench/pipeline-state"));
    const pipeJson = await pipeRes.json();
    const dm = pipeJson.data?.disposalMetrics;
    assert(
      pipeRes.status === 200 &&
        dm &&
        dm.pendingThemes === 1 &&
        dm.inProgressThemes === 1 &&
        dm.resolvedThemes === 1 &&
        dm.fakeClosureTickets === 1 &&
        dm.pendingReviewCount === 1,
      `GET /api/workbench/pipeline-state 返回真实 disposalMetrics (${JSON.stringify(dm)})`
    );

    // 6. 校验 /api/cockpit 与 loadCockpitSnapshot 返回 closureFunnel 与 24 桶 hourlyDistribution
    const cockpitRes = await cockpitGet(makeRequest("/api/cockpit"));
    const cockpitJson = await cockpitRes.json();
    const snap = await loadCockpitSnapshot(TEST_REGION_ID);
    const funnel = cockpitJson.closureFunnel;
    const hours = cockpitJson.hourlyDistribution as Array<{ hour: number; label: string; count: number }>;

    assert(
      cockpitRes.status === 200 &&
        funnel &&
        funnel.total === 3 &&
        funnel.analyzed === 3 &&
        funnel.clustered === 2 &&
        funnel.dispatched === 3 &&
        funnel.resolved === 2 &&
        funnel.fakeClosureIntercepted === 1 &&
        snap.closureFunnel.total === 3,
      `GET /api/cockpit 返回真实 closureFunnel (${JSON.stringify(funnel)})`
    );
    const hourSum = Array.isArray(hours) ? hours.reduce((s, h) => s + Number(h.count || 0), 0) : -1;
    assert(
      Array.isArray(hours) &&
        hours.length === 24 &&
        hours[0]?.hour === 0 &&
        hours[23]?.hour === 23 &&
        hours[9]?.count === 1 &&
        hours[14]?.count === 1 &&
        hours[21]?.count === 1 &&
        hourSum === 3,
      `GET /api/cockpit 返回 24 个时段桶且上海时区聚合正确 (sum=${hourSum})`
    );

    // 7. 静态扫描：app/ 下不存在 /spatial 死链，且 /sandbox 页面文件存在
    const appDir = path.resolve(process.cwd(), "app");
    const appFiles = collectFiles(appDir);
    const spatialHits: string[] = [];
    for (const file of appFiles) {
      const content = readFileSync(file, "utf8");
      if (content.includes("/spatial")) {
        spatialHits.push(path.relative(process.cwd(), file));
      }
    }
    assert(spatialHits.length === 0, `静态扫描 app/ 无 /spatial 死链 (hits=${spatialHits.length})`);
    const sandboxExists = appFiles.some((f) => f.endsWith(path.join("app", "sandbox", "page.tsx")));
    const disposalNodeExists = appFiles.some((f) =>
      f.endsWith(path.join("app", "workbench", "_components", "nodes", "disposal-node.tsx"))
    );
    assert(sandboxExists && disposalNodeExists, "存在 app/sandbox/page.tsx 与 disposal-node.tsx");
  } finally {
    await cleanupTestTenant();
    await assertBaselineUnchanged("清理后");
  }

  if (failedAssertions > 0) {
    console.error(`\n❌ 阶段 2 验收失败: ${failedAssertions} 项断言未通过`);
    process.exit(1);
  }
  console.log("\n✅ tests/test-xray-and-visuals.ts 全项端到端验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
