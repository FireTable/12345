import type { TicketRadarState, EnrichedTicket, RawTicket } from "../state";
import {
  isLocalSystemTwo,
  modelSupportsToolCalling,
  getSystemTwoEngine,
  systemTwoConcurrency,
  getSystemTwoEndpoints,
} from "../model";
import { workOrderClockFromTicketNo, workOrderInstantFromTicketNo } from "@/lib/work-order-date";
import {
  BatchExtractionSchema,
  buildBatchExtractionPrompt,
  buildDynamicBatchExtractionSchema,
  type ExtractedTicketItem,
} from "../prompt";
import { adminFromLocation, explicitAdmin } from "@/lib/admin-area";
import { getRegionAliasMap, normalizeAliasesInText, resolveEntityAlias } from "@/lib/alias-dict";
import { canonicalizeCategory, canonicalizeTownship, getRegionVocabulary, legalTownshipName, matchTownshipName, type RegionVocabulary } from "@/lib/vocabulary";
import { verifyAndCanonicalizeTicketArea } from "./arbitrator-node";
import {
  enrichEnterpriseLocation,
  isPlaceholderLocation,
  isEnterpriseEntity,
} from "@/lib/map/enterprise-address-enricher";
import { updateTaskProgress } from "@/lib/task-progress";
import { stagePercent } from "@/lib/pipeline-progress";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { anonymize, deanonymize } from "@civic/anonymizer";
import { SystemOneEngine } from "@civic/system-one";
import { LLM_TOKENS } from "@/lib/tokens";

export const LOW_CONFIDENCE_THRESHOLD = 60;

function clipField(value: string | null | undefined, max: number): string | null {
  const text = (value ?? "").trim();
  if (!text) return null;
  return text.length <= max ? text : text.slice(0, max);
}

/** 抽到一条就写下主体、地点、事件和摘要，中断后可以接着跑。空字段不覆盖已有值。 */
function rememberExtraction(
  tenantDb: Awaited<ReturnType<typeof getRegionDb>>["db"],
  ticketId: string,
  patch: {
    createTime?: Date | null;
    sourceCategory?: string | null;
    urgency?: string | null;
    slaHours?: number | null;
    stabilityRisk?: boolean | null;
    summarizeTitle?: string | null;
    confidence?: number | null;
    canonicalSubject?: string | null;
    eventType?: string | null;
    address?: string | null;
    subdistrict?: string | null;
  }
) {
  const set: Record<string, unknown> = {};
  if (patch.createTime instanceof Date) set.createTime = patch.createTime;
  const sourceCategory = clipField(patch.sourceCategory, 64);
  if (sourceCategory) set.sourceCategory = sourceCategory;
  if (patch.urgency) set.urgency = patch.urgency;
  if (typeof patch.slaHours === "number") set.slaHours = patch.slaHours;
  if (typeof patch.stabilityRisk === "boolean") set.stabilityRisk = patch.stabilityRisk;
  if (patch.summarizeTitle?.trim()) set.summarizeTitle = patch.summarizeTitle.trim();
  if (typeof patch.confidence === "number") set.confidence = patch.confidence;
  const subject = clipField(patch.canonicalSubject, 255);
  if (subject) set.canonicalSubject = subject;
  const eventType = clipField(patch.eventType, 128);
  if (eventType) set.eventType = eventType;
  const address = clipField(patch.address, 255);
  if (address) set.address = address;
  const subdistrict = clipField(patch.subdistrict, 64);
  if (subdistrict) set.subdistrict = subdistrict;
  set.updatedAt = new Date();
  if (Object.keys(set).length === 0) return;
  tenantDb
    .update(ticketsTable)
    .set(set)
    .where(eq(ticketsTable.id, ticketId))
    .catch((e) => console.warn(`Failed to persist ticket ${ticketId}:`, e.message));
}

function systemOnePatch(ticket: RawTicket) {
  return {
    createTime: workOrderInstantFromTicketNo(ticket.ticketNo),
    sourceCategory: ticket.sourceCategory,
    urgency: ticket.urgency,
    slaHours: ticket.systemOneSlaHours,
    stabilityRisk: ticket.systemOneStabilityRisk,
    subdistrict: ticket.systemOneTownship || null,
  };
}

function hasStoredExtraction(ticket: RawTicket): boolean {
  return Boolean(
    ticket.summarizeTitle?.trim() &&
      ticket.canonicalSubject?.trim() &&
      ticket.eventType?.trim() &&
      ticket.address?.trim() &&
      typeof ticket.confidence === "number" &&
      ticket.confidence > 0
  );
}

function hasStoredSystemOne(ticket: RawTicket): boolean {
  return Boolean(
    hasStoredExtraction(ticket) ||
      typeof ticket.slaHours === "number" ||
      typeof ticket.stabilityRisk === "boolean"
  );
}


/**
 * 批次调用大模型进行严格、精准的结构化 Zod 要素抽取
 */
async function extractBatchWithLLM(
  tickets: RawTicket[],
  startIndex: number,
  vocab?: RegionVocabulary
): Promise<{ items: Map<number, ExtractedTicketItem>; fromLlm: Set<number> }> {
  const result = new Map<number, ExtractedTicketItem>();
  const fromLlm = new Set<number>();
  if (tickets.length === 0) return { items: result, fromLlm };

  // 1. 建立本批工单的本地脱敏 Keymap 映射，用于大模型抽取结果的确定性实体还原
  const keymapByIndex = new Map<number, Record<string, string>>();
  const maskedTickets: RawTicket[] = tickets.map((t, idx) => {
    const anon = anonymize(t.content || "");
    keymapByIndex.set(idx + 1, anon.keymap);
    return {
      ...t,
      maskedContent: anon.text,
    };
  });

  const sanitizeItem = (rawItem: any): ExtractedTicketItem => {
    const idx = Number(rawItem.index) || 1;
    const km = keymapByIndex.get(idx) || {};
    // 执行深度反向还原：若模型提取的主体/标题带有 {{LICENSE_PLATE_1}} 等占位符，自动还原为真实车牌/人名
    const item = deanonymize(rawItem, km);
    const rawTown = item.township;
    const cleanTown =
      rawTown && rawTown !== "无" && rawTown !== "null" && rawTown !== "未知"
        ? String(rawTown).trim()
        : null;

    return {
      index: idx,
      summarizeTitle: String(item.summarizeTitle || "").trim(),
      subject: String(item.subject || "").trim(),
      location: String(item.location || "").trim(),
      township: cleanTown as any,
      eventType: String(item.eventType || "").trim(),
      category: item.category || "城市管理",
      confidence: Number(item.confidence || 85),
    };
  };

  const prompt = buildBatchExtractionPrompt(maskedTickets, vocab);
  const townshipNames = (vocab?.townships || []).map((t) => t.fullName).filter(Boolean);
  const dynamicSchema = buildDynamicBatchExtractionSchema(townshipNames);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const startMs = Date.now();
      const systemTwo = await getSystemTwoEngine();
      const { data, timings } = await systemTwo.createJSON(dynamicSchema, {
        messages: [{ role: "user", content: prompt }],
        enableThinking: false,
        maxTokens: LLM_TOKENS.EXTRACTION,
        temperature: 0.1,
      });

      if (data && Array.isArray(data.items)) {
        for (const item of data.items) {
          if (!item || typeof item.index !== "number") continue;
          const sanitized = sanitizeItem(item);
          // 标题和事件至少要有一个，否则这行没有可用要素。主体或地点为空是合法的：
          // 政策咨询常常没有可核验的对象和门牌，后面合并时再用工单镇街兜底，不要整批重试。
          if (!sanitized.summarizeTitle && !sanitized.eventType) continue;
          if (!sanitized.subject) {
            sanitized.confidence = Math.min(sanitized.confidence, 55);
          }
          const key = startIndex + item.index - 1;
          result.set(key, sanitized);
          fromLlm.add(key);
        }
        if (result.size === tickets.length) return { items: result, fromLlm };
      }
    } catch (err: any) {
      console.warn(`[extract-node] System-2 extraction batch error at index ${startIndex} attempt ${attempt + 1}:`, err.message);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }

  // 3. 模型失败时平滑退化为本地动态规则抽取引擎
  tickets.forEach((ticket, idx) => {
    const globalIdx = startIndex + idx;
    if (!result.has(globalIdx)) {
      result.set(globalIdx, fallbackDynamicExtraction(ticket, vocab?.categories?.[0]?.category || "综合民生"));
    }
  });

  return { items: result, fromLlm };
}

/**
 * 通用正则兜底提取器（当网络离线时备用，通用中文模式，零特定地名硬编码）
 */
function fallbackDynamicExtraction(ticket: RawTicket, defaultCategory = "综合民生"): ExtractedTicketItem {
  const content = typeof ticket?.content === "string" ? ticket.content : "";
  const subdistrict = explicitAdmin(ticket?.subdistrict) || "";
  const district = explicitAdmin(ticket?.district) || "";

  // 1. 车牌号基础识别
  const matchPlate = content.match(/(?:车牌[号为：:\s]*|小车|车辆|车牌[：:\s]*)([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/);
  const plateSubject = matchPlate && matchPlate[1] ? `${matchPlate[1].replace(/\s+/g, "").toUpperCase()}车辆` : "";

  // 2. 涉事主体（优先车牌或直接实体）
  const subject = plateSubject || "涉事方";

  // 3. 地点兜底（优先工单已有镇街/区县信息）
  const location = subdistrict ? `${subdistrict}` : (district || "辖区");

  // 4. 分类与诉求类型：直接继承工单自带分类或站点默认分类，绝不在代码中通过关键字死逻辑硬编码
  const category = (ticket?.sourceCategory as any) || defaultCategory;
  const eventType = ticket?.title || ticket?.sourceCategory || "民生诉求跟进";

  return {
    index: 0,
    summarizeTitle: ticket?.title || content.slice(0, 30),
    subject,
    location,
    eventType,
    category,
    confidence: 50,
  };
}

/**
 * Extract Node: 全量采用 AI Agent 大模型语义抽取四要素与摘要标题（P-Queue 受控并发与真实进度回报）
 */
export async function extractNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets || [];
  const taskId = state.taskId;
  const regionId = state.regionId;
  const CHUNK_SIZE = isLocalSystemTwo() ? 1 : 4;
  const extractionMap = new Map<number, ExtractedTicketItem>();
  const queue = new PQueue({ concurrency: systemTwoConcurrency() });

  // 加载当前运行站点的动态词库与别名映射，以及专属 Schema 数据库客户端
  const regionVocab = await getRegionVocabulary(state.regionId);
  const aliasMap = await getRegionAliasMap(state.regionId);
  const { db: tenantDb, region } = await getRegionDb(state.regionId);

  if (taskId) {
    updateTaskProgress(taskId, regionId, {
      stage: "EXTRACTING",
      stageText: "正在探测模型是否支持工具调用...",
      total: rawTickets.length,
      processed: 0,
      percent: 0,
    });
  }
  const toolsOk = await modelSupportsToolCalling();
  if (taskId) {
    updateTaskProgress(taskId, regionId, {
      stage: "EXTRACTING",
      stageText: toolsOk
        ? `模型支持工具调用，开始抽取 (共 ${rawTickets.length} 条)...`
        : `模型不支持工具调用，已回退 JSON 抽取 (共 ${rawTickets.length} 条)...`,
      total: rawTickets.length,
      processed: 0,
      percent: 0,
    });
  }

  // 1. 全文别名标准化预处理
  const normalizedRawTickets = rawTickets.map((t) => {
    const clock = workOrderClockFromTicketNo(t.ticketNo);
    return {
      ...t,
      title: normalizeAliasesInText(t.title, aliasMap),
      content: normalizeAliasesInText(t.content, aliasMap),
      subdistrict: normalizeAliasesInText(t.subdistrict, aliasMap),
      createTime: clock || t.createTime,
    };
  });

  // 1.1 先载入已经完成 System-2 完整要素抽取的工单（断点续抽/跳过已处理）
  let preExtractedCount = 0;
  normalizedRawTickets.forEach((ticket, idx) => {
    if (extractionMap.has(idx) || !hasStoredExtraction(ticket)) return;
    extractionMap.set(idx, {
      index: 1,
      summarizeTitle: ticket.summarizeTitle || "",
      subject: ticket.canonicalSubject || "",
      location: ticket.address || "",
      eventType: ticket.eventType || "",
      category: (ticket.sourceCategory as any) || "综合民生",
      confidence: ticket.confidence || 0,
    });
    preExtractedCount++;
  });

  // 1.2 检查 System-1 状态，仅对真正缺乏快思考决策的工单执行推理
  let classifiedCount = 0;
  let stabilityAlertCount = 0;
  const pendingS1Tickets: Array<{ ticket: RawTicket; index: number }> = [];

  normalizedRawTickets.forEach((ticket, index) => {
    if (hasStoredSystemOne(ticket)) {
      // 已经拥有 S1 决策标识，直接载入内存状态，无需重复过神经网络模型
      ticket.systemOneSlaHours = ticket.slaHours;
      ticket.systemOneStabilityRisk = ticket.stabilityRisk;
      ticket.systemOneCategory = ticket.sourceCategory;
      ticket.systemOneTownship = ticket.subdistrict;
      if (ticket.stabilityRisk) stabilityAlertCount++;
      classifiedCount++;
    } else {
      pendingS1Tickets.push({ ticket, index });
    }
  });

  // 1.3 若存在未被 System-1 分类的工单，仅对增量/未分类工单启动快思考引擎
  if (pendingS1Tickets.length > 0) {
    try {
      const systemOne = await SystemOneEngine.create();
      if (taskId) {
        updateTaskProgress(taskId, regionId, {
          stage: "EXTRACTING",
          stageText: `正在执行 System-1 快思考引擎预审 (${pendingS1Tickets.length} 条待分类工单)...`,
          total: normalizedRawTickets.length,
          processed: classifiedCount,
          percent: stagePercent("S1", classifiedCount, pendingS1Tickets.length + classifiedCount, "live"),
        });
      }

      for (let i = 0; i < pendingS1Tickets.length; i++) {
        const { ticket } = pendingS1Tickets[i];
        try {
          const decision = await systemOne.evaluate(
            {
              title: ticket.title,
              content: ticket.content,
              subdistrict: ticket.subdistrict,
            },
            {
              townships: regionVocab.townships,
            }
          );

          ticket.systemOneCategory = decision.categoryName;
          ticket.systemOneIntent = decision.intent;
          ticket.systemOneUrgencyTier = decision.urgencyLevel;
          ticket.systemOneSlaHours = decision.slaHours;
          ticket.systemOneStabilityRisk = decision.stabilityRisk;
          ticket.systemOneConfidence = decision.categoryProbability;

          const s1Township =
            canonicalizeTownship(decision.township, regionVocab) ||
            canonicalizeTownship(ticket.subdistrict, regionVocab) ||
            matchTownshipName((ticket.title || "") + " " + (ticket.content || ""), regionVocab.townships) ||
            null;
          ticket.systemOneTownship = s1Township || undefined;
          ticket.subdistrict = s1Township || "";

          ticket.urgency = decision.stabilityRisk || decision.urgencyLevel === 3
            ? "URGENT"
            : decision.urgencyLevel === 2
            ? "MEDIUM"
            : "NORMAL";
          const category = canonicalizeCategory(decision.categoryName) || decision.categoryName;
          if (category) ticket.sourceCategory = category;
          if (decision.stabilityRisk) stabilityAlertCount++;
          classifiedCount++;
          if (ticket.id) rememberExtraction(tenantDb, ticket.id, systemOnePatch(ticket));
          if ((i + 1) % 50 === 0 || i + 1 === pendingS1Tickets.length) {
            console.log(`[extract] system-1 ${i + 1}/${pendingS1Tickets.length}`);
          }
        } catch (s1Err: any) {
          console.warn(`[extract-node] System-1 evaluation error for ticket ${ticket.ticketNo}:`, s1Err.message);
        }
      }
      await systemOne.close();
    } catch (initErr: any) {
      console.warn("[extract-node] System-1 engine initialization warning, continuing without S1 pre-filter:", initErr.message);
    }
  } else {
    console.log(`[extract] System-1 全部历史工单已拥有分类标识 (${classifiedCount} 条)，直接跳过快思考推理。`);
  }


  let processedCount = preExtractedCount;
  const chunkTasks: Array<() => Promise<void>> = [];

  // 1.4 对尚未抽取的疑难工单加入 LLM 并发队列
  const pendingIdx: number[] = [];
  for (let i = 0; i < normalizedRawTickets.length; i++) {
    if (!extractionMap.has(i)) pendingIdx.push(i);
  }

  // 计算当前已提取工单的板块分类分布
  const computeActiveCategories = () => {
    const counts = new Map<string, number>();
    for (const item of extractionMap.values()) {
      const cat = item.category || "综合民生";
      counts.set(cat, (counts.get(cat) || 0) + 1);
    }
    return Array.from(counts.entries())
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 6);
  };

  if (taskId) {
    // S2 是 pipeline 耗时大头（每张工单都要跑 LLM），由 completed/total 在 S2 区间内推进
    const percent = stagePercent("S2", processedCount, normalizedRawTickets.length);
    const alertNotice = stabilityAlertCount > 0 ? `，🔴 发现 ${stabilityAlertCount} 件涉稳红线工单` : "";
    updateTaskProgress(taskId, regionId, {
      processed: processedCount,
      percent,
      classifiedCount,
      activeCategories: computeActiveCategories(),
      stageText: preExtractedCount > 0
        ? `继续研判：已完成 ${preExtractedCount} 条，还剩 ${pendingIdx.length} 条`
        : `System 1 已分类 ${classifiedCount} 条${alertNotice}，接下来抽取 ${pendingIdx.length} 条`,
      extractedCount: extractionMap.size,
    });
  }

  console.log(`[extract] system-1 done, stored ${preExtractedCount}, system-2 pending ${pendingIdx.length}`);
  const llmTicketIndexes = new Set<number>();
  for (let p = 0; p < pendingIdx.length; p += CHUNK_SIZE) {
    const idxs = pendingIdx.slice(p, p + CHUNK_SIZE);
    const chunk = idxs.map((i) => normalizedRawTickets[i]);
    const indexMap = idxs;
    chunkTasks.push(async () => {
      const packed = await extractBatchWithLLM(chunk, 0, regionVocab);
      packed.fromLlm.forEach((packedIdx) => {
        const key = indexMap[packedIdx];
        if (key !== undefined) llmTicketIndexes.add(key);
      });
      packed.items.forEach((val, packedIdx) => {
        const key = indexMap[packedIdx];
        if (key === undefined) return;
        extractionMap.set(key, val);

        const orig = normalizedRawTickets[key];
        // 严格白名单校验与规范化：绝不允许跳出目标辖区的法定镇街白名单
        const validTownship =
          canonicalizeTownship(val.township, regionVocab) ||
          canonicalizeTownship(val.location, regionVocab) ||
          canonicalizeTownship(orig?.subdistrict, regionVocab) ||
          null;

        // 单条实时持久化至目标 Schema 对应的 PostgreSQL 数据库，保证中途关闭或刷新永不丢失进度
        if (orig && orig.id) {
          rememberExtraction(tenantDb, orig.id, {
            ...systemOnePatch(orig),
            subdistrict: validTownship || null,
            summarizeTitle: val.summarizeTitle,
            confidence: val.confidence,
            canonicalSubject: val.subject,
            eventType: val.eventType,
            address: val.location,
          });
        }
      });
      processedCount += chunk.length;
      const done = Math.min(processedCount, normalizedRawTickets.length);
      console.log(`[extract] ${done}/${normalizedRawTickets.length}`);
      if (taskId) {
        const currentProcessed = Math.min(processedCount, normalizedRawTickets.length);
        const percent = stagePercent("S2", currentProcessed, normalizedRawTickets.length);
        const latestItem = Array.from(packed.items.values()).pop();
        updateTaskProgress(taskId, regionId, {
          processed: currentProcessed,
          percent,
          classifiedCount,
          activeCategories: computeActiveCategories(),
          stageText: `AI 正在抽取工单实体与微观地点...`,
          extractedCount: extractionMap.size,
          currentLocation: latestItem?.location || undefined,
          currentSubject: latestItem?.subject || undefined,
          currentEventType: latestItem?.eventType || undefined,
        });
      }
    });
  }

  if (chunkTasks.length > 0) {
    await queue.addAll(chunkTasks);
  }

  // 2. 客观物理区划校准与别名规范化（彻底废除置信度二次套娃仲裁，仅对不在白名单的镇街执行纯代码别名修正）
  normalizedRawTickets.forEach((ticket, idx) => {
    const item = extractionMap.get(idx);
    if (!item) return;

    const calibrated = verifyAndCanonicalizeTicketArea(item, ticket, regionVocab, aliasMap);
    extractionMap.set(idx, calibrated);
  });

  // 2.1 针对发生地点缺失或为占位符（如“无”、“未指定”）的企业主体工单，智能补全属地与经营地址 (纯规则+天地图两级容错，零硬编码)
  for (const [idx, item] of extractionMap.entries()) {
    if (isPlaceholderLocation(item.location) && isEnterpriseEntity(item.subject)) {
      try {
        const enriched = await enrichEnterpriseLocation(item.subject, region, regionVocab);
        if (enriched.enriched) {
          if (enriched.address) item.location = enriched.address;
          if (enriched.township) item.township = enriched.township as any;
          const orig = normalizedRawTickets[idx];
          if (orig && orig.id) {
            rememberExtraction(tenantDb, orig.id, {
              address: enriched.address,
              subdistrict: enriched.township || null,
            });
          }
        }
      } catch {
        // 静默捕获，确保绝对不影响流水线主流程
      }
    }
  }

  if (taskId) {
    updateTaskProgress(taskId, regionId, {
      percent: stagePercent("S2", normalizedRawTickets.length, normalizedRawTickets.length, "max"),
      classifiedCount,
      activeCategories: computeActiveCategories(),
      stageText: `抽取完成，准备按同一事件归并`,
    });
  }

  // 3. 构建富化工单并执行最终标准词汇表与别名规范化映射
  const enrichedTickets: EnrichedTicket[] = normalizedRawTickets.map((ticket, index) => {
    const fallback = fallbackDynamicExtraction(ticket);
    const aiExtracted = extractionMap.get(index);
    const summarizeTitle = aiExtracted?.summarizeTitle || ticket.summarizeTitle || fallback.summarizeTitle;
    const rawSubject = (aiExtracted?.subject || "").trim() || fallback.subject;
    const canonicalSubject = resolveEntityAlias(rawSubject, aliasMap);
    const rawLocation = (aiExtracted?.location || "").trim() || fallback.location;
    const eventType = (aiExtracted?.eventType || "").trim() || fallback.eventType;
    const category =
      canonicalizeCategory(ticket.systemOneCategory) ||
      canonicalizeCategory(aiExtracted?.category) ||
      "";
    const confidence =
      typeof aiExtracted?.confidence === "number"
        ? aiExtracted.confidence
        : fallback.confidence;

    const canonicalLocation = resolveEntityAlias(rawLocation, aliasMap);
    const area = adminFromLocation(canonicalLocation, ticket);
    const fromLlm = llmTicketIndexes.has(index);
    const validTownship =
      canonicalizeTownship(aiExtracted?.township, regionVocab) ||
      canonicalizeTownship(fromLlm ? aiExtracted?.location : ticket.address, regionVocab) ||
      canonicalizeTownship(ticket.systemOneTownship, regionVocab) ||
      canonicalizeTownship(ticket.subdistrict, regionVocab);
    const subdistrict = validTownship || undefined;

    return {
      ...ticket,
      district: area.district || ticket.district || undefined,
      subdistrict,
      sourceCategory: category || undefined,
      address: canonicalLocation || ticket.address,
      urgency: ticket.urgency,
      summarizeTitle,
      confidence,
      canonicalSubject,
      canonicalLocation,
      eventType,
      themes: category ? [category] : [],
      entities: [
        { name: canonicalSubject, canonicalName: canonicalSubject, type: "SUBJECT", confidence: Math.min(1, confidence / 100) },
        { name: canonicalLocation, canonicalName: canonicalLocation, type: "LOCATION", confidence: Math.min(1, (confidence - 5) / 100) },
        { name: eventType, canonicalName: eventType, type: "EVENT_TYPE", confidence: Math.min(1, confidence / 100) },
      ],
      relations: [
        { source: ticket.id, target: canonicalSubject, relation: "投诉主体" },
        { source: ticket.id, target: canonicalLocation, relation: "发生地" },
        { source: canonicalSubject, target: eventType, relation: "涉及事件" },
      ],
    };
  });

  const lowConfidenceTickets = enrichedTickets
    .filter((t) => (t.confidence ?? 0) < LOW_CONFIDENCE_THRESHOLD)
    .map((t) => ({
      ticketId: t.id,
      confidence: t.confidence ?? 0,
      reason: (t.confidence ?? 0) === 0 ? "EXTRACTION_FAILED" : "LOW_CONFIDENCE",
    }));

  if (taskId) {
    updateTaskProgress(taskId, regionId, {
      percent: stagePercent("S2", normalizedRawTickets.length, normalizedRawTickets.length, "max"),
      stageText: `要素抽取完成，识别低置信工单 ${lowConfidenceTickets.length} 条，准备执行图谱聚类...`,
      reviewCount: lowConfidenceTickets.length,
    });
  }

  return {
    enrichedTickets,
    lowConfidenceTickets,
    status: "extracting",
  };
}
