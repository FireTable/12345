/**
 * M1_P0_Auth_Map 安全与功能单元测试（P0 #1 & P0 #2）
 *
 * 红线守卫：
 * 1. 先加载 ./_auth-helper，确保 .env.local 在导入 middleware.ts / auth config 前注入；
 * 2. 仅使用临时隔离 Schema `verify_p0_m1` 与临时 task_progress 记录，并在 try/finally 物理销毁；
 * 3. 全程不触碰基线数据：region_gz_tianhe (103,397/5,748)、region_fs_shunde (135,666/9,222)、
 *    region_ecom_demo (3,240/40)、public.compute_nodes (0)、public.citizen_submissions (0)。
 */

import { getTestSessionCookie, withAuthHeaders, type TestUserRole } from "./_auth-helper";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db, sql, getRegionDb } from "../db/client";
import { taskProgressTable, vocabulariesTable } from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { GOV_12345_PROFILE } from "../lib/domain-profile";
import { middleware } from "../middleware";
import { GET as sseGet } from "../app/api/sse/route";
import {
  registerController,
  unregisterController,
  broadcastTaskProgress,
  broadcastDataRefresh,
  broadcastPipelineRefresh,
  _resetSseBroadcasterForTesting,
} from "../lib/sse-broadcaster";
import { POST as geocodePost } from "../app/api/map/geocode/route";
import { GET as tileGet } from "../app/api/map/tile/route";
import {
  geocodeAddress,
  reverseGeocode,
  getTiandituTileUrl,
} from "../lib/map/tianditu-service";
import { fetchDistrictBoundary } from "../lib/map/boundary-service";

const TEMP_REGION_ID = "verify_p0_m1";
const TEMP_TASK_ID = `verify-p0-m1-task-${Date.now()}`;

const BASELINE = {
  gz_tianhe: { schema: "region_gz_tianhe", tickets: 103397, themes: 5748 },
  fs_shunde: { schema: "region_fs_shunde", tickets: 135666, themes: 9222 },
  ecom_demo: { schema: "region_ecom_demo", tickets: 3240, themes: 40 },
} as const;

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS: ${msg}`);
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
      `[${stage}] ${id} 基线零污染 (tickets=${actual.tickets}/${expected.tickets}, themes=${actual.themes}/${expected.themes})`
    );
  }
  const [{ cn }] = await sql<Array<{ cn: number }>>`
    SELECT count(*)::int AS cn FROM public.compute_nodes
  `;
  assert(cn === 0, `[${stage}] public.compute_nodes = ${cn} (预期 0)`);
  const [{ reg }] = await sql<Array<{ reg: string | null }>>`
    SELECT to_regclass('public.citizen_submissions')::text AS reg
  `;
  if (reg) {
    const [{ cs }] = await sql<Array<{ cs: number }>>`
      SELECT count(*)::int AS cs FROM public.citizen_submissions
    `;
    assert(cs === 0, `[${stage}] public.citizen_submissions = ${cs} (预期 0)`);
  }
}

async function signCookieValueForTest(token: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sigBuf = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(token));
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  return encodeURIComponent(`${token}.${sigB64}`);
}

async function makeReq(
  pathWithQuery: string,
  init?: {
    method?: string;
    body?: unknown;
    rawBody?: string;
    headers?: Record<string, string>;
    role?: TestUserRole | "anon";
    cookieOverride?: string;
    signal?: AbortSignal;
  }
) {
  const url = `http://localhost:3000${pathWithQuery}`;
  const baseHeaders: Record<string, string> = {
    host: "localhost:3000",
    ...(init?.body !== undefined || init?.rawBody !== undefined
      ? { "content-type": "application/json" }
      : {}),
    ...(init?.headers ?? {}),
  };

  let headers: Headers;
  if (init?.cookieOverride !== undefined) {
    headers = new Headers(baseHeaders);
    if (init.cookieOverride) headers.set("cookie", init.cookieOverride);
  } else if (init?.role === "anon") {
    headers = new Headers(baseHeaders);
  } else {
    headers = await withAuthHeaders(baseHeaders, init?.role ?? "admin");
  }

  return new NextRequest(url, {
    method: init?.method ?? "GET",
    headers,
    signal: init?.signal,
    ...(init?.rawBody !== undefined
      ? { body: init.rawBody }
      : init?.body !== undefined
        ? { body: JSON.stringify(init.body) }
        : {}),
  });
}

async function testMiddlewareAuth() {
  console.log("\n=== 1. Middleware HMAC-SHA256 & Bypass Tests ===");

  const adminCookie = await getTestSessionCookie("admin");
  const userCookie = await getTestSessionCookie("user");
  const adminTokenVal = adminCookie.split("better-auth.session_token=")[1] || "";

  // Tamper 1 character in the Base64 signature
  const decodedAdmin = decodeURIComponent(adminTokenVal);
  const dotIdx = decodedAdmin.lastIndexOf(".");
  const tokenPart = decodedAdmin.slice(0, dotIdx);
  const sigPart = decodedAdmin.slice(dotIdx + 1);
  const flippedChar = sigPart[0] === "A" ? "B" : "A";
  const tamperedCookie = `better-auth.session_token=${encodeURIComponent(`${tokenPart}.${flippedChar}${sigPart.slice(1)}`)}`;

  const invalidCookies = [
    "",
    "better-auth.session_token=fake",
    "better-auth.session_token=foo.bar",
    "__Secure-better-auth.session_token=fake",
    tamperedCookie,
    `better-auth.session_token=${encodeURIComponent(`${tokenPart}.${"A".repeat(44)}`)}`,
  ];

  for (const ck of invalidCookies) {
    const label = ck ? ck.slice(0, 48) : "<empty>";
    const sseRes = await middleware(await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { cookieOverride: ck }));
    assert(sseRes.status === 401, `middleware /api/sse 拒绝无效 Cookie (${label}) -> ${sseRes.status}`);

    const geoRes = await middleware(
      await makeReq("/api/map/geocode", { method: "POST", cookieOverride: ck, body: { address: "test" } })
    );
    assert(geoRes.status === 401, `middleware /api/map/geocode 拒绝无效 Cookie (${label}) -> ${geoRes.status}`);

    const pageRes = await middleware(await makeReq("/themes", { cookieOverride: ck }));
    assert(
      pageRes.status === 307 && (pageRes.headers.get("location") || "").includes("/login"),
      `middleware /themes 拒绝无效 Cookie 并跳转 /login (${label}) -> ${pageRes.status}`
    );
  }

  // Dot-path API cannot skip auth via pathname.includes(".")
  const dotApiRes = await middleware(
    await makeReq("/api/workorders/item.json", { cookieOverride: "better-auth.session_token=fake" })
  );
  assert(dotApiRes.status === 401, `middleware 带点号 /api/workorders/item.json 不可绕过鉴权 -> ${dotApiRes.status}`);

  // Static / well-known / public APIs still pass
  const wellKnownRes = await middleware(
    await makeReq("/.well-known/oauth-authorization-server", { role: "anon" })
  );
  assert(wellKnownRes.status === 200, `middleware /.well-known/* 放行 -> ${wellKnownRes.status}`);

  const faviconRes = await middleware(await makeReq("/favicon.ico", { role: "anon" }));
  assert(faviconRes.status === 200, `middleware /favicon.ico 放行 -> ${faviconRes.status}`);

  // Protected dynamic/dot pages must NOT bypass Edge auth
  for (const dotPage of [
    "/themes/foo.bar",
    "/themes/foo.json",
    "/tickets/1.2",
    "/admin/regions/test.html",
  ]) {
    const res = await middleware(await makeReq(dotPage, { role: "anon" }));
    assert(
      res.status === 307 && (res.headers.get("location") || "").includes("/login"),
      `middleware 匿名访问受保护带点页面 ${dotPage} 不可绕过 -> ${res.status}`
    );
  }

  // Prefix boundaries: sibling paths must NOT bypass auth
  for (const evilApi of ["/api/map/tile-evil", "/api/auth-evil", "/api/regions-evil", "/api/mcp/grant"]) {
    const res = await middleware(await makeReq(evilApi, { role: "anon" }));
    assert(res.status === 401, `middleware 前缀边界拦截 ${evilApi} -> ${res.status}`);
  }
  const loginEvilRes = await middleware(await makeReq("/login-evil", { role: "anon" }));
  assert(
    loginEvilRes.status === 307 && (loginEvilRes.headers.get("location") || "").includes("/login"),
    `middleware /login-evil 不可绕过鉴权 -> ${loginEvilRes.status}`
  );

  // Double-encoded cookie (%253D) must be rejected consistently with Better Auth
  const doubleEncodedCookie = `better-auth.session_token=${encodeURIComponent(adminTokenVal)}`;
  const doubleEncodedRes = await middleware(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { cookieOverride: doubleEncodedCookie })
  );
  assert(
    doubleEncodedRes.status === 401,
    `middleware 拒绝双重 URL 编码 Cookie (%253D) -> ${doubleEncodedRes.status}`
  );

  const tilePublicRes = await middleware(
    await makeReq("/api/map/tile?type=vec&z=12&x=3337&y=1775", { role: "anon" })
  );
  assert(tilePublicRes.status === 200, `middleware /api/map/tile 公开瓦片代理放行 -> ${tilePublicRes.status}`);

  const regionsPublicRes = await middleware(await makeReq("/api/regions", { role: "anon" }));
  assert(regionsPublicRes.status === 200, `middleware /api/regions 放行 -> ${regionsPublicRes.status}`);

  // Valid admin & user & __Secure- prefix pass middleware
  const validAdminSse = await middleware(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { cookieOverride: adminCookie })
  );
  assert(validAdminSse.status === 200, `middleware 合法 admin Cookie 放行 /api/sse -> ${validAdminSse.status}`);

  const validUserGeo = await middleware(
    await makeReq("/api/map/geocode", { method: "POST", cookieOverride: userCookie, body: { address: "test" } })
  );
  assert(validUserGeo.status === 200, `middleware 合法签名 user Cookie 放行至 route handler (由 requireAdmin 拦 403) -> ${validUserGeo.status}`);

  const securePrefixCookie = `__Secure-better-auth.session_token=${adminTokenVal}`;
  const validSecureRes = await middleware(
    await makeReq("/", { cookieOverride: securePrefixCookie })
  );
  assert(validSecureRes.status === 200, `middleware 合法 __Secure-better-auth.session_token 放行 / -> ${validSecureRes.status}`);
}

function createStreamCollector(body: ReadableStream<Uint8Array>) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let done = false;
  const waiter: { cb: (() => void) | null } = { cb: null };

  const wake = () => {
    const cb = waiter.cb;
    waiter.cb = null;
    if (cb) cb();
  };

  const loop = (async () => {
    try {
      while (!done) {
        const { value, done: streamDone } = await reader.read();
        if (streamDone) {
          done = true;
          break;
        }
        if (value) {
          buffer += decoder.decode(value, { stream: true });
          wake();
        }
      }
    } catch {
      done = true;
    } finally {
      wake();
    }
  })();

  return {
    getText: () => buffer,
    async waitFor(predicate: (text: string) => boolean, timeoutMs: number): Promise<string> {
      const deadline = Date.now() + timeoutMs;
      while (!predicate(buffer) && !done && Date.now() < deadline) {
        const remaining = Math.max(10, deadline - Date.now());
        await Promise.race([
          new Promise<void>((resolve) => {
            waiter.cb = resolve;
          }),
          new Promise<void>((resolve) => setTimeout(resolve, remaining)),
        ]);
      }
      return buffer;
    },
    async close() {
      done = true;
      await reader.cancel().catch(() => {});
      await loop.catch(() => {});
    },
  };
}

async function testSseBroadcasterRoleSplit() {
  console.log("\n=== 2. lib/sse-broadcaster.ts Role Split Tests ===");
  _resetSseBroadcasterForTesting();

  const decoder = new TextDecoder();
  const makeMockController = () => {
    const chunks: string[] = [];
    const controller = {
      desiredSize: 1,
      enqueue(chunk: Uint8Array) {
        chunks.push(decoder.decode(chunk));
      },
      close() {},
      error() {},
    } as unknown as ReadableStreamDefaultController<Uint8Array>;
    return { controller, chunks };
  };

  const adminMock = makeMockController();
  const userMock = makeMockController();
  const defaultRoleMock = makeMockController();

  const cleanupAdmin = registerController(TEMP_REGION_ID, adminMock.controller, "admin");
  const cleanupUser = registerController(TEMP_REGION_ID, userMock.controller, "user");
  // Omitted role must fail closed to "user"
  const cleanupDefault = registerController(TEMP_REGION_ID, defaultRoleMock.controller);

  // Wait briefly for initial async snapshot on admin
  await new Promise((r) => setTimeout(r, 150));

  const sensitiveTaskProgress = {
    taskId: TEMP_TASK_ID,
    regionId: TEMP_REGION_ID,
    status: "RUNNING",
    stage: "EXTRACTING",
    percent: 45,
    total: 100,
    processed: 45,
    currentSubject: "涉密涉事主体XYZ",
    currentReasoning: "敏感研判推理过程",
    endpointRecentTickets: {
      "http://10.0.0.1:8080/v1": [{ id: "t1", ticketNo: "NO-999", address: "秘密地址1号", processedAt: Date.now() }],
    },
  };

  await broadcastTaskProgress(TEMP_REGION_ID, sensitiveTaskProgress);
  broadcastPipelineRefresh(TEMP_REGION_ID);
  broadcastDataRefresh(TEMP_REGION_ID);

  const adminText = adminMock.chunks.join("");
  const userText = userMock.chunks.join("");
  const defaultText = defaultRoleMock.chunks.join("");

  assert(adminText.includes(`"type":"task-progress"`), "broadcaster admin 收到 task-progress");
  assert(adminText.includes(`"type":"pipeline-state-refresh"`), "broadcaster admin 收到 pipeline-state-refresh");
  assert(adminText.includes(`"type":"civic-data-refresh"`), "broadcaster admin 收到 civic-data-refresh");

  assert(!userText.includes("task-progress"), "broadcaster user 绝不收到 task-progress");
  assert(!userText.includes("pipeline-state-refresh"), "broadcaster user 绝不收到 pipeline-state-refresh");
  assert(!userText.includes("涉密涉事主体XYZ") && !userText.includes("endpointRecentTickets"), "broadcaster user 绝不收到敏感主体/节点信息");
  assert(
    userText.trim() === `data: {"type":"civic-data-refresh","regionId":"${TEMP_REGION_ID}"}`,
    `broadcaster user 仅收到最小化 civic-data-refresh -> ${userText.trim()}`
  );

  assert(!defaultText.includes("task-progress") && !defaultText.includes("pipeline-state-refresh"), "broadcaster 省略 role 时 fail-closed 为 user");
  assert(defaultText.includes(`"type":"civic-data-refresh"`), "broadcaster 省略 role 时可收到 civic-data-refresh");

  // Unregister & verify cleanup
  cleanupUser();
  unregisterController(TEMP_REGION_ID, defaultRoleMock.controller);
  const beforeUserLen = userMock.chunks.length;
  const beforeDefaultLen = defaultRoleMock.chunks.length;
  broadcastDataRefresh(TEMP_REGION_ID);
  assert(
    userMock.chunks.length === beforeUserLen && defaultRoleMock.chunks.length === beforeDefaultLen,
    "unregisterController / cleanup 后不再向已注销订阅者推送"
  );

  // When only user remains, broadcastTaskProgress skips pushing
  cleanupAdmin();
  const userOnlyMock = makeMockController();
  const cleanupUserOnly = registerController(TEMP_REGION_ID, userOnlyMock.controller, "user");
  await broadcastTaskProgress(TEMP_REGION_ID, sensitiveTaskProgress);
  assert(userOnlyMock.chunks.length === 0, "仅 user 订阅时 broadcastTaskProgress 不发送任何帧");
  cleanupUserOnly();

  _resetSseBroadcasterForTesting();
}

async function testSseRouteAuthAndStream() {
  console.log("\n=== 3. GET /api/sse Auth, Validation & Role Streaming Tests ===");
  _resetSseBroadcasterForTesting();

  // 1) Unauthenticated & forged -> 401
  const unauthRes = await sseGet(await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { role: "anon" }));
  assert(unauthRes.status === 401, `GET /api/sse 无 Cookie 返回 401 -> ${unauthRes.status}`);

  const forgedRes = await sseGet(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, {
      cookieOverride: "better-auth.session_token=forged-cookie-value",
    })
  );
  assert(forgedRes.status === 401, `GET /api/sse 伪造 Cookie 返回 401 -> ${forgedRes.status}`);

  // 2) Valid HMAC signature but token NOT in DB -> 401 (proves DB session check via getRequestSession)
  const secret = process.env.BETTER_AUTH_SECRET || "civic-12345-auth-secret-key-production-dev-mode";
  const signedNonDb = await signCookieValueForTest("nonexistent-session-token-12345", secret);
  const nonDbRes = await sseGet(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, {
      cookieOverride: `better-auth.session_token=${signedNonDb}`,
    })
  );
  assert(nonDbRes.status === 401, `GET /api/sse 有效 HMAC 但无 DB 会话返回 401 -> ${nonDbRes.status}`);

  // 3) Missing / malformed / unknown regionId -> 400 / 404
  const missingRegionRes = await sseGet(await makeReq("/api/sse", { role: "admin" }));
  assert(missingRegionRes.status === 400, `GET /api/sse 缺 regionId 返回 400 -> ${missingRegionRes.status}`);

  const badRegionRes = await sseGet(await makeReq("/api/sse?regionId=bad!region", { role: "admin" }));
  assert(badRegionRes.status === 400, `GET /api/sse 非法 regionId 返回 400 -> ${badRegionRes.status}`);

  const bogusRegionRes = await sseGet(await makeReq("/api/sse?regionId=region_bogus_999", { role: "admin" }));
  assert(bogusRegionRes.status === 404, `GET /api/sse 不存在站点返回 404 -> ${bogusRegionRes.status}`);

  // 4) Insert temporary task_progress row so admin gets initial snapshot while user gets none
  await db
    .insert(taskProgressTable)
    .values({
      taskId: TEMP_TASK_ID,
      regionId: TEMP_REGION_ID,
      status: "RUNNING",
      stage: "EXTRACTING",
      stageText: "测试中",
      percent: 50,
      total: 10,
      processed: 5,
      extractedCount: 5,
      themeCount: 1,
      reviewCount: 0,
      failedCount: 0,
      updatedAt: new Date(),
    })
    .onConflictDoNothing();

  // User stream
  const userAbort = new AbortController();
  const userSseRes = await sseGet(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { role: "user", signal: userAbort.signal })
  );
  assert(userSseRes.status === 200 && Boolean(userSseRes.body), `GET /api/sse 合法 user 返回 200 -> ${userSseRes.status}`);
  const userCollector = createStreamCollector(userSseRes.body!);
  await userCollector.waitFor((t) => t.includes(": connected "), 1000);
  await broadcastTaskProgress(TEMP_REGION_ID, { taskId: TEMP_TASK_ID, currentSubject: "SECRET_SUBJ" });
  broadcastPipelineRefresh(TEMP_REGION_ID);
  broadcastDataRefresh(TEMP_REGION_ID);
  const userCombined = await userCollector.waitFor(
    (t) => t.includes(`"type":"civic-data-refresh"`),
    1000
  );
  // Give a brief window to ensure no delayed admin frames arrive
  await new Promise((r) => setTimeout(r, 100));
  const userFinal = userCollector.getText();
  assert(userFinal.includes(": connected "), "GET /api/sse user 收到 : connected 注释帧");
  assert(
    !userFinal.includes("task-progress") &&
      !userFinal.includes("pipeline-state-refresh") &&
      !userFinal.includes("SECRET_SUBJ"),
    "GET /api/sse user 绝不收到 task-progress 或 pipeline-state-refresh"
  );
  assert(userCombined.includes(`"type":"civic-data-refresh"`), "GET /api/sse user 可收到 civic-data-refresh");
  userAbort.abort();
  await userCollector.close();

  // Admin stream
  const adminAbort = new AbortController();
  const adminSseRes = await sseGet(
    await makeReq(`/api/sse?regionId=${TEMP_REGION_ID}`, { role: "admin", signal: adminAbort.signal })
  );
  assert(adminSseRes.status === 200 && Boolean(adminSseRes.body), `GET /api/sse 合法 admin 返回 200 -> ${adminSseRes.status}`);
  const adminCollector = createStreamCollector(adminSseRes.body!);
  const adminInitial = await adminCollector.waitFor(
    (t) => t.includes(": connected ") && t.includes(`"type":"task-progress"`),
    3000
  );
  assert(adminInitial.includes(": connected "), "GET /api/sse admin 收到 : connected 注释帧");
  assert(
    adminInitial.includes(`"type":"task-progress"`) && adminInitial.includes(TEMP_TASK_ID),
    "GET /api/sse admin 收到初始 task-progress 快照"
  );
  adminAbort.abort();
  await adminCollector.close();

  // 5) Direct unregisterController immediately after registerController must suppress initial async snapshot
  const raceChunks: string[] = [];
  const raceDecoder = new TextDecoder();
  const raceController = {
    desiredSize: 1,
    enqueue(chunk: Uint8Array) {
      raceChunks.push(raceDecoder.decode(chunk));
    },
    close() {},
    error() {},
  } as unknown as ReadableStreamDefaultController<Uint8Array>;
  registerController(TEMP_REGION_ID, raceController, "admin");
  unregisterController(TEMP_REGION_ID, raceController);
  await new Promise((r) => setTimeout(r, 250));
  assert(
    raceChunks.length === 0,
    `unregisterController 立即取消后抑制初始异步快照 -> chunks=${raceChunks.length}`
  );

  _resetSseBroadcasterForTesting();
}

async function testGeocodeAuthAndValidation() {
  console.log("\n=== 4. POST /api/map/geocode Auth & Validation Tests ===");

  // 1) Auth checks
  const anonRes = await geocodePost(
    await makeReq("/api/map/geocode", { method: "POST", role: "anon", body: { address: "天河路1号" } })
  );
  assert(anonRes.status === 401, `POST /api/map/geocode 匿名请求返回 401 -> ${anonRes.status}`);

  const forgedRes = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      cookieOverride: "better-auth.session_token=fake",
      body: { address: "天河路1号" },
    })
  );
  assert(forgedRes.status === 401, `POST /api/map/geocode 伪造 Cookie 返回 401 -> ${forgedRes.status}`);

  const citizenRes = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "user",
      body: {
        regionId: TEMP_REGION_ID,
        address: "越权写入测试地点",
        overrideLng: 113.25,
        overrideLat: 22.84,
      },
    })
  );
  assert(citizenRes.status === 403, `POST /api/map/geocode 普通用户返回 403 -> ${citizenRes.status}`);

  const { db: tempDb } = await getRegionDb(TEMP_REGION_ID);
  const rowsAfterCitizen = await tempDb
    .select()
    .from(vocabulariesTable)
    .where(eq(vocabulariesTable.type, "LOCATION"));
  assert(rowsAfterCitizen.length === 0, "普通用户被 403 拒绝后临时站点 vocabularies 零写入");

  // 2) Admin input validation
  const badJsonRes = await geocodePost(
    await makeReq("/api/map/geocode", { method: "POST", role: "admin", rawBody: "{bad json" })
  );
  assert(badJsonRes.status === 400, `POST /api/map/geocode 非法 JSON 返回 400 -> ${badJsonRes.status}`);

  const arrayBodyRes = await geocodePost(
    await makeReq("/api/map/geocode", { method: "POST", role: "admin", body: [1, 2, 3] })
  );
  assert(arrayBodyRes.status === 400, `POST /api/map/geocode 非对象 JSON 返回 400 -> ${arrayBodyRes.status}`);

  const badCases: Array<{ label: string; body: Record<string, unknown> }> = [
    { label: "非法 mode", body: { regionId: TEMP_REGION_ID, mode: "hack", address: "abc" } },
    { label: "空 address", body: { regionId: TEMP_REGION_ID, address: "   " } },
    { label: "超长 address (>128)", body: { regionId: TEMP_REGION_ID, address: "a".repeat(129) } },
    { label: "超长 formattedAddress (>255)", body: { regionId: TEMP_REGION_ID, address: "地点A", formattedAddress: "x".repeat(256) } },
    { label: "超长 township (>128)", body: { regionId: TEMP_REGION_ID, address: "地点A", township: "t".repeat(129) } },
    { label: "overrideLng 越界 181", body: { regionId: TEMP_REGION_ID, address: "地点A", overrideLng: 181, overrideLat: 22 } },
    { label: "overrideLat 越界 -91", body: { regionId: TEMP_REGION_ID, address: "地点A", overrideLng: 113, overrideLat: -91 } },
    { label: "仅传 overrideLng 未传 overrideLat", body: { regionId: TEMP_REGION_ID, address: "地点A", overrideLng: 113.2 } },
    { label: "overrideLng 非纯数字 '113abc'", body: { regionId: TEMP_REGION_ID, address: "地点A", overrideLng: "113abc", overrideLat: 22.8 } },
    { label: "overrideLng 布尔值 true", body: { regionId: TEMP_REGION_ID, address: "地点A", overrideLng: true, overrideLat: 22.8 } },
    { label: "reverse 模式 lng 越界 200", body: { regionId: TEMP_REGION_ID, mode: "reverse", lng: 200, lat: 22.8 } },
  ];

  for (const c of badCases) {
    const res = await geocodePost(
      await makeReq("/api/map/geocode", { method: "POST", role: "admin", body: c.body })
    );
    assert(res.status === 400, `POST /api/map/geocode 拦截 ${c.label} -> ${res.status}`);
  }

  // 3) Valid admin write & (0, 0) coordinate cache regression test
  const zeroWriteRes = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "admin",
      body: {
        regionId: TEMP_REGION_ID,
        address: "赤道本初子午线零点测试",
        overrideLng: 0,
        overrideLat: 0,
        formattedAddress: "零点测试标准地点",
        township: "测试街道",
      },
    })
  );
  const zeroWriteJson = await zeroWriteRes.json();
  assert(
    zeroWriteRes.status === 200 && zeroWriteJson.data?.lng === 0 && zeroWriteJson.data?.lat === 0,
    `POST /api/map/geocode admin 写入 (0, 0) 坐标成功 -> ${zeroWriteRes.status}`
  );

  // Subsequent read must hit cache and return lng=0, lat=0
  const zeroCacheRes = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "admin",
      body: {
        regionId: TEMP_REGION_ID,
        address: "赤道本初子午线零点测试",
      },
    })
  );
  const zeroCacheJson = await zeroCacheRes.json();
  assert(
    zeroCacheRes.status === 200 &&
      zeroCacheJson.data?.fromCache === true &&
      zeroCacheJson.data?.lng === 0 &&
      zeroCacheJson.data?.lat === 0 &&
      zeroCacheJson.data?.township === "测试街道",
    `POST /api/map/geocode (0, 0) 缓存命中不因 falsy 丢失 -> fromCache=${zeroCacheJson.data?.fromCache}, lng=${zeroCacheJson.data?.lng}, lat=${zeroCacheJson.data?.lat}`
  );

  // 4) >= 9 CJK chars sharing an 8-char prefix must NOT collide in vocabularies cache
  const addr100 = "广州市天河区天河南街道体育西路100号";
  const addr200 = "广州市天河区天河南街道体育西路200号";
  const write100Res = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "admin",
      body: { regionId: TEMP_REGION_ID, address: addr100, overrideLng: 113.321, overrideLat: 23.131 },
    })
  );
  const write200Res = await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "admin",
      body: { regionId: TEMP_REGION_ID, address: addr200, overrideLng: 113.999, overrideLat: 23.999 },
    })
  );
  assert(write100Res.status === 200 && write200Res.status === 200, "同前缀长中文地址双写入成功");

  const read100Res = await geocodePost(
    await makeReq("/api/map/geocode", { method: "POST", role: "admin", body: { regionId: TEMP_REGION_ID, address: addr100 } })
  );
  const read200Res = await geocodePost(
    await makeReq("/api/map/geocode", { method: "POST", role: "admin", body: { regionId: TEMP_REGION_ID, address: addr200 } })
  );
  const read100Json = await read100Res.json();
  const read200Json = await read200Res.json();
  assert(
    read100Json.data?.fromCache === true &&
      read100Json.data?.lng === 113.321 &&
      read100Json.data?.lat === 23.131 &&
      read200Json.data?.fromCache === true &&
      read200Json.data?.lng === 113.999 &&
      read200Json.data?.lat === 23.999,
    `同8字前缀长中文地址互不覆盖缓存 -> 100号=(${read100Json.data?.lng},${read100Json.data?.lat}), 200号=(${read200Json.data?.lng},${read200Json.data?.lat})`
  );

  // 5) Legacy pre-M1 LOC-<base64> row reuse without duplicate row creation
  const legacyAddr = "广州市天河区天河南街道体育西路300号";
  await tempDb.insert(vocabulariesTable).values({
    id: "LOC-legacy-pre-m1-row",
    type: "LOCATION",
    name: legacyAddr,
    fullName: legacyAddr,
    metaJson: JSON.stringify({ lng: 113.1, lat: 23.1 }),
    isStandard: true,
  });
  await geocodePost(
    await makeReq("/api/map/geocode", {
      method: "POST",
      role: "admin",
      body: { regionId: TEMP_REGION_ID, address: legacyAddr, overrideLng: 113.456, overrideLat: 23.456 },
    })
  );
  const legacyRows = await tempDb
    .select()
    .from(vocabulariesTable)
    .where(eq(vocabulariesTable.name, legacyAddr));
  assert(
    legacyRows.length === 1 && legacyRows[0].id === "LOC-legacy-pre-m1-row",
    `旧 LOC-<base64> 词条原地更新不重复建行 -> count=${legacyRows.length}, id=${legacyRows[0]?.id}`
  );
}

async function testTileProxyAndMapServices() {
  console.log("\n=== 5. Tile Proxy, Tianditu & Boundary Hardening Tests ===");

  // 1) Invalid query parameters -> 400
  const invalidTileQueries = [
    "/api/map/tile?type=foo&z=12&x=3337&y=1775",
    "/api/map/tile?type=vec%26evil=1&z=12&x=3337&y=1775",
    "/api/map/tile?type=&z=12&x=3337&y=1775",
    "/api/map/tile?type=vec&z=-1&x=0&y=0",
    "/api/map/tile?type=vec&z=19&x=0&y=0",
    "/api/map/tile?type=vec&z=1.5&x=0&y=0",
    "/api/map/tile?type=vec&z=12&x=abc&y=1775",
    "/api/map/tile?type=vec&z=12&x=1abc&y=1775",
    "/api/map/tile?type=vec&z=0&x=1&y=0",
    "/api/map/tile?type=vec&z=2&x=4&y=0",
  ];
  for (const q of invalidTileQueries) {
    const res = await tileGet(await makeReq(q, { role: "anon" }));
    assert(res.status === 400, `GET ${q} 返回 400 -> ${res.status}`);
  }

  // 2) Mock globalThis.fetch to test non-image, empty body, timeout, and fallback caching
  const origFetch = globalThis.fetch;
  let fetchCalls: Array<{ url: string; hasAbortSignal: boolean }> = [];
  let mode: "html" | "empty" | "oversized" | "timeout" | "fallback_ok" = "html";

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    fetchCalls.push({ url, hasAbortSignal: init?.signal instanceof AbortSignal });

    if (mode === "html") {
      return new Response("<html>WAF blocked</html>", {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" },
      });
    }
    if (mode === "empty") {
      return new Response(new Uint8Array(0), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (mode === "oversized") {
      return new Response(new Uint8Array(5 * 1024 * 1024 + 1), {
        status: 200,
        headers: { "content-type": "image/png" },
      });
    }
    if (mode === "timeout") {
      const err = new Error("The operation timed out");
      err.name = "TimeoutError";
      throw err;
    }
    // fallback_ok: primary returns 200 text/html, autonavi fallback returns 200 image/png
    if (url.includes("tianditu.gov.cn")) {
      return new Response(JSON.stringify({ error: "waf" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    return new Response(new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), {
      status: 200,
      headers: { "content-type": "image/png" },
    });
  }) as typeof fetch;

  try {
    // 2a) HTML response on primary & fallback -> 502, NOT cached
    mode = "html";
    fetchCalls = [];
    const htmlRes1 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1001&y=2001", { role: "anon" }));
    const htmlCalls1 = fetchCalls.length;
    const htmlRes2 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1001&y=2001", { role: "anon" }));
    assert(
      htmlRes1.status === 502 && htmlRes2.status === 502 && htmlCalls1 === 2 && fetchCalls.length === 4,
      `GET /api/map/tile 上游返回 200 text/html 时拒绝并返回 502 且不缓存 (calls=${fetchCalls.length})`
    );
    assert(
      fetchCalls.every((c) => c.hasAbortSignal),
      "GET /api/map/tile primary/fallback fetch 均携带 AbortSignal"
    );

    // 2b) Empty image body -> 502, NOT cached
    mode = "empty";
    fetchCalls = [];
    const emptyRes1 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1002&y=2002", { role: "anon" }));
    const emptyRes2 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1002&y=2002", { role: "anon" }));
    assert(
      emptyRes1.status === 502 && emptyRes2.status === 502 && fetchCalls.length === 4,
      `GET /api/map/tile 空响应体返回 502 且不缓存 (calls=${fetchCalls.length})`
    );

    // 2b2) Oversized image (>5MB) -> 502, NOT cached
    mode = "oversized";
    fetchCalls = [];
    const overRes1 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1005&y=2005", { role: "anon" }));
    const overRes2 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1005&y=2005", { role: "anon" }));
    assert(
      overRes1.status === 502 && overRes2.status === 502 && fetchCalls.length === 4,
      `GET /api/map/tile 超大响应 (>5MB) 返回 502 且不缓存 (calls=${fetchCalls.length})`
    );

    // 2c) TimeoutError -> 504, NOT cached
    mode = "timeout";
    fetchCalls = [];
    const toRes1 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1003&y=2003", { role: "anon" }));
    const toRes2 = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1003&y=2003", { role: "anon" }));
    assert(
      toRes1.status === 504 && toRes2.status === 504 && fetchCalls.length === 4,
      `GET /api/map/tile 超时返回 504 且不缓存 (calls=${fetchCalls.length})`
    );

    // 2d) Primary 200 JSON triggers fallback, fallback 200 image/png is cached -> MISS then HIT
    mode = "fallback_ok";
    fetchCalls = [];
    const okMiss = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1004&y=2004", { role: "anon" }));
    const callsAfterMiss = fetchCalls.length;
    const okHit = await tileGet(await makeReq("/api/map/tile?type=vec&z=15&x=1004&y=2004", { role: "anon" }));
    assert(
      okMiss.status === 200 &&
        okMiss.headers.get("X-Tile-Cache") === "MISS" &&
        okHit.status === 200 &&
        okHit.headers.get("X-Tile-Cache") === "HIT" &&
        callsAfterMiss === 2 &&
        fetchCalls.length === 2,
      `GET /api/map/tile 主源返回 JSON 时成功降级高德并仅缓存有效图片 (MISS->HIT, calls=${fetchCalls.length})`
    );

    // 3) tianditu-service.ts & boundary-service.ts
    const validTileUrl = getTiandituTileUrl("vec", 12, 3337, 1775);
    assert(
      /^http:\/\/t[0-7]\.tianditu\.gov\.cn\/vec_w\/wmts\?/.test(validTileUrl) &&
        !validTileUrl.includes("undefined"),
      `getTiandituTileUrl 合法参数返回规范天地图 URL -> ${validTileUrl.slice(0, 60)}...`
    );

    const invalidTileUrlCases: Array<[any, number, number, number]> = [
      ["evil", 12, 1, 1],
      ["vec", -1, 0, 0],
      ["vec", 19, 0, 0],
      ["vec", 12, -1, 1],
      ["vec", 12, 1, -1],
      ["vec", 0, 1, 0],
      ["vec", 1.5, 0, 0],
    ];
    for (const [t, z, x, y] of invalidTileUrlCases) {
      let threw = false;
      try {
        getTiandituTileUrl(t, z, x, y);
      } catch {
        threw = true;
      }
      assert(threw, `getTiandituTileUrl 拒绝非法参数 (${String(t)}, z=${z}, x=${x}, y=${y})`);
    }

    const revBadCoord = await reverseGeocode(200, 0);
    assert(!revBadCoord.success, "reverseGeocode 拒绝越界经度 200");

    // Verify geocodeAddress, reverseGeocode, and fetchDistrictBoundary pass AbortSignal
    const prevTiandituKey = process.env.TIANDITU_SERVER_KEY;
    process.env.TIANDITU_SERVER_KEY = "test-key-for-signal";
    try {
      fetchCalls = [];
      await geocodeAddress("天河南街道体育西路");
      const geoHasSignal = fetchCalls.length > 0 && fetchCalls.every((c) => c.hasAbortSignal);
      assert(geoHasSignal, "geocodeAddress fetch 携带 AbortSignal");

      fetchCalls = [];
      await reverseGeocode(113.324, 23.134);
      const revHasSignal = fetchCalls.length > 0 && fetchCalls.every((c) => c.hasAbortSignal);
      assert(revHasSignal, "reverseGeocode fetch 携带 AbortSignal");
    } finally {
      if (prevTiandituKey === undefined) delete process.env.TIANDITU_SERVER_KEY;
      else process.env.TIANDITU_SERVER_KEY = prevTiandituKey;
    }

    for (const badAdcode of [123, 99999, 1000000, 440606.5]) {
      const badBnd = await fetchDistrictBoundary("顺德区", "佛山市", badAdcode);
      assert(!badBnd.success, `fetchDistrictBoundary 拒绝非法 adcode=${badAdcode}`);
    }

    fetchCalls = [];
    await fetchDistrictBoundary("顺德区", "佛山市", 440606);
    assert(
      fetchCalls.length === 1 && fetchCalls[0].hasAbortSignal,
      "fetchDistrictBoundary fetch 携带 AbortSignal"
    );
  } finally {
    globalThis.fetch = origFetch;
  }
}

async function cleanupTempArtifacts() {
  _resetSseBroadcasterForTesting();
  await db.delete(taskProgressTable).where(eq(taskProgressTable.taskId, TEMP_TASK_ID)).catch(() => {});
  await destroyRegionTenant(sql, TEMP_REGION_ID).catch(() => {});
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEMP_REGION_ID}" CASCADE;`).catch(() => {});
  await sql.unsafe(`DROP SCHEMA IF EXISTS "region_${TEMP_REGION_ID}" CASCADE;`).catch(() => {});
}

async function main() {
  const prevAppDomain = process.env.APP_DOMAIN;
  process.env.APP_DOMAIN = "ALL";

  await assertBaselineUnchanged("前置");
  await cleanupTempArtifacts();

  try {
    await registerRegion(sql, {
      id: TEMP_REGION_ID,
      name: "M1安全验收区",
      city: "佛山市",
      province: "广东省",
      schemaName: TEMP_REGION_ID,
      isDefault: false,
      categoryConfigJson: JSON.stringify({ domainProfile: GOV_12345_PROFILE }),
      description: "M1 P0 #1 & #2 临时隔离验证站点",
    });

    await testMiddlewareAuth();
    await testSseBroadcasterRoleSplit();
    await testSseRouteAuthAndStream();
    await testGeocodeAuthAndValidation();
    await testTileProxyAndMapServices();
  } finally {
    if (prevAppDomain === undefined) delete process.env.APP_DOMAIN;
    else process.env.APP_DOMAIN = prevAppDomain;

    await cleanupTempArtifacts();
    await assertBaselineUnchanged("清理后");

    const leftovers = await sql<Array<{ schema_name: string }>>`
      SELECT schema_name FROM information_schema.schemata
      WHERE schema_name IN (${TEMP_REGION_ID}, ${`region_${TEMP_REGION_ID}`})
    `;
    assert(leftovers.length === 0, `[清理检查] 无残留 ${TEMP_REGION_ID} schema (${leftovers.length})`);
  }

  console.log(`\n断言汇总: ${passed} PASS / ${failed} FAIL`);
  if (failed > 0) {
    process.exit(1);
  }
  console.log("✅ tests/test-p0-m1-auth-map.ts 全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
