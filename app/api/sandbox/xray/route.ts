import { NextRequest, NextResponse } from "next/server";
import { desc, eq, ilike, inArray, or, sql } from "drizzle-orm";
import { anonymize, deanonymize } from "@civic/anonymizer";
import { SystemOneEngine } from "@civic/system-one";
import { createEmbedClient } from "@civic/embed";
import { getRegionDb } from "@/db/client";
import { themesTable, ticketThemesTable, ticketsTable } from "@/db/schema";
import { resolveRequestRegionId } from "@/lib/tenant/request-region";
import {
  canonicalizeCategory,
  canonicalizeTownship,
  getRegionVocabulary,
  matchTownshipName,
  type RegionVocabulary,
} from "@/lib/vocabulary";
import { getRegionAliasMap, normalizeAliasesInText } from "@/lib/alias-dict";
import { getSystemTwoEngine } from "@/backend/model";
import {
  buildBatchExtractionPrompt,
  buildDynamicBatchExtractionSchema,
} from "@/backend/prompt";
import { embedEndpointsFromEnv, extractionProductText } from "@/backend/embed-products";
import { PRODUCT_COSINE_MIN } from "@/backend/same-incident-cluster";
import { evaluateIncrementalTicket } from "@/backend/incremental-cluster";
import { RULES } from "@/backend/rules";
import { extractSpatialCore } from "@/backend/node/canonical-node";
import { searchTicketsByVector } from "@/lib/ticket-embeddings";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";
import { CATEGORY } from "@/lib/vocabulary";
import { triggerClusterJobAuto } from "@/lib/cluster-runner";
import { invalidateCivicAggregates } from "@/lib/civic-cache";
import { broadcastDataRefresh } from "@/lib/sse-broadcaster";
import type { EnrichedTicket, MultiFrequencyTheme, RawTicket, RiskLevel } from "@/backend/state";

export const dynamic = "force-dynamic";

declare global {
  // eslint-disable-next-line no-var
  var __sandboxSystemOnePromise: Promise<SystemOneEngine> | undefined;
}

function getSandboxSystemOne(): Promise<SystemOneEngine> {
  if (!globalThis.__sandboxSystemOnePromise) {
    globalThis.__sandboxSystemOnePromise = SystemOneEngine.create().catch((err) => {
      globalThis.__sandboxSystemOnePromise = undefined;
      throw err;
    });
  }
  return globalThis.__sandboxSystemOnePromise;
}

function normalizeInputRegionId(raw?: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed === "shunde") return "fs_shunde";
  if (trimmed === "haizhu") return "gz_haizhu";
  return trimmed;
}

function inferEntityTypeFromToken(token: string): string {
  const m = token.match(/^\{\{([A-Z_]+)_\d+\}\}$/);
  return m?.[1] || "PII";
}

function withTimeout<T>(work: Promise<T>, ms: number, msg: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(msg)), ms);
    work.then(
      (v) => {
        clearTimeout(timer);
        resolve(v);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      }
    );
  });
}

function departmentForCategory(category: string, vocab: RegionVocabulary): string {
  const cat = (category || "").trim();
  const findDept = (kw: RegExp) =>
    vocab.departments.find((d) => kw.test(d.name) || kw.test(d.fullName))?.fullName;

  if (/交通|出行|违停|道路/.test(cat)) return findDept(/交警|交通/) || "区公安分局交警大队 / 区交通运输局";
  if (/市场|消费|价格|餐饮|食品/.test(cat)) return findDept(/市监|市场/) || "区市场监督管理局";
  if (/环境|生态|噪音|油烟|污水/.test(cat)) return findDept(/生态|环保/) || "区生态环境分局";
  if (/劳动|社保|欠薪|医保/.test(cat)) return findDept(/人社|劳动/) || "区人力资源和社会保障局";
  if (/安全|消防|燃气|治安/.test(cat)) return findDept(/应急|消防|公安/) || "区应急管理局 / 区消防救援大队";
  if (/社会|物业|社区|邻里|治理/.test(cat)) return findDept(/政法|住建|民政/) || "属地镇街综治中心";
  return findDept(/城管|综合执法/) || "区城市管理和综合执法局";
}

function slaHintFromHours(slaHours: number): string {
  if (slaHours <= 0) return "即诉即答（无需派单立案）";
  if (slaHours <= 2) return `${slaHours}小时内紧急响应处置`;
  if (slaHours <= 24) return `${slaHours}小时内快速核查处置`;
  if (slaHours <= 120) return `${Math.round(slaHours / 24)}个工作日内办结回复`;
  return `${Math.round(slaHours / 24)}个工作日内依法办结`;
}

function fallbackRuleExtract(params: {
  title: string;
  maskedContent: string;
  matchedTownship: string | null;
  category: string;
}) {
  const { title, maskedContent, matchedTownship, category } = params;
  const combined = `${title} ${maskedContent}`.trim();

  const plateTokenMatch = combined.match(/\{\{LICENSE_PLATE_\d+\}\}/);
  const shopMatch = combined.match(/([\u4e00-\u9fa5A-Za-z0-9]{2,12}(?:餐厅|烧烤|大排档|美食城|超市|酒店|公司|物业|工地|幼儿园|学校|工厂|车行))/);
  const subject = plateTokenMatch
    ? `${plateTokenMatch[0]}车辆`
    : shopMatch?.[1] || "涉事相关方";

  const spatial = extractSpatialCore(maskedContent);
  const roadMatch = maskedContent.match(/([\u4e00-\u9fa5]{2,12}(?:大道|路|街|巷|桥|广场|小区|花园|大厦|工业区|商业街)[^\s，。；,.;]{0,12})/);
  const location =
    (spatial && spatial.length >= 3 ? spatial : "") ||
    roadMatch?.[1] ||
    matchedTownship ||
    "辖区";

  const eventHints: Array<[RegExp, string]> = [
    [/违停|乱停|占道|堵路/, "机动车违停占道影响通行"],
    [/油烟|排烟|烧烤|异味/, "餐饮油烟异味扰民"],
    [/噪音|喧哗|施工|音响/, "噪音扰民诉求"],
    [/停水|漏水|爆管|积水/, "供水异常与管网漏水"],
    [/停电|路灯|故障/, "供电或市政照明故障"],
    [/欠薪|工资|社保/, "劳资纠纷维权"],
    [/假闭环|回潮|反弹|再次|复发|未解决/, "办结后诉求复发核查"],
  ];
  const matchedEvent = eventHints.find(([re]) => re.test(combined));
  const eventType = matchedEvent?.[1] || (title ? title.slice(0, 24) : `${category}诉求处置`);
  const summarizeTitle =
    title ||
    `关于${matchedTownship || ""}${location !== matchedTownship ? location : ""}${eventType}`.slice(0, 32);

  return {
    subject,
    location,
    eventType,
    category: category || "综合民生",
    summarizeTitle,
    confidence: plateTokenMatch || shopMatch ? 78 : 68,
    reasoning: `System-2 在线推理端点不可用，已启用安全规则降级提取（脱敏输入长度 ${maskedContent.length} 字，命中属地=${matchedTownship || "未指定"}，空间核心="${location}"，事件模式="${eventType}"）。`,
  };
}

function asRisk(v?: string | null): RiskLevel {
  if (v === "HIGH" || v === "高危") return "HIGH";
  if (v === "MEDIUM" || v === "中") return "MEDIUM";
  return "LOW";
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => null)) as {
      title?: string;
      content?: string;
      subdistrict?: string;
      regionId?: string;
      persist?: boolean;
    } | null;

    const rawContent = typeof body?.content === "string" ? body.content.trim() : "";
    if (!rawContent) {
      return NextResponse.json({ success: false, error: "content is required" }, { status: 400 });
    }

    const rawTitle = typeof body?.title === "string" ? body.title.trim() : "";
    const rawSubdistrict = typeof body?.subdistrict === "string" ? body.subdistrict.trim() : "";
    const persist = body?.persist === true;
    const regionId =
      normalizeInputRegionId(body?.regionId) || (await resolveRequestRegionId(req));

    // =========================================================================
    // Stage 1: 可逆脱敏 (Reversible PII Anonymization)
    // =========================================================================
    const t1Start = process.hrtime.bigint();
    const contentAnon = anonymize(rawContent);
    const titleAnon = rawTitle
      ? anonymize(rawTitle, { seedKeymap: contentAnon.keymap })
      : null;
    const keymap: Record<string, string> = {
      ...contentAnon.keymap,
      ...(titleAnon?.keymap || {}),
    };
    const allSpans = [...contentAnon.spans, ...(titleAnon?.spans || [])];
    const entities = Object.entries(keymap).map(([token, original]) => {
      const span = allSpans.find((s) => s.value === original);
      return {
        type: span?.category || inferEntityTypeFromToken(token),
        original,
        token,
      };
    });
    const t1End = process.hrtime.bigint();
    const step1DurationUs = Math.max(1, Math.round(Number(t1End - t1Start) / 1000));

    const step1_anonymize = {
      maskedText: contentAnon.text,
      entities,
      durationUs: step1DurationUs,
    };

    // 加载词汇表与别名映射（只读）
    const regionVocab = await getRegionVocabulary(regionId);
    const aliasMap = await getRegionAliasMap(regionId);

    // =========================================================================
    // Stage 2: System-1 快思考神经引擎
    // =========================================================================
    const t2Start = performance.now();
    const systemOne = await getSandboxSystemOne();
    const s1Decision = await systemOne.evaluate(
      {
        title: titleAnon?.text || rawTitle,
        content: contentAnon.text,
        subdistrict: rawSubdistrict,
      },
      { townships: regionVocab.townships }
    );
    const s1DurationMs = Math.max(0.1, Number((performance.now() - t2Start).toFixed(2)));
    const s1Urgency =
      s1Decision.stabilityRisk || s1Decision.urgencyLevel === 3
        ? "URGENT"
        : s1Decision.urgencyLevel === 2
          ? "MEDIUM"
          : "NORMAL";
    const s1Category =
      canonicalizeCategory(s1Decision.categoryName) ||
      s1Decision.categoryName ||
      CATEGORY.URBAN_MANAGEMENT;

    const step2_systemOne = {
      intent: s1Decision.intent,
      urgency: s1Urgency,
      slaHours: s1Decision.slaHours,
      stabilityRisk: s1Decision.stabilityRisk,
      category: s1Category,
      adapter: s1Decision.adapterUsed,
      durationMs: s1DurationMs,
    };

    // =========================================================================
    // Stage 3: 法定白名单与别名归一
    // =========================================================================
    const t3Start = performance.now();
    const rawCombinedForVocab = [rawTitle, rawContent, rawSubdistrict].filter(Boolean).join(" ");
    const sortedAliases = Array.from(aliasMap.keys()).sort((a, b) => b.length - a.length);
    const aliasHits: Array<{ alias: string; canonical: string }> = [];
    const seenAliases = new Set<string>();
    for (const alias of sortedAliases) {
      if (alias.length < 2) continue;
      const canonical = aliasMap.get(alias);
      if (!canonical || canonical === alias) continue;
      if (rawCombinedForVocab.includes(alias) && !seenAliases.has(alias)) {
        seenAliases.add(alias);
        aliasHits.push({ alias, canonical });
      }
    }

    const aliasedContent = normalizeAliasesInText(contentAnon.text, aliasMap);
    const aliasedTitle = normalizeAliasesInText(titleAnon?.text || rawTitle, aliasMap);
    const aliasedSubdistrict = normalizeAliasesInText(rawSubdistrict, aliasMap);
    const matchedTownship =
      canonicalizeTownship(aliasedSubdistrict, regionVocab) ||
      canonicalizeTownship(rawSubdistrict, regionVocab) ||
      matchTownshipName(
        [rawTitle, normalizeAliasesInText(rawContent, aliasMap), rawSubdistrict]
          .filter(Boolean)
          .join(" "),
        regionVocab.townships
      ) ||
      null;

    const s3DurationMs = Math.max(0.1, Number((performance.now() - t3Start).toFixed(2)));
    const step3_vocab = {
      matchedTownship,
      aliasHits,
      durationMs: s3DurationMs,
    };

    // =========================================================================
    // Stage 4: System-2 慢思考结构化抽取（含不可达优雅降级）
    // =========================================================================
    const t4Start = performance.now();
    const syntheticTicket: RawTicket = {
      id: `xray-${Date.now()}`,
      ticketNo: `XRAY-${Date.now()}`,
      title: aliasedTitle || rawTitle || "市民诉求",
      content: aliasedContent,
      maskedContent: aliasedContent,
      citizenName: "市民*",
      citizenPhone: "",
      subdistrict: matchedTownship || rawSubdistrict || undefined,
      sourceCategory: s1Category,
      urgency: s1Urgency,
      channel: "X-Ray 演练沙箱",
      status: "PENDING",
      createTime: new Date().toISOString(),
    };

    let s2Subject = "";
    let s2Location = "";
    let s2EventType = "";
    let s2Category = s1Category;
    let s2SummarizeTitle = "";
    let s2Confidence = 70;
    let s2Reasoning = "";
    let s2Endpoint: string | null = null;
    let s2Backend: string = "fallback";

    try {
      const systemTwo = await withTimeout(
        getSystemTwoEngine(),
        3500,
        "System-2 引擎探活超时"
      );
      const activeName = systemTwo.getActiveBackend().toLowerCase();
      if (!activeName.includes("fallback")) {
        const prompt = buildBatchExtractionPrompt([syntheticTicket], regionVocab);
        const townshipNames = regionVocab.townships.map((t) => t.fullName).filter(Boolean);
        const schema = buildDynamicBatchExtractionSchema(townshipNames);
        const res = await withTimeout(
          systemTwo.createJSON(schema, {
            messages: [{ role: "user", content: prompt }],
            enableThinking: false,
            maxTokens: 1024,
            temperature: 0.1,
          }),
          12_000,
          "System-2 单工单抽取超时"
        );
        const item = res.data?.items?.[0];
        if (item && (item.summarizeTitle || item.eventType)) {
          s2Subject = String(item.subject || "").trim();
          s2Location = String(item.location || "").trim();
          s2EventType = String(item.eventType || "").trim();
          s2Category = String(item.category || s1Category).trim();
          s2SummarizeTitle = String(item.summarizeTitle || "").trim();
          s2Confidence = Number(item.confidence ?? 85);
          s2Reasoning = (res.reasoning || "").trim() || "System-2 结构化语义抽取完成（JSON 直出模式）";
          s2Endpoint = res.endpoint ?? null;
          s2Backend = activeName.includes("cloud") ? "cloud" : "local";
        }
      }
    } catch {
      // 优雅降级至规则兜底
    }

    if (!s2SummarizeTitle && !s2EventType) {
      const fb = fallbackRuleExtract({
        title: aliasedTitle || rawTitle,
        maskedContent: aliasedContent,
        matchedTownship,
        category: s1Category,
      });
      s2Subject = fb.subject;
      s2Location = fb.location;
      s2EventType = fb.eventType;
      s2Category = fb.category;
      s2SummarizeTitle = fb.summarizeTitle;
      s2Confidence = fb.confidence;
      s2Reasoning = fb.reasoning;
      s2Endpoint = null;
      s2Backend = "fallback";
    }

    const s4DurationMs = Math.max(0.1, Number((performance.now() - t4Start).toFixed(2)));
    const step4_systemTwo = {
      subject: s2Subject,
      location: s2Location,
      eventType: s2EventType,
      category: s2Category,
      summarizeTitle: s2SummarizeTitle,
      confidence: s2Confidence,
      reasoning: s2Reasoning,
      endpoint: s2Endpoint,
      backend: s2Backend,
      durationMs: s4DurationMs,
    };

    // =========================================================================
    // Stage 5: 语义吸附与假闭环探测（严格只读，绝不修改库）
    // =========================================================================
    const t5Start = performance.now();
    const restoredSubject = deanonymize(s2Subject, keymap) || s2Subject;
    const restoredLocation =
      deanonymize(s2Location, keymap) || s2Location || matchedTownship || "辖区";

    const { db: tenantDb } = await getRegionDb(regionId);
    const threshold = PRODUCT_COSINE_MIN;

    type SimilarTicketItem = {
      ticketNo: string;
      title: string;
      similarity: number;
      status: string;
      closedAt: string | null;
      primaryThemeId?: string | null;
    };
    const similarTickets: SimilarTicketItem[] = [];

    const enrichedForMatch: EnrichedTicket = {
      ...syntheticTicket,
      summarizeTitle: deanonymize(s2SummarizeTitle, keymap) || s2SummarizeTitle,
      canonicalSubject: restoredSubject,
      canonicalLocation: restoredLocation,
      eventType: s2EventType,
      sourceCategory: s2Category,
      subdistrict: matchedTownship || rawSubdistrict || undefined,
      confidence: s2Confidence,
      entities: [],
      relations: [],
      themes: [s2Category],
    };

    // 5.1 优先尝试向量检索（仅只读查询）
    const embedApiKey = process.env.EMBEDDING_API_KEY || process.env.OPENAI_API_KEY || "";
    const embedEndpoints = embedEndpointsFromEnv();
    let queryVector: number[] | undefined;
    if (embedApiKey || embedEndpoints.length > 0) {
      try {
        const client = createEmbedClient({
          endpoints: embedEndpoints,
          profile: "online",
          apiKey: embedApiKey,
        });
        const text = extractionProductText(enrichedForMatch);
        const [vec] = await withTimeout(
          client.embed([text]),
          3500,
          "嵌入服务超时"
        );
        if (vec && vec.length === 1024) {
          queryVector = vec;
          const hits = await searchTicketsByVector(regionId, vec, 5);
          if (hits.length > 0) {
            const ticketNos = hits.map((h) => h.ticketNo).filter(Boolean);
            const detailRows = ticketNos.length
              ? await tenantDb
                  .select({
                    ticketNo: ticketsTable.ticketNo,
                    status: ticketsTable.status,
                    closedAt: ticketsTable.closedAt,
                    primaryThemeId: ticketsTable.primaryThemeId,
                  })
                  .from(ticketsTable)
                  .where(inArray(ticketsTable.ticketNo, ticketNos))
              : [];
            const detailByNo = new Map(detailRows.map((d) => [d.ticketNo, d]));
            for (const hit of hits) {
              const det = detailByNo.get(hit.ticketNo);
              similarTickets.push({
                ticketNo: hit.ticketNo,
                title: hit.title || hit.subject || "历史工单",
                similarity: hit.similarity,
                status: det?.status || "PENDING",
                closedAt: det?.closedAt ? det.closedAt.toISOString() : null,
                primaryThemeId: det?.primaryThemeId || hit.themeId || null,
              });
            }
          }
        }
      } catch {
        // 嵌入不可用时平滑降级到同区 SQL 匹配
      }
    }

    // 5.2 SQL 降级相似工单检索（按主体、事件、地点、镇街）
    if (similarTickets.length === 0) {
      const searchConds = [];
      if (restoredSubject && restoredSubject !== "涉事方" && restoredSubject.length >= 2) {
        searchConds.push(ilike(ticketsTable.canonicalSubject, `%${restoredSubject.slice(0, 16)}%`));
      }
      if (restoredLocation && restoredLocation !== "辖区" && restoredLocation.length >= 2) {
        searchConds.push(ilike(ticketsTable.address, `%${restoredLocation.slice(0, 16)}%`));
      }
      if (s2EventType && s2EventType.length >= 2) {
        searchConds.push(ilike(ticketsTable.eventType, `%${s2EventType.slice(0, 12)}%`));
      }
      if (searchConds.length === 0 && matchedTownship) {
        searchConds.push(eq(ticketsTable.subdistrict, matchedTownship));
      }

      const sqlCandidates = searchConds.length
        ? await tenantDb
            .select({
              ticketNo: ticketsTable.ticketNo,
              title: ticketsTable.title,
              summarizeTitle: ticketsTable.summarizeTitle,
              canonicalSubject: ticketsTable.canonicalSubject,
              address: ticketsTable.address,
              eventType: ticketsTable.eventType,
              status: ticketsTable.status,
              closedAt: ticketsTable.closedAt,
              primaryThemeId: ticketsTable.primaryThemeId,
              subdistrict: ticketsTable.subdistrict,
            })
            .from(ticketsTable)
            .where(or(...searchConds))
            .orderBy(desc(ticketsTable.createTime))
            .limit(5)
        : [];

      for (const row of sqlCandidates) {
        let score = 0.65;
        if (restoredSubject && row.canonicalSubject && row.canonicalSubject.includes(restoredSubject)) {
          score += 0.2;
        }
        if (matchedTownship && row.subdistrict === matchedTownship) {
          score += 0.08;
        }
        if (s2EventType && row.eventType && row.eventType.includes(s2EventType.slice(0, 4))) {
          score += 0.05;
        }
        similarTickets.push({
          ticketNo: row.ticketNo,
          title: row.summarizeTitle || row.title || "历史工单",
          similarity: Number(Math.min(0.98, score).toFixed(3)),
          status: row.status || "PENDING",
          closedAt: row.closedAt ? row.closedAt.toISOString() : null,
          primaryThemeId: row.primaryThemeId || null,
        });
      }
    }

    // 5.3 只读匹配所属主题并探测假闭环风险
    const hintThemeIds = Array.from(
      new Set(similarTickets.map((t) => t.primaryThemeId).filter((v): v is string => Boolean(v)))
    );
    const themeFilterConds = [];
    if (hintThemeIds.length > 0) themeFilterConds.push(inArray(themesTable.id, hintThemeIds));
    if (restoredSubject && restoredSubject !== "涉事方" && restoredSubject.length >= 2) {
      themeFilterConds.push(ilike(themesTable.canonicalSubject, `%${restoredSubject.slice(0, 16)}%`));
    }
    if (matchedTownship) {
      themeFilterConds.push(ilike(themesTable.canonicalLocation, `%${matchedTownship.replace(/(街道|镇)$/, "")}%`));
    }

    const candidateThemeRows = await (themeFilterConds.length
      ? tenantDb.select().from(themesTable).where(or(...themeFilterConds)).orderBy(desc(themesTable.lastAt)).limit(60)
      : tenantDb.select().from(themesTable).orderBy(desc(themesTable.lastAt)).limit(40));

    const candIds = candidateThemeRows.map((t) => t.id);
    const closedRows = candIds.length
      ? await tenantDb
          .select({
            themeId: ticketThemesTable.themeId,
            maxClosedAt: sql<Date | null>`max(${ticketsTable.closedAt})`,
          })
          .from(ticketThemesTable)
          .innerJoin(ticketsTable, eq(ticketsTable.id, ticketThemesTable.ticketId))
          .where(inArray(ticketThemesTable.themeId, candIds))
          .groupBy(ticketThemesTable.themeId)
      : [];
    const closedAtMap = new Map<string, string>();
    for (const r of closedRows) {
      if (r.maxClosedAt) {
        const d = r.maxClosedAt instanceof Date ? r.maxClosedAt : new Date(r.maxClosedAt);
        if (!Number.isNaN(d.getTime())) closedAtMap.set(r.themeId, d.toISOString());
      }
    }

    const candidateThemes: MultiFrequencyTheme[] = candidateThemeRows.map((row) => ({
      id: row.id,
      title: row.title,
      canonicalSubject: row.canonicalSubject,
      canonicalLocation: row.canonicalLocation,
      eventType: row.eventType,
      category: row.category || "",
      riskLevel: asRisk(row.riskLevel),
      riskReason: row.riskReason || "",
      ticketCount: row.ticketCount,
      timeSpanHours: row.timeSpanHours || 1,
      firstOccurrence: row.firstAt ? row.firstAt.toISOString() : "",
      lastOccurrence: row.lastAt ? row.lastAt.toISOString() : "",
      aiSummary: row.aiSummary || "",
      recommendedAction: row.recommendedAction || "",
      handlingStatus: row.handlingStatus || HANDLING_STATUS.PENDING,
      handlingProgress: row.handlingProgress ?? 0,
      handlingOwner: row.handlingOwner || undefined,
      handlingEta: row.handlingEta ? row.handlingEta.toISOString() : undefined,
      closedAt: closedAtMap.get(row.id),
      status: "CONFIRMED",
      tickets: [],
      relatedSubjects: [row.canonicalSubject],
      relatedLocations: [row.canonicalLocation],
    }));

    const clusterEval = evaluateIncrementalTicket(
      { ...enrichedForMatch },
      candidateThemes.map((t) => ({ ...t, tickets: [] })),
      {
        townships: regionVocab.townships,
        vocab: regionVocab,
        ticketVector: queryVector,
      }
    );

    let matchedTheme: {
      id: string;
      title: string;
      handlingStatus: string;
      riskLevel: string;
    } | null = null;
    let willTriggerFakeClosure = false;

    if (clusterEval.action === "ATTACHED" && clusterEval.matchedThemeId) {
      const origRow = candidateThemeRows.find((r) => r.id === clusterEval.matchedThemeId);
      if (origRow) {
        matchedTheme = {
          id: origRow.id,
          title: origRow.title,
          handlingStatus: normalizeStatusCode(origRow.handlingStatus),
          riskLevel: origRow.riskLevel || "LOW",
        };
        willTriggerFakeClosure = Boolean(clusterEval.fakeClosureDetected);
      }
    } else if (similarTickets.length > 0 && similarTickets[0].similarity >= threshold && similarTickets[0].primaryThemeId) {
      const origRow = candidateThemeRows.find((r) => r.id === similarTickets[0].primaryThemeId);
      if (origRow) {
        const handlingStatus = normalizeStatusCode(origRow.handlingStatus);
        matchedTheme = {
          id: origRow.id,
          title: origRow.title,
          handlingStatus,
          riskLevel: origRow.riskLevel || "LOW",
        };
        if (handlingStatus === HANDLING_STATUS.RESOLVED) {
          const closeStr = closedAtMap.get(origRow.id) || origRow.handlingEta?.toISOString() || origRow.lastAt?.toISOString();
          if (closeStr) {
            const diffDays = (Date.now() - new Date(closeStr).getTime()) / (24 * 60 * 60 * 1000);
            willTriggerFakeClosure = diffDays >= -1 && diffDays <= RULES.fakeClosure.windowDays;
          } else {
            willTriggerFakeClosure = true;
          }
        }
      }
    }

    const s5DurationMs = Math.max(0.1, Number((performance.now() - t5Start).toFixed(2)));
    const step5_clusterMatch = {
      similarTickets: similarTickets.map(({ primaryThemeId: _omit, ...rest }) => rest),
      matchedTheme,
      willTriggerFakeClosure,
      threshold,
      durationMs: s5DurationMs,
    };

    // =========================================================================
    // Stage 6: 反向脱敏还原与公文处置建议（仅 persist === true 时才写库）
    // =========================================================================
    const leadDepartment =
      (matchedTheme &&
        candidateThemeRows.find((r) => r.id === matchedTheme?.id)?.handlingOwner?.trim()) ||
      departmentForCategory(s2Category, regionVocab);
    const slaHint = slaHintFromHours(s1Decision.slaHours);
    const fakeClosureAlert = willTriggerFakeClosure
      ? `⚠️ 假闭环复发预警：该诉求高度吻合已办结主题 [${matchedTheme?.id}]，若正式受理将自动触发重开督办并提级 HIGH 风险。`
      : "";
    const recommendedAction = [
      `牵头部门：${leadDepartment}`,
      `响应时限：${slaHint}`,
      `办理路径：1. 针对「${restoredSubject || "相关涉事方"}」（位置：${restoredLocation}）反映的「${s2EventType}」开展现场核查；2. 核实情况后按${s2Category}权责清单落实整改并向市民反馈结果。`,
      fakeClosureAlert,
    ]
      .filter(Boolean)
      .join("\n");

    let persistedTicketNo: string | undefined;
    if (persist) {
      const newId = `tk-xray-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const newNo = `XR-${Date.now()}`;
      await tenantDb.insert(ticketsTable).values({
        id: newId,
        ticketNo: newNo,
        title: rawTitle || s2SummarizeTitle || "市民诉求",
        summarizeTitle: deanonymize(s2SummarizeTitle, keymap) || s2SummarizeTitle,
        content: rawContent,
        maskedContent: contentAnon.text,
        subdistrict: matchedTownship || rawSubdistrict || null,
        sourceCategory: s2Category,
        urgency: s1Urgency,
        slaHours: s1Decision.slaHours,
        stabilityRisk: s1Decision.stabilityRisk,
        canonicalSubject: restoredSubject,
        eventType: s2EventType,
        address: restoredLocation,
        confidence: s2Confidence,
        status: "PENDING",
        createTime: new Date(),
      });
      persistedTicketNo = newNo;
      invalidateCivicAggregates(regionId);
      broadcastDataRefresh(regionId);
      triggerClusterJobAuto(regionId).catch(() => {});
    }

    const step6_restoreAndAdvice = {
      restoredSubject,
      restoredLocation,
      recommendedAction,
      leadDepartment,
      slaHint,
      ...(persistedTicketNo ? { persistedTicketNo } : {}),
    };

    return NextResponse.json({
      success: true,
      regionId,
      persist,
      step1_anonymize,
      step2_systemOne,
      step3_vocab,
      step4_systemTwo,
      step5_clusterMatch,
      step6_restoreAndAdvice,
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : "X-Ray simulation failed";
    console.error("[sandbox/xray] error:", err);
    return NextResponse.json({ success: false, error: msg }, { status: 500 });
  }
}
