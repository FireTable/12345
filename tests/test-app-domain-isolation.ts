/**
 * APP_DOMAIN 业务域物理隔离开关端到端验证（纯只读 + 基线零变动守卫）
 *
 * 覆盖三种运行模式：
 * 1. 未设置 APP_DOMAIN（默认）与显式 APP_DOMAIN=GOV_12345：12345 主站彻底隐藏电商入口与越权回退
 * 2. APP_DOMAIN=ECOMMERCE_CS：独立电商客诉站点，仅暴露 ecom_demo，默认即切入电商口径
 * 3. APP_DOMAIN=ALL：多业务域联合调试模式，同时可见 3 个租户
 */

import { NextRequest } from "next/server";
import { withAuthHeaders } from "./_auth-helper";
import { sql } from "../db/client";
import { GET as regionsGet } from "../app/api/regions/route";
import { GET as adminRegionsGet } from "../app/api/admin/regions/route";
import { GET as adminRegionDetailGet } from "../app/api/admin/regions/[id]/route";
import { GET as publicOverviewGet } from "../app/api/public/overview/route";
import { POST as xrayPost } from "../app/api/sandbox/xray/route";
import { resolveRequestRegionId } from "../lib/tenant/request-region";
import { callMcpTool } from "../lib/mcp/tools";
import { getAppDomainMode } from "../lib/app-domain";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
  ecom_demo: { schema: "region_ecom_demo", tickets: 3240, themes: 40 },
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

async function readRegionCounts(schemaName: string) {
  const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".tickets`);
  const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".themes`);
  return { tickets: Number(tRow?.c ?? 0), themes: Number(thRow?.c ?? 0) };
}

async function assertBaselineUnchanged(stage: string) {
  for (const [id, expected] of Object.entries(BASELINE)) {
    const actual = await readRegionCounts(expected.schema);
    assert(
      actual.tickets === expected.tickets && actual.themes === expected.themes,
      `[${stage}] ${id} 基线零变动 (tickets=${actual.tickets}/${expected.tickets}, themes=${actual.themes}/${expected.themes})`
    );
  }
}

async function makeRequest(
  pathWithQuery: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string>; regionId?: string }
) {
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = init?.regionId
    ? `http://localhost:3000${pathWithQuery}${sep}region=${encodeURIComponent(init.regionId)}`
    : `http://localhost:3000${pathWithQuery}`;
  const headers = await withAuthHeaders(
    {
      ...(init?.regionId ? { "x-region-id": init.regionId } : {}),
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
      ...(init?.headers ?? {}),
    },
    "admin"
  );
  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function verifyGovOnlyMode(label: string) {
  assert(getAppDomainMode() === "GOV_12345", `[${label}] getAppDomainMode() === GOV_12345`);

  const regionsRes = await regionsGet();
  const regionsJson = await regionsRes.json();
  const ids = (regionsJson.regions || []).map((r: { id: string }) => r.id);
  assert(
    regionsRes.status === 200 &&
      regionsJson.appDomain === "GOV_12345" &&
      regionsJson.defaultRegionId === "gz_tianhe" &&
      ids.includes("gz_tianhe") &&
      ids.includes("fs_shunde") &&
      !ids.includes("ecom_demo"),
    `[${label}] GET /api/regions 仅含政务站点 (${ids.join(",")}), defaultRegionId=${regionsJson.defaultRegionId}`
  );

  const adminRes = await adminRegionsGet(await makeRequest("/api/admin/regions"));
  const adminJson = await adminRes.json();
  const adminIds = (adminJson.regions || []).map((r: { id: string }) => r.id);
  assert(
    adminRes.status === 200 &&
      adminJson.appDomain === "GOV_12345" &&
      adminIds.includes("gz_tianhe") &&
      adminIds.includes("fs_shunde") &&
      !adminIds.includes("ecom_demo"),
    `[${label}] GET /api/admin/regions 彻底隐藏 ecom_demo (${adminIds.join(",")})`
  );

  const ecomDetailRes = await adminRegionDetailGet(
    await makeRequest("/api/admin/regions/ecom_demo"),
    { params: Promise.resolve({ id: "ecom_demo" }) }
  );
  assert(
    ecomDetailRes.status === 404,
    `[${label}] GET /api/admin/regions/ecom_demo 返回 404 (${ecomDetailRes.status})`
  );

  const resolvedQuery = await resolveRequestRegionId(
    await makeRequest("/api/overview", { regionId: "ecom_demo" })
  );
  const resolvedExplicit = await resolveRequestRegionId(null, "ecom_demo");
  const resolvedCookie = await resolveRequestRegionId(
    await makeRequest("/api/overview", { headers: { "x-region-id": "ecom_demo" } })
  );
  assert(
    resolvedQuery === "gz_tianhe" &&
      resolvedExplicit === "gz_tianhe" &&
      resolvedCookie === "gz_tianhe",
    `[${label}] resolveRequestRegionId 阻断 ecom_demo 并回退 gz_tianhe (${resolvedQuery}/${resolvedExplicit}/${resolvedCookie})`
  );

  const xrayRes = await xrayPost(
    await makeRequest("/api/sandbox/xray", {
      method: "POST",
      regionId: "ecom_demo",
      body: {
        regionId: "ecom_demo",
        persist: false,
        title: "华南冷链仓物流测试",
        content: "收到货发臭化冻，测试在 GOV_12345 主站是否被隔离到天河域。",
      },
    })
  );
  const xrayJson = await xrayRes.json();
  assert(
    xrayRes.status === 200 && xrayJson.domainType === "GOV_12345",
    `[${label}] POST /api/sandbox/xray 带 ecom_demo 参数被安全隔离回 GOV_12345 (${xrayJson.domainType})`
  );

  const pubRes = await publicOverviewGet(await makeRequest("/api/public/overview"));
  const pubJson = await pubRes.json();
  assert(
    pubRes.status === 200 && pubJson.totalWorkorders === BASELINE.gz_tianhe.tickets,
    `[${label}] GET /api/public/overview 返回天河总量 (${pubJson.totalWorkorders})`
  );

  const mcpListRaw = await callMcpTool("list_regions", {});
  const mcpList = JSON.parse(mcpListRaw.content[0].text) as Array<{ id: string }>;
  const mcpEcomOverview = await callMcpTool("region_overview", { regionId: "ecom_demo" });
  assert(
    !mcpList.some((r) => r.id === "ecom_demo") && mcpEcomOverview.isError === true,
    `[${label}] MCP list_regions 隐藏 ecom_demo 且 region_overview(ecom_demo) 拒绝访问`
  );
}

async function verifyEcommerceOnlyMode() {
  assert(getAppDomainMode() === "ECOMMERCE_CS", "[ECOMMERCE_CS] getAppDomainMode() === ECOMMERCE_CS");

  const regionsRes = await regionsGet();
  const regionsJson = await regionsRes.json();
  const ids = (regionsJson.regions || []).map((r: { id: string }) => r.id);
  assert(
    regionsRes.status === 200 &&
      regionsJson.appDomain === "ECOMMERCE_CS" &&
      regionsJson.defaultRegionId === "ecom_demo" &&
      ids.length === 1 &&
      ids[0] === "ecom_demo",
    `[ECOMMERCE_CS] GET /api/regions 仅暴露 ecom_demo, defaultRegionId=${regionsJson.defaultRegionId}`
  );

  const adminRes = await adminRegionsGet(await makeRequest("/api/admin/regions"));
  const adminJson = await adminRes.json();
  const adminIds = (adminJson.regions || []).map((r: { id: string }) => r.id);
  assert(
    adminRes.status === 200 &&
      adminJson.appDomain === "ECOMMERCE_CS" &&
      adminIds.length === 1 &&
      adminIds[0] === "ecom_demo",
    `[ECOMMERCE_CS] GET /api/admin/regions 仅含 ecom_demo (${adminIds.join(",")})`
  );

  const govDetailRes = await adminRegionDetailGet(
    await makeRequest("/api/admin/regions/gz_tianhe"),
    { params: Promise.resolve({ id: "gz_tianhe" }) }
  );
  assert(
    govDetailRes.status === 404,
    `[ECOMMERCE_CS] GET /api/admin/regions/gz_tianhe 返回 404 (${govDetailRes.status})`
  );

  const resolvedGov = await resolveRequestRegionId(
    await makeRequest("/api/overview", { regionId: "gz_tianhe" })
  );
  const resolvedDefault = await resolveRequestRegionId(await makeRequest("/api/overview"));
  assert(
    resolvedGov === "ecom_demo" && resolvedDefault === "ecom_demo",
    `[ECOMMERCE_CS] resolveRequestRegionId 阻断 gz_tianhe 并默认回退 ecom_demo (${resolvedGov}/${resolvedDefault})`
  );

  const pubRes = await publicOverviewGet(await makeRequest("/api/public/overview"));
  const pubJson = await pubRes.json();
  assert(
    pubRes.status === 200 && pubJson.totalWorkorders === BASELINE.ecom_demo.tickets,
    `[ECOMMERCE_CS] GET /api/public/overview 返回电商总量 (${pubJson.totalWorkorders})`
  );

  const xrayRes = await xrayPost(
    await makeRequest("/api/sandbox/xray", {
      method: "POST",
      body: {
        persist: false,
        title: "华南冷链仓 SKU-GD2026-881 化冻发臭",
        subdistrict: "华南冷链仓",
        content: "收到的礼盒全部化冻发酸，要求赔付，否则打 12315 举报。",
      },
    })
  );
  const xrayJson = await xrayRes.json();
  assert(
    xrayRes.status === 200 && xrayJson.domainType === "ECOMMERCE_CS",
    `[ECOMMERCE_CS] POST /api/sandbox/xray 不传 regionId 自动路由到 ECOMMERCE_CS (${xrayJson.domainType})`
  );

  const mcpListRaw = await callMcpTool("list_regions", {});
  const mcpList = JSON.parse(mcpListRaw.content[0].text) as Array<{ id: string }>;
  assert(
    mcpList.length === 1 && mcpList[0].id === "ecom_demo",
    `[ECOMMERCE_CS] MCP list_regions 仅返回 ecom_demo (${mcpList.map((r) => r.id).join(",")})`
  );
}

async function verifyAllMode() {
  assert(getAppDomainMode() === "ALL", "[ALL] getAppDomainMode() === ALL");

  const regionsRes = await regionsGet();
  const regionsJson = await regionsRes.json();
  const ids = (regionsJson.regions || []).map((r: { id: string }) => r.id);
  assert(
    regionsRes.status === 200 &&
      regionsJson.appDomain === "ALL" &&
      regionsJson.defaultRegionId === "gz_tianhe" &&
      ids.includes("gz_tianhe") &&
      ids.includes("fs_shunde") &&
      ids.includes("ecom_demo"),
    `[ALL] GET /api/regions 全部 3 站点可见 (${ids.join(",")})`
  );

  const resolvedEcom = await resolveRequestRegionId(
    await makeRequest("/api/overview", { regionId: "ecom_demo" })
  );
  const resolvedGov = await resolveRequestRegionId(
    await makeRequest("/api/overview", { regionId: "gz_tianhe" })
  );
  assert(
    resolvedEcom === "ecom_demo" && resolvedGov === "gz_tianhe",
    `[ALL] resolveRequestRegionId 可自由路由双域 (${resolvedEcom} / ${resolvedGov})`
  );
}

async function main() {
  const prevAppDomain = process.env.APP_DOMAIN;
  await assertBaselineUnchanged("前置");

  try {
    delete process.env.APP_DOMAIN;
    await verifyGovOnlyMode("默认未设置");

    process.env.APP_DOMAIN = "GOV_12345";
    await verifyGovOnlyMode("显式 GOV_12345");

    process.env.APP_DOMAIN = "ECOMMERCE_CS";
    await verifyEcommerceOnlyMode();

    process.env.APP_DOMAIN = "ALL";
    await verifyAllMode();
  } finally {
    if (prevAppDomain === undefined) {
      delete process.env.APP_DOMAIN;
    } else {
      process.env.APP_DOMAIN = prevAppDomain;
    }
    await assertBaselineUnchanged("清理后");
  }

  if (failedAssertions > 0) {
    console.error(`\n❌ APP_DOMAIN 域隔离验收失败: ${failedAssertions} 项未通过`);
    process.exit(1);
  }
  console.log("\n✅ APP_DOMAIN 业务域隔离开关全模式验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
