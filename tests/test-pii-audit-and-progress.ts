/**
 * PII 按需明文查看留痕审计 + 工序进度权重实测校准 验收测试
 *
 * 覆盖范围：
 * 1. POST /api/workorders/[id]/reveal-pii：401 未登录 / 403 普通用户 / 400 事由与字段校验 / 404 不存在工单 /
 *    200 管理员按需查验（含 Cache-Control: no-store、原始字段回传、public.pii_audit_logs 完整落库与字段子集支持）
 * 2. GET /api/admin/pii-audit：401 / 403 / 200 按 regionId + ticketId / ticketNo + limit 筛选与 Cache-Control: no-store
 * 3. 出网 LLM 3 层 PII 脱敏防火墙回归验证（确保未削弱）
 * 4. lib/pipeline-progress.ts：实测权重校准、区间连续性、stagePercent 边界、normalizeStageWeights 边界、
 *    PIPELINE_STAGE_WEIGHTS 环境变量覆写（JSON / KV / 部分覆写 / 畸形回退）与运行时 EMA 动态校准
 */

import { NextRequest } from "next/server";
import { eq, inArray } from "drizzle-orm";
import { withAuthHeaders } from "./_auth-helper";
import { db, getRegionDb, sql } from "../db/client";
import { piiAuditLogsTable, ticketsTable } from "../db/schema";
import { POST as revealPiiPost } from "../app/api/workorders/[id]/reveal-pii/route";
import { GET as piiAuditGet } from "../app/api/admin/pii-audit/route";
import { desensitizeContent, ticketBodyForAI } from "../backend/anonymizer";
import {
  DEFAULT_PIPELINE_STAGE_WEIGHTS,
  PIPELINE_STAGES,
  PIPELINE_STAGE_BASELINE_MS,
  PIPELINE_STAGE_RANGES,
  PIPELINE_STAGE_WEIGHTS,
  buildStageRanges,
  computeWeightsFromLatency,
  createLatencyEmaState,
  getActiveStageRanges,
  getActiveStageWeights,
  getLatencyEmaSnapshot,
  normalizeStageWeights,
  parseStageWeightsEnv,
  recordStageLatency,
  resetStageCalibration,
  resolveStageWeights,
  stagePercent,
  updateLatencyEma,
} from "../lib/pipeline-progress";

let failed = 0;

function assert(cond: unknown, msg: string) {
  if (!cond) {
    failed += 1;
    console.error(`FAIL: ${msg}`);
    process.exitCode = 1;
  } else {
    console.log(`PASS: ${msg}`);
  }
}

async function makeReq(
  pathWithQuery: string,
  options?: {
    method?: string;
    role?: "admin" | "user" | "anon";
    body?: unknown;
    headers?: Record<string, string>;
  }
): Promise<NextRequest> {
  const url = `http://localhost:3000${pathWithQuery}`;
  const baseHeaders: Record<string, string> = {
    ...(options?.body !== undefined ? { "content-type": "application/json" } : {}),
    ...(options?.headers ?? {}),
  };
  const headers =
    options?.role === "anon"
      ? new Headers({ host: "localhost:3000", ...baseHeaders })
      : await withAuthHeaders(baseHeaders, options?.role ?? "admin");

  return new NextRequest(url, {
    method: options?.method ?? "GET",
    headers,
    ...(options?.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function testPiiAuditEndpoints() {
  console.log("\n=== 1. PII Reveal & Audit API Tests ===");

  const regionId = "gz_tianhe";
  const { db: tenantDb } = await getRegionDb(regionId);
  const sampleRows = await tenantDb
    .select({
      id: ticketsTable.id,
      ticketNo: ticketsTable.ticketNo,
      citizenName: ticketsTable.citizenName,
      citizenPhone: ticketsTable.citizenPhone,
      address: ticketsTable.address,
      content: ticketsTable.content,
    })
    .from(ticketsTable)
    .limit(1);

  const sample = sampleRows[0];
  assert(Boolean(sample?.id), `租户 ${regionId} 存在可供验证的样本工单`);
  if (!sample) return;

  const createdAuditIds: string[] = [];

  try {
    // 1.1 未登录 -> 401 + no-store
    const anonRevealRes = await revealPiiPost(
      await makeReq(`/api/workorders/${encodeURIComponent(sample.id)}/reveal-pii`, {
        method: "POST",
        role: "anon",
        body: { reason: "未登录测试事由", regionId },
      }),
      { params: Promise.resolve({ id: sample.id }) }
    );
    assert(anonRevealRes.status === 401, `reveal-pii 未登录返回 401 (actual=${anonRevealRes.status})`);
    assert(
      anonRevealRes.headers.get("cache-control")?.includes("no-store"),
      "reveal-pii 401 响应带 Cache-Control: no-store"
    );

    const anonAuditRes = await piiAuditGet(
      await makeReq(`/api/admin/pii-audit?regionId=${regionId}&ticketId=${encodeURIComponent(sample.id)}`, {
        role: "anon",
      })
    );
    assert(anonAuditRes.status === 401, `pii-audit 未登录返回 401 (actual=${anonAuditRes.status})`);
    assert(
      anonAuditRes.headers.get("cache-control")?.includes("no-store"),
      "pii-audit 401 响应带 Cache-Control: no-store"
    );

    // 1.2 普通市民角色 -> 403 + no-store
    const citizenRevealRes = await revealPiiPost(
      await makeReq(`/api/workorders/${encodeURIComponent(sample.id)}/reveal-pii`, {
        method: "POST",
        role: "user",
        body: { reason: "普通用户越权测试事由", regionId },
      }),
      { params: Promise.resolve({ id: sample.id }) }
    );
    assert(citizenRevealRes.status === 403, `reveal-pii 普通用户返回 403 (actual=${citizenRevealRes.status})`);
    assert(
      citizenRevealRes.headers.get("cache-control")?.includes("no-store"),
      "reveal-pii 403 响应带 Cache-Control: no-store"
    );

    const citizenAuditRes = await piiAuditGet(
      await makeReq(`/api/admin/pii-audit?regionId=${regionId}`, {
        role: "user",
      })
    );
    assert(citizenAuditRes.status === 403, `pii-audit 普通用户返回 403 (actual=${citizenAuditRes.status})`);
    assert(
      citizenAuditRes.headers.get("cache-control")?.includes("no-store"),
      "pii-audit 403 响应带 Cache-Control: no-store"
    );

    // 1.3 事由校验边界（空 / 3 字 / 201 字 / 非法 fields） -> 400
    for (const [label, body] of [
      ["空事由", { reason: "   ", regionId }],
      ["3字过短事由", { reason: "核实电", regionId }],
      ["201字过长事由", { reason: "测".repeat(201), regionId }],
      ["非法 fields", { reason: "合法四字事由", regionId, fields: ["invalidField"] }],
    ] as const) {
      const badRes = await revealPiiPost(
        await makeReq(`/api/workorders/${encodeURIComponent(sample.id)}/reveal-pii`, {
          method: "POST",
          role: "admin",
          body,
        }),
        { params: Promise.resolve({ id: sample.id }) }
      );
      assert(badRes.status === 400, `reveal-pii ${label} 返回 400 (actual=${badRes.status})`);
      assert(
        badRes.headers.get("cache-control")?.includes("no-store"),
        `reveal-pii ${label} 响应带 Cache-Control: no-store`
      );
    }

    // 1.4 不存在的工单 -> 404
    const notFoundRes = await revealPiiPost(
      await makeReq("/api/workorders/NON_EXISTENT_TICKET_999999/reveal-pii", {
        method: "POST",
        role: "admin",
        body: { reason: "核实不存在工单返回 404", regionId },
      }),
      { params: Promise.resolve({ id: "NON_EXISTENT_TICKET_999999" }) }
    );
    assert(notFoundRes.status === 404, `reveal-pii 不存在工单返回 404 (actual=${notFoundRes.status})`);

    // 1.5 管理员合法查验 -> 200 + no-store + 原始字段匹配 + 完整留痕入库
    const reason1 = `自动化验收测试：核实工单 ${sample.ticketNo || sample.id} 联系电话与现场地址`;
    const okRes = await revealPiiPost(
      await makeReq(`/api/workorders/${encodeURIComponent(sample.id)}/reveal-pii`, {
        method: "POST",
        role: "admin",
        headers: {
          "x-region-id": regionId,
          "x-forwarded-for": "203.0.113.42, 10.0.0.1",
          "user-agent": "CivicAuditTestAgent/1.0",
        },
        body: { reason: reason1, regionId },
      }),
      { params: Promise.resolve({ id: sample.id }) }
    );
    assert(okRes.status === 200, `reveal-pii 管理员合法申请返回 200 (actual=${okRes.status})`);
    assert(
      okRes.headers.get("cache-control") === "no-store",
      `reveal-pii 200 响应头含 Cache-Control: no-store (actual=${okRes.headers.get("cache-control")})`
    );
    const okJson = await okRes.json();
    assert(okJson.success === true && typeof okJson.auditId === "string", "返回 success=true 且包含 auditId");
    if (typeof okJson.auditId === "string") {
      createdAuditIds.push(okJson.auditId);
    }
    assert(
      okJson.callerName === (sample.citizenName || "") &&
        okJson.callerPhone === (sample.citizenPhone || "") &&
        okJson.address === (sample.address || "") &&
        okJson.rawContent === (sample.content || ""),
      "返回明文 callerName/callerPhone/address/rawContent 与租户库原值完全一致"
    );
    assert(
      Array.isArray(okJson.fieldsRevealed) && okJson.fieldsRevealed.length === 4,
      "默认记录全部 4 个敏感字段"
    );

    // 直接核对 public.pii_audit_logs 落库字段
    const [dbRow] = await db
      .select()
      .from(piiAuditLogsTable)
      .where(eq(piiAuditLogsTable.id, okJson.auditId))
      .limit(1);
    assert(Boolean(dbRow), "public.pii_audit_logs 已写入留痕记录");
    assert(
      dbRow?.regionId === regionId &&
        dbRow?.ticketId === sample.id &&
        dbRow?.ticketNo === (sample.ticketNo || null) &&
        dbRow?.actorRole === "admin" &&
        dbRow?.reason === reason1 &&
        dbRow?.ipAddress === "203.0.113.42" &&
        dbRow?.userAgent === "CivicAuditTestAgent/1.0" &&
        Array.isArray(dbRow?.fieldsRevealed) &&
        dbRow.fieldsRevealed.join(",") === "callerName,callerPhone,address,rawContent",
      "public.pii_audit_logs 留痕字段（region/ticket/actor/reason/fields_revealed/ip/ua）完整准确"
    );

    // 1.6 字段子集申请（按 ticketNo 查询）
    const reason2 = "复核回访仅查验联系电话与地址";
    const subsetRes = await revealPiiPost(
      await makeReq(`/api/workorders/${encodeURIComponent(sample.ticketNo || sample.id)}/reveal-pii`, {
        method: "POST",
        role: "admin",
        headers: { "x-region-id": regionId },
        body: {
          reason: reason2,
          regionId,
          fields: ["callerPhone", "address"],
        },
      }),
      { params: Promise.resolve({ id: sample.ticketNo || sample.id }) }
    );
    assert(subsetRes.status === 200, `reveal-pii 字段子集请求返回 200 (actual=${subsetRes.status})`);
    const subsetJson = await subsetRes.json();
    if (typeof subsetJson.auditId === "string") {
      createdAuditIds.push(subsetJson.auditId);
    }
    assert(
      subsetJson.callerPhone === (sample.citizenPhone || "") &&
        subsetJson.address === (sample.address || "") &&
        subsetJson.rawContent === undefined &&
        subsetJson.callerName === undefined &&
        Array.isArray(subsetJson.fieldsRevealed) &&
        subsetJson.fieldsRevealed.join(",") === "callerPhone,address",
      "字段子集仅返回并留痕指定字段"
    );

    // 1.7 GET /api/admin/pii-audit 查询验证
    const auditListRes = await piiAuditGet(
      await makeReq(
        `/api/admin/pii-audit?regionId=${encodeURIComponent(regionId)}&ticketId=${encodeURIComponent(sample.id)}&limit=10`,
        { role: "admin" }
      )
    );
    assert(auditListRes.status === 200, `pii-audit 管理员查询返回 200 (actual=${auditListRes.status})`);
    assert(
      auditListRes.headers.get("cache-control") === "no-store",
      "pii-audit 200 响应带 Cache-Control: no-store"
    );
    const auditListJson = await auditListRes.json();
    assert(
      auditListJson.success === true &&
        Array.isArray(auditListJson.items) &&
        auditListJson.items.length >= 2 &&
        auditListJson.total >= 2,
      `pii-audit 返回当前工单审计记录 (count=${auditListJson.items?.length}, total=${auditListJson.total})`
    );
    const returnedIds = new Set((auditListJson.items as Array<{ id: string }>).map((i) => i.id));
    assert(
      createdAuditIds.every((id) => returnedIds.has(id)),
      "pii-audit 查询结果包含刚写入的 2 条留痕记录"
    );
    // 验证 limit=1 生效且按 created_at DESC 排在首位的是最新一条
    const limitOneRes = await piiAuditGet(
      await makeReq(
        `/api/admin/pii-audit?regionId=${encodeURIComponent(regionId)}&ticketId=${encodeURIComponent(sample.ticketNo || sample.id)}&limit=1`,
        { role: "admin" }
      )
    );
    const limitOneJson = await limitOneRes.json();
    assert(
      limitOneRes.status === 200 &&
        Array.isArray(limitOneJson.items) &&
        limitOneJson.items.length === 1 &&
        limitOneJson.items[0].id === createdAuditIds[1],
      "pii-audit 支持 ticketNo 过滤、limit=1 截断且按 created_at 倒序返回最新记录"
    );

    // 1.8 出网 LLM PII 防火墙未削弱验证（使用 GB 11643-1999 规范测试校验位样例）
    const rawWithPii = "市民张伟（手机号13812345678，身份证11010519491231002X）反映天河路施工噪音问题";
    const maskedOut = ticketBodyForAI({ content: rawWithPii, maskedContent: null });
    assert(
      !maskedOut.includes("张伟") &&
        !maskedOut.includes("13812345678") &&
        !maskedOut.includes("11010519491231002X") &&
        desensitizeContent(rawWithPii) === maskedOut,
      "出网 LLM PII 脱敏防火墙完好无损（姓名、手机号与身份证均被掩码）"
    );
  } finally {
    if (createdAuditIds.length > 0) {
      await db
        .delete(piiAuditLogsTable)
        .where(inArray(piiAuditLogsTable.id, createdAuditIds));
      console.log(`CLEANUP: 已清理 ${createdAuditIds.length} 条测试审计留痕记录`);
    }
  }
}

function testPipelineProgressCalibration() {
  console.log("\n=== 2. Pipeline Progress Calibration Tests ===");

  const originalEnv = process.env.PIPELINE_STAGE_WEIGHTS;
  try {
    delete process.env.PIPELINE_STAGE_WEIGHTS;
    resetStageCalibration();

    // 2.1 默认实测基线校准权重与区间连续性
    const defaultSum = PIPELINE_STAGES.reduce((s, k) => s + DEFAULT_PIPELINE_STAGE_WEIGHTS[k], 0);
    assert(defaultSum === 100, `默认校准权重总和精确等于 100 (actual=${defaultSum})`);
    assert(
      DEFAULT_PIPELINE_STAGE_WEIGHTS.S1 === 1 &&
        DEFAULT_PIPELINE_STAGE_WEIGHTS.S2 === 83 &&
        DEFAULT_PIPELINE_STAGE_WEIGHTS.EMBED === 5 &&
        DEFAULT_PIPELINE_STAGE_WEIGHTS.CLUSTER === 3 &&
        DEFAULT_PIPELINE_STAGE_WEIGHTS.SUMMARY === 8,
      `实测基线校准权重符合预期 (${JSON.stringify(DEFAULT_PIPELINE_STAGE_WEIGHTS)})`
    );
    assert(
      PIPELINE_STAGE_BASELINE_MS.S1 < 1 && PIPELINE_STAGE_WEIGHTS.S1 === 1,
      "System-1 ONNX (~0.079ms) 经保底校准占比 1%"
    );

    // 校验 PIPELINE_STAGE_RANGES 连续且覆盖 0..100
    let prevEnd = 0;
    let contiguous = true;
    for (const stage of PIPELINE_STAGES) {
      const r = PIPELINE_STAGE_RANGES[stage];
      if (r.start !== prevEnd || r.end - r.start !== r.weight) {
        contiguous = false;
      }
      prevEnd = r.end;
    }
    assert(contiguous && prevEnd === 100, "PIPELINE_STAGE_RANGES 严密连续且精确覆盖 [0, 100]");

    // 2.2 stagePercent 既有签名与边界测试
    assert(stagePercent("S1", 0, 10, "min") === 0, "stagePercent S1 min=0");
    assert(stagePercent("S1", 10, 10, "max") === 1, "stagePercent S1 max=1");
    assert(stagePercent("S2", 0, 100, "min") === 1, "stagePercent S2 min=1");
    assert(stagePercent("S2", 50, 100) === Math.round(1 + 0.5 * 83), "stagePercent S2 50% 线性插值正确");
    assert(stagePercent("S2", 100, 100, "max") === 84, "stagePercent S2 max=84");
    assert(stagePercent("SUMMARY", 10, 10, "max") === 100, "stagePercent SUMMARY max=100");
    assert(stagePercent("EMBED", 5, 0) === 84, "total=0 返回阶段起点");
    assert(stagePercent("EMBED", -10, 10) === 84, "completed<0 钳位至阶段起点");
    assert(stagePercent("EMBED", 999, 10) === 89, "completed>total 钳位至阶段终点");
    assert(stagePercent("CLUSTER", Number.NaN, 10) === 89, "completed=NaN 安全回退至起点");
    assert(stagePercent("CLUSTER", 5, Number.NaN) === 89, "total=NaN 安全回退至起点");

    // 2.3 normalizeStageWeights 边界测试
    const exact100 = normalizeStageWeights({ S1: 5, S2: 70, EMBED: 10, CLUSTER: 5, SUMMARY: 10 });
    assert(
      exact100.S1 === 5 &&
        exact100.S2 === 70 &&
        exact100.EMBED === 10 &&
        exact100.CLUSTER === 5 &&
        exact100.SUMMARY === 10,
      "合法整数且求和为 100 的权重原样保留不畸变"
    );

    const equalW = normalizeStageWeights({ S1: 1, S2: 1, EMBED: 1, CLUSTER: 1, SUMMARY: 1 });
    assert(
      PIPELINE_STAGES.every((s) => equalW[s] === 20),
      "等权分布归一化为各 20%"
    );

    const extremeSkew = normalizeStageWeights({
      S1: 1e-6,
      S2: 1e9,
      EMBED: 1e-6,
      CLUSTER: 1e-6,
      SUMMARY: 1e-6,
    });
    assert(
      extremeSkew.S1 === 1 &&
        extremeSkew.EMBED === 1 &&
        extremeSkew.CLUSTER === 1 &&
        extremeSkew.SUMMARY === 1 &&
        extremeSkew.S2 === 96,
      "极端偏态耗时下所有微阶段保底 1%，总和仍为 100"
    );

    const invalidFallback = normalizeStageWeights({
      S1: Number.NaN,
      S2: -10,
      EMBED: 0,
      CLUSTER: Number.POSITIVE_INFINITY,
    });
    assert(
      PIPELINE_STAGES.reduce((s, k) => s + invalidFallback[k], 0) === 100 &&
        invalidFallback.S2 === DEFAULT_PIPELINE_STAGE_WEIGHTS.S2,
      "非法/负值/NaN/Infinity 输入安全回退至基线且总和为 100"
    );

    // 2.4 环境变量解析与覆写（JSON / KV / 部分覆写 / 畸形回退）
    const jsonEnv = resolveStageWeights('{"S1":2,"S2":78,"EMBED":6,"CLUSTER":4,"SUMMARY":10}');
    assert(
      jsonEnv.S1 === 2 && jsonEnv.S2 === 78 && jsonEnv.EMBED === 6 && jsonEnv.CLUSTER === 4 && jsonEnv.SUMMARY === 10,
      "JSON 格式 PIPELINE_STAGE_WEIGHTS 正确解析"
    );

    const kvEnv = resolveStageWeights("s1=1, s2=75, embed=8, cluster=6, summary=10");
    assert(
      kvEnv.S1 === 1 && kvEnv.S2 === 75 && kvEnv.EMBED === 8 && kvEnv.CLUSTER === 6 && kvEnv.SUMMARY === 10,
      "键值对格式（大小写无关）PIPELINE_STAGE_WEIGHTS 正确解析"
    );

    const partialEnv = resolveStageWeights("EMBED=20,SUMMARY=20");
    assert(
      PIPELINE_STAGES.reduce((s, k) => s + partialEnv[k], 0) === 100 &&
        partialEnv.EMBED > DEFAULT_PIPELINE_STAGE_WEIGHTS.EMBED &&
        partialEnv.SUMMARY > DEFAULT_PIPELINE_STAGE_WEIGHTS.SUMMARY,
      "部分阶段覆写与未指定阶段合并并归一化至 100"
    );

    assert(parseStageWeightsEnv("not-valid-anything") === null, "畸形环境变量解析返回 null 不抛错");
    assert(parseStageWeightsEnv('{"S1":-5,"S2":"bad"}') === null, "全非法数值 JSON 返回 null");

    // 动态 process.env.PIPELINE_STAGE_WEIGHTS 覆写生效验证
    process.env.PIPELINE_STAGE_WEIGHTS = "S1=4,S2=60,EMBED=12,CLUSTER=8,SUMMARY=16";
    const activeEnvWeights = getActiveStageWeights();
    const activeEnvRanges = getActiveStageRanges();
    assert(
      activeEnvWeights.S2 === 60 &&
        activeEnvRanges.EMBED.start === 64 &&
        stagePercent("S2", 50, 100) === 34,
      "运行时读取 PIPELINE_STAGE_WEIGHTS 环境变量动态生效"
    );
    delete process.env.PIPELINE_STAGE_WEIGHTS;

    // 2.5 纯函数 EMA 校准 + 运行时全局 EMA 校准
    let ema = createLatencyEmaState(undefined, 0.5);
    const unchanged = updateLatencyEma(ema, "S2", -100);
    assert(unchanged === ema, "EMA 忽略非正数耗时观测");
    const unchangedItems = updateLatencyEma(ema, "S2", 500, { items: 0 });
    assert(unchangedItems === ema, "EMA 忽略 items<=0 的批观测");

    // 模拟 10 张工单 S2 总耗时 5000ms -> 单单 500ms；alpha=0.5，prev=1150 -> next=825
    ema = updateLatencyEma(ema, "S2", 5000, { items: 10 });
    assert(
      Math.abs(ema.latencyMs.S2 - 825) < 1e-6 && ema.samples.S2 === 1,
      `EMA 批耗时折算单单耗时准确 (actual=${ema.latencyMs.S2})`
    );
    const emaWeights = computeWeightsFromLatency(ema.latencyMs);
    assert(
      PIPELINE_STAGES.reduce((s, k) => s + emaWeights[k], 0) === 100 &&
        emaWeights.S2 < DEFAULT_PIPELINE_STAGE_WEIGHTS.S2,
      `S2 变快后 EMA 校准自动调低 S2 权重 (${DEFAULT_PIPELINE_STAGE_WEIGHTS.S2} -> ${emaWeights.S2})`
    );

    // 进程级 recordStageLatency -> 影响 getActiveStageWeights -> resetStageCalibration 复原
    resetStageCalibration(0.5);
    recordStageLatency("SUMMARY", 6000, { items: 5 }); // 单单 1200ms，大幅拉高 SUMMARY 占比
    const afterLiveEma = getActiveStageWeights();
    const snap = getLatencyEmaSnapshot();
    assert(
      snap.samples.SUMMARY === 1 &&
        afterLiveEma.SUMMARY > DEFAULT_PIPELINE_STAGE_WEIGHTS.SUMMARY &&
        PIPELINE_STAGES.reduce((s, k) => s + afterLiveEma[k], 0) === 100,
      `运行时 recordStageLatency 动态提升 SUMMARY 占比 (${DEFAULT_PIPELINE_STAGE_WEIGHTS.SUMMARY} -> ${afterLiveEma.SUMMARY})`
    );

    // 验证 buildStageRanges 与 customWeights 隔离
    const customRanges = buildStageRanges({ S1: 10, S2: 50, EMBED: 10, CLUSTER: 10, SUMMARY: 20 });
    assert(
      customRanges.SUMMARY.start === 80 &&
        customRanges.SUMMARY.end === 100 &&
        stagePercent("SUMMARY", 1, 2, "live", { S1: 10, S2: 50, EMBED: 10, CLUSTER: 10, SUMMARY: 20 }) === 90,
      "stagePercent 支持传入 customWeights 隔离计算"
    );

    resetStageCalibration();
    const afterReset = getActiveStageWeights();
    assert(
      afterReset.SUMMARY === DEFAULT_PIPELINE_STAGE_WEIGHTS.SUMMARY &&
        afterReset.S2 === DEFAULT_PIPELINE_STAGE_WEIGHTS.S2,
      "resetStageCalibration 完整恢复默认实测基线权重"
    );
  } finally {
    resetStageCalibration();
    if (originalEnv === undefined) {
      delete process.env.PIPELINE_STAGE_WEIGHTS;
    } else {
      process.env.PIPELINE_STAGE_WEIGHTS = originalEnv;
    }
  }
}

async function main() {
  try {
    await testPiiAuditEndpoints();
    testPipelineProgressCalibration();
  } finally {
    await sql.end({ timeout: 5 }).catch(() => {});
  }

  if (failed > 0 || process.exitCode) {
    console.error(`\n❌ 测试失败：共 ${failed} 项断言未通过`);
    process.exit(1);
  }
  console.log("\n✅ 全部 PII 审计留痕与工序进度权重校准测试通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
