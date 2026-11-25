/**
 * 市民受理反馈修复回归测试：
 * - 临时租户 `verify_intake_feedback` + 临时市民用户，finally 中物理清理；
 * - 覆盖：
 *   1) 提交涉事主体为 "涉事方" 等泛型词时，tickets.canonical_subject 存为 null（非泛型主体正常保留）；
 *   2) processIntakeChat & POST /api/intake/chat 识别纯进度询问（如"处理的怎么样了"），返回 intent="PROGRESS_QUERY"，
 *      答复含最新 ticketNo 与状态标签，不索要手机号，且保持 draft.content === ""；含具体新诉求时不误判；
 *   3) 30 分钟内同用户/同镇街/同分类重复提交返回 HTTP 409 (code="DUPLICATE_TICKET", existingTicketNo)；
 *      传入 allowDuplicate: true 或原工单已办结时允许正常提交。
 */

import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { auth } from "../lib/auth/config";
import { sql, getRegionDb } from "../db/client";
import { ticketsTable } from "../db/schema";
import { registerRegion, destroyRegionTenant } from "../lib/tenant/schema-manager";
import { GOV_12345_PROFILE } from "../lib/domain-profile";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import {
  invalidateAgentGovernanceCache,
  isProgressQueryUtterance,
  processIntakeChat,
} from "../lib/agent-governance";
import { POST as intakeChatPost } from "../app/api/intake/chat/route";
import { POST as intakeSubmitPost } from "../app/api/intake/submit/route";

const TEST_REGION_ID = "verify_intake_feedback";
const TEMP_CITIZEN_USER = `verify_intake_fb_${Date.now()}`;
const TEMP_CITIZEN_PASS = `VerifyFbPass_${Date.now()}!`;

async function getCitizenAuthCookie(): Promise<{ userId: string; cookie: string }> {
  const email = `${TEMP_CITIZEN_USER}@example.test`;
  await auth.api.signUpEmail({
    body: {
      email,
      password: TEMP_CITIZEN_PASS,
      name: "受理反馈测试市民",
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

function makeCitizenReq(
  urlPath: string,
  citizenCookie: string,
  body: unknown,
  regionId = TEST_REGION_ID
) {
  return new NextRequest(`http://localhost:3000${urlPath}`, {
    method: "POST",
    headers: new Headers({
      host: "localhost:3000",
      cookie: citizenCookie,
      "x-region-id": regionId,
      "content-type": "application/json",
    }),
    body: JSON.stringify(body),
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
      name: "受理反馈测试区",
      city: "广州市",
      province: "广东省",
      schemaName: TEST_REGION_ID,
      isDefault: false,
      categoryConfigJson: JSON.stringify({ domainProfile: GOV_12345_PROFILE }),
      description: "Intake feedback fixes test schema",
    });

    const { userId, cookie } = await getCitizenAuthCookie();

    // 0. 单元测试：isProgressQueryUtterance 正误报边界
    for (const phrase of [
      "处理的怎么样了",
      "处理进度怎么样",
      "查进度",
      "办得怎么样",
      "办好了吗",
      "派单了吗",
      "有没有处理",
      "现在怎么样了",
      "进展如何",
      "跟进情况",
    ]) {
      assert.equal(isProgressQueryUtterance(phrase), true, `应识别为进度查询：${phrase}`);
    }
    assert.equal(
      isProgressQueryUtterance("天河南路88号楼下烧烤摊油烟太大，处理的怎么样了"),
      false,
      "夹带具体地址与新诉求时不应判为纯进度查询"
    );
    assert.equal(
      isProgressQueryUtterance("订单JD99887766一直没发货，进展如何"),
      false,
      "夹带订单号与具体售后诉求时不应判为纯进度查询"
    );

    // 0b. 尚无已提交工单时查询进度
    const emptyProgressRes = await processIntakeChat({
      regionId: TEST_REGION_ID,
      userId,
      messages: [{ role: "user", content: "处理的怎么样了" }],
    });
    assert.equal(emptyProgressRes.intent, "PROGRESS_QUERY");
    assert.equal(emptyProgressRes.draft.content, "");
    assert.deepEqual(emptyProgressRes.missingFields, []);
    assert.equal(emptyProgressRes.readyToSubmit, false);
    assert.equal(emptyProgressRes.usedLlm, false);

    // 1. 提交带有泛型 subject: "涉事方" 的工单 -> canonical_subject 必须存为 null
    const complaintPayload = {
      regionId: TEST_REGION_ID,
      title: "天河南一路深夜施工噪音扰民",
      content: "天河南一路12号附近工地每天凌晨两点还在打桩施工，严重影响周边居民休息。",
      subdistrict: "天河南街道",
      category: "生态环境",
      subject: "涉事方",
      address: "天河南一路12号",
      contactPhone: "13800138000",
      source: "FORM",
      skipAutoCluster: true,
    };

    const submit1Res = await intakeSubmitPost(
      makeCitizenReq(`/api/intake/submit?region=${TEST_REGION_ID}`, cookie, complaintPayload)
    );
    const submit1Json = await submit1Res.json();
    assert.equal(submit1Res.status, 200, `首单提交应成功: ${JSON.stringify(submit1Json)}`);
    const firstTicketId = submit1Json.ticketId as string;
    const firstTicketNo = submit1Json.ticketNo as string;
    assert.ok(firstTicketId && firstTicketNo, "返回有效 ticketId 与 ticketNo");

    const { db: testDb } = await getRegionDb(TEST_REGION_ID);
    const [row1] = await testDb
      .select({ canonicalSubject: ticketsTable.canonicalSubject })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, firstTicketId))
      .limit(1);
    assert.equal(
      row1?.canonicalSubject ?? null,
      null,
      `subject="涉事方" 时 canonical_subject 应存为 null，实际: ${row1?.canonicalSubject}`
    );

    // 2. 查询进度：processIntakeChat + POST /api/intake/chat
    const progressRes = await processIntakeChat({
      regionId: TEST_REGION_ID,
      userId,
      messages: [{ role: "user", content: "处理的怎么样了" }],
      draft: { content: "" },
    });
    assert.equal(progressRes.intent, "PROGRESS_QUERY", "应识别为 PROGRESS_QUERY");
    assert.ok(
      progressRes.reply.includes(firstTicketNo),
      `进度回复应包含单号 ${firstTicketNo}，实际: ${progressRes.reply}`
    );
    assert.ok(
      progressRes.reply.includes("待派单"),
      `进度回复应包含中文状态标签，实际: ${progressRes.reply}`
    );
    assert.equal(
      /手机号|联系电话|电子邮箱/.test(progressRes.reply),
      false,
      `进度查询不应反问索要手机号，实际: ${progressRes.reply}`
    );
    assert.equal(progressRes.draft.content, "", "进度查询不得污染 draft.content");
    assert.deepEqual(progressRes.missingFields, []);
    assert.equal(progressRes.readyToSubmit, false);
    assert.equal(progressRes.usedLlm, false);

    // 验证 /api/intake/chat 路由透传 userId 并返回相同进度查询语义
    const chatApiRes = await intakeChatPost(
      makeCitizenReq(`/api/intake/chat?region=${TEST_REGION_ID}`, cookie, {
        regionId: TEST_REGION_ID,
        messages: [{ role: "user", content: "办好了吗" }],
        draft: { content: "" },
      })
    );
    const chatApiJson = await chatApiRes.json();
    assert.equal(chatApiRes.status, 200);
    assert.equal(chatApiJson.intent, "PROGRESS_QUERY");
    assert.ok(String(chatApiJson.reply).includes(firstTicketNo), "API 路由回复包含最近单号");
    assert.equal(chatApiJson.draft.content, "");

    // 3. 30 分钟内重复提交相同诉求 -> 返回 HTTP 409 DUPLICATE_TICKET
    const dupRes = await intakeSubmitPost(
      makeCitizenReq(`/api/intake/submit?region=${TEST_REGION_ID}`, cookie, complaintPayload)
    );
    const dupJson = await dupRes.json();
    assert.equal(dupRes.status, 409, `重复提交应返回 409，实际: ${dupRes.status} ${JSON.stringify(dupJson)}`);
    assert.equal(dupJson.success, false);
    assert.equal(dupJson.code, "DUPLICATE_TICKET");
    assert.equal(dupJson.existingTicketNo, firstTicketNo);
    assert.equal(dupJson.existingTicketId, firstTicketId);
    assert.ok(String(dupJson.error).includes(firstTicketNo), "409 提示包含原单号");

    // 4. 传入 allowDuplicate: true 且指定具体非泛型主体 -> 成功建单并保留主体
    const allowDupRes = await intakeSubmitPost(
      makeCitizenReq(`/api/intake/submit?region=${TEST_REGION_ID}`, cookie, {
        ...complaintPayload,
        subject: "天河建工打桩施工队",
        allowDuplicate: true,
      })
    );
    const allowDupJson = await allowDupRes.json();
    assert.equal(allowDupRes.status, 200, `allowDuplicate=true 应允许建单: ${JSON.stringify(allowDupJson)}`);
    assert.notEqual(allowDupJson.ticketId, firstTicketId);

    const [row2] = await testDb
      .select({ canonicalSubject: ticketsTable.canonicalSubject })
      .from(ticketsTable)
      .where(eq(ticketsTable.id, allowDupJson.ticketId as string))
      .limit(1);
    assert.equal(row2?.canonicalSubject, "天河建工打桩施工队", "非泛型主体应正常落库");

    // 5. 将两张工单标记为已办结后，再次提交相同诉求不应触发在办重复拦截
    await testDb
      .update(ticketsTable)
      .set({ status: "RESOLVED" })
      .where(eq(ticketsTable.subdistrict, "天河南街道"));

    const afterResolvedRes = await intakeSubmitPost(
      makeCitizenReq(`/api/intake/submit?region=${TEST_REGION_ID}`, cookie, complaintPayload)
    );
    assert.equal(afterResolvedRes.status, 200, "原工单已办结后允许再次提交同类诉求");

    console.log("✅ All intake feedback fixes regression tests passed!");
  } finally {
    await cleanup();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("❌ test-intake-feedback-fixes failed:", err);
    process.exit(1);
  });
