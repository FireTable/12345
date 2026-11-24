/**
 * 双端隔离式 AI 外呼全链路测试：
 * - 临时租户 `verify_outreach_dual` + 临时市民用户 `verify_outreach_citizen`，finally 中彻底清理；
 * - 覆盖：管理员发起外呼(RINGING) -> 用户端主动拉取并隐藏内部推理 -> 管理员调用用户端 reply 接口被 403 拦截 ->
 *   用户接听(ANSWER) -> 用户回复补全缺失要素 -> 写回 tickets & agent_tasks(EXECUTED) ->
 *   管理端查询返回用户原话 + AI 推理(reasoning) + extractedPatch -> 拒绝/取消/L3熔断保护。
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { withAuthHeaders } from "./_auth-helper";
import { auth } from "../lib/auth/config";
import { sql, getRegionDb } from "../db/client";
import { ticketsTable } from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { GOV_12345_PROFILE } from "../lib/domain-profile";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import {
  invalidateAgentGovernanceCache,
  createOrReuseMissingInfoTask,
} from "../lib/agent-governance";
import { POST as intakeSubmitPost } from "../app/api/intake/submit/route";
import { POST as agentOutreachStartPost } from "../app/api/agent/outreach/sessions/route";
import { GET as outreachActiveGet } from "../app/api/outreach/active/route";
import { GET as outreachDetailGet } from "../app/api/outreach/sessions/[id]/route";
import { POST as outreachActionPost } from "../app/api/outreach/sessions/[id]/action/route";
import { POST as outreachReplyPost } from "../app/api/outreach/sessions/[id]/reply/route";

const TEST_REGION_ID = "verify_outreach_dual";
const TEMP_CITIZEN_USER = `verify_citizen_${Date.now()}`;
const TEMP_CITIZEN_PASS = `VerifyPass_${Date.now()}!`;

async function getCitizenAuthCookie(): Promise<{ userId: string; cookie: string }> {
  const email = `${TEMP_CITIZEN_USER}@example.test`;
  await auth.api.signUpEmail({
    body: {
      email,
      password: TEMP_CITIZEN_PASS,
      name: "临时验证市民",
      username: TEMP_CITIZEN_USER,
    },
  });

  const [userRow] = await sql<Array<{ id: string }>>`
    SELECT id FROM public."user" WHERE username = ${TEMP_CITIZEN_USER} LIMIT 1
  `;
  assert.ok(userRow?.id, "临时市民账号创建成功");
  await sql`UPDATE public."user" SET role = 'user' WHERE id = ${userRow.id}`;

  const signInRes = await auth.api.signInUsername({
    body: { username: TEMP_CITIZEN_USER, password: TEMP_CITIZEN_PASS },
    asResponse: true,
  });
  assert.equal(signInRes.ok, true, "临时市民登录成功");
  const rawSetCookies =
    typeof signInRes.headers.getSetCookie === "function"
      ? signInRes.headers.getSetCookie()
      : signInRes.headers.get("set-cookie")
        ? [signInRes.headers.get("set-cookie") as string]
        : [];
  const cookie = rawSetCookies
    .map((c: string) => c.split(";")[0]?.trim())
    .filter(Boolean)
    .join("; ");
  assert.ok(cookie.includes("better-auth.session_token"), "返回市民 Session Cookie");
  return { userId: userRow.id, cookie };
}

async function makeCitizenReq(
  urlPath: string,
  citizenCookie: string,
  init?: { method?: string; body?: unknown; regionId?: string }
) {
  const headers = new Headers({
    host: "localhost:3000",
    cookie: citizenCookie,
    ...(init?.regionId ? { "x-region-id": init.regionId } : {}),
    ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
  });
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function makeAdminReq(
  urlPath: string,
  init?: { method?: string; body?: unknown; regionId?: string }
) {
  const headers = await withAuthHeaders(
    {
      host: "localhost:3000",
      ...(init?.regionId ? { "x-region-id": init.regionId } : {}),
      ...(init?.body !== undefined ? { "content-type": "application/json" } : {}),
    },
    "admin"
  );
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
  });
}

async function cleanup() {
  try {
    await destroyRegionTenant(sql, TEST_REGION_ID);
  } catch {
    /* ignore */
  }
  await sql.unsafe(`DROP SCHEMA IF EXISTS "${TEST_REGION_ID}" CASCADE;`);
  await sql`DELETE FROM public.regions WHERE id = ${TEST_REGION_ID};`;
  await sql`DELETE FROM public.outreach_sessions WHERE region_id = ${TEST_REGION_ID};`.catch(() => {});
  await sql`DELETE FROM public.citizen_submissions WHERE region_id = ${TEST_REGION_ID};`.catch(() => {});
  await sql`DELETE FROM public."user" WHERE username = ${TEMP_CITIZEN_USER};`.catch(() => {});
  invalidateAgentGovernanceCache(TEST_REGION_ID);
  invalidateCivicAggregates(TEST_REGION_ID);
}

async function main() {
  await cleanup();

  try {
    await registerRegion(sql, {
      id: TEST_REGION_ID,
      name: "双端外呼测试区",
      city: "广州市",
      province: "广东省",
      schemaName: TEST_REGION_ID,
      isDefault: false,
      categoryConfigJson: JSON.stringify({ domainProfile: GOV_12345_PROFILE }),
      description: "Dual-side outreach test schema",
    });

    const { userId: citizenUserId, cookie: citizenCookie } = await getCitizenAuthCookie();

    // 1. 市民提交缺要素工单（缺少门牌与涉事主体）
    const submitRes = await intakeSubmitPost(
      await makeCitizenReq(`/api/intake/submit?region=${TEST_REGION_ID}`, citizenCookie, {
        method: "POST",
        regionId: TEST_REGION_ID,
        body: {
          title: "夜间烧烤摊油烟噪音扰民",
          content: "每天深夜楼下有人摆摊烧烤，油烟和噪音太大了，希望赶紧处理。",
          subdistrict: "天河南街道",
          category: "生态环境",
          contactPhone: "13800138000",
          source: "FORM",
          skipAutoCluster: true,
        },
      })
    );
    const submitJson = await submitRes.json();
    assert.equal(submitRes.status, 200, `市民提交工单成功: ${JSON.stringify(submitJson)}`);
    const ticketId = (submitJson.ticketId || submitJson.receipt?.ticketId) as string;

    // 确保该工单触发缺要素任务（清空可能被规则推断的地址/主体后生成 MISSING_INFO）
    const { db: testDb } = await getRegionDb(TEST_REGION_ID);
    await testDb
      .update(ticketsTable)
      .set({ address: null, canonicalSubject: null, confidence: 52 })
      .where(eq(ticketsTable.id, ticketId));

    const taskRes = await createOrReuseMissingInfoTask({
      regionId: TEST_REGION_ID,
      ticketId,
    });
    if (!taskRes.ok) {
      throw new Error(`生成 MISSING_INFO 治理任务失败: ${taskRes.error}`);
    }
    const taskId = taskRes.task.id;

    // 2. 管理员发起外呼会话 -> RINGING + 自动关联 targetUserId
    const startRes = await agentOutreachStartPost(
      await makeAdminReq("/api/agent/outreach/sessions", {
        method: "POST",
        regionId: TEST_REGION_ID,
        body: { taskId, regionId: TEST_REGION_ID },
      })
    );
    const startJson = await startRes.json();
    assert.equal(startRes.status, 200, "管理员发起外呼会话成功");
    assert.equal(startJson.session.status, "RINGING");
    assert.equal(startJson.session.targetUserId, citizenUserId, "自动精准绑定到对应提交市民账号");
    const sessionId = startJson.session.id as string;

    // 3. 管理员尝试调用用户端回答接口 -> 必须返回 403（严禁管理员自问自答）
    const adminReplyRes = await outreachReplyPost(
      await makeAdminReq(`/api/outreach/sessions/${encodeURIComponent(sessionId)}/reply`, {
        method: "POST",
        regionId: TEST_REGION_ID,
        body: { transcript: "管理员试图冒充市民回答" },
      }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    assert.equal(adminReplyRes.status, 403, "管理员禁止调用用户端 reply 接口 (403)");

    // 4. 用户端自动查询待接听来电 -> 能收到 RINGING 来电，且绝不泄露内部 reasoning
    const activeRes = await outreachActiveGet(
      await makeCitizenReq("/api/outreach/active", citizenCookie)
    );
    const activeJson = await activeRes.json();
    assert.equal(activeRes.status, 200);
    assert.ok(activeJson.session, "用户端成功接收到待接听来电");
    assert.equal(activeJson.session.id, sessionId);
    assert.equal(activeJson.session.status, "RINGING");
    assert.equal("reasoning" in (activeJson.session.turns[0] || {}), false, "用户端响应剥离内部 reasoning");
    assert.equal("initiatedBy" in activeJson.session, false, "用户端响应剥离管理员信息");

    // 5. 管理员尝试代替用户接听 -> 403
    const adminAnswerRes = await outreachActionPost(
      await makeAdminReq(`/api/outreach/sessions/${encodeURIComponent(sessionId)}/action`, {
        method: "POST",
        body: { action: "ANSWER" },
      }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    assert.equal(adminAnswerRes.status, 403, "管理员不能代为点击接听 (403)");

    // 6. 用户端接听通话 -> 状态切为 IN_CALL
    const answerRes = await outreachActionPost(
      await makeCitizenReq(`/api/outreach/sessions/${encodeURIComponent(sessionId)}/action`, citizenCookie, {
        method: "POST",
        body: { action: "ANSWER" },
      }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    const answerJson = await answerRes.json();
    assert.equal(answerRes.status, 200);
    assert.equal(answerJson.session.status, "IN_CALL", "用户接听后会话进入 IN_CALL");

    // 7. 用户端通过语音/文字提交回答 -> 自动抽取并回写 DB + 管理端拿到推理
    const replyRes = await outreachReplyPost(
      await makeCitizenReq(`/api/outreach/sessions/${encodeURIComponent(sessionId)}/reply`, citizenCookie, {
        method: "POST",
        body: { transcript: "就在天河南一路88号老广烧烤档，每晚油烟很大。" },
      }),
      { params: Promise.resolve({ id: sessionId }) }
    );
    const replyJson = await replyRes.json();
    assert.equal(replyRes.status, 200, `用户回答提交成功: ${JSON.stringify(replyJson)}`);
    assert.equal(replyJson.session.status, "COMPLETED");
    assert.equal(replyJson.session.completed, true);
    assert.equal("reasoning" in (replyJson.session.turns.at(-1) || {}), false, "用户端不回显管理端推理");

    // 8. 管理端查看会话详情 -> 包含用户回答原话、AI 回复、AI 推理过程与 extractedPatch
    const adminDetailRes = await outreachDetailGet(
      await makeAdminReq(`/api/outreach/sessions/${encodeURIComponent(sessionId)}`),
      { params: Promise.resolve({ id: sessionId }) }
    );
    const adminDetailJson = await adminDetailRes.json();
    assert.equal(adminDetailRes.status, 200);
    const adminSess = adminDetailJson.session;
    assert.equal(adminSess.status, "COMPLETED");
    assert.ok(adminSess.turns.some((t: any) => t.role === "citizen" && t.text.includes("天河南一路88号")));
    const finalAgentTurn = [...adminSess.turns].reverse().find((t: any) => t.role === "agent");
    assert.ok(finalAgentTurn?.reasoning && finalAgentTurn.reasoning.includes("要素对齐写库"), "管理端完整展示 AI 推理步骤");
    assert.ok(adminSess.extractedPatch?.address?.includes("天河南一路88号"), "管理端完整展示写库补丁");

    // 验证 DB 真实落库
    const [tkAfter] = await testDb
      .select({ address: ticketsTable.address, confidence: ticketsTable.confidence })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, ticketId))
      .limit(1);
    assert.ok(tkAfter?.address?.includes("天河南一路88号"), "tickets 表地址字段已被用户回答真实更新");
    assert.ok((tkAfter?.confidence || 0) >= 88, "tickets 表置信度提升至 >= 88");

    // 9. 验证前端管理弹窗源码中已彻底移除所有用户输入控件（只读监听）
    const adminDialogSrc = fs.readFileSync(
      path.resolve("app/_components/agent/voice-outreach-dialog.tsx"),
      "utf8"
    );
    assert.equal(adminDialogSrc.includes("useStreamAsr"), false, "管理端弹窗已移除麦克风输入 Hook");
    assert.equal(adminDialogSrc.includes("/api/agent/outreach/voice-turn"), false, "管理端弹窗已移除直接模拟回复调用");
    assert.equal(adminDialogSrc.includes("<input"), false, "管理端弹窗不含文本输入框");

    const userReceiverSrc = fs.readFileSync(
      path.resolve("app/_components/agent/user-outreach-receiver.tsx"),
      "utf8"
    );
    assert.ok(userReceiverSrc.includes("useStreamAsr"), "用户端来电弹窗包含语音输入");
    assert.ok(userReceiverSrc.includes("/api/outreach/sessions/"), "用户端来电弹窗对接独立接听与回复接口");

    console.log("✅ All dual-side AI outreach tests passed!");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ test-outreach-dual-side failed:", err);
    process.exit(1);
  });
