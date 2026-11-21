/**
 * M9 P1 #5, #6, #7 & M6 预防语境补充 — 综合单元测试与回归验证套件
 *
 * 覆盖：
 * 1. P1 #5: `evaluateEcommerceTicket` 否定上下文窗口 + 口语同义词 + 边界保护
 * 2. P1 #5: `evaluateCallbackSentiment` 双重否定/转折优先/口语词表 + 裸依然/仍然去误杀
 * 3. M6 Caveat: `ACCIDENT_PREVENTIVE_PREFIX_RE` / `REDLINE_ACCIDENT_PREVENTIVE_RE` + 后缀 `隐患/风险/苗头` 一致性
 * 4. P1 #6: `SystemTwoEngine` 冷却单飞回切本地集群 + `PooledMetalAdapter` 探活去重 & `lastChecked`
 * 5. P1 #6: `LlmPool` 双车道优先级 + 交互预留 + 即时 `AbortSignal` 退队 + `streamCopilot`/`extractNode`/`summaryNode`
 * 6. P1 #6: 确认移除死代码 `modelSupportsToolCalling`
 * 7. P1 #7: `canonicalizeTownship` 最长匹配、`evaluateIncrementalTicket` 空日期/`HIGH` 刷新、`upgradeThemeWithSystemTwo` 最新工单
 * 8. P1 #7 (临时 schema `verify_m9_gov`, 结束后物理清理): `processIntakeChat` 多轮标题刷新与槽位合并、`processAgentVoiceTurn` 保护已确认槽位与泛型主体拦截、`runAgentPatrol`、`POST /api/tickets`
 */

import fs from "node:fs";
import http from "node:http";
import path from "node:path";
import { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import {
  SystemTwoEngine,
  PooledMetalAdapter,
  isAbortError,
} from "@civic/system-two";
import {
  hasCivicRedlineSignal,
  matchCivicRedline,
  SystemOneEngine,
} from "@civic/system-one";
import { evaluateEcommerceTicket } from "../lib/ecommerce-triage";
import {
  evaluateCallbackSentiment,
  hasRedlineSignal,
  processIntakeChat,
  processAgentVoiceTurn,
  runAgentPatrol,
  invalidateAgentGovernanceCache,
} from "../lib/agent-governance";
import {
  canonicalizeTownship,
  CATEGORY,
  type RegionVocabulary,
} from "../lib/vocabulary";
import {
  evaluateIncrementalTicket,
  upgradeThemeWithSystemTwo,
} from "../backend/incremental-cluster";
import type { EnrichedTicket, MultiFrequencyTheme, TicketRadarState } from "../backend/state";
import { HANDLING_STATUS } from "../lib/civic-dto";
import {
  LlmPool,
  getLlmPool,
  runInLlmPool,
  _resetLlmPoolForTesting,
} from "../backend/llm-pool";
import { extractNode } from "../backend/node/extract-node";
import { summaryNode, enrichThemeBatchWithLLM } from "../backend/node/summary-node";
import { streamCopilot, type CopilotEngineLike } from "../backend/agent/copilot-agent";
import { getRegionDb, sql } from "../db/client";
import { themesTable, ticketsTable, vocabulariesTable } from "../db/schema";
import { destroyRegionTenant, registerRegion } from "../lib/tenant/schema-manager";
import { invalidateCivicAggregates } from "../lib/civic-cache";
import { withAuthHeaders } from "./_auth-helper";
import { POST as ticketsPost } from "../app/api/tickets/route";

let passed = 0;
let failed = 0;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    failed += 1;
    console.error(`FAIL ${msg}`);
    process.exitCode = 1;
  } else {
    passed += 1;
    console.log(`PASS ${msg}`);
  }
}

interface MockServer {
  url: string;
  modelsHits: number;
  chatHits: number;
  setHealthy: (ok: boolean) => void;
  close: () => Promise<void>;
}

async function startMockLlmServer(options: {
  name: string;
  healthy?: boolean;
  onChat?: (body: any, attempt: number) => { content: string; status?: number };
}): Promise<MockServer> {
  let healthy = options.healthy ?? true;
  let modelsHits = 0;
  let chatHits = 0;

  const server = http.createServer(async (req, res) => {
    if (req.method === "GET" && req.url?.includes("/models")) {
      modelsHits += 1;
      if (!healthy) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "unhealthy" }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ data: [{ id: options.name }] }));
      return;
    }
    if (req.method === "GET" && req.url?.includes("/health")) {
      if (!healthy) {
        res.statusCode = 503;
        res.end(JSON.stringify({ error: "unhealthy" }));
        return;
      }
      res.setHeader("content-type", "application/json");
      res.end(JSON.stringify({ status: "ok" }));
      return;
    }

    if (req.method === "POST" && req.url?.includes("/chat/completions")) {
      chatHits += 1;
      const chunks: Buffer[] = [];
      for await (const ch of req) {
        chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
      }
      const rawBody = Buffer.concat(chunks).toString("utf-8");
      const parsedBody = rawBody ? JSON.parse(rawBody) : {};

      if (!healthy) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: `${options.name} down` }));
        return;
      }

      const custom = options.onChat?.(parsedBody, chatHits);
      const content = custom?.content ?? JSON.stringify({ ok: true, server: options.name });
      const status = custom?.status ?? 200;

      if (status !== 200) {
        res.statusCode = status;
        res.end(JSON.stringify({ error: content }));
        return;
      }

      if (parsedBody.stream) {
        res.setHeader("content-type", "text/event-stream; charset=utf-8");
        res.write(
          `data: ${JSON.stringify({
            choices: [{ delta: { content }, finish_reason: "stop" }],
          })}\n\n`
        );
        res.write("data: [DONE]\n\n");
        res.end();
        return;
      }

      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          id: `mock-${chatHits}`,
          object: "chat.completion",
          created: Math.floor(Date.now() / 1000),
          model: options.name,
          choices: [
            {
              index: 0,
              message: { role: "assistant", content },
              finish_reason: "stop",
            },
          ],
          usage: { prompt_tokens: 10, completion_tokens: 10, total_tokens: 20 },
        })
      );
      return;
    }

    if (req.method === "POST" && req.url?.includes("/embeddings")) {
      const chunks: Buffer[] = [];
      for await (const ch of req) {
        chunks.push(Buffer.isBuffer(ch) ? ch : Buffer.from(ch));
      }
      const parsed = JSON.parse(Buffer.concat(chunks).toString("utf-8") || "{}");
      const inputs = Array.isArray(parsed.input) ? parsed.input : [parsed.input || ""];
      const vec = Array.from({ length: 1024 }, (_, idx) => (idx === 0 ? 1 : 0));
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify({
          data: inputs.map((_: unknown, index: number) => ({ index, embedding: vec })),
        })
      );
      return;
    }

    res.statusCode = 404;
    res.end();
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  return {
    url: `http://127.0.0.1:${port}/v1`,
    get modelsHits() {
      return modelsHits;
    },
    get chatHits() {
      return chatHits;
    },
    setHealthy(ok: boolean) {
      healthy = ok;
    },
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections?.();
        server.close(() => resolve());
      }),
  };
}

function testP1_5_EcommerceTriage() {
  console.log("\n--- 1. P1 #5: evaluateEcommerceTicket 否定窗口 & 口语词表 ---");

  const negRedlineCases = [
    "收到的礼盒并非假货，只是外盒轻微压扁",
    "经核实无食物中毒，也不存在欺诈行为",
    "家人食用后未出现腹泻，也没有发霉、腐烂或变质",
    "无食物中毒、腹泻及呕吐，并非假货或山寨",
    "防伪码验证通过，不是假货，只是不会安装",
    "不会打12315，只是希望帮忙换货",
  ];
  for (const text of negRedlineCases) {
    const res = evaluateEcommerceTicket({ content: text });
    assert(
      res.stabilityRisk === false,
      `电商否定防误杀 "${text}" -> stabilityRisk=${res.stabilityRisk}`
    );
  }

  const posRedlineCases = [
    "再不处理我就打12315投诉",
    "如果不退款就打12315",
    "无良商家卖假货，必须假一赔三",
    "没有售后还卖假货和过期食品",
    "吃了之后拉肚子上吐下泻，必须赔付",
    "收到的是翻新机不是正品",
  ];
  for (const text of posRedlineCases) {
    const res = evaluateEcommerceTicket({ content: text });
    assert(
      res.stabilityRisk === true && res.urgency === "URGENT" && res.slaHours === 2,
      `电商红线触发 "${text}" -> stabilityRisk=${res.stabilityRisk}, urgency=${res.urgency}`
    );
  }

  const inv = evaluateEcommerceTicket({ content: "没有破损也没有丢件，请问怎么开发票" });
  assert(
    inv.intent === "INQUIRY" && inv.urgency === "NORMAL" && inv.slaHours === 0,
    `否定破损/丢件咨询保持 INQUIRY/0h (got intent=${inv.intent}, urgency=${inv.urgency}, sla=${inv.slaHours})`
  );

  const askAuthentic = evaluateEcommerceTicket({ content: "请问是不是正品，什么时候发货" });
  assert(
    askAuthentic.stabilityRisk === false && askAuthentic.intent === "INQUIRY",
    `"请问是不是正品" 识别为正常咨询而非假货红线 (intent=${askAuthentic.intent}, risk=${askAuthentic.stabilityRisk})`
  );

  const comm = evaluateEcommerceTicket({ content: "感谢客服，没有破损也没有问题，五星好评" });
  assert(
    comm.intent === "COMMENDATION",
    `否定问题后表扬识别为 COMMENDATION (got ${comm.intent})`
  );

  const sugg = evaluateEcommerceTicket({ content: "并非假货，建议优化一下泡沫防撞包装" });
  assert(
    sugg.intent === "SUGGESTION",
    `否定假货后建议识别为 SUGGESTION (got ${sugg.intent})`
  );

  const catQuality = evaluateEcommerceTicket({ content: "并非食物中毒，只是杯子摔坏碎了漏水" });
  assert(
    catQuality.stabilityRisk === false &&
      catQuality.category === "商品质量与破损" &&
      catQuality.urgency === "MEDIUM",
    `否定食安且摔坏碎了归类商品质量 MEDIUM (got cat=${catQuality.category}, urgency=${catQuality.urgency})`
  );

  const noFakeReminder = evaluateEcommerceTicket({ content: "没有假闭环，并未推诿，请问何时发货" });
  assert(
    noFakeReminder.intent === "INQUIRY",
    `否定假闭环/推诿不误判催办 (got ${noFakeReminder.intent})`
  );

  const catService = evaluateEcommerceTicket({
    content: "客服一直装死强行关单，再不处理打12315",
    subdistrict: "ECOM-TH-002",
  });
  assert(
    catService.stabilityRisk === true && catService.category === "客服推诿与售后超时",
    `12315 保留红线同时归类客服推诿与售后超时 (got cat=${catService.category})`
  );

  const catLogistics = evaluateEcommerceTicket({ content: "一直没发货虚假发货，物流卡在半路" });
  assert(
    catLogistics.category === "物流延误与丢件" && catLogistics.urgency === "MEDIUM",
    `口语物流延误与丢件归类 (got ${catLogistics.category})`
  );

  // Iteration 2: 商家/平台应尽义务未履行（没有/并未/暂未/还没有/不会/无任何 + 退款/赔偿/发货/解决/处理）、链式没有出现/发生、小写a货&防伪码查不到
  const absentRefund1 = evaluateEcommerceTicket({ content: "申请售后三天了，一直没有退款，也没有赔偿" });
  assert(
    absentRefund1.category === "退款与价保纠纷",
    `没有退款/赔偿归类退款与价保纠纷 (got ${absentRefund1.category})`
  );

  const absentRefund2 = evaluateEcommerceTicket({ content: "申请一周还没有收到退款" });
  assert(
    absentRefund2.category === "退款与价保纠纷",
    `还没有收到退款归类退款与价保纠纷 (got ${absentRefund2.category})`
  );

  const absentRefund3 = evaluateEcommerceTicket({ content: "商家并未退款也暂未赔付" });
  assert(
    absentRefund3.category === "退款与价保纠纷",
    `并未退款暂未赔付归类退款与价保纠纷 (got ${absentRefund3.category})`
  );

  const absentRefund4 = evaluateEcommerceTicket({ content: "商家说不会退钱，也没有赔偿" });
  assert(
    absentRefund4.category === "退款与价保纠纷",
    `不会退钱无赔偿归类退款与价保纠纷 (got ${absentRefund4.category})`
  );

  const absentRefund5 = evaluateEcommerceTicket({ content: "客服无任何赔偿方案" });
  assert(
    absentRefund5.category === "退款与价保纠纷",
    `无任何赔偿方案归类退款与价保纠纷 (got ${absentRefund5.category})`
  );

  const absentRefundSuggest = evaluateEcommerceTicket({ content: "一直没有退款，建议平台管管" });
  assert(
    absentRefundSuggest.intent !== "SUGGESTION" && absentRefundSuggest.category === "退款与价保纠纷",
    `一直没有退款建议平台管管不误判 SUGGESTION (got intent=${absentRefundSuggest.intent}, cat=${absentRefundSuggest.category})`
  );

  const absentShip1 = evaluateEcommerceTicket({ content: "下单五天了商家一直没有发货" });
  assert(
    absentShip1.category === "物流延误与丢件" && absentShip1.urgency === "MEDIUM",
    `一直没有发货归类物流延误与丢件且 MEDIUM (got cat=${absentShip1.category}, urgency=${absentShip1.urgency})`
  );

  const absentShipInquiry = evaluateEcommerceTicket({ content: "一直没有发货，请问什么时候发货" });
  assert(
    absentShipInquiry.intent !== "INQUIRY" &&
      absentShipInquiry.category === "物流延误与丢件" &&
      absentShipInquiry.urgency === "MEDIUM",
    `一直没有发货追问拦截 INQUIRY (got intent=${absentShipInquiry.intent}, cat=${absentShipInquiry.category})`
  );

  const absentService = evaluateEcommerceTicket({ content: "客服一直没有解决，也没有处理" });
  assert(
    absentService.intent === "REMINDER" &&
      absentService.category === "客服推诿与售后超时" &&
      absentService.urgency === "MEDIUM",
    `客服一直没有解决也没有处理归类客服推诿且 REMINDER/MEDIUM (got intent=${absentService.intent}, cat=${absentService.category})`
  );

  // 否定防误杀边界保留：没有退货、无需退款、不需要退款
  const noReturn = evaluateEcommerceTicket({ content: "没有退货，只是咨询怎么开发票" });
  assert(
    noReturn.intent === "INQUIRY" && noReturn.category !== "退款与价保纠纷",
    `没有退货仍保持否定不误判退款纠纷 (got intent=${noReturn.intent}, cat=${noReturn.category})`
  );
  for (const waived of ["无需退款，只是咨询保修政策", "不需要退款，仅咨询怎么使用"]) {
    const r = evaluateEcommerceTicket({ content: waived });
    assert(
      r.intent === "INQUIRY" && r.category !== "退款与价保纠纷",
      `豁免退款否定 "${waived}" 不误判退款纠纷 (got intent=${r.intent}, cat=${r.category})`
    );
  }

  // 链式没有出现/没有发生防误杀
  const chainNeg1 = evaluateEcommerceTicket({ content: "没有出现食物中毒、腹泻、呕吐，只是包装破损" });
  assert(
    chainNeg1.stabilityRisk === false && chainNeg1.category === "商品质量与破损",
    `没有出现食物中毒、腹泻、呕吐不触发食安红线 (got risk=${chainNeg1.stabilityRisk}, cat=${chainNeg1.category})`
  );

  const chainNeg2 = evaluateEcommerceTicket({ content: "没有发生食物中毒、腹泻，仅咨询保质期" });
  assert(
    chainNeg2.stabilityRisk === false && chainNeg2.category !== "食安与合规红线",
    `没有发生食物中毒、腹泻不触发食安红线 (got risk=${chainNeg2.stabilityRisk}, cat=${chainNeg2.category})`
  );

  // 小写 a货 & 防伪码查不到
  const lowerAHuo = evaluateEcommerceTicket({ content: "买到a货，防伪码查不到" });
  assert(
    lowerAHuo.stabilityRisk === true &&
      lowerAHuo.urgency === "URGENT" &&
      lowerAHuo.category === "假冒伪劣与欺诈",
    `小写 a货与防伪码查不到触发假冒合规红线 (got risk=${lowerAHuo.stabilityRisk}, cat=${lowerAHuo.category})`
  );
}

function testP1_5_CallbackSentiment() {
  console.log("\n--- 2. P1 #5: evaluateCallbackSentiment 双重否定/转折/口语 ---");

  const cases: Array<{ text: string; expected: "NEGATIVE" | "POSITIVE" | "UNCLEAR" }> = [
    { text: "不是没解决，已经解决了", expected: "POSITIVE" },
    { text: "不是没解决已经解决了", expected: "POSITIVE" },
    { text: "没有没解决，早就弄好了", expected: "POSITIVE" },
    { text: "没有不满意，挺好的", expected: "POSITIVE" },
    { text: "不是假办结，已经退到账了", expected: "POSITIVE" },
    { text: "不是没收到退款，已经退到账了", expected: "POSITIVE" },
    { text: "问题已解决，依然很满意", expected: "POSITIVE" },
    { text: "仍然挺好的，谢谢", expected: "POSITIVE" },
    { text: "弄好了，已经妥了", expected: "POSITIVE" },
    { text: "之前一直拖着，但昨天终于修好了", expected: "POSITIVE" },
    { text: "已解决，但想问下以后怎么联系", expected: "POSITIVE" },
    { text: "口头上说已解决，但实际上根本没修好", expected: "NEGATIVE" },
    { text: "并不是已经解决了，现在还在漏水", expected: "NEGATIVE" },
    { text: "不是没问题，问题根本还在", expected: "NEGATIVE" },
    { text: "根本没修好", expected: "NEGATIVE" },
    { text: "一直拖着压根没人管", expected: "NEGATIVE" },
    { text: "白跑一趟还是老样子", expected: "NEGATIVE" },
    { text: "强行结案还在吵", expected: "NEGATIVE" },
    { text: "问题依然存在，还是漏水", expected: "NEGATIVE" },
    { text: "不太满意，没有收到退款", expected: "NEGATIVE" },
    { text: "根本没收到退款，客服敷衍假办结，非常不满意！", expected: "NEGATIVE" },
    { text: "请问您刚才说的是哪个单号", expected: "UNCLEAR" },
    // Iteration 2: 否定症状、礼貌客套不掩盖未解决、无标点转折、多转折递归、副词间隔与高频负向短语
    { text: "修好了，不漏水了", expected: "POSITIVE" },
    { text: "已解决，不再漏水了", expected: "POSITIVE" },
    { text: "已经不吵了，也没漏水", expected: "POSITIVE" },
    { text: "还是漏", expected: "NEGATIVE" },
    { text: "还在漏", expected: "NEGATIVE" },
    { text: "一直漏水", expected: "NEGATIVE" },
    { text: "问题还是没解决，但客服态度挺好的", expected: "NEGATIVE" },
    { text: "根本没修好，不过谢谢你们回访", expected: "NEGATIVE" },
    { text: "之前一直拖着但是昨天终于修好了", expected: "POSITIVE" },
    { text: "刚开始没修好可是昨天弄好了", expected: "POSITIVE" },
    { text: "现在还在吵，但刚才已经解决了，不过我想问下退款", expected: "POSITIVE" },
    { text: "整改不过关", expected: "NEGATIVE" },
    { text: "没有彻底解决", expected: "NEGATIVE" },
    { text: "并没有完全修好", expected: "NEGATIVE" },
    { text: "并未真正解决", expected: "NEGATIVE" },
    { text: "还没完全修好", expected: "NEGATIVE" },
    { text: "态度依然很差", expected: "NEGATIVE" },
    { text: "态度仍然不好", expected: "NEGATIVE" },
    { text: "问题根本没有改善", expected: "NEGATIVE" },
    { text: "还是老问题", expected: "NEGATIVE" },
    { text: "依然老样子", expected: "NEGATIVE" },
  ];

  for (const c of cases) {
    const actual = evaluateCallbackSentiment(c.text);
    assert(
      actual === c.expected,
      `回访情感 "${c.text}" -> ${actual} (预期 ${c.expected})`
    );
  }
}

async function testM6_PreventiveModifierParity() {
  console.log("\n--- 3. M6 Caveat: 事故预防词 + 隐患/风险/苗头 ---");

  const falseCases = [
    "路口标线模糊，可能会发生重大交通事故，请整改。",
    "人行道没有护栏，容易出现重大交通事故，建议加装护栏。",
    "该路段大货车抢道，极易引发严重的重大交通事故。",
    "某仓库存在重大事故隐患，请求排查。",
    "该路口存在重大交通事故风险，建议优化信号灯。",
    "厂区存在重大安全生产事故苗头，请加强巡查。",
    "这里极易导致发生重大交通事故",
    "有发生重大交通事故的可能",
    "存在引发重大安全事故的安全隐患",
  ];

  const s1 = await SystemOneEngine.create();
  try {
    for (const text of falseCases) {
      const civic = hasCivicRedlineSignal(text);
      const gov = hasRedlineSignal(text);
      const evalRes = await s1.evaluate({ title: text, content: text });
      assert(
        civic === false && gov === false && evalRes.stabilityRisk === false,
        `预防语境不误报红线 "${text}" -> civic=${civic}, gov=${gov}, s1=${evalRes.stabilityRisk}`
      );
    }

    const trueCases = [
      "高速路段发生重大交通事故连环相撞，现场拥堵",
      "高速路口发生重大交通事故可能导致交通瘫痪",
      "居民担心危房随时坍塌",
      "居民担心化工厂发生爆炸",
    ];
    for (const text of trueCases) {
      const civic = hasCivicRedlineSignal(text);
      const gov = hasRedlineSignal(text);
      assert(
        civic === true && gov === true,
        `真实涉稳险情保持触发 "${text}" -> civic=${civic}, gov=${gov}`
      );
    }
  } finally {
    await s1.close();
  }
}

async function testP1_6_SwitchbackAndPool() {
  console.log("\n--- 4. P1 #6: System-2 回切 & PooledMetalAdapter & LlmPool ---");

  // 4.1 SystemTwoEngine cooldown switchback + single-flight probe + createStream switchback
  const localSrv = await startMockLlmServer({
    name: "local-metal",
    healthy: false,
    onChat: () => ({ content: JSON.stringify({ backend: "local" }) }),
  });
  const cloudSrv = await startMockLlmServer({
    name: "cloud-openai",
    healthy: true,
    onChat: () => ({ content: JSON.stringify({ backend: "cloud" }) }),
  });

  try {
    const adapter = new PooledMetalAdapter([localSrv.url], { timeoutMs: 2000 });
    const [ok1, ok2, ok3] = await Promise.all([
      adapter.isAvailable(),
      adapter.isAvailable(),
      adapter.isAvailable(),
    ]);
    assert(
      !ok1 && !ok2 && !ok3 && localSrv.modelsHits === 1,
      `PooledMetalAdapter.isAvailable 单飞去重 (modelsHits=${localSrv.modelsHits})`
    );

    // 验证 syncNodes() 递增 syncGeneration 后，在途失败探测不会覆写新节点的 isHealthy=true
    const delayedSrv = http.createServer((req, res) => {
      if (req.url?.includes("/models")) {
        setTimeout(() => {
          res.statusCode = 503;
          res.end(JSON.stringify({ error: "stale down" }));
        }, 50);
        return;
      }
      res.statusCode = 404;
      res.end();
    });
    await new Promise<void>((resolve) => delayedSrv.listen(0, "127.0.0.1", () => resolve()));
    try {
      const delayedAddr = delayedSrv.address();
      const delayedPort = typeof delayedAddr === "object" && delayedAddr ? delayedAddr.port : 0;
      const delayedUrl = `http://127.0.0.1:${delayedPort}/v1`;
      const genAdapter = new PooledMetalAdapter(
        [{ endpoint: delayedUrl, apiKey: "old-key", model: "m1" }],
        { timeoutMs: 2000 }
      );
      const staleProbe = genAdapter.isAvailable();
      await new Promise((r) => setTimeout(r, 10));
      genAdapter.syncNodes([{ endpoint: delayedUrl, apiKey: "new-key", model: "m2" }]);
      await staleProbe;
      const metasAfterSync = genAdapter.getNodeMetas();
      assert(
        metasAfterSync[0]?.isHealthy === true,
        `syncNodes 热重载后过期探活结果不覆写新节点 isHealthy (isHealthy=${metasAfterSync[0]?.isHealthy})`
      );
    } finally {
      await new Promise<void>((resolve) => {
        delayedSrv.closeAllConnections?.();
        delayedSrv.close(() => resolve());
      });
    }

    const engine = await SystemTwoEngine.create({
      nodes: [localSrv.url],
      cloudFallback: { endpoint: cloudSrv.url, apiKey: "test-key", model: "cloud-openai" },
      timeoutMs: 2000,
      clusterSwitchbackCooldownMs: 80,
    } as any);

    assert(
      engine.getActiveBackend().includes("Cloud"),
      `初始本地不可用时降级到 Cloud (got ${engine.getActiveBackend()})`
    );

    const hitsBeforeCooldown = localSrv.modelsHits;
    const r1 = await engine.chat.completions.create({
      messages: [{ role: "user", content: "hi" }],
    });
    assert(
      r1.model === "cloud-openai" && localSrv.modelsHits === hitsBeforeCooldown,
      `冷却期内不探活本地节点 (modelsHits=${localSrv.modelsHits}/${hitsBeforeCooldown})`
    );

    localSrv.setHealthy(true);
    await new Promise((r) => setTimeout(r, 100));

    const hitsBeforeBurst = localSrv.modelsHits;
    const burst = await Promise.all(
      Array.from({ length: 5 }, () =>
        engine.chat.completions.create({
          messages: [{ role: "user", content: "hi" }],
        })
      )
    );
    assert(
      engine.getActiveBackend().includes("PooledMetal") &&
        burst.every((b) => b.model === "local-metal") &&
        localSrv.modelsHits - hitsBeforeBurst === 1,
      `冷却后 5 并发单飞探活并自动切回本地集群 (modelsDelta=${localSrv.modelsHits - hitsBeforeBurst})`
    );

    // 验证 createStream 也能在本地恢复后自动切回
    localSrv.setHealthy(false);
    const streamFailoverChunks: string[] = [];
    for await (const ch of engine.chat.completions.createStream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (ch.deltaContent) streamFailoverChunks.push(ch.deltaContent);
    }
    assert(
      engine.getActiveBackend().includes("Cloud") && streamFailoverChunks.join("").includes("cloud"),
      `流式在本地故障时切至 Cloud`
    );

    localSrv.setHealthy(true);
    await new Promise((r) => setTimeout(r, 100));
    const streamBackChunks: string[] = [];
    for await (const ch of engine.chat.completions.createStream({
      messages: [{ role: "user", content: "hi" }],
    })) {
      if (ch.deltaContent) streamBackChunks.push(ch.deltaContent);
    }
    assert(
      engine.getActiveBackend().includes("PooledMetal") &&
        streamBackChunks.join("").includes("local"),
      `流式在冷却后自动切回 PooledMetalAdapter`
    );
  } finally {
    await localSrv.close();
    await cloudSrv.close();
  }

  // 4.2 LlmPool 两车道 + interactive headroom + 抢占顺序 + AbortSignal 即时退队
  {
    const pool = new LlmPool({ concurrency: 2 });
    let releaseBatch!: () => void;
    const batchGate = new Promise<void>((r) => {
      releaseBatch = r;
    });
    let b1Started = false;
    let b2Started = false;

    const b1 = pool.run(async () => {
      b1Started = true;
      await batchGate;
      return "b1";
    }, { lane: "batch" });
    const b2 = pool.run(async () => {
      b2Started = true;
      return "b2";
    }, { lane: "batch" });

    await new Promise((r) => setTimeout(r, 15));
    assert(b1Started && !b2Started, "concurrency=2 时 batch 最多占 1 槽，为 interactive 预留 1 槽");

    const interactiveDone = await pool.run(async () => "i1", { lane: "interactive" });
    assert(interactiveDone === "i1", "batch 拥堵时 interactive 立即拿到预留槽位完成");

    releaseBatch();
    assert((await b1) === "b1" && (await b2) === "b2", "放行后 batch 队列正常排空");
  }

  {
    const pool = new LlmPool({ concurrency: 1 });
    const order: string[] = [];
    let releaseB1!: () => void;
    const b1Gate = new Promise<void>((r) => {
      releaseB1 = r;
    });

    const pB1 = pool.run(async () => {
      order.push("B1");
      await b1Gate;
    }, { lane: "batch" });
    const pB2 = pool.run(async () => {
      order.push("B2");
    }, { lane: "batch" });
    const pB3 = pool.run(async () => {
      order.push("B3");
    }, { lane: "batch" });
    const pI1 = pool.run(async () => {
      order.push("I1");
    }, { lane: "interactive" });

    await new Promise((r) => setTimeout(r, 10));
    releaseB1();
    await Promise.all([pB1, pB2, pB3, pI1]);
    assert(
      order.join("->") === "B1->I1->B2->B3",
      `concurrency=1 时 interactive 插队先于待处理 batch (order=${order.join("->")})`
    );
  }

  {
    const pool = new LlmPool({ concurrency: 1 });
    const preCtrl = new AbortController();
    preCtrl.abort("pre");
    let preRan = false;
    let preErr: unknown = null;
    try {
      await pool.run(
        async () => {
          preRan = true;
        },
        { lane: "interactive", signal: preCtrl.signal }
      );
    } catch (e) {
      preErr = e;
    }
    assert(!preRan && isAbortError(preErr), "预中止 signal 立即抛 AbortError 且不执行任务");

    let releaseBlocker!: () => void;
    const blockerGate = new Promise<void>((r) => {
      releaseBlocker = r;
    });
    const blocker = pool.run(() => blockerGate, { lane: "batch" });

    const queuedCtrl = new AbortController();
    let queuedRan = false;
    const queuedPromise = pool.run(
      async () => {
        queuedRan = true;
      },
      { lane: "batch", signal: queuedCtrl.signal }
    );

    const t0 = Date.now();
    queuedCtrl.abort("user cancel");
    let queuedErr: unknown = null;
    try {
      await queuedPromise;
    } catch (e) {
      queuedErr = e;
    }
    const elapsed = Date.now() - t0;
    releaseBlocker();
    await blocker;
    assert(
      isAbortError(queuedErr) && !queuedRan && elapsed < 30 && pool.size === 0 && pool.pending === 0,
      `排队中 AbortSignal 立即退队抛 AbortError (${elapsed}ms) 且绝不执行回调`
    );
  }

  // 4.3 streamCopilot 经由 interactive 车道在批处理拥堵时立即完成 + 预中止不入池
  {
    _resetLlmPoolForTesting();
    const pool = getLlmPool();
    pool.concurrency = 2;
    let releaseSlow!: () => void;
    const slowGate = new Promise<void>((r) => {
      releaseSlow = r;
    });
    const slowBatch = pool.add(() => slowGate, { lane: "batch" });
    const slowQueued = pool.add(async () => {}, { lane: "batch" });

    const mockEngine: CopilotEngineLike = {
      chat: {
        completions: {
          async *createStream() {
            yield {
              deltaContent: JSON.stringify({ action: "answer", text: "交互通道直达回复" }),
              finishReason: "stop",
            };
          },
        },
      },
    };

    const events: Array<{ type: string; text?: string }> = [];
    for await (const ev of streamCopilot({
      regionId: "fs_shunde",
      regionLabel: "测试辖区",
      domainType: "GOV_12345",
      turns: [{ role: "user", content: "查看态势" }],
      engine: mockEngine,
      tools: [],
    })) {
      events.push(ev);
    }
    assert(
      events.some((e) => e.type === "answer" && e.text?.includes("交互通道直达回复")),
      `streamCopilot 在 batch 队列积压时仍经 interactive 通道立即响应`
    );

    releaseSlow();
    await Promise.all([slowBatch, slowQueued]);
    _resetLlmPoolForTesting();
  }

  // 4.4 extractNode / summaryNode AbortSignal 透传 + 死探针代码移除校验
  {
    const abortCtrl = new AbortController();
    abortCtrl.abort("cancelled");
    let extractAborted = false;
    try {
      await extractNode(
        {
          rawTickets: [
            {
              id: "t1",
              ticketNo: "NO1",
              title: "测试",
              content: "测试内容",
              createTime: "2026-01-01 00:00:00",
              citizenName: "市民",
              citizenPhone: "",
              subdistrict: "大良街道",
              channel: "热线",
              status: "PENDING",
            },
          ],
          status: "idle",
        } as TicketRadarState,
        { signal: abortCtrl.signal }
      );
    } catch (err) {
      extractAborted = isAbortError(err);
    }
    assert(extractAborted, "extractNode 预中止立即抛出 AbortError 不回退正则");

    let summaryAborted = false;
    try {
      await enrichThemeBatchWithLLM(
        [
          {
            id: "th1",
            title: "测试",
            canonicalSubject: "A",
            canonicalLocation: "B",
            eventType: "C",
            category: "城市管理",
            riskLevel: "LOW",
            riskReason: "",
            ticketCount: 2,
            timeSpanHours: 1,
            firstOccurrence: "",
            lastOccurrence: "",
            aiSummary: "",
            recommendedAction: "",
            status: "CONFIRMED",
            tickets: [],
            relatedSubjects: [],
            relatedLocations: [],
          },
        ],
        abortCtrl.signal
      );
    } catch (err) {
      summaryAborted = isAbortError(err);
    }
    assert(summaryAborted, "enrichThemeBatchWithLLM 预中止立即抛出 AbortError");

    let summaryNodeAborted = false;
    try {
      await summaryNode(
        { themes: [], rawTickets: [], status: "idle" } as unknown as TicketRadarState,
        { signal: abortCtrl.signal }
      );
    } catch (err) {
      summaryNodeAborted = isAbortError(err);
    }
    assert(summaryNodeAborted, "summaryNode 预中止立即抛出 AbortError");

    const modelSrc = fs.readFileSync(path.resolve(process.cwd(), "backend/model.ts"), "utf-8");
    const extractSrc = fs.readFileSync(
      path.resolve(process.cwd(), "backend/node/extract-node.ts"),
      "utf-8"
    );
    assert(
      !modelSrc.includes("modelSupportsToolCalling") &&
        !extractSrc.includes("modelSupportsToolCalling") &&
        !extractSrc.includes("正在探测模型是否支持工具调用"),
      "确认死代码 modelSupportsToolCalling 探测已从 backend/model.ts 与 extract-node.ts 完全移除"
    );
  }
}

function testP1_7_TownshipAndIncremental() {
  console.log("\n--- 5. P1 #7: canonicalizeTownship 最长匹配 & 增量聚类日期/HIGH刷新 ---");

  const customVocab: RegionVocabulary = {
    regionId: "test_overlap",
    regionName: "测试区",
    cityName: "测试市",
    provinceName: "广东省",
    townships: [
      {
        name: "天河",
        fullName: "天河街道",
        aliases: ["天河区中心"],
        communities: ["天河社区"],
        landmarks: ["天河城"],
      },
      {
        name: "天河南",
        fullName: "天河南街道",
        aliases: ["天河南商圈"],
        communities: ["天河南社区"],
        landmarks: ["天环广场"],
      },
      {
        name: "新塘",
        fullName: "新塘街道",
        aliases: [],
        communities: [],
        landmarks: [],
      },
      {
        name: "新塘北",
        fullName: "新塘北镇",
        aliases: [],
        communities: [],
        landmarks: [],
      },
      {
        name: "新城",
        fullName: "新城街道",
        aliases: [],
        communities: [],
        landmarks: [],
      },
      {
        name: "佛山新城",
        fullName: "佛山新城",
        aliases: [],
        communities: [],
        landmarks: [],
      },
    ],
    departments: [],
    categories: [],
  };

  assert(
    canonicalizeTownship("广东省测试市测试区天河南一路88号", customVocab) === "天河南街道",
    "canonicalizeTownship 剥离多级行政前缀并最长匹配天河南街道"
  );
  assert(
    canonicalizeTownship("新塘北镇工业区", customVocab) === "新塘北镇",
    "canonicalizeTownship 优先匹配新塘北镇而非靠前短前缀新塘"
  );
  assert(
    canonicalizeTownship("佛山新城东平路", customVocab) === "佛山新城",
    "canonicalizeTownship 优先匹配佛山新城而非短名新城"
  );

  // 空日期不造假 now() + 假闭环空闭环时间不误判 + 历史工单 timeSpanHours=1
  const emptyDateResolvedTheme: MultiFrequencyTheme = {
    id: "TH-EMPTY-DATE",
    title: "大良街道金榜上街 · 供水管网破裂",
    canonicalSubject: "金榜上街供水管",
    canonicalLocation: "大良街道金榜上街",
    eventType: "供水管网破裂",
    category: CATEGORY.URBAN_MANAGEMENT,
    riskLevel: "LOW",
    riskReason: "",
    ticketCount: 2,
    timeSpanHours: 1,
    firstOccurrence: "",
    lastOccurrence: "",
    aiSummary: "供水管网维修",
    recommendedAction: "抢修队排查",
    handlingStatus: HANDLING_STATUS.RESOLVED,
    status: "CONFIRMED",
    tickets: [],
    relatedSubjects: ["金榜上街供水管"],
    relatedLocations: ["大良街道金榜上街"],
  };

  const histTicket: EnrichedTicket = {
    id: "TK-HIST-1",
    ticketNo: "FS250101001",
    title: "金榜上街10号停水",
    content: "大良街道金榜上街10号自来水停水",
    createTime: "2025-01-01 08:00:00",
    citizenName: "王某",
    citizenPhone: "",
    subdistrict: "大良街道",
    channel: "热线",
    status: "PENDING",
    canonicalSubject: "金榜上街供水管",
    canonicalLocation: "大良街道金榜上街10号",
    eventType: "供水管网破裂",
    sourceCategory: CATEGORY.URBAN_MANAGEMENT,
    confidence: 95,
    entities: [],
    relations: [],
    themes: [CATEGORY.URBAN_MANAGEMENT],
  };

  const resEmpty = evaluateIncrementalTicket(histTicket, [emptyDateResolvedTheme]);
  assert(
    resEmpty.action === "ATTACHED" &&
      emptyDateResolvedTheme.firstOccurrence === "2025-01-01 08:00:00" &&
      emptyDateResolvedTheme.lastOccurrence === "2025-01-01 08:00:00" &&
      emptyDateResolvedTheme.timeSpanHours === 1 &&
      resEmpty.fakeClosureDetected === false,
    `空日期主题并入历史工单不伪造 now()，timeSpanHours=${emptyDateResolvedTheme.timeSpanHours}，空闭环参考时间不误触发假闭环`
  );

  // 已为 HIGH 的主题按有界条件刷新
  const highTheme: MultiFrequencyTheme = {
    id: "TH-HIGH-1",
    title: "大良街道金榜上街 · 供水管网破裂",
    canonicalSubject: "金榜上街供水管",
    canonicalLocation: "大良街道金榜上街",
    eventType: "供水管网破裂",
    category: CATEGORY.URBAN_MANAGEMENT,
    riskLevel: "HIGH",
    riskReason: "工单数量达到 5 件，突破高风险群体事件阈值！",
    ticketCount: 5,
    timeSpanHours: 4,
    firstOccurrence: "2026-09-26 08:00:00",
    lastOccurrence: "2026-09-26 12:00:00",
    aiSummary: "旧摘要",
    recommendedAction: "旧处置建议",
    handlingStatus: HANDLING_STATUS.IN_PROGRESS,
    status: "CONFIRMED",
    tickets: [],
    relatedSubjects: ["金榜上街供水管"],
    relatedLocations: ["大良街道金榜上街"],
  };

  const makeNormalTicket = (seq: number, hazardText = ""): EnrichedTicket => ({
    ...histTicket,
    id: `TK-HIGH-${seq}`,
    ticketNo: `FS26092600${seq}`,
    title: hazardText ? `金榜上街自来水爆管${hazardText}` : `金榜上街${seq}号停水`,
    content: hazardText
      ? `大良街道金榜上街自来水管爆管引发${hazardText}，影响居民出行`
      : `大良街道金榜上街${seq}号仍然停水`,
    createTime: `2026-09-26 1${Math.min(9, seq)}:00:00`,
  });

  const r6 = evaluateIncrementalTicket(makeNormalTicket(6), [highTheme]);
  assert(
    !r6.needDeepThinkingUpgrade,
    `HIGH 主题第 6 件普通工单不重复触发慢思考刷新`
  );

  const r7 = evaluateIncrementalTicket(makeNormalTicket(7, "路面塌陷事故"), [highTheme]);
  assert(
    r7.needDeepThinkingUpgrade === true && highTheme.riskReason.includes("突发严重险情"),
    `HIGH 主题新增突发严重险情时触发一次刷新并记录险情原因`
  );

  const r8 = evaluateIncrementalTicket(makeNormalTicket(8, "再次塌陷事故"), [highTheme]);
  assert(
    !r8.needDeepThinkingUpgrade,
    `HIGH 主题已标记突发严重险情后，第 8 件同类险情不重复轰炸慢思考`
  );

  const r9 = evaluateIncrementalTicket(makeNormalTicket(9), [highTheme]);
  assert(!r9.needDeepThinkingUpgrade, `HIGH 主题第 9 件普通工单不触发刷新`);

  const r10 = evaluateIncrementalTicket(makeNormalTicket(10), [highTheme]);
  assert(
    r10.needDeepThinkingUpgrade === true,
    `HIGH 主题到达激增里程碑 (10 件) 触发阶段性刷新`
  );
}

async function testP1_7_DbAndGovernanceFlows() {
  console.log("\n--- 6. P1 #7 (临时 Schema): 槽位保护/标题刷新/泛型主体/主题时间窗持久化 ---");
  const REGION_ID = "verify_m9_gov";
  const prevSys2 = process.env.SYSTEM_TWO_ENDPOINTS;
  const prevEmbed = process.env.EMBEDDING_ENDPOINTS;

  let turnMode: "noisy_llm" | "generic_subj_llm" | "voice_missing" = "noisy_llm";
  const mockSys2 = await startMockLlmServer({
    name: "mock-m9-sys2",
    healthy: true,
    onChat: (body) => {
      const sysPrompt = String(body?.messages?.[0]?.content || "");
      if (sysPrompt.includes("提取补充要素")) {
        return {
          content: JSON.stringify({
            address: "环市东路66号",
            canonicalSubject: "市民",
            subdistrict: "大良街道",
            reply: "收到，已补充路名信息。",
          }),
        };
      }
      if (sysPrompt.includes("受理专员")) {
        if (turnMode === "generic_subj_llm") {
          return {
            content: JSON.stringify({
              reply: "已记录，请再告知具体商铺名称。",
              title: "",
              subdistrict: "大良街道",
              category: "生态环境",
              subject: "商家",
              address: "环市路12号",
            }),
          };
        }
        return {
          content: JSON.stringify({
            reply: "已为您更新环市路12号老王烧烤店信息。",
            title: "大良街道 · 老王烧烤店（生态环境）",
            subdistrict: "大良街道",
            category: "生态环境",
            subject: "老王烧烤店",
            address: "环市路12号",
          }),
        };
      }
      if (sysPrompt.includes("items") || body?.messages?.some((m: any) => String(m.content || "").includes("items"))) {
        return {
          content: JSON.stringify({
            items: [
              {
                index: 1,
                summarizeTitle: "金榜上街供水管网漏水",
                subject: "金榜上街供水管",
                location: "大良街道金榜上街88号",
                township: "大良街道",
                eventType: "供水管网破裂",
                category: "城市管理",
                confidence: 92,
              },
            ],
          }),
        };
      }
      return {
        content: JSON.stringify({
          results: [
            {
              themeIndex: 1,
              riskReason: "高风险主题刷新研判",
              aiSummary: "最新摘要：含最新第10件险情刷新",
              recommendedAction: "最新处置建议：应急抢修",
            },
          ],
        }),
      };
    },
  });

  const cleanup = async () => {
    try {
      await destroyRegionTenant(sql, REGION_ID);
    } catch {
      // ignore
    }
    await sql.unsafe(`DROP SCHEMA IF EXISTS "${REGION_ID}" CASCADE;`);
    await sql`DELETE FROM public.regions WHERE id = ${REGION_ID};`;
    invalidateAgentGovernanceCache(REGION_ID);
    invalidateCivicAggregates(REGION_ID);
  };

  try {
    await cleanup();
    process.env.SYSTEM_TWO_ENDPOINTS = mockSys2.url;
    process.env.EMBEDDING_ENDPOINTS = mockSys2.url;

    await registerRegion(sql, {
      id: REGION_ID,
      name: "M9临时校验区",
      city: "佛山市",
      province: "广东省",
      schemaName: REGION_ID,
    });
    const { db: tenantDb } = await getRegionDb(REGION_ID);
    await tenantDb.insert(vocabulariesTable).values({
      id: "tw-m9-dl",
      type: "TOWNSHIP",
      name: "大良",
      fullName: "大良街道",
      metaJson: JSON.stringify({ aliases: ["大良"], communities: ["金榜"], landmarks: ["金榜上街"] }),
    });

    // A. upgradeThemeWithSystemTwo 传入最新 2 条工单并覆盖旧建议
    const upgradeTarget: MultiFrequencyTheme = {
      id: "TH-UPG-1",
      title: "金榜上街停水",
      canonicalSubject: "金榜上街供水管",
      canonicalLocation: "大良街道金榜上街",
      eventType: "供水管网破裂",
      category: CATEGORY.URBAN_MANAGEMENT,
      riskLevel: "HIGH",
      riskReason: "险情升级",
      ticketCount: 3,
      timeSpanHours: 5,
      firstOccurrence: "2026-09-26 08:00:00",
      lastOccurrence: "2026-09-26 13:00:00",
      aiSummary: "旧摘要",
      recommendedAction: "旧建议",
      status: "CONFIRMED",
      tickets: [
        { id: "old1", ticketNo: "T1", title: "旧单1", summarizeTitle: "旧单1", subdistrict: "大良街道" } as any,
        { id: "old2", ticketNo: "T2", title: "旧单2", summarizeTitle: "旧单2", subdistrict: "大良街道" } as any,
        { id: "new3", ticketNo: "T3", title: "最新塌陷险情", summarizeTitle: "最新塌陷险情", subdistrict: "大良街道" } as any,
      ],
      relatedSubjects: [],
      relatedLocations: [],
    };
    const upgraded = await upgradeThemeWithSystemTwo(upgradeTarget);
    assert(
      upgraded.recommendedAction.includes("最新处置建议") && upgraded.aiSummary.includes("最新摘要"),
      `upgradeThemeWithSystemTwo 成功刷新 HIGH 主题摘要与建议`
    );

    // B. 多轮 processIntakeChat：Turn 1 生成自动标题 -> Turn 2 补充主体后刷新；泛型主体被拦截；confirmed 槽位不被覆盖
    turnMode = "generic_subj_llm";
    const t1 = await processIntakeChat({
      regionId: REGION_ID,
      messages: [{ role: "user", content: "家里楼下太吵了" }],
    });
    assert(
      t1.draft.title === "大良街道 · 环市路12号（生态环境）" && t1.draft.subject === "",
      `Turn 1 生成自动占位标题且拒绝泛型主体 '商家' (title=${t1.draft.title}, subj=${t1.draft.subject})`
    );

    turnMode = "noisy_llm";
    const t2 = await processIntakeChat({
      regionId: REGION_ID,
      draft: t1.draft,
      messages: [{ role: "user", content: "我在大良街道，店名是老王烧烤店" }],
    });
    assert(
      t2.draft.title === "大良街道 · 老王烧烤店（生态环境）" &&
        t2.draft.title !== t1.draft.title &&
        t2.draft.address === "环市路12号" &&
        t2.draft.subject === "老王烧烤店",
      `Turn 2 刷新 Turn 1 自动标题并采纳 LLM 抽取 (title=${t2.draft.title}, addr=${t2.draft.address}, subj=${t2.draft.subject})`
    );

    // 额外验证：首轮纯片段标题（无 LLM 槽位时）在次轮补充槽位后也会刷新
    const t1Frag = {
      title: "家里楼下太吵了",
      content: "家里楼下太吵了",
      subdistrict: "",
      category: "",
      subject: "",
      address: "",
      contactPhone: "",
    };
    const t2Frag = await processIntakeChat({
      regionId: REGION_ID,
      draft: t1Frag,
      messages: [{ role: "user", content: "在大良街道环市路12号老王烧烤店" }],
    });
    assert(
      t2Frag.draft.title === "大良街道 · 老王烧烤店（生态环境）" &&
        t2Frag.draft.title !== t1Frag.title,
      `首轮片段标题在次轮补充槽位后自动刷新 (title=${t2Frag.draft.title})`
    );

    // 用户自定义标题不被自动覆盖 + 已确认槽位不被覆盖
    const t3 = await processIntakeChat({
      regionId: REGION_ID,
      draft: { ...t2.draft, title: "用户手写标题", address: "金榜路99号" },
      messages: [{ role: "user", content: "补充说明一下情况" }],
    });
    assert(
      t3.draft.title === "用户手写标题" && t3.draft.address === "金榜路99号",
      `用户手写标题与已确认槽位在后续轮次受到保护 (title=${t3.draft.title}, addr=${t3.draft.address})`
    );

    // C. runAgentPatrol 识别扩展泛型主体 ('市民', '某店铺') 且不误伤 '涉事施工单位'
    await tenantDb.insert(ticketsTable).values([
      {
        id: "tk-m9-generic",
        ticketNo: "M9-GEN-01",
        title: "油烟扰民投诉",
        content: "夜间油烟很大",
        maskedContent: "夜间油烟很大",
        subdistrict: "大良街道",
        address: "环市路1号",
        canonicalSubject: "市民",
        confidence: 90,
        status: "PENDING",
        stabilityRisk: false,
        createTime: new Date(),
      },
      {
        id: "tk-m9-specific",
        ticketNo: "M9-SPEC-01",
        title: "施工围挡隐患",
        content: "工地围挡破损",
        maskedContent: "工地围挡破损",
        subdistrict: "大良街道",
        address: "环市路2号",
        canonicalSubject: "涉事施工单位",
        confidence: 90,
        status: "PENDING",
        stabilityRisk: false,
        createTime: new Date(),
      },
    ]);

    const patrol = await runAgentPatrol(REGION_ID);
    const genTask = patrol.tasks.find((t) => t.targetId === "tk-m9-generic");
    const specTask = patrol.tasks.find((t) => t.targetId === "tk-m9-specific");
    assert(
      Boolean(genTask) && genTask?.taskType === "MISSING_INFO" && !specTask,
      `runAgentPatrol 识别泛型主体 '市民' 入队 MISSING_INFO 且保留 '涉事施工单位'`
    );

    // D. processAgentVoiceTurn: 保护 DB 已确认 canonicalSubject='老王烧烤店' & 拦截泛型 '市民'
    await tenantDb.insert(ticketsTable).values({
      id: "tk-m9-voice",
      ticketNo: "M9-VOX-01",
      title: "油烟投诉",
      content: "油烟扰民",
      maskedContent: "油烟扰民",
      subdistrict: "",
      address: "",
      canonicalSubject: "老王烧烤店",
      confidence: 65,
      status: "PENDING",
      stabilityRisk: false,
      createTime: new Date(),
    });
    const patrol2 = await runAgentPatrol(REGION_ID);
    const voiceTask = patrol2.tasks.find((t) => t.targetId === "tk-m9-voice");
    assert(Boolean(voiceTask), "为缺失 address/subdistrict 的工单生成 MISSING_INFO 任务");

    if (voiceTask) {
      const vRes = await processAgentVoiceTurn({
        regionId: REGION_ID,
        taskId: voiceTask.id,
        transcript: "就在环市东路66号，是大良街道的，我是市民",
        operatorName: "admin",
      });
      const [afterVoiceTk] = await tenantDb
        .select()
        .from(ticketsTable)
        .where(eq(ticketsTable.id, "tk-m9-voice"))
        .limit(1);
      assert(
        vRes.ok &&
          vRes.completed &&
          !vRes.extractedPatch?.canonicalSubject &&
          afterVoiceTk?.canonicalSubject === "老王烧烤店" &&
          afterVoiceTk?.address === "环市东路66号" &&
          afterVoiceTk?.subdistrict === "大良街道",
        `processAgentVoiceTurn 补全缺失 address/subdistrict，同时保护已确认 canonicalSubject='老王烧烤店' 不被泛型 '市民' 覆写`
      );
    }

    // E. POST /api/tickets 单工单挂载主题时更新 firstAt / monotonic lastAt / timeSpanHours
    const existingFirst = new Date("2026-09-20T08:00:00+08:00");
    const existingLast = new Date("2026-09-25T10:00:00+08:00");
    await tenantDb.insert(themesTable).values({
      id: "TH-M9-POST",
      title: "大良街道金榜上街 · 供水管网破裂",
      canonicalSubject: "金榜上街供水管",
      canonicalLocation: "大良街道金榜上街",
      eventType: "供水管网破裂",
      category: CATEGORY.URBAN_MANAGEMENT,
      riskLevel: "LOW",
      riskReason: "测试初始主题",
      ticketCount: 2,
      timeSpanHours: 122,
      aiSummary: "供水破损",
      recommendedAction: "抢修队排查",
      patternType: "HOTSPOT",
      civicMode: "NORMAL_CLUSTER",
      aiConfidence: 90,
      firstAt: existingFirst,
      lastAt: existingLast,
      handlingStatus: "IN_PROGRESS",
      handlingProgress: 40,
    });

    const headers = await withAuthHeaders(
      {
        host: "localhost:3000",
        "x-region-id": REGION_ID,
        "content-type": "application/json",
      },
      "admin"
    );
    const postReq = new NextRequest(`http://localhost:3000/api/tickets?region=${REGION_ID}`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        regionId: REGION_ID,
        ticketNo: "FS2609220001",
        title: "金榜上街88号自来水爆管",
        content: "大良街道金榜上街88号自来水管破裂漏水",
        subdistrict: "大良街道",
        sourceCategory: CATEGORY.URBAN_MANAGEMENT,
        createTime: "2026-09-22 09:00:00",
      }),
    });
    const postRes = await ticketsPost(postReq);
    assert(postRes.status === 200 || postRes.status === 201, `POST /api/tickets 入库成功 (${postRes.status})`);

    // 等待后台异步吸附落库完成
    let updatedTheme: typeof themesTable.$inferSelect | undefined;
    for (let i = 0; i < 40; i++) {
      const [row] = await tenantDb
        .select()
        .from(themesTable)
        .where(eq(themesTable.id, "TH-M9-POST"))
        .limit(1);
      if (row && row.ticketCount >= 3) {
        updatedTheme = row;
        break;
      }
      await new Promise((r) => setTimeout(r, 100));
    }

    assert(
      Boolean(updatedTheme) &&
        updatedTheme!.ticketCount === 3 &&
        updatedTheme!.firstAt?.getTime() === existingFirst.getTime() &&
        updatedTheme!.lastAt?.getTime() === existingLast.getTime() &&
        Number(updatedTheme!.timeSpanHours) >= 122,
      `POST /api/tickets 并入较早历史单时保持 firstAt 与单调 lastAt 不倒退且刷新 timeSpanHours (count=${updatedTheme?.ticketCount}, span=${updatedTheme?.timeSpanHours})`
    );
  } finally {
    if (prevSys2 === undefined) {
      delete process.env.SYSTEM_TWO_ENDPOINTS;
    } else {
      process.env.SYSTEM_TWO_ENDPOINTS = prevSys2;
    }
    if (prevEmbed === undefined) {
      delete process.env.EMBEDDING_ENDPOINTS;
    } else {
      process.env.EMBEDDING_ENDPOINTS = prevEmbed;
    }
    await mockSys2.close();
    await cleanup();
  }
}

function testP1_5_ChallengerIter2Regressions() {
  console.log("\n--- 2b. P1 #5: Challenger Iter2 回访/电商对抗样例 ---");
  const notPositive = [
    "问题一直没有得到解决，根本没人来修", "问题一直没有得到解决", "至今未能解决", "一直没能修好",
    "问题没给解决", "钱一直没有给我退到账", "你们服务态度挺好的，但是噪音还是照样响",
    "客服态度挺好的，但是问题一直没办好", "感谢你们回访，但是到现在钱还没退给我",
    "谢谢回访，不过一直没人上门修", "你们服务态度挺好的，但是根本没帮我修好",
    "感谢回访，但钱到现在也没给退到账", "已解决，但是问题又出现了", "退款一直没能到账", "一直没人来处理",
  ];
  for (const t of notPositive) {
    const r = evaluateCallbackSentiment(t);
    assert(r !== "POSITIVE", `回访不得误判满意: "${t}" -> ${r}`);
  }
  for (const t of ["完全不漏水了", "现在不漏水了", "没有再漏水了", "并没有复发，已经彻底好了", "不是没修好，早就修好了，谢谢你们"]) {
    const r = evaluateCallbackSentiment(t);
    assert(r === "POSITIVE", `回访满意识别: "${t}" -> ${r}`);
  }
  const ecom: Array<[string, (r: ReturnType<typeof evaluateEcommerceTicket>) => boolean]> = [
    ["没有出现食物中毒、食物过敏、腹泻，只是包装压扁", (r) => !r.stabilityRisk],
    ["没有出现发霉、过期食品、异物，只是外盒压扁", (r) => !r.stabilityRisk],
    ["没有出现食物中毒和腹泻以及呕吐，只是包装破损", (r) => !r.stabilityRisk],
    ["并非假货、翻新机、水货，只是问下怎么开发票", (r) => !r.stabilityRisk],
    ["没有申请退款，只是问一下什么时候发货", (r) => r.category === "物流延误与丢件"],
    ["无任何退款诉求，仅咨询物流到哪了", (r) => r.category === "物流延误与丢件"],
    ["申请一周还没有收到退款，请问什么时候能退", (r) => r.intent !== "INQUIRY" && r.category === "退款与价保纠纷"],
    ["已经申请一周了还没有到账，建议平台管管", (r) => r.intent !== "SUGGESTION"],
    ["商家一直不退钱，建议平台管管", (r) => r.intent !== "SUGGESTION"],
    ["没有收到货，建议优化物流", (r) => r.intent !== "SUGGESTION"],
    ["一直没有得到解决，建议平台管管", (r) => r.intent !== "SUGGESTION"],
    ["昨天买的还没有揽收，请问什么时候能发", (r) => r.intent !== "INQUIRY" && r.category === "物流延误与丢件" && r.urgency === "MEDIUM"],
    ["无任何赔偿方案，商家不理", (r) => r.category === "退款与价保纠纷"],
  ];
  for (const [t, ok] of ecom) {
    const r = evaluateEcommerceTicket({ content: t });
    assert(ok(r), `电商分诊: "${t}" -> ${JSON.stringify({ i: r.intent, u: r.urgency, c: r.category, s: r.stabilityRisk })}`);
  }
  const hz = "存在发生重大交通事故的重大安全隐患";
  assert(!hasCivicRedlineSignal(hz) && !hasRedlineSignal(hz), `预防性多修饰隐患不误报: "${hz}"`);
}

async function main() {
  testP1_5_EcommerceTriage();
  testP1_5_CallbackSentiment();
  testP1_5_ChallengerIter2Regressions();
  await testM6_PreventiveModifierParity();
  await testP1_6_SwitchbackAndPool();
  testP1_7_TownshipAndIncremental();
  await testP1_7_DbAndGovernanceFlows();

  console.log(`\n=== M9 综合验收完成: ${passed} passed, ${failed} failed ===`);
  if (failed > 0) {
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("M9 测试运行异常:", err);
  process.exit(1);
});
