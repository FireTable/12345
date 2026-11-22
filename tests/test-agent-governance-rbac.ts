/**
 * Wave 3 全栈 RBAC + 主动治理 Agent + 市民受理闭环验收测试（Verifier 独立编写）
 *
 * 红线守卫：
 * 1. 仅使用独立临时 Schema `verify_rbac_gov` 与 `verify_rbac_ecom`，并在 try/finally 物理销毁；
 * 2. 清理所有测试写入 `public.citizen_submissions` 的临时记录；
 * 3. 全程不触碰基线数据：region_gz_tianhe (103,397/5,748)、region_fs_shunde (135,666/9,222)、region_ecom_demo (3,240/40)。
 */

import { NextRequest } from "next/server";
import { and, desc, eq } from "drizzle-orm";
import { withAuthHeaders, type TestUserRole } from "./_auth-helper";
import { sql, getRegionDb } from "../db/client";
import {
  disposalLogsTable,
  themesTable,
  ticketThemesTable,
  ticketsTable,
  vocabulariesTable,
} from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { ECOMMERCE_CS_PROFILE, GOV_12345_PROFILE } from "../lib/domain-profile";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import { invalidateAgentGovernanceCache } from "../lib/agent-governance";
import { checkAgentRateLimit } from "../lib/security/agent-guard";

import { POST as copilotPost } from "../app/api/copilot/route";
import { POST as xrayPost } from "../app/api/sandbox/xray/route";
import { POST as patrolPost } from "../app/api/agent/patrol/route";
import { GET as agentTasksGet } from "../app/api/agent/tasks/route";
import { PATCH as agentTaskPatch } from "../app/api/agent/tasks/[id]/route";
import { POST as voiceTurnPost } from "../app/api/agent/outreach/voice-turn/route";
import { GET as agentReportGet, POST as agentReportPost } from "../app/api/agent/report/route";
import { GET as intakeOptionsGet } from "../app/api/intake/options/route";
import { POST as intakeChatPost } from "../app/api/intake/chat/route";
import { POST as intakeSubmitPost } from "../app/api/intake/submit/route";
import { GET as myTicketsGet } from "../app/api/intake/my-tickets/route";
import { POST as myTicketReopenPost } from "../app/api/intake/my-tickets/[id]/reopen/route";
import { PATCH as clusterPatch } from "../app/api/clusters/[id]/route";
import { PATCH as workorderPatch } from "../app/api/workorders/[id]/route";
import { GET as reviewGet, POST as reviewPost } from "../app/api/review/route";
import { GET as adminRegionsGet } from "../app/api/admin/regions/route";
import { GET as overviewGet } from "../app/api/overview/route";

const GOV_REGION_ID = "verify_rbac_gov";
const ECOM_REGION_ID = "verify_rbac_ecom";

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
  ecom_demo: { schema: "region_ecom_demo", tickets: 3240, themes: 40 },
} as const;

let passedAssertions = 0;
let failedAssertions = 0;

function assert(cond: unknown, message: string) {
  if (!cond) {
    failedAssertions += 1;
    console.error(`FAIL ${message}`);
    process.exitCode = 1;
  } else {
    passedAssertions += 1;
    console.log(`PASS ${message}`);
  }
}

async function readRegionCounts(schemaName: string) {
  const [tRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".tickets`);
  const [thRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".themes`);
  return {
    tickets: Number(tRow?.c ?? 0),
    themes: Number(thRow?.c ?? 0),
  };
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

async function makeReq(
  pathWithQuery: string,
  init?: {
    method?: string;
    body?: unknown;
    headers?: Record<string, string>;
    role?: TestUserRole | "anon";
    regionId?: string;
  }
) {
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = init?.regionId
    ? `http://localhost:3000${pathWithQuery}${sep}region=${encodeURIComponent(init.regionId)}`
    : `http://localhost:3000${pathWithQuery}`;

  const baseHeaders: Record<string, string> = {
    host: "localhost:3000",
    ...(init?.regionId ? { "x-region-id": init.regionId } : {}),
    ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(init?.headers ?? {}),
  };

  let headers: Headers;
  if (init?.role === "anon") {
    headers = new Headers(baseHeaders);
  } else {
    headers = await withAuthHeaders(baseHeaders, init?.role ?? "admin");
  }

  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function cleanupTempArtifacts() {
  for (const id of [GOV_REGION_ID, ECOM_REGION_ID]) {
    try {
      await destroyRegionTenant(sql, id);
    } catch {
      // fallback below ensures complete drop
    }
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${id}" CASCADE;`);
    await sql`DELETE FROM public.regions WHERE id = ${id};`;
    invalidateAgentGovernanceCache(id);
    invalidateCivicAggregates(id);
  }

  const [{ reg }] = await sql<Array<{ reg: string | null }>>`
    SELECT to_regclass('public.citizen_submissions')::text AS reg
  `;
  if (reg) {
    await sql`
      DELETE FROM public.citizen_submissions
      WHERE region_id IN (${GOV_REGION_ID}, ${ECOM_REGION_ID});
    `;
  }
}

async function setupEphemeralTenants() {
  await registerRegion(sql, {
    id: GOV_REGION_ID,
    name: "验收临时政务区",
    city: "广州市",
    province: "广东省",
    schemaName: GOV_REGION_ID,
    isDefault: false,
    categoryConfigJson: JSON.stringify({ domainProfile: GOV_12345_PROFILE }),
    description: "Wave 3 RBAC & Agent verification ephemeral GOV tenant",
  });

  await registerRegion(sql, {
    id: ECOM_REGION_ID,
    name: "验收临时电商售后中心",
    city: "全国全渠道",
    province: "全域电商",
    schemaName: ECOM_REGION_ID,
    isDefault: false,
    categoryConfigJson: JSON.stringify({ domainProfile: ECOMMERCE_CS_PROFILE }),
    description: "Wave 3 RBAC & Agent verification ephemeral ECOM tenant",
  });

  const { db: govDb } = await getRegionDb(GOV_REGION_ID);
  await govDb.insert(vocabulariesTable).values([
    {
      id: "voc-gov-t1",
      type: "TOWNSHIP",
      name: "天河南",
      fullName: "天河南街道",
      isStandard: true,
    },
    {
      id: "voc-gov-t2",
      type: "TOWNSHIP",
      name: "猎德",
      fullName: "猎德街道",
      isStandard: true,
    },
  ]);
}

async function verifyUnauthenticated401() {
  const cases: Array<{ name: string; call: () => Promise<Response> }> = [
    {
      name: "POST /api/copilot",
      call: () => copilotPost(new NextRequest("http://localhost:3000/api/copilot", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ prompt: "test" }),
      })),
    },
    {
      name: "POST /api/sandbox/xray",
      call: () => xrayPost(new NextRequest("http://localhost:3000/api/sandbox/xray", {
        method: "POST",
        headers: { host: "localhost:3000", "content-type": "application/json" },
        body: JSON.stringify({ content: "test" }),
      })),
    },
    {
      name: "POST /api/agent/patrol",
      call: async () => patrolPost(await makeReq("/api/agent/patrol", { method: "POST", role: "anon", body: {} })),
    },
    {
      name: "GET /api/agent/tasks",
      call: async () => agentTasksGet(await makeReq("/api/agent/tasks", { role: "anon" })),
    },
    {
      name: "GET /api/intake/options",
      call: async () => intakeOptionsGet(await makeReq("/api/intake/options", { role: "anon" })),
    },
    {
      name: "POST /api/intake/chat",
      call: async () => intakeChatPost(await makeReq("/api/intake/chat", {
        method: "POST",
        role: "anon",
        body: { messages: [{ role: "user", content: "测试" }] },
      })),
    },
    {
      name: "POST /api/intake/submit",
      call: async () => intakeSubmitPost(await makeReq("/api/intake/submit", {
        method: "POST",
        role: "anon",
        body: { content: "测试工单内容不少于六个字", subdistrict: "天河南街道", category: "城市管理" },
      })),
    },
    {
      name: "GET /api/intake/my-tickets",
      call: async () => myTicketsGet(await makeReq("/api/intake/my-tickets", { role: "anon" })),
    },
  ];

  for (const c of cases) {
    const res = await c.call();
    assert(res.status === 401, `[1.未登录401] ${c.name} 返回 ${res.status}`);
  }
}

async function verifyHostOrigin403() {
  const evilOriginAdmin = await makeReq("/api/agent/tasks", {
    role: "admin",
    regionId: GOV_REGION_ID,
    headers: { origin: "https://evil.example" },
  });
  assert((await agentTasksGet(evilOriginAdmin)).status === 403, "[2.Origin校验] origin=https://evil.example 调 /api/agent/tasks 返回 403");

  const nullOriginAdmin = await makeReq("/api/agent/patrol", {
    method: "POST",
    role: "admin",
    regionId: GOV_REGION_ID,
    body: {},
    headers: { origin: "null" },
  });
  assert((await patrolPost(nullOriginAdmin)).status === 403, "[2.Origin校验] origin=null 调 /api/agent/patrol 返回 403");

  const evilHostAdmin = await makeReq("/api/copilot", {
    method: "POST",
    role: "admin",
    regionId: GOV_REGION_ID,
    body: { prompt: "test" },
    headers: { host: "evil.example:3000" },
  });
  assert((await copilotPost(evilHostAdmin)).status === 403, "[2.Host校验] host=evil.example:3000 调 /api/copilot 返回 403");

  const evilOriginCitizen = await makeReq("/api/intake/chat", {
    method: "POST",
    role: "user",
    regionId: GOV_REGION_ID,
    body: { messages: [{ role: "user", content: "测试" }] },
    headers: { origin: "https://evil.example" },
  });
  assert((await intakeChatPost(evilOriginCitizen)).status === 403, "[2.Origin校验] origin=https://evil.example 调 /api/intake/chat 返回 403");
}

async function verifyCitizenRbac403() {
  const idCtx = { params: Promise.resolve({ id: "NON_EXISTENT_ID" }) };
  const checks: Array<{ name: string; call: () => Promise<Response> }> = [
    {
      name: "PATCH /api/clusters/[id]",
      call: async () => clusterPatch(await makeReq("/api/clusters/NON_EXISTENT_ID", {
        method: "PATCH",
        role: "user",
        regionId: GOV_REGION_ID,
        body: { action: "DISPATCH" },
      }), idCtx),
    },
    {
      name: "PATCH /api/workorders/[id]",
      call: async () => workorderPatch(await makeReq("/api/workorders/NON_EXISTENT_ID", {
        method: "PATCH",
        role: "user",
        regionId: GOV_REGION_ID,
        body: { action: "DISPATCH" },
      }), idCtx),
    },
    {
      name: "GET /api/review",
      call: async () => reviewGet(await makeReq("/api/review", { role: "user", regionId: GOV_REGION_ID })),
    },
    {
      name: "POST /api/review",
      call: async () => reviewPost(await makeReq("/api/review", {
        method: "POST",
        role: "user",
        regionId: GOV_REGION_ID,
        body: { id: "x", action: "APPROVE" },
      })),
    },
    {
      name: "POST /api/agent/patrol",
      call: async () => patrolPost(await makeReq("/api/agent/patrol", {
        method: "POST",
        role: "user",
        regionId: GOV_REGION_ID,
        body: {},
      })),
    },
    {
      name: "GET /api/agent/tasks",
      call: async () => agentTasksGet(await makeReq("/api/agent/tasks", { role: "user", regionId: GOV_REGION_ID })),
    },
    {
      name: "POST /api/agent/report",
      call: async () => agentReportPost(await makeReq("/api/agent/report", {
        method: "POST",
        role: "user",
        regionId: GOV_REGION_ID,
        body: {},
      })),
    },
    {
      name: "POST /api/copilot",
      call: async () => copilotPost(await makeReq("/api/copilot", {
        method: "POST",
        role: "user",
        regionId: GOV_REGION_ID,
        body: { prompt: "test" },
      })),
    },
    {
      name: "POST /api/sandbox/xray",
      call: async () => xrayPost(await makeReq("/api/sandbox/xray", {
        method: "POST",
        role: "user",
        regionId: GOV_REGION_ID,
        body: { content: "test" },
      })),
    },
    {
      name: "GET /api/admin/regions",
      call: async () => adminRegionsGet(await makeReq("/api/admin/regions", { role: "user" })),
    },
    {
      name: "GET /api/overview",
      call: async () => overviewGet(await makeReq("/api/overview", { role: "user", regionId: GOV_REGION_ID })),
    },
  ];

  for (const c of checks) {
    const res = await c.call();
    assert(res.status === 403, `[3.角色隔离403] citizen 调 ${c.name} 返回 ${res.status}`);
  }
}

async function verifyCitizenJourneyForDomain(opts: {
  regionId: string;
  expectedDomain: "GOV_12345" | "ECOMMERCE_CS";
  expectedSubdistrict: string;
  expectedCategory: string;
  utterance: string;
  expectedAddressFrag: string;
  expectedSubjectFrag: string;
}) {
  const { regionId, expectedDomain } = opts;
  const tag = `[5.普通用户-${expectedDomain}]`;

  // 1) options
  const optRes = await intakeOptionsGet(
    await makeReq("/api/intake/options", { role: "user", regionId })
  );
  const optJson = await optRes.json();
  assert(
    optRes.status === 200 &&
      optJson.success === true &&
      optJson.domainProfile?.domainType === expectedDomain &&
      Array.isArray(optJson.subdistricts) &&
      optJson.subdistricts.includes(opts.expectedSubdistrict),
    `${tag} GET /api/intake/options 返回双域配置 (domain=${optJson.domainProfile?.domainType})`
  );

  // 2) chat extraction
  const chatRes = await intakeChatPost(
    await makeReq("/api/intake/chat", {
      method: "POST",
      role: "user",
      regionId,
      body: {
        regionId,
        messages: [{ role: "user", content: opts.utterance }],
      },
    })
  );
  const chatJson = await chatRes.json();
  assert(
    chatRes.status === 200 &&
      chatJson.success === true &&
      typeof chatJson.reply === "string" &&
      chatJson.reply.length > 0 &&
      chatJson.draft?.subdistrict === opts.expectedSubdistrict &&
      String(chatJson.draft?.address || "").includes(opts.expectedAddressFrag) &&
      String(chatJson.draft?.subject || "").includes(opts.expectedSubjectFrag),
    `${tag} POST /api/intake/chat 抽取结构化草稿 (sub=${chatJson.draft?.subdistrict}, addr=${chatJson.draft?.address}, subj=${chatJson.draft?.subject})`
  );

  // 3) citizen submits with skipAutoCluster: true
  const citSubRes = await intakeSubmitPost(
    await makeReq("/api/intake/submit", {
      method: "POST",
      role: "user",
      regionId,
      body: {
        regionId,
        title: `${expectedDomain}市民测试工单`,
        content: opts.utterance,
        subdistrict: opts.expectedSubdistrict,
        category: opts.expectedCategory,
        address: chatJson.draft?.address || opts.expectedAddressFrag,
        subject: chatJson.draft?.subject || opts.expectedSubjectFrag,
        contactPhone: "13800138000",
        source: "AGENT_VOICE",
        skipAutoCluster: true,
      },
    })
  );
  const citSubJson = await citSubRes.json();
  assert(
    citSubRes.status === 200 &&
      citSubJson.success === true &&
      typeof citSubJson.ticketId === "string" &&
      !String(citSubJson.maskedPreview || "").includes("13800138000"),
    `${tag} citizen POST /api/intake/submit 成功且 PII 脱敏 (${citSubJson.ticketNo})`
  );

  // 4) admin also submits a separate ticket to verify my-tickets isolation
  const admSubRes = await intakeSubmitPost(
    await makeReq("/api/intake/submit", {
      method: "POST",
      role: "admin",
      regionId,
      body: {
        regionId,
        title: `${expectedDomain}管理员隔离对照工单`,
        content: `${opts.expectedSubdistrict}对照测试工单，请勿混入市民列表。`,
        subdistrict: opts.expectedSubdistrict,
        category: opts.expectedCategory,
        address: opts.expectedAddressFrag,
        subject: opts.expectedSubjectFrag,
        contactEmail: "admin@civic.gov.cn",
        skipAutoCluster: true,
      },
    })
  );
  const admSubJson = await admSubRes.json();
  assert(admSubRes.status === 200 && Boolean(admSubJson.ticketId), `${tag} admin 提交隔离对照工单 (${admSubJson.ticketNo})`);

  // Mark admin's ticket RESOLVED so it does not pollute Step 6 MISSING_INFO patrol
  const { db: tenantDb } = await getRegionDb(regionId);
  await tenantDb
    .update(ticketsTable)
    .set({ status: "RESOLVED", closureStatus: "RESOLVED", confidence: 95 })
    .where(eq(ticketsTable.id, admSubJson.ticketId));

  // 5) my-tickets isolation checks
  const citListRes = await myTicketsGet(
    await makeReq("/api/intake/my-tickets", { role: "user", regionId })
  );
  const citListJson = await citListRes.json();
  const citIds = (citListJson.tickets || []).map((t: { id: string }) => t.id);
  assert(
    citListRes.status === 200 &&
      citIds.includes(citSubJson.ticketId) &&
      !citIds.includes(admSubJson.ticketId),
    `${tag} citizen GET /api/intake/my-tickets 仅见本人单，未混入 admin 工单`
  );

  const admListRes = await myTicketsGet(
    await makeReq("/api/intake/my-tickets", { role: "admin", regionId })
  );
  const admListJson = await admListRes.json();
  const admIds = (admListJson.tickets || []).map((t: { id: string }) => t.id);
  assert(
    admListRes.status === 200 &&
      admIds.includes(admSubJson.ticketId) &&
      !admIds.includes(citSubJson.ticketId),
    `${tag} admin GET /api/intake/my-tickets 仅见本人单，未混入 citizen 工单`
  );

  // 6) cross-user reopen must return 403, missing ticket returns 404
  const adminReopenCit = await myTicketReopenPost(
    await makeReq(`/api/intake/my-tickets/${citSubJson.ticketId}/reopen`, {
      method: "POST",
      role: "admin",
      regionId,
      body: { regionId, reason: "越权尝试重开" },
    }),
    { params: Promise.resolve({ id: citSubJson.ticketId }) }
  );
  assert(adminReopenCit.status === 403, `${tag} admin 重开 citizen 工单返回 403 (实际 ${adminReopenCit.status})`);

  const citReopenAdmin = await myTicketReopenPost(
    await makeReq(`/api/intake/my-tickets/${admSubJson.ticketId}/reopen`, {
      method: "POST",
      role: "user",
      regionId,
      body: { regionId, reason: "越权尝试重开" },
    }),
    { params: Promise.resolve({ id: admSubJson.ticketId }) }
  );
  assert(citReopenAdmin.status === 403, `${tag} citizen 重开他人(admin)工单返回 403 (实际 ${citReopenAdmin.status})`);

  const citReopenMissing = await myTicketReopenPost(
    await makeReq("/api/intake/my-tickets/NON_EXISTENT_TICKET/reopen", {
      method: "POST",
      role: "user",
      regionId,
      body: { regionId, reason: "不存在测试" },
    }),
    { params: Promise.resolve({ id: "NON_EXISTENT_TICKET" }) }
  );
  assert(citReopenMissing.status === 404, `${tag} citizen 重开不存在工单返回 404 (实际 ${citReopenMissing.status})`);

  // 7) Mark citizen ticket & linked theme RESOLVED, then citizen reopens it as fake closure
  const citThemeId = `TH-CIT-RES-${expectedDomain}`;
  const now = new Date();
  await tenantDb.insert(themesTable).values({
    id: citThemeId,
    title: `${opts.expectedSubdistrict} · 市民重开验证已办结专题`,
    canonicalSubject: opts.expectedSubjectFrag,
    canonicalLocation: opts.expectedAddressFrag,
    eventType: "诉求复发",
    category: opts.expectedCategory,
    riskLevel: "LOW",
    ticketCount: 1,
    timeSpanHours: 1,
    handlingStatus: "RESOLVED",
    handlingProgress: 100,
    firstAt: now,
    lastAt: now,
  });
  await tenantDb
    .update(ticketsTable)
    .set({
      status: "RESOLVED",
      closureStatus: "RESOLVED",
      primaryThemeId: citThemeId,
      closedAt: now,
    })
    .where(eq(ticketsTable.id, citSubJson.ticketId));
  await tenantDb.insert(ticketThemesTable).values({
    ticketId: citSubJson.ticketId,
    themeId: citThemeId,
  });

  const reopenRes = await myTicketReopenPost(
    await makeReq(`/api/intake/my-tickets/${citSubJson.ticketId}/reopen`, {
      method: "POST",
      role: "user",
      regionId,
      body: { regionId, reason: "现场仍未处理完毕，申请假闭环重开" },
    }),
    { params: Promise.resolve({ id: citSubJson.ticketId }) }
  );
  const reopenJson = await reopenRes.json();
  assert(
    reopenRes.status === 200 &&
      reopenJson.success === true &&
      reopenJson.reopened === true &&
      reopenJson.themeId === citThemeId,
    `${tag} citizen POST /api/intake/my-tickets/[id]/reopen 触发假闭环重开成功`
  );

  const [reopenedTk] = await tenantDb
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, citSubJson.ticketId))
    .limit(1);
  const [reopenedTh] = await tenantDb
    .select()
    .from(themesTable)
    .where(eq(themesTable.id, citThemeId))
    .limit(1);
  const reopenLogs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.action, "REOPEN"),
        eq(disposalLogsTable.targetId, citSubJson.ticketId)
      )
    );
  const themeReopenLogs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.action, "REOPEN"),
        eq(disposalLogsTable.targetId, citThemeId)
      )
    );
  assert(
    reopenedTk?.isFakeClosure === true &&
      reopenedTk?.status === "REOPENED" &&
      reopenedTh?.handlingStatus === "REOPENED" &&
      reopenLogs.length >= 1 &&
      themeReopenLogs.length >= 1,
    `${tag} 重开后 tickets/themes 状态与 disposal_logs(REOPEN) 一致`
  );
}

async function verifyAdminProactiveAgentForDomain(opts: {
  regionId: string;
  domainType: "GOV_12345" | "ECOMMERCE_CS";
}) {
  const { regionId, domainType } = opts;
  const isEcom = domainType === "ECOMMERCE_CS";
  const tag = `[6.主动Agent-${domainType}]`;
  const { db: tenantDb } = await getRegionDb(regionId);

  const now = new Date();
  const tkMissId = `TK-${domainType}-MISS`;
  const tkRedId = `TK-${domainType}-RED`;
  const tkResMemberId = `TK-${domainType}-RES-M1`;
  const thHighId = `TH-${domainType}-HIGH`;
  const thResId = `TH-${domainType}-RES`;

  await tenantDb.insert(themesTable).values([
    {
      id: thHighId,
      title: isEcom ? "华南冷链仓 · 生鲜延迟化冻积压" : "天河南街道 · 占道施工噪音积压",
      canonicalSubject: isEcom ? "华南冷链仓" : "体育西地铁施工",
      canonicalLocation: isEcom ? "华南冷链仓" : "天河南街道",
      eventType: isEcom ? "冷链化冻" : "夜间施工噪音",
      category: isEcom ? "物流延误与丢件" : "生态环境",
      riskLevel: "HIGH",
      ticketCount: 6,
      timeSpanHours: 48,
      handlingStatus: "PENDING",
      handlingProgress: 0,
      recommendedAction: isEcom
        ? "责任团队：冷链履约应急专班；2小时内清仓赔付"
        : "牵头部门：区生态环保执法大队；立即责令夜间停工",
      firstAt: now,
      lastAt: now,
    },
    {
      id: thResId,
      title: isEcom ? "抖音直播间 · 护肤品退款已完成抽查" : "猎德街道 · 餐饮油烟整治已办结",
      canonicalSubject: isEcom ? "SKU-CARE-202" : "兴盛路大排档",
      canonicalLocation: isEcom ? "抖音直播间" : "猎德街道",
      eventType: isEcom ? "退款纠纷" : "油烟扰民",
      category: isEcom ? "退款与价保纠纷" : "生态环境",
      riskLevel: "MEDIUM",
      ticketCount: 3,
      timeSpanHours: 12,
      handlingStatus: "RESOLVED",
      handlingProgress: 100,
      handlingOwner: isEcom ? "售后退款一组" : "猎德街道综合执法队",
      firstAt: now,
      lastAt: now,
    },
  ]);

  await tenantDb.insert(ticketsTable).values([
    {
      id: tkMissId,
      ticketNo: `${isEcom ? "EC" : "GV"}-MISS-01`,
      title: isEcom ? "买家反映礼盒破损缺订单号" : "反映夜市油烟扰民缺门牌",
      summarizeTitle: isEcom ? "礼盒破损缺少订单号与SKU" : "夜市油烟扰民缺少具体路名门牌",
      content: isEcom ? "买的东西破损了还没发货单，联系我13812345678" : "夜市烧烤油烟很重，位置说不清，电话13812345678",
      maskedContent: isEcom ? "买的东西破损了还没发货单，联系我{{PHONE_NUMBER_1}}" : "夜市烧烤油烟很重，位置说不清，电话{{PHONE_NUMBER_1}}",
      citizenPhone: "13812345678",
      subdistrict: isEcom ? "天猫旗舰店" : "天河南街道",
      sourceCategory: isEcom ? "商品质量与破损" : "生态环境",
      address: null,
      canonicalSubject: null,
      confidence: 55,
      status: "PENDING",
      stabilityRisk: false,
      createTime: now,
    },
    {
      id: tkRedId,
      ticketNo: `${isEcom ? "EC" : "GV"}-RED-01`,
      title: isEcom ? "疑似食品中毒腹泻投诉12315曝光" : "多户居民聚集堵路群体维权",
      summarizeTitle: isEcom ? "食安红线：疑似食物中毒腹泻并向12315投诉" : "涉稳红线：居民集体维权聚集堵路",
      content: isEcom
        ? "吃了你们冷链海鲜全家食物中毒腹泻呕吐，已向12315和媒体曝光，电话13912345678"
        : "工程欠薪引发数十人聚集堵路集体维权，电话13912345678",
      maskedContent: isEcom
        ? "吃了你们冷链海鲜全家食物中毒腹泻呕吐，已向12315和媒体曝光，电话{{PHONE_NUMBER_1}}"
        : "工程欠薪引发数十人聚集堵路集体维权，电话{{PHONE_NUMBER_1}}",
      citizenPhone: "13912345678",
      subdistrict: isEcom ? "华南冷链仓" : "猎德街道",
      sourceCategory: isEcom ? "食安与合规红线" : "公共安全",
      address: isEcom ? "订单 EC999001" : "猎德大道18号",
      canonicalSubject: isEcom ? "SKU-FOOD-999" : "涉事施工单位",
      confidence: 92,
      status: "PENDING",
      stabilityRisk: true,
      createTime: now,
    },
    {
      id: tkResMemberId,
      ticketNo: `${isEcom ? "EC" : "GV"}-RES-01`,
      title: isEcom ? "已办结退款纠纷抽查单" : "已办结油烟抽查单",
      content: isEcom ? "售后显示已办结退款" : "执法队回复已整改办结",
      maskedContent: isEcom ? "售后显示已办结退款" : "执法队回复已整改办结",
      subdistrict: isEcom ? "抖音直播间" : "猎德街道",
      sourceCategory: isEcom ? "退款与价保纠纷" : "生态环境",
      primaryThemeId: thResId,
      status: "RESOLVED",
      closureStatus: "RESOLVED",
      closedAt: now,
      createTime: now,
    },
  ]);

  await tenantDb.insert(ticketThemesTable).values({
    ticketId: tkResMemberId,
    themeId: thResId,
  });

  // 1) Run patrol
  const patrolRes = await patrolPost(
    await makeReq("/api/agent/patrol", {
      method: "POST",
      role: "admin",
      regionId,
      body: { regionId },
    })
  );
  const patrolJson = await patrolRes.json();
  assert(
    patrolRes.status === 200 &&
      patrolJson.success === true &&
      patrolJson.domainType === domainType &&
      patrolJson.createdCount >= 4,
    `${tag} POST /api/agent/patrol 生成任务 (created=${patrolJson.createdCount})`
  );

  // 2) List tasks
  const listRes = await agentTasksGet(
    await makeReq("/api/agent/tasks", { role: "admin", regionId })
  );
  const listJson = await listRes.json();
  const tasks = (listJson.tasks || []) as Array<{
    id: string;
    taskType: string;
    autonomyLevel: string;
    status: string;
    targetId: string;
    maskedContact: string | null;
    draftMessage: string;
  }>;

  const overdueTask = tasks.find((t) => t.taskType === "SLA_OVERDUE" && t.targetId === thHighId);
  const missingTask = tasks.find((t) => t.taskType === "MISSING_INFO" && t.targetId === tkMissId);
  const callbackTask = tasks.find((t) => t.taskType === "REOPEN_CALLBACK" && t.targetId === thResId);
  const redlineTask = tasks.find((t) => t.taskType === "REDLINE_BLOCK" && t.targetId === tkRedId);

  assert(
    Boolean(overdueTask) && overdueTask?.autonomyLevel === "L1_AUTO",
    `${tag} 巡检产生 L1 SLA_OVERDUE 任务`
  );
  assert(
    Boolean(missingTask) &&
      missingTask?.autonomyLevel === (isEcom ? "L1_AUTO" : "L2_APPROVAL") &&
      missingTask?.maskedContact === "{{PHONE_NUMBER_1}}" &&
      !missingTask?.draftMessage.includes("13812345678"),
    `${tag} 巡检产生 MISSING_INFO 任务且联系方式脱敏为 {{PHONE_NUMBER_1}}`
  );
  assert(
    Boolean(callbackTask) &&
      callbackTask?.autonomyLevel === "L2_APPROVAL" &&
      callbackTask?.maskedContact === "{{PHONE_NUMBER_1}}",
    `${tag} 巡检产生 L2 REOPEN_CALLBACK 任务且含 {{PHONE_NUMBER_1}}`
  );
  assert(
    Boolean(redlineTask) &&
      redlineTask?.autonomyLevel === "L3_BLOCKED" &&
      redlineTask?.status === "BLOCKED" &&
      !redlineTask?.draftMessage.includes("13912345678"),
    `${tag} 巡检产生 L3_BLOCKED REDLINE_BLOCK 任务且联系方式脱敏`
  );

  // 3) Reject L3_BLOCKED EXECUTE & voice-turn with 400
  const l3ExecRes = await agentTaskPatch(
    await makeReq(`/api/agent/tasks/${redlineTask!.id}`, {
      method: "PATCH",
      role: "admin",
      regionId,
      body: { regionId, action: "EXECUTE" },
    }),
    { params: Promise.resolve({ id: redlineTask!.id }) }
  );
  const l3ExecJson = await l3ExecRes.json();
  assert(
    l3ExecRes.status === 400 && l3ExecJson.code === "REDLINE_BLOCKED",
    `${tag} L3_BLOCKED 尝试 EXECUTE 被明确拒绝 (status=${l3ExecRes.status}, code=${l3ExecJson.code})`
  );

  const l3VoiceRes = await voiceTurnPost(
    await makeReq("/api/agent/outreach/voice-turn", {
      method: "POST",
      role: "admin",
      regionId,
      body: { regionId, taskId: redlineTask!.id, transcript: "尝试语音外呼" },
    })
  );
  assert(
    l3VoiceRes.status === 400,
    `${tag} L3_BLOCKED 尝试语音外呼被拒绝 (status=${l3VoiceRes.status})`
  );

  // 4) Execute L1 SLA_OVERDUE -> success + disposal_logs
  const l1ExecRes = await agentTaskPatch(
    await makeReq(`/api/agent/tasks/${overdueTask!.id}`, {
      method: "PATCH",
      role: "admin",
      regionId,
      body: { regionId, action: "EXECUTE", note: "自动化催办核验" },
    }),
    { params: Promise.resolve({ id: overdueTask!.id }) }
  );
  const l1ExecJson = await l1ExecRes.json();
  const l1Logs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.targetType, "THEME"),
        eq(disposalLogsTable.targetId, thHighId),
        eq(disposalLogsTable.action, "DISPATCH")
      )
    )
    .orderBy(desc(disposalLogsTable.createdAt));
  assert(
    l1ExecRes.status === 200 &&
      l1ExecJson.task?.status === "EXECUTED" &&
      l1Logs.length >= 1,
    `${tag} L1 SLA_OVERDUE EXECUTE 成功并写入 disposal_logs`
  );

  // 5) Voice turn on MISSING_INFO -> updates ticket + CORRECT_ENTITY log
  const missingVoiceTranscript = isEcom
    ? "补充单号：EC2026112088，涉事商品是 SKU-FRESH-888"
    : "补充一下，地点在天河南街道体育东路108号，店铺是阿强烧烤店";
  const missVoiceRes = await voiceTurnPost(
    await makeReq("/api/agent/outreach/voice-turn", {
      method: "POST",
      role: "admin",
      regionId,
      body: {
        regionId,
        taskId: missingTask!.id,
        transcript: missingVoiceTranscript,
        turnIndex: 1,
      },
    })
  );
  const missVoiceJson = await missVoiceRes.json();
  const [updatedMissTk] = await tenantDb
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, tkMissId))
    .limit(1);
  const correctLogs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.targetType, "TICKET"),
        eq(disposalLogsTable.targetId, tkMissId),
        eq(disposalLogsTable.action, "CORRECT_ENTITY")
      )
    );
  assert(
    missVoiceRes.status === 200 &&
      missVoiceJson.completed === true &&
      Boolean(updatedMissTk?.address) &&
      Number(updatedMissTk?.confidence || 0) >= 88 &&
      correctLogs.length >= 1,
    `${tag} voice-turn MISSING_INFO 写回 tickets (addr=${updatedMissTk?.address}, subj=${updatedMissTk?.canonicalSubject}) 并记录 CORRECT_ENTITY`
  );

  // 6) Voice turn on REOPEN_CALLBACK -> negative triggers triggeredFakeClosure + REOPEN log
  const cbVoiceTranscript = isEcom
    ? "根本没收到退款，客服敷衍假办结，非常不满意！"
    : "问题根本没解决，昨晚照样噪音扰民，这是假办结！";
  const cbVoiceRes = await voiceTurnPost(
    await makeReq("/api/agent/outreach/voice-turn", {
      method: "POST",
      role: "admin",
      regionId,
      body: {
        regionId,
        taskId: callbackTask!.id,
        transcript: cbVoiceTranscript,
        turnIndex: 1,
      },
    })
  );
  const cbVoiceJson = await cbVoiceRes.json();
  const [reopenedTheme] = await tenantDb
    .select()
    .from(themesTable)
    .where(eq(themesTable.id, thResId))
    .limit(1);
  const [reopenedMember] = await tenantDb
    .select()
    .from(ticketsTable)
    .where(eq(ticketsTable.id, tkResMemberId))
    .limit(1);
  const cbReopenLogs = await tenantDb
    .select()
    .from(disposalLogsTable)
    .where(
      and(
        eq(disposalLogsTable.targetType, "THEME"),
        eq(disposalLogsTable.targetId, thResId),
        eq(disposalLogsTable.action, "REOPEN")
      )
    );
  assert(
    cbVoiceRes.status === 200 &&
      cbVoiceJson.completed === true &&
      cbVoiceJson.triggeredFakeClosure === true &&
      cbVoiceJson.reopenedThemeId === thResId &&
      reopenedTheme?.handlingStatus === "REOPENED" &&
      reopenedMember?.isFakeClosure === true &&
      cbReopenLogs.length >= 1,
    `${tag} voice-turn REOPEN_CALLBACK 触发假闭环重开 (triggeredFakeClosure=true) 并记录 REOPEN 日志`
  );

  // 7) Generate & read domain-adapted Agent report
  const postRptRes = await agentReportPost(
    await makeReq("/api/agent/report", {
      method: "POST",
      role: "admin",
      regionId,
      body: { regionId },
    })
  );
  const postRptJson = await postRptRes.json();
  const getRptRes = await agentReportGet(
    await makeReq("/api/agent/report", { role: "admin", regionId })
  );
  const getRptJson = await getRptRes.json();
  const md = String(postRptJson.report?.markdown || "");
  const expectedPhrase = isEcom ? "SKU 与仓网溯源" : "辖区民生诉求核心态势";
  assert(
    postRptRes.status === 200 &&
      getRptRes.status === 200 &&
      postRptJson.report?.id === getRptJson.report?.id &&
      md.includes(expectedPhrase),
    `${tag} GET/POST /api/agent/report 生成${domainType}风格专报 (${postRptJson.report?.title})`
  );
}

async function verifyRateLimit429() {
  // 1) Isolated scope unit check (does not touch real route buckets)
  const isoScope = `verify-rl-${Date.now()}`;
  for (let i = 0; i < 3; i++) {
    assert(checkAgentRateLimit(isoScope, "verify-user", 3) === null, `[4.限流] 临时 scope 第 ${i + 1}/3 次放行`);
  }
  const blocked = checkAgentRateLimit(isoScope, "verify-user", 3);
  assert(
    blocked !== null &&
      blocked.status === 429 &&
      Number(blocked.headers.get("Retry-After") || 0) >= 1,
    `[4.限流] 临时 scope 第 4 次返回 429 且带 Retry-After=${blocked?.headers.get("Retry-After")}`
  );

  // 2) Real API route 429 check at the very end using citizen /api/intake/options
  let hit429: Response | null = null;
  for (let i = 0; i < 30; i++) {
    const res = await intakeOptionsGet(
      await makeReq("/api/intake/options", { role: "user", regionId: GOV_REGION_ID })
    );
    if (res.status === 429) {
      hit429 = res;
      break;
    }
  }
  assert(
    hit429 !== null &&
      hit429.status === 429 &&
      Number(hit429.headers.get("Retry-After") || 0) >= 1,
    `[4.限流] 真实接口 GET /api/intake/options 超限返回 429 且带 Retry-After=${hit429?.headers.get("Retry-After")}`
  );
}

async function main() {
  const prevAppDomain = process.env.APP_DOMAIN;
  process.env.APP_DOMAIN = "ALL";

  await assertBaselineUnchanged("前置");
  await cleanupTempArtifacts();

  try {
    await setupEphemeralTenants();
    await verifyUnauthenticated401();
    await verifyHostOrigin403();
    await verifyCitizenRbac403();

    await verifyCitizenJourneyForDomain({
      regionId: GOV_REGION_ID,
      expectedDomain: "GOV_12345",
      expectedSubdistrict: "天河南街道",
      expectedCategory: "生态环境",
      utterance: "天河南街道体育西路88号老王烧烤店深夜油烟噪声扰民，联系电话13800138000",
      expectedAddressFrag: "体育西路88号",
      expectedSubjectFrag: "老王烧烤店",
    });

    await verifyCitizenJourneyForDomain({
      regionId: ECOM_REGION_ID,
      expectedDomain: "ECOMMERCE_CS",
      expectedSubdistrict: "天猫旗舰店",
      expectedCategory: "商品质量与破损",
      utterance: "我在天猫旗舰店买的生鲜礼盒 SKU-SEA-101 化冻变质了，订单号 EC2026112099，电话13900139000",
      expectedAddressFrag: "EC2026112099",
      expectedSubjectFrag: "SKU-SEA-101",
    });

    await verifyAdminProactiveAgentForDomain({
      regionId: GOV_REGION_ID,
      domainType: "GOV_12345",
    });

    await verifyAdminProactiveAgentForDomain({
      regionId: ECOM_REGION_ID,
      domainType: "ECOMMERCE_CS",
    });

    await verifyRateLimit429();
  } finally {
    if (prevAppDomain === undefined) {
      delete process.env.APP_DOMAIN;
    } else {
      process.env.APP_DOMAIN = prevAppDomain;
    }
    await cleanupTempArtifacts();
    await assertBaselineUnchanged("清理后");

    const leftovers = await sql<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name LIKE 'verify_%'
    `;
    assert(leftovers.length === 0, `[清理检查] 无残留 verify_* schema (${leftovers.length})`);

    const [{ reg }] = await sql<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.citizen_submissions')::text AS reg
    `;
    if (reg) {
      const [{ c }] = await sql<Array<{ c: number }>>`
        SELECT count(*)::int AS c FROM public.citizen_submissions
      `;
      assert(c === 0, `[清理检查] public.citizen_submissions 无临时残留 (${c})`);
    }
  }

  console.log(`\n断言汇总: ${passedAssertions} PASS / ${failedAssertions} FAIL`);
  if (failedAssertions > 0) {
    process.exit(1);
  }
  console.log("✅ tests/test-agent-governance-rbac.ts 全链路验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
