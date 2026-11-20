/**
 * 阶段 1 管理员可操作闭环端到端验收测试（Verifier 独立编写）
 *
 * 红线守卫：
 * 1. 所有写库/改库/删库测试仅在完全独立的临时租户 verify_closed_loop (schema: region_verify_closed_loop) 执行；
 * 2. 全程不触碰 region_gz_tianhe (103397 / 5748) 与 region_fs_shunde (135666 / 9222)；
 * 3. try/finally 保证测试结束后物理销毁 region_verify_closed_loop 与 public.regions 临时记录，并再次校验基线零变动。
 */

import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { sql, getRegionDb } from "../db/client";
import {
  aliasesTable,
  disposalLogsTable,
  reviewQueueTable,
  themesTable,
  ticketThemesTable,
  ticketsTable,
} from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { GET as clusterGet, PATCH as clusterPatch } from "../app/api/clusters/[id]/route";
import { GET as clusterMembersGet } from "../app/api/clusters/[id]/members/route";
import { GET as workorderGet, PATCH as workorderPatch } from "../app/api/workorders/[id]/route";
import { GET as reviewGet, POST as reviewPost } from "../app/api/review/route";
import { GET as ticketsGet } from "../app/api/tickets/route";
import { GET as workordersGet } from "../app/api/workorders/route";
import { evaluateIncrementalTicket } from "../backend/incremental-cluster";
import { persistIncrementalResult } from "../lib/civic-persist";
import { createCopilotTools } from "../backend/agent/copilot-tools";
import { parseCivicActionBlocks } from "../lib/copilot-protocol";
import type { EnrichedTicket, MultiFrequencyTheme } from "../backend/state";
import { HANDLING_STATUS } from "../lib/civic-dto";

const TEST_REGION_ID = "verify_closed_loop";
const TEST_SCHEMA_NAME = "region_verify_closed_loop";

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
      name: "闭环验收临时区",
      city: "顺德区测试市",
      province: "广东省",
      schemaName: TEST_SCHEMA_NAME,
      isDefault: false,
      description: "Stage 1 closed-loop verification ephemeral tenant",
    });

    const { db: tenantDb, schemaName } = await getRegionDb(TEST_REGION_ID);
    assert(schemaName === TEST_SCHEMA_NAME, `临时租户绑定到独立 schema (${schemaName})`);

    const now = new Date();
    const twoDaysAgo = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000);
    const threeDaysAgo = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000);

    // 2. 插入测试工单、多频主题及关联关系
    await tenantDb.insert(themesTable).values([
      {
        id: "THEME-V1",
        title: "大良街道金榜上街 · 供水管网破裂停水",
        canonicalSubject: "大良街道金榜上街供水管",
        canonicalLocation: "大良街道金榜上街",
        eventType: "供水管网破裂",
        category: "城市管理",
        riskLevel: "MEDIUM",
        riskReason: "同地点多起供水诉求",
        ticketCount: 2,
        timeSpanHours: 6,
        aiSummary: "大良街道金榜上街供水管破裂导致停水。",
        recommendedAction: "牵头部门：区住建水务局；响应时限：24小时内抢修通水",
        patternType: "AGGREGATE",
        civicMode: "aggregate",
        aiConfidence: 94,
        firstAt: threeDaysAgo,
        lastAt: twoDaysAgo,
        handlingStatus: "PENDING",
        handlingProgress: 0,
      },
      {
        id: "THEME-V2",
        title: "大良街道清晖东路 · 路灯成片熄灭",
        canonicalSubject: "清晖东路市政路灯",
        canonicalLocation: "大良街道清晖东路",
        eventType: "路灯故障",
        category: "城市管理",
        riskLevel: "LOW",
        riskReason: "已有 1 起已办结路灯报修",
        ticketCount: 1,
        timeSpanHours: 2,
        aiSummary: "大良街道清晖东路沿线部分路灯不亮。",
        recommendedAction: "牵头部门：市政路灯所；响应时限：48小时内检修",
        patternType: "AGGREGATE",
        civicMode: "aggregate",
        aiConfidence: 90,
        firstAt: threeDaysAgo,
        lastAt: twoDaysAgo,
        handlingStatus: "RESOLVED",
        handlingProgress: 100,
        handlingOwner: "市政路灯所",
        handlingEta: twoDaysAgo,
      },
    ]);

    await tenantDb.insert(ticketsTable).values([
      {
        id: "TK-V1",
        ticketNo: "V-2026-0001",
        title: "金榜上街10号停水",
        summarizeTitle: "金榜上街10号供水中断",
        content: "大良街道金榜上街10号居民楼早上开始完全停水。",
        maskedContent: "大良街道金榜上街10号居民楼早上开始完全停水。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "城市管理",
        urgency: "URGENT",
        canonicalSubject: "大良街道金榜上街供水管",
        eventType: "供水管网破裂",
        address: "大良街道金榜上街10号",
        confidence: 92,
        primaryThemeId: "THEME-V1",
        status: "PENDING",
        createTime: threeDaysAgo,
      },
      {
        id: "TK-V2",
        ticketNo: "V-2026-0002",
        title: "金榜上街22号水压极低",
        summarizeTitle: "金榜上街22号水压异常",
        content: "大良街道金榜上街22号附近水压明显不足。",
        maskedContent: "大良街道金榜上街22号附近水压明显不足。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "城市管理",
        urgency: "NORMAL",
        canonicalSubject: "大良街道金榜上街供水管",
        eventType: "供水管网破裂",
        address: "大良街道金榜上街22号",
        confidence: 65,
        primaryThemeId: "THEME-V1",
        status: "PENDING",
        createTime: twoDaysAgo,
      },
      {
        id: "TK-V3",
        ticketNo: "V-2026-0003",
        title: "清晖路巷口积水未清",
        summarizeTitle: "清晖路巷口积水诉求",
        content: "大良清晖路巷口雨后积水严重。",
        maskedContent: "大良清晖路巷口雨后积水严重。",
        district: "顺德区",
        subdistrict: "大良",
        sourceCategory: "城市管理",
        urgency: "NORMAL",
        canonicalSubject: "清晖路巷口排水口",
        eventType: "道路积水",
        address: "大良清晖路1号巷口",
        confidence: 55,
        primaryThemeId: null,
        status: "PENDING",
        createTime: twoDaysAgo,
      },
      {
        id: "TK-V4",
        ticketNo: "V-2026-0004",
        title: "清晖东路80号路灯不亮",
        summarizeTitle: "清晖东路80号路灯熄灭",
        content: "大良街道清晖东路80号门口几盏路灯晚上不亮，已修复办结。",
        maskedContent: "大良街道清晖东路80号门口几盏路灯晚上不亮，已修复办结。",
        district: "顺德区",
        subdistrict: "大良街道",
        sourceCategory: "城市管理",
        urgency: "NORMAL",
        canonicalSubject: "清晖东路市政路灯",
        eventType: "路灯故障",
        address: "大良街道清晖东路80号",
        confidence: 91,
        primaryThemeId: "THEME-V2",
        status: "RESOLVED",
        closedAt: twoDaysAgo,
        closureStatus: "RESOLVED",
        createTime: threeDaysAgo,
      },
    ]);

    await tenantDb.insert(ticketThemesTable).values([
      { ticketId: "TK-V1", themeId: "THEME-V1" },
      { ticketId: "TK-V2", themeId: "THEME-V1" },
      { ticketId: "TK-V4", themeId: "THEME-V2" },
    ]);

    // 3. 验证 /api/clusters/[id] PATCH: DISPATCH -> ADVANCE(step 3/4) -> ESCALATE -> RESOLVE
    const dispatchRes = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "DISPATCH" } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const dispatchJson = await dispatchRes.json();
    assert(dispatchRes.status === 200 && dispatchJson.success, "clusters PATCH DISPATCH 返回 200");
    assert(
      dispatchJson.status?.code === "IN_PROGRESS" &&
        dispatchJson.status?.progress === 40 &&
        dispatchJson.status?.owner === "区住建水务局" &&
        Boolean(dispatchJson.status?.eta),
      `DISPATCH 更新状态/进度(40)/提取牵头部门(${dispatchJson.status?.owner})/ETA(${dispatchJson.status?.eta})`
    );
    const [tkV1AfterDispatch] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V1"));
    assert(tkV1AfterDispatch?.status === "IN_PROGRESS", "DISPATCH 联动成员工单进入 IN_PROGRESS");

    const adv3Res = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "ADVANCE", step: 3 } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const adv3Json = await adv3Res.json();
    assert(adv3Json.status?.code === "IN_PROGRESS" && adv3Json.status?.progress === 60, "ADVANCE step=3 推进至 60%");

    const adv4Res = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "ADVANCE", step: 4 } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const adv4Json = await adv4Res.json();
    assert(adv4Json.status?.code === "IN_PROGRESS" && adv4Json.status?.progress === 80, "ADVANCE step=4 推进至 80%");

    const escRes = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "ESCALATE", note: "群众停水影响范围扩大，重点督办" } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const escJson = await escRes.json();
    assert(
      escJson.riskLevel === "HIGH" && String(escJson.riskReason || "").includes("群众停水影响范围扩大"),
      "ESCALATE 真实升级为 HIGH 风险并追加督办说明"
    );

    const resolveRes = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "RESOLVE", note: "供水主管道已抢修通水" } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const resolveJson = await resolveRes.json();
    assert(
      resolveJson.status?.code === "RESOLVED" && resolveJson.status?.progress === 100,
      "RESOLVE 置主题为 RESOLVED / 100%"
    );

    const [tkV1Resolved] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V1"));
    const [tkV2Resolved] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V2"));
    assert(
      tkV1Resolved?.status === "RESOLVED" &&
        tkV1Resolved?.closureStatus === "RESOLVED" &&
        Boolean(tkV1Resolved?.closedAt) &&
        tkV2Resolved?.status === "RESOLVED" &&
        tkV2Resolved?.closureStatus === "RESOLVED" &&
        Boolean(tkV2Resolved?.closedAt),
      "RESOLVE 统一设置成员工单 status='RESOLVED', closedAt 与 closureStatus='RESOLVED'"
    );
    const themeLogs = Array.isArray(resolveJson.disposalLogs) ? resolveJson.disposalLogs : [];
    const actionsInLogs = themeLogs.map((l: { action: string }) => l.action);
    assert(
      actionsInLogs.includes("DISPATCH") &&
        actionsInLogs.includes("ADVANCE") &&
        actionsInLogs.includes("ESCALATE") &&
        actionsInLogs.includes("RESOLVE"),
      `disposal_logs 完整记录主题流转链路 (${actionsInLogs.join(",")})`
    );

    // 4. 验证活体假闭环：向已办结主题 THEME-V2 增量并入同地点同事件新工单 TK-V5
    await tenantDb.insert(ticketsTable).values({
      id: "TK-V5",
      ticketNo: "V-2026-0005",
      title: "清晖东路88号路灯再次熄灭",
      summarizeTitle: "清晖东路88号路灯反复不亮",
      content: "大良街道清晖东路88号刚修好两天的路灯今天晚上又不亮了，请抓紧复查。",
      maskedContent: "大良街道清晖东路88号刚修好两天的路灯今天晚上又不亮了，请抓紧复查。",
      district: "顺德区",
      subdistrict: "大良街道",
      sourceCategory: "城市管理",
      urgency: "NORMAL",
      canonicalSubject: "清晖东路市政路灯",
      eventType: "路灯故障",
      address: "大良街道清晖东路88号",
      confidence: null,
      primaryThemeId: null,
      status: "PENDING",
      createTime: now,
    });

    const [themeV2Row] = await tenantDb.select().from(themesTable).where(eq(themesTable.id, "THEME-V2"));
    const activeThemeV2: MultiFrequencyTheme = {
      id: themeV2Row.id,
      title: themeV2Row.title,
      canonicalSubject: themeV2Row.canonicalSubject,
      canonicalLocation: themeV2Row.canonicalLocation,
      eventType: themeV2Row.eventType,
      category: themeV2Row.category || "城市管理",
      riskLevel: "LOW",
      riskReason: themeV2Row.riskReason || "",
      ticketCount: themeV2Row.ticketCount,
      timeSpanHours: themeV2Row.timeSpanHours || 1,
      firstOccurrence: themeV2Row.firstAt ? themeV2Row.firstAt.toISOString() : threeDaysAgo.toISOString(),
      lastOccurrence: themeV2Row.lastAt ? themeV2Row.lastAt.toISOString() : twoDaysAgo.toISOString(),
      aiSummary: themeV2Row.aiSummary || "",
      recommendedAction: themeV2Row.recommendedAction || "",
      handlingStatus: themeV2Row.handlingStatus || HANDLING_STATUS.RESOLVED,
      handlingProgress: themeV2Row.handlingProgress ?? 100,
      handlingOwner: themeV2Row.handlingOwner || undefined,
      handlingEta: themeV2Row.handlingEta ? themeV2Row.handlingEta.toISOString() : undefined,
      closedAt: twoDaysAgo.toISOString(),
      status: "CONFIRMED",
      tickets: [],
      relatedSubjects: [themeV2Row.canonicalSubject],
      relatedLocations: [themeV2Row.canonicalLocation],
    };

    const incomingFakeTicket: EnrichedTicket = {
      id: "TK-V5",
      ticketNo: "V-2026-0005",
      title: "清晖东路88号路灯再次熄灭",
      summarizeTitle: "清晖东路88号路灯反复不亮",
      content: "大良街道清晖东路88号刚修好两天的路灯今天晚上又不亮了，请抓紧复查。",
      createTime: now.toISOString(),
      citizenName: "市民*",
      citizenPhone: "",
      district: "顺德区",
      subdistrict: "大良街道",
      channel: "市民服务热线",
      status: "PENDING",
      canonicalLocation: "大良街道清晖东路88号",
      canonicalSubject: "清晖东路市政路灯",
      eventType: "路灯故障",
      sourceCategory: "城市管理",
      confidence: 93,
      entities: [],
      relations: [],
      themes: ["城市管理"],
    };

    const incDecision = evaluateIncrementalTicket(incomingFakeTicket, [activeThemeV2]);
    assert(
      incDecision.action === "ATTACHED" &&
        incDecision.matchedThemeId === "THEME-V2" &&
        incDecision.fakeClosureDetected === true &&
        incDecision.recurredAfterClose === true,
      `活体假闭环判定并入已办结主题并触发假闭环检测 (${incDecision.action}/${incDecision.matchedThemeId})`
    );
    assert(
      incomingFakeTicket.isFakeClosure === true &&
        incomingFakeTicket.closureStatus === "REOPENED" &&
        incDecision.matchedTheme?.handlingStatus === "IN_PROGRESS" &&
        incDecision.matchedTheme?.handlingProgress === 40 &&
        incDecision.matchedTheme?.riskLevel === "HIGH",
      "活体假闭环在内存中将新工单标 isFakeClosure=true/REOPENED 并将主题回弹 IN_PROGRESS(40)/HIGH"
    );

    await persistIncrementalResult({
      tickets: [incomingFakeTicket],
      attachedThemes: incDecision.matchedTheme ? [incDecision.matchedTheme] : [],
      newThemes: [],
      regionId: TEST_REGION_ID,
    });

    const [tkV5Db] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V5"));
    assert(
      tkV5Db?.isFakeClosure === true && tkV5Db?.closureStatus === "REOPENED" && tkV5Db?.primaryThemeId === "THEME-V2",
      "persistIncrementalResult 落库新工单 isFakeClosure=true, closureStatus='REOPENED', primaryThemeId='THEME-V2'"
    );

    const clusterV2Res = await clusterGet(
      makeRequest("/api/clusters/THEME-V2"),
      { params: Promise.resolve({ id: "THEME-V2" }) }
    );
    const clusterV2Json = await clusterV2Res.json();
    assert(
      clusterV2Json.status?.code === "IN_PROGRESS" &&
        clusterV2Json.status?.progress === 40 &&
        clusterV2Json.riskLevel === "HIGH" &&
        clusterV2Json.fakeClosureCount === 1 &&
        (clusterV2Json.disposalLogs || []).some((l: { action: string }) => l.action === "REOPEN"),
      `GET /api/clusters/THEME-V2 反映假闭环重开 IN_PROGRESS/40/HIGH, fakeClosureCount=1 且含 REOPEN 日志`
    );

    const membersV2Res = await clusterMembersGet(
      makeRequest("/api/clusters/THEME-V2/members"),
      { params: Promise.resolve({ id: "THEME-V2" }) }
    );
    const membersV2Json = await membersV2Res.json();
    const memberV5 = (membersV2Json.members || []).find((m: { ticketId: string }) => m.ticketId === "TK-V5");
    assert(memberV5?.isFakeClosure === true && Boolean(memberV5?.status), "clusters/[id]/members 返回 isFakeClosure 与 status");

    // 5. 验证 /api/clusters/[id] PATCH DETACH_TICKET 重算 ticketCount 与 REOPEN
    const detachRes = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "DETACH_TICKET", ticketId: "TK-V2" } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const detachJson = await detachRes.json();
    assert(detachRes.status === 200 && detachJson.count === 1, `DETACH_TICKET 后重算 THEME-V1.ticketCount = ${detachJson.count} (期望 1)`);
    const [tkV2Detached] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V2"));
    assert(tkV2Detached?.primaryThemeId === null, "DETACH_TICKET 将 TK-V2.primaryThemeId 置 null");

    const reopenRes = await clusterPatch(
      makeRequest("/api/clusters/THEME-V1", { method: "PATCH", body: { action: "REOPEN", note: "测试管理员重开" } }),
      { params: Promise.resolve({ id: "THEME-V1" }) }
    );
    const reopenJson = await reopenRes.json();
    assert(
      reopenJson.status?.code === "IN_PROGRESS" && reopenJson.status?.progress === 40,
      "REOPEN 将已办结主题回弹至 IN_PROGRESS/40"
    );
    const [tkV1Reopened] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V1"));
    assert(
      tkV1Reopened?.status === "IN_PROGRESS" && tkV1Reopened?.closureStatus === "REOPENED",
      "REOPEN 同步将剩余成员工单置 IN_PROGRESS / REOPENED"
    );

    // 6. 验证 /api/workorders/[id] GET & PATCH: UPDATE_STATUS & CORRECT_ENTITY + saveAlias & DETACH_THEME
    const woGetRes = await workorderGet(
      makeRequest("/api/workorders/TK-V3"),
      { params: Promise.resolve({ id: "TK-V3" }) }
    );
    const woGetJson = await woGetRes.json();
    assert(
      woGetRes.status === 200 &&
        woGetJson.subdistrict === "大良" &&
        woGetJson.sourceCategory === "城市管理" &&
        Array.isArray(woGetJson.disposalLogs),
      "GET /api/workorders/[id] 返回原始 subdistrict/sourceCategory 与 disposalLogs"
    );

    const woResolveRes = await workorderPatch(
      makeRequest("/api/workorders/TK-V3", {
        method: "PATCH",
        body: { action: "UPDATE_STATUS", status: "RESOLVED", note: "现场疏通完毕" },
      }),
      { params: Promise.resolve({ id: "TK-V3" }) }
    );
    const woResolveJson = await woResolveRes.json();
    assert(
      woResolveJson.status === "RESOLVED" &&
        woResolveJson.closureStatus === "RESOLVED" &&
        Boolean(woResolveJson.closedAt),
      "workorders PATCH UPDATE_STATUS->RESOLVED 写入 closedAt 与 closureStatus='RESOLVED'"
    );

    const woReopenRes = await workorderPatch(
      makeRequest("/api/workorders/TK-V3", {
        method: "PATCH",
        body: { action: "UPDATE_STATUS", status: "IN_PROGRESS", note: "市民反馈仍积水" },
      }),
      { params: Promise.resolve({ id: "TK-V3" }) }
    );
    const woReopenJson = await woReopenRes.json();
    assert(
      woReopenJson.status === "IN_PROGRESS" && woReopenJson.closureStatus === "REOPENED",
      "workorders PATCH 从 RESOLVED 改回 IN_PROGRESS 写入 closureStatus='REOPENED'"
    );

    const woCorrectRes = await workorderPatch(
      makeRequest("/api/workorders/TK-V3", {
        method: "PATCH",
        body: {
          action: "CORRECT_ENTITY",
          note: "人工规范化镇街与别名",
          correction: {
            subdistrict: "大良街道",
            sourceCategory: "城市管理",
            canonicalSubject: "大良街道清晖路排水管网",
            address: "大良街道清晖路1号巷口",
            eventType: "市政排水积水",
            urgency: "URGENT",
          },
          saveAlias: {
            alias: "大良城管站",
            canonical: "大良街道综合行政执法办",
            type: "DEPARTMENT",
          },
        },
      }),
      { params: Promise.resolve({ id: "TK-V3" }) }
    );
    const woCorrectJson = await woCorrectRes.json();
    assert(
      woCorrectJson.subdistrict === "大良街道" &&
        woCorrectJson.canonicalSubject === "大良街道清晖路排水管网" &&
        woCorrectJson.urgency === "URGENT",
      "workorders PATCH CORRECT_ENTITY 更新工单要素字段"
    );

    // 再次调用相同 alias 验证幂等 upsert usageCount +1
    await workorderPatch(
      makeRequest("/api/workorders/TK-V3", {
        method: "PATCH",
        body: {
          action: "CORRECT_ENTITY",
          saveAlias: {
            alias: "大良城管站",
            canonical: "大良街道综合行政执法办",
            type: "DEPARTMENT",
          },
        },
      }),
      { params: Promise.resolve({ id: "TK-V3" }) }
    );
    const [aliasRow] = await tenantDb
      .select()
      .from(aliasesTable)
      .where(eq(aliasesTable.alias, "大良城管站"));
    assert(
      aliasRow?.canonical === "大良街道综合行政执法办" &&
        aliasRow?.source === "MANUAL" &&
        aliasRow?.type === "DEPARTMENT" &&
        aliasRow?.usageCount === 2,
      `aliasesTable 幂等 upsert 写入 MANUAL 别名并自增 usageCount (${aliasRow?.usageCount})`
    );

    // 验证单工单侧 DETACH_THEME
    const woDetachRes = await workorderPatch(
      makeRequest("/api/workorders/TK-V1", { method: "PATCH", body: { action: "DETACH_THEME" } }),
      { params: Promise.resolve({ id: "TK-V1" }) }
    );
    const woDetachJson = await woDetachRes.json();
    assert(woDetachRes.status === 200 && !woDetachJson.cluster_id, "workorders PATCH DETACH_THEME 清除 primaryThemeId");
    const [themeV1AfterDetach] = await tenantDb.select().from(themesTable).where(eq(themesTable.id, "THEME-V1"));
    assert(themeV1AfterDetach?.ticketCount === 0, `DETACH_THEME 后 THEME-V1.ticketCount 重算为 ${themeV1AfterDetach?.ticketCount}`);

    // 7. 验证 /api/review GET & POST 多租户隔离
    const seedRevRes = await reviewPost(
      makeRequest("/api/review/seed", {
        method: "POST",
        body: {
          tickets: [
            { ticketId: "TK-V3", confidence: 55, reason: "LOW_CONFIDENCE" },
            { ticketId: "TK-V2", confidence: 65, reason: "LOW_CONFIDENCE" },
          ],
        },
      })
    );
    const seedRevJson = await seedRevRes.json();
    assert(seedRevRes.status === 200 && seedRevJson.inserted === 2, `POST /api/review/seed 插入 2 条复核项 (${seedRevJson.inserted})`);

    const revGetVerify = await reviewGet(makeRequest("/api/review?status=PENDING"));
    const revGetVerifyJson = await revGetVerify.json();
    const verifyRevIds = (revGetVerifyJson.data || []).map((r: { ticketId: string }) => r.ticketId);
    assert(
      revGetVerify.status === 200 &&
        revGetVerifyJson.regionId === TEST_REGION_ID &&
        verifyRevIds.includes("TK-V3") &&
        verifyRevIds.includes("TK-V2") &&
        revGetVerifyJson.total === 2,
      `GET /api/review?status=PENDING 多租户隔离仅读到 verify_closed_loop 2 条复核项`
    );

    // 只读核验 gz_tianhe 与 fs_shunde 不会读到 verify_closed_loop 的复核项
    const revGetTianhe = await reviewGet(makeRequest("/api/review?status=PENDING", { regionId: "gz_tianhe" }));
    const revGetTianheJson = await revGetTianhe.json();
    const tianheTicketIds = new Set((revGetTianheJson.data || []).map((r: { ticketId: string }) => r.ticketId));
    assert(
      revGetTianheJson.regionId === "gz_tianhe" && !tianheTicketIds.has("TK-V3") && !tianheTicketIds.has("TK-V2"),
      "GET /api/review (gz_tianhe) 不串区读取 verify_closed_loop 数据"
    );

    const revItemV3 = (revGetVerifyJson.data as Array<{ id: string; ticketId: string }>).find((r) => r.ticketId === "TK-V3")!;
    const revItemV2 = (revGetVerifyJson.data as Array<{ id: string; ticketId: string }>).find((r) => r.ticketId === "TK-V2")!;

    const revApproveRes = await reviewPost(
      makeRequest("/api/review", {
        method: "POST",
        body: {
          reviewId: revItemV3.id,
          action: "REVIEWED",
          note: "人工核验并同步修正事件类型",
          correction: { eventType: "路面雨后积水" },
        },
      })
    );
    const revApproveJson = await revApproveRes.json();
    assert(revApproveRes.status === 200 && revApproveJson.data?.status === "REVIEWED", "POST /api/review REVIEWED 成功");
    const [tkV3AfterReview] = await tenantDb.select().from(ticketsTable).where(eq(ticketsTable.id, "TK-V3"));
    assert(tkV3AfterReview?.eventType === "路面雨后积水", "POST /api/review 附带 correction 同步修正工单字段");

    const revDismissRes = await reviewPost(
      makeRequest("/api/review", {
        method: "POST",
        body: { reviewId: revItemV2.id, action: "DISMISSED", note: "忽略误报" },
      })
    );
    const revDismissJson = await revDismissRes.json();
    assert(revDismissRes.status === 200 && revDismissJson.data?.status === "DISMISSED", "POST /api/review DISMISSED 成功");

    const tkV3Logs = await tenantDb
      .select()
      .from(disposalLogsTable)
      .where(eq(disposalLogsTable.targetId, "TK-V3"));
    assert(
      tkV3Logs.some((l) => l.action === "REVIEW_APPROVE") &&
        tkV3Logs.some((l) => l.action === "CORRECT_ENTITY"),
      "disposal_logs 记录工单 REVIEW_APPROVE 与 CORRECT_ENTITY 审计轨迹"
    );

    // 8. 验证 /api/tickets?tab=fake_closure 与 /api/workorders?tab=fake_closure 及 stats
    const ticketsFakeRes = await ticketsGet(makeRequest("/api/tickets?tab=fake_closure"));
    const ticketsFakeJson = await ticketsFakeRes.json();
    const fakeTicketIds = (ticketsFakeJson.data || []).map((t: { id: string }) => t.id);
    assert(
      ticketsFakeRes.status === 200 &&
        fakeTicketIds.includes("TK-V5") &&
        fakeTicketIds.length === 1 &&
        ticketsFakeJson.stats?.fakeClosure === 1 &&
        ticketsFakeJson.stats?.pendingReview === 0,
      `GET /api/tickets?tab=fake_closure 返回正确 (${fakeTicketIds.join(",")}) 且 stats 含 fakeClosure/pendingReview`
    );

    const woFakeRes = await workordersGet(makeRequest("/api/workorders?tab=fake_closure"));
    const woFakeJson = await woFakeRes.json();
    const woFakeIds = (woFakeJson.data || []).map((t: { ticketId: string }) => t.ticketId);
    assert(
      woFakeRes.status === 200 &&
        woFakeIds.includes("TK-V5") &&
        woFakeIds.length === 1 &&
        woFakeJson.stats?.fakeClosure === 1 &&
        woFakeJson.stats?.pendingReview === 0,
      `GET /api/workorders?tab=fake_closure 返回正确 (${woFakeIds.join(",")}) 且 stats 含 fakeClosure/pendingReview`
    );

    // 9. 验证 Copilot propose_theme_action 与 parseCivicActionBlocks
    const copilotTools = createCopilotTools(TEST_REGION_ID);
    const proposeTool = copilotTools.find((t) => t.name === "propose_theme_action") as
      | { name: string; invoke: (input: Record<string, unknown>) => Promise<unknown> }
      | undefined;
    assert(Boolean(proposeTool), "createCopilotTools 包含 propose_theme_action");
    const proposalRaw = await proposeTool!.invoke({ themeId: "THEME-V2", action: "ESCALATE", note: "建议督办" });
    const proposalParsed = JSON.parse(String(proposalRaw));
    assert(
      proposalParsed.ok === true &&
        proposalParsed.executable === false &&
        proposalParsed.requiresConfirmation === true &&
        typeof proposalParsed.actionBlock === "string",
      "propose_theme_action 生成待确认提案且不直接执行改库"
    );
    const blockParsed = parseCivicActionBlocks(`请核查后确认执行：\n${proposalParsed.actionBlock}`);
    assert(
      blockParsed.actions.length === 1 &&
        blockParsed.actions[0].themeId === "THEME-V2" &&
        blockParsed.actions[0].action === "ESCALATE" &&
        !blockParsed.cleanText.includes("civic-action"),
      "parseCivicActionBlocks 正确剥离代码块并解析提案参数"
    );

    // unused import guard check
    void reviewQueueTable;
  } finally {
    await cleanupTestTenant();
    await assertBaselineUnchanged("清理后");
  }

  if (failedAssertions > 0) {
    console.error(`\n❌ 验收测试失败: ${failedAssertions} 项断言未通过`);
    process.exit(1);
  }
  console.log("\n✅ tests/test-closed-loop-disposal.ts 全链路端到端验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
