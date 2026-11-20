/**
 * 阶段 4 衍生电商应用域（Domain Profile + ecom_demo 示范租户）端到端验收测试（Verifier 独立编写）
 *
 * 红线守卫：
 * 1. 严禁修改 gz_tianhe (103397 / 5748, isDefault=true) 与 fs_shunde (135666 / 9222, isDefault=false) 任何数据；
 * 2. 对 ecom_demo 的闭环写操作仅使用独立临时测试 ID（E2E-TEMP-*），并在 try/finally 中彻底删除还原，不污染示范数据。
 */

import { NextRequest } from "next/server";
import { withAuthHeaders } from "./_auth-helper";
import { and, eq } from "drizzle-orm";
import { getRegionDb, sql } from "../db/client";
import {
  disposalLogsTable,
  regionsTable,
  themesTable,
  ticketThemesTable,
  ticketsTable,
} from "../db/schema";
import { GET as regionsGet } from "../app/api/regions/route";
import { GET as overviewGet } from "../app/api/overview/route";
import { GET as cockpitGet } from "../app/api/cockpit/route";
import { GET as clusterGet, PATCH as clusterPatch } from "../app/api/clusters/[id]/route";
import { GET as ticketsGet } from "../app/api/tickets/route";
import { POST as xrayPost } from "../app/api/sandbox/xray/route";

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

async function makeRequest(
  pathWithQuery: string,
  init?: { method?: string; body?: unknown; headers?: Record<string, string>; regionId?: string }
) {
  const regionId = init?.regionId ?? "ecom_demo";
  const sep = pathWithQuery.includes("?") ? "&" : "?";
  const url = `http://localhost:3000${pathWithQuery}${sep}region=${encodeURIComponent(regionId)}`;
  const headers = await withAuthHeaders(
    {
      "x-region-id": regionId,
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

async function readEcomSnapshot(schemaName = "region_ecom_demo") {
  const counts = await readRegionCounts(schemaName);
  const [logRow] = await sql.unsafe(`SELECT count(*)::int AS c FROM "${schemaName}".disposal_logs`);
  return {
    ...counts,
    disposalLogs: Number(logRow?.c ?? 0),
  };
}

async function main() {
  const prevAppDomain = process.env.APP_DOMAIN;
  process.env.APP_DOMAIN = "ALL";
  await assertBaselineUnchanged("前置");
  const initialEcom = await readEcomSnapshot();
  assert(
    initialEcom.tickets >= 3000 && initialEcom.themes >= 30,
    `ecom_demo 已幂等初始化 (tickets=${initialEcom.tickets}, themes=${initialEcom.themes})`
  );

  try {
    // 1. 验证 GET /api/regions 租户矩阵、默认租户与 DomainProfile 配置
    const regionsRes = await regionsGet();
    const regionsJson = await regionsRes.json();
    assert(regionsRes.status === 200 && regionsJson.success, "GET /api/regions 返回 200");
    assert(regionsJson.defaultRegionId === "gz_tianhe", `defaultRegionId 保持 gz_tianhe (${regionsJson.defaultRegionId})`);

    const regionList: Array<{
      id: string;
      isDefault: boolean;
      domainProfile?: {
        domainType?: string;
        hasGeoMap?: boolean;
        terminology?: { regionUnit?: string };
      };
    }> = Array.isArray(regionsJson.regions) ? regionsJson.regions : [];

    const tianheReg = regionList.find((r) => r.id === "gz_tianhe");
    const shundeReg = regionList.find((r) => r.id === "fs_shunde");
    const ecomReg = regionList.find((r) => r.id === "ecom_demo");

    assert(
      Boolean(tianheReg) &&
        tianheReg?.isDefault === true &&
        tianheReg?.domainProfile?.domainType === "GOV_12345" &&
        tianheReg?.domainProfile?.hasGeoMap === true,
      "gz_tianhe DomainProfile=GOV_12345 且 hasGeoMap=true, isDefault=true"
    );
    assert(
      Boolean(shundeReg) &&
        shundeReg?.isDefault === false &&
        shundeReg?.domainProfile?.domainType === "GOV_12345" &&
        shundeReg?.domainProfile?.hasGeoMap === true,
      "fs_shunde DomainProfile=GOV_12345 且 hasGeoMap=true, isDefault=false"
    );
    assert(
      Boolean(ecomReg) &&
        ecomReg?.isDefault === false &&
        ecomReg?.domainProfile?.domainType === "ECOMMERCE_CS" &&
        ecomReg?.domainProfile?.hasGeoMap === false &&
        ecomReg?.domainProfile?.terminology?.regionUnit === "渠道/仓网",
      "ecom_demo DomainProfile=ECOMMERCE_CS 且 hasGeoMap=false, isDefault=false"
    );

    const dbRegionRows = await sql`SELECT id, is_default FROM public.regions WHERE id IN ('gz_tianhe', 'fs_shunde', 'ecom_demo')`;
    const dbDefaultCount = dbRegionRows.filter((r) => r.is_default === true).length;
    assert(dbDefaultCount === 1, `public.regions 仅 1 个默认租户 (count=${dbDefaultCount})`);

    // 2. 验证 /api/overview & /api/cockpit 电商域数据读出且渠道无“未知”污染
    const overviewRes = await overviewGet(await makeRequest("/api/overview", { regionId: "ecom_demo" }));
    const overviewJson = await overviewRes.json();
    const distKeys = Object.keys(overviewJson.regionDistribution || {});
    assert(
      overviewRes.status === 200 &&
        overviewJson.totalWorkorders === initialEcom.tickets &&
        distKeys.includes("天猫旗舰店") &&
        !distKeys.includes("未知"),
      `ecom_demo /api/overview 总量=${overviewJson.totalWorkorders}, 含天猫旗舰店且无"未知" (${distKeys.length} 个渠道)`
    );

    const cockpitRes = await cockpitGet(await makeRequest("/api/cockpit", { regionId: "ecom_demo" }));
    const cockpitJson = await cockpitRes.json();
    assert(cockpitRes.status === 200 && cockpitJson.success !== false, "ecom_demo /api/cockpit 返回 200");

    // 3. 验证 3 大亮点案例与租户严格隔离
    const { db: ecomDb, schemaName: ecomSchema } = await getRegionDb("ecom_demo");
    assert(ecomSchema === "region_ecom_demo", `ecom_demo 映射到 region_ecom_demo (${ecomSchema})`);

    // 亮点 1：SKU-GD2026-881 高频批次爆发
    const th1EcomRes = await clusterGet(
      await makeRequest("/api/clusters/ECOM-TH-001", { regionId: "ecom_demo" }),
      { params: Promise.resolve({ id: "ECOM-TH-001" }) }
    );
    const th1EcomJson = await th1EcomRes.json();
    assert(
      th1EcomRes.status === 200 &&
        th1EcomJson.id === "ECOM-TH-001" &&
        th1EcomJson.riskLevel === "HIGH" &&
        Number(th1EcomJson.count) >= 28 &&
        String(th1EcomJson.summary || "").includes("SKU-GD2026-881"),
      `亮点案例1 ECOM-TH-001 可读 (HIGH, count=${th1EcomJson.count})`
    );

    // 跨租户隔离：天河库不可见电商主题
    const th1TianheRes = await clusterGet(
      await makeRequest("/api/clusters/ECOM-TH-001", { regionId: "gz_tianhe" }),
      { params: Promise.resolve({ id: "ECOM-TH-001" }) }
    );
    assert(th1TianheRes.status === 404, `跨租户隔离: gz_tianhe 访问 ECOM-TH-001 返回 ${th1TianheRes.status}`);

    // 亮点 2：48h 假闭环重开案例 & fake_closure 页签
    const th2Tickets = await ecomDb
      .select({ id: ticketsTable.id, isFakeClosure: ticketsTable.isFakeClosure })
      .from(ticketsTable)
      .where(and(eq(ticketsTable.primaryThemeId, "ECOM-TH-002"), eq(ticketsTable.isFakeClosure, true)));
    assert(th2Tickets.length >= 1, `亮点案例2 ECOM-TH-002 含假闭环重开工单 (${th2Tickets.length} 条)`);

    const fakeTabRes = await ticketsGet(await makeRequest("/api/tickets?tab=fake_closure&size=20", { regionId: "ecom_demo" }));
    const fakeTabJson = await fakeTabRes.json();
    assert(
      fakeTabRes.status === 200 &&
        Array.isArray(fakeTabJson.data) &&
        fakeTabJson.data.length >= 1 &&
        fakeTabJson.data.every((item: { isFakeClosure?: boolean }) => item.isFakeClosure === true),
      `ecom_demo /api/tickets?tab=fake_closure 返回假闭环记录 (${fakeTabJson.total} 条)`
    );

    // 亮点 3：PII 可逆脱敏验证
    const th3Tickets = await ecomDb
      .select({
        id: ticketsTable.id,
        content: ticketsTable.content,
        maskedContent: ticketsTable.maskedContent,
      })
      .from(ticketsTable)
      .where(eq(ticketsTable.primaryThemeId, "ECOM-TH-003"))
      .limit(10);
    const piiMaskedCount = th3Tickets.filter(
      (t) =>
        Boolean(t.maskedContent) &&
        t.maskedContent !== t.content &&
        /\{\{[A-Z0-9_]+_\d+\}\}/.test(t.maskedContent || "")
    ).length;
    assert(piiMaskedCount >= 1, `亮点案例3 ECOM-TH-003 完成可逆 PII 脱敏写入 (${piiMaskedCount}/${th3Tickets.length})`);

    // 4. 验证 POST /api/sandbox/xray (persist=false) 双域分流与零写库
    const ecomXrayRes = await xrayPost(
      await makeRequest("/api/sandbox/xray", {
        method: "POST",
        regionId: "ecom_demo",
        body: {
          regionId: "ecom_demo",
          persist: false,
          title: "华南冷链仓 SKU-GD2026-881 礼盒化冻发臭，再不赔付打 12315",
          subdistrict: "华南冷链仓",
          content:
            "我叫张测试，手机号13800138999，收到华南冷链仓发出的 SKU-GD2026-881 冻干生鲜礼盒全部化冻发酸，食用后轻微腹泻，要求全额退款并按食安法赔付，否则打 12315 举报！",
        },
      })
    );
    const ecomXrayJson = await ecomXrayRes.json();
    const afterXrayEcom = await readEcomSnapshot();
    assert(
      ecomXrayRes.status === 200 &&
        ecomXrayJson.success === true &&
        ecomXrayJson.domainType === "ECOMMERCE_CS" &&
        ecomXrayJson.persist === false,
      `POST /api/sandbox/xray (ecom_demo) 返回 domainType=ECOMMERCE_CS, persist=false`
    );
    assert(
      !/13800138999/.test(String(ecomXrayJson.step1_anonymize?.maskedText || "")) &&
        /\{\{PHONE_NUMBER_\d+\}\}/.test(String(ecomXrayJson.step1_anonymize?.maskedText || "")),
      "ecom_demo X-Ray Stage1 可逆脱敏隐藏手机号"
    );
    assert(
      ecomXrayJson.step2_systemOne?.adapter === "ecommerce-rule" &&
        ecomXrayJson.step2_systemOne?.stabilityRisk === true &&
        ecomXrayJson.step2_systemOne?.urgency === "URGENT" &&
        ecomXrayJson.step2_systemOne?.slaHours === 2 &&
        Array.isArray(ecomXrayJson.step2_systemOne?.riskSignals) &&
        ecomXrayJson.step2_systemOne.riskSignals.length >= 1,
      `ecom_demo X-Ray Stage2 命中 ecommerce-rule 红线 (${ecomXrayJson.step2_systemOne?.category})`
    );
    assert(
      Boolean(ecomXrayJson.step5_clusterMatch?.matchedTheme?.id),
      `ecom_demo X-Ray Stage5 吸附主题 (${ecomXrayJson.step5_clusterMatch?.matchedTheme?.id})`
    );
    assert(
      afterXrayEcom.tickets === initialEcom.tickets && afterXrayEcom.themes === initialEcom.themes,
      `ecom_demo X-Ray persist=false 严格零写库 (${afterXrayEcom.tickets}/${initialEcom.tickets})`
    );

    // 对照验证 gz_tianhe X-Ray 仍保持政务路由与零写库
    const tianheXrayRes = await xrayPost(
      await makeRequest("/api/sandbox/xray", {
        method: "POST",
        regionId: "gz_tianhe",
        body: {
          regionId: "gz_tianhe",
          persist: false,
          title: "天河南街道夜宵油烟扰民测试",
          subdistrict: "天河南街道",
          content: "天河南街道某餐饮店夜间排烟管道噪音和油烟较大。",
        },
      })
    );
    const tianheXrayJson = await tianheXrayRes.json();
    assert(
      tianheXrayRes.status === 200 &&
        tianheXrayJson.success === true &&
        tianheXrayJson.domainType === "GOV_12345" &&
        tianheXrayJson.step2_systemOne?.adapter !== "ecommerce-rule",
      `对照 gz_tianhe X-Ray 仍为 GOV_12345 (adapter=${tianheXrayJson.step2_systemOne?.adapter})`
    );

    // 5. ecom_demo 独立临时 ID 闭环验证（DISPATCH -> RESOLVE），并在 finally 中彻底清理
    const tempThemeId = "E2E-TEMP-TH-001";
    const tempTicketId = "E2E-TEMP-TK-001";
    const tempTicketNo = "E2E-TEMP-2026-0001";
    const now = new Date();
    try {
      await ecomDb.insert(themesTable).values({
        id: tempThemeId,
        title: "E2E临时校验 · 华南冷链仓温控抽检工单闭环测试",
        canonicalSubject: "SKU-TEMP-VERIFY",
        canonicalLocation: "华南冷链仓",
        eventType: "临时测试温控复核",
        category: "商品质量与破损",
        riskLevel: "LOW",
        riskReason: "Verifier 临时闭环测试案卷",
        ticketCount: 1,
        timeSpanHours: 1,
        aiSummary: "Verifier 临时闭环测试",
        recommendedAction: "责任团队：品控质检组；响应时限：24小时内核查",
        patternType: "HOTSPOT",
        civicMode: "NORMAL_CLUSTER",
        aiConfidence: 90,
        firstAt: now,
        lastAt: now,
        handlingStatus: "PENDING",
        handlingProgress: 0,
      });
      await ecomDb.insert(ticketsTable).values({
        id: tempTicketId,
        ticketNo: tempTicketNo,
        title: "E2E临时测试工单",
        summarizeTitle: "E2E临时测试工单",
        content: "Verifier 临时测试闭环，测试完成后自动清除。",
        maskedContent: "Verifier 临时测试闭环，测试完成后自动清除。",
        subdistrict: "华南冷链仓",
        sourceCategory: "商品质量与破损",
        urgency: "NORMAL",
        canonicalSubject: "SKU-TEMP-VERIFY",
        eventType: "临时测试温控复核",
        address: "华南冷链仓",
        confidence: 90,
        primaryThemeId: tempThemeId,
        status: "PENDING",
        createTime: now,
      });
      await ecomDb.insert(ticketThemesTable).values({
        ticketId: tempTicketId,
        themeId: tempThemeId,
      });

      const dRes = await clusterPatch(
        await makeRequest(`/api/clusters/${tempThemeId}`, {
          regionId: "ecom_demo",
          method: "PATCH",
          body: { action: "DISPATCH", owner: "品控质检组", note: "E2E临时派单" },
        }),
        { params: Promise.resolve({ id: tempThemeId }) }
      );
      const dJson = await dRes.json();
      assert(
        dRes.status === 200 &&
          dJson.status?.code === "IN_PROGRESS" &&
          dJson.status?.progress === 40 &&
          dJson.status?.owner === "品控质检组",
        `ecom_demo 临时案卷 DISPATCH 成功 (IN_PROGRESS 40%)`
      );

      const rRes = await clusterPatch(
        await makeRequest(`/api/clusters/${tempThemeId}`, {
          regionId: "ecom_demo",
          method: "PATCH",
          body: { action: "RESOLVE", owner: "品控质检组", note: "E2E临时办结" },
        }),
        { params: Promise.resolve({ id: tempThemeId }) }
      );
      const rJson = await rRes.json();
      const [tempTkAfter] = await ecomDb
        .select({ status: ticketsTable.status, closureStatus: ticketsTable.closureStatus })
        .from(ticketsTable)
        .where(eq(ticketsTable.id, tempTicketId));
      const tempLogs = await ecomDb
        .select({ id: disposalLogsTable.id })
        .from(disposalLogsTable)
        .where(eq(disposalLogsTable.targetId, tempThemeId));
      assert(
        rRes.status === 200 &&
          rJson.status?.code === "RESOLVED" &&
          rJson.status?.progress === 100 &&
          tempTkAfter?.closureStatus === "RESOLVED" &&
          tempLogs.length >= 2,
        `ecom_demo 临时案卷 RESOLVE 成功且写入 disposal_logs (${tempLogs.length} 条)`
      );
    } finally {
      await ecomDb.delete(disposalLogsTable).where(eq(disposalLogsTable.targetId, tempThemeId));
      await ecomDb.delete(ticketThemesTable).where(eq(ticketThemesTable.themeId, tempThemeId));
      await ecomDb.delete(themesTable).where(eq(themesTable.id, tempThemeId));
      await ecomDb.delete(ticketsTable).where(eq(ticketsTable.id, tempTicketId));
    }
  } finally {
    const afterCleanupEcom = await readEcomSnapshot();
    assert(
      afterCleanupEcom.tickets === initialEcom.tickets &&
        afterCleanupEcom.themes === initialEcom.themes &&
        afterCleanupEcom.disposalLogs === initialEcom.disposalLogs,
      `[清理后] ecom_demo 数据无污染还原 (tickets=${afterCleanupEcom.tickets}/${initialEcom.tickets}, themes=${afterCleanupEcom.themes}/${initialEcom.themes}, logs=${afterCleanupEcom.disposalLogs}/${initialEcom.disposalLogs})`
    );
    await assertBaselineUnchanged("清理后");
    if (prevAppDomain === undefined) {
      delete process.env.APP_DOMAIN;
    } else {
      process.env.APP_DOMAIN = prevAppDomain;
    }
  }

  // 显式确保 regionsTable 引用不被裁掉（校验未篡改 schema）
  void regionsTable;

  if (failedAssertions > 0) {
    console.error(`\n❌ 阶段 4 验收失败: ${failedAssertions} 项断言未通过`);
    process.exit(1);
  }
  console.log("\n✅ 阶段 4 衍生电商应用域端到端验收全部通过！");
  process.exit(0);
}

main().catch((err) => {
  console.error("测试执行异常:", err);
  process.exit(1);
});
