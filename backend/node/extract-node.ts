import type { TicketRadarState, EnrichedTicket, RawTicket } from "../state";
import {
  getChatModel,
  isLocalLlm,
  llmConcurrency,
  markToolCallingUnsupported,
  modelSupportsToolCalling,
} from "../model";
import {
  BatchExtractionSchema,
  buildBatchExtractionPrompt,
  type ExtractedTicketItem,
} from "../prompt";
import { adminFromLocation, explicitAdmin } from "@/lib/admin-area";
import { getRegionAliasMap, normalizeAliasesInText, resolveEntityAlias } from "@/lib/alias-dict";
import { canonicalizeCategory, canonicalizeTownship, getRegionVocabulary, type RegionVocabulary } from "@/lib/vocabulary";
import { needsArbitration, arbitrateSingleTicket } from "./arbitrator-node";
import { updateTaskProgress } from "@/lib/task-progress";
import { getRegionDb } from "@/db/client";
import { ticketsTable } from "@/db/schema";
import { eq } from "drizzle-orm";
import PQueue from "p-queue";
import { anonymize, deanonymize } from "@civic/anonymizer";
import { SystemOneEngine } from "@civic/system-one";

export const LOW_CONFIDENCE_THRESHOLD = 60;

/**
 * 批次调用大模型进行严格、精准的结构化 Zod 要素抽取
 */
async function extractBatchWithLLM(
  tickets: RawTicket[],
  startIndex: number,
  vocab?: RegionVocabulary
): Promise<Map<number, ExtractedTicketItem>> {
  const result = new Map<number, ExtractedTicketItem>();
  if (tickets.length === 0) return result;

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
    return {
      index: idx,
      summarizeTitle: String(item.summarizeTitle || "").trim(),
      subject: String(item.subject || "").trim(),
      location: String(item.location || "").trim(),
      eventType: String(item.eventType || "").trim(),
      category: item.category || "城市管理",
      confidence: Number(item.confidence || 85),
    };
  };

  const prompt = buildBatchExtractionPrompt(maskedTickets, vocab);

  try {
    const chat = getChatModel(0);

    if (await modelSupportsToolCalling()) {
      try {
        const structuredChat = chat.withStructuredOutput(BatchExtractionSchema);
        const structuredRes = await structuredChat.invoke(prompt);
        if (structuredRes && Array.isArray(structuredRes.items)) {
          for (const item of structuredRes.items) {
            if (item && typeof item.index === "number") {
              result.set(startIndex + item.index - 1, sanitizeItem(item));
            }
          }
          if (result.size > 0) return result;
        }
      } catch (structErr: unknown) {
        const message = structErr instanceof Error ? structErr.message : String(structErr);
        markToolCallingUnsupported(message);
      }
    }

    // 探测失败或不支持：JSON 解析
    const res = await chat.invoke(prompt);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const items: ExtractedTicketItem[] = Array.isArray(parsed) ? parsed : (parsed.items || []);
      for (const item of items) {
        if (item && typeof item.index === "number") {
          result.set(startIndex + item.index - 1, sanitizeItem(item));
        }
      }
      if (result.size > 0) return result;
    }
  } catch (err: any) {
    console.warn(`[extract-node] LLM extraction batch error at index ${startIndex}:`, err.message);
  }

  // 3. 模型失败时平滑退化为本地动态规则抽取引擎
  tickets.forEach((ticket, idx) => {
    const globalIdx = startIndex + idx;
    if (!result.has(globalIdx)) {
      result.set(globalIdx, fallbackDynamicExtraction(ticket, vocab?.categories?.[0]?.category || "综合民生"));
    }
  });

  return result;
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
  const CHUNK_SIZE = isLocalLlm() ? 4 : 1;
  const extractionMap = new Map<number, ExtractedTicketItem>();
  const queue = new PQueue({ concurrency: llmConcurrency() });

  // 加载当前运行站点的动态词库与别名映射，以及专属 Schema 数据库客户端
  const regionVocab = await getRegionVocabulary(state.regionId);
  const aliasMap = await getRegionAliasMap(state.regionId);
  const { db: tenantDb } = await getRegionDb(state.regionId);

  if (taskId) {
    updateTaskProgress(taskId, {
      stage: "EXTRACTING",
      stageText: "正在探测模型是否支持工具调用...",
      total: rawTickets.length,
      processed: 0,
      percent: 0,
    });
  }
  const toolsOk = await modelSupportsToolCalling();
  if (taskId) {
    updateTaskProgress(taskId, {
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
  const normalizedRawTickets = rawTickets.map((t) => ({
    ...t,
    title: normalizeAliasesInText(t.title, aliasMap),
    content: normalizeAliasesInText(t.content, aliasMap),
    subdistrict: normalizeAliasesInText(t.subdistrict, aliasMap),
  }));

  // 1.1 启动 System-1 极速决策引擎 (自适应 MPS / ONNX 神经编码器，单件时延 <1ms)
  let fastTrackCount = 0;
  let stabilityAlertCount = 0;
  try {
    const systemOne = await SystemOneEngine.create();
    if (taskId) {
      updateTaskProgress(taskId, {
        stage: "EXTRACTING",
        stageText: `正在执行 System-1 快思考引擎极速预审 (${normalizedRawTickets.length} 条)...`,
        total: normalizedRawTickets.length,
        processed: 0,
        percent: 5,
      });
    }

    for (let i = 0; i < normalizedRawTickets.length; i++) {
      const ticket = normalizedRawTickets[i];
      try {
        const decision = await systemOne.evaluate({
          title: ticket.title,
          content: ticket.content,
          subdistrict: ticket.subdistrict,
        });

        ticket.systemOneCategory = decision.categoryName;
        ticket.systemOneIntent = decision.intent;
        ticket.systemOneUrgencyTier = decision.urgencyLevel;
        ticket.systemOneSlaHours = decision.slaHours;
        ticket.systemOneStabilityRisk = decision.stabilityRisk;
        ticket.systemOneConfidence = decision.categoryProbability;
        ticket.urgency = decision.stabilityRisk || decision.urgencyLevel === 3
          ? "URGENT"
          : decision.urgencyLevel === 2
          ? "MEDIUM"
          : "NORMAL";

        if (decision.stabilityRisk) {
          stabilityAlertCount++;
        }

        // 1.2 高置信度业务咨询 (INQUIRY, 0h SLA) 与催办件 (REMINDER) 免 LLM 直通车
        const isFastTrackIntent = decision.intent === "INQUIRY" || decision.intent === "REMINDER";
        if (isFastTrackIntent && decision.intentProbability >= 0.80 && !extractionMap.has(i)) {
          const area = adminFromLocation(ticket.subdistrict || "", ticket);
          const targetCategory = canonicalizeCategory(decision.categoryName) || "城市管理";
          const eventType = `${decision.categoryName}${decision.intent === "INQUIRY" ? "政策咨询" : "工单催办"}`;
          const summarizeTitle =
            ticket.title ||
            ticket.summarizeTitle ||
            `关于${ticket.subdistrict || regionVocab.regionName}${decision.categoryName}的${decision.intent === "INQUIRY" ? "政策咨询" : "催办诉求"}`;
          const subject = decision.intent === "INQUIRY" ? "咨询市民" : "催办诉求人";
          const location = ticket.address || ticket.subdistrict || regionVocab.regionName;

          const item: ExtractedTicketItem = {
            index: 1,
            summarizeTitle,
            subject,
            location,
            eventType,
            category: targetCategory as any,
            confidence: Math.round(decision.intentProbability * 100),
          };

          extractionMap.set(i, item);
          ticket.isSystemOneFastTrack = true;
          fastTrackCount++;

          // 实时持久化落库
          if (ticket.id) {
            tenantDb
              .update(ticketsTable)
              .set({
                summarizeTitle: item.summarizeTitle,
                address: item.location,
                district: area.district || ticket.district || null,
                subdistrict: area.subdistrict || ticket.subdistrict || null,
                sourceCategory: item.category,
                urgency: ticket.urgency,
                confidence: item.confidence,
              })
              .where(eq(ticketsTable.id, ticket.id))
              .catch((e) => console.warn(`Failed to persist fast-track ticket ${ticket.id}:`, e.message));
          }
        }
      } catch (s1Err: any) {
        console.warn(`[extract-node] System-1 evaluation error for ticket ${ticket.ticketNo}:`, s1Err.message);
      }
    }
    await systemOne.close();
  } catch (initErr: any) {
    console.warn("[extract-node] System-1 engine initialization warning, continuing without S1 pre-filter:", initErr.message);
  }

  // 1.3 检查已抽取过的工单（断点续抽/跳过已处理），直接载入并跳过 LLM
  let preExtractedCount = 0;
  normalizedRawTickets.forEach((ticket, idx) => {
    if (extractionMap.has(idx)) return;
    if (ticket.summarizeTitle && typeof ticket.confidence === "number" && ticket.confidence > 0) {
      const fallback = fallbackDynamicExtraction(ticket);
      extractionMap.set(idx, {
        index: 1,
        summarizeTitle: ticket.summarizeTitle,
        subject: ticket.title || fallback.subject || "相关主体",
        location: ticket.address || ticket.subdistrict || fallback.location || regionVocab.regionName,
        eventType: ticket.sourceCategory || fallback.eventType || "民生诉求",
        category: (ticket.sourceCategory as any) || fallback.category || "城市管理",
        confidence: ticket.confidence,
      });
      preExtractedCount++;
    }
  });

  let processedCount = preExtractedCount + fastTrackCount;
  const chunkTasks: Array<() => Promise<void>> = [];

  // 1.4 对尚未抽取的疑难工单加入 LLM 并发队列
  const pendingIdx: number[] = [];
  for (let i = 0; i < normalizedRawTickets.length; i++) {
    if (!extractionMap.has(i)) pendingIdx.push(i);
  }

  if (taskId) {
    const percent = Math.round((processedCount / Math.max(1, normalizedRawTickets.length)) * 50);
    const alertNotice = stabilityAlertCount > 0 ? `，🔴 发现 ${stabilityAlertCount} 件涉稳红线工单` : "";
    updateTaskProgress(taskId, {
      processed: processedCount,
      percent,
      stageText: `System-1 快思考分流完成：${fastTrackCount} 条咨询/催办直通分派${alertNotice}；剩余 ${pendingIdx.length} 条工单进入大模型抽取...`,
      extractedCount: extractionMap.size,
    });
  }

  for (let p = 0; p < pendingIdx.length; p += CHUNK_SIZE) {
    const idxs = pendingIdx.slice(p, p + CHUNK_SIZE);
    const chunk = idxs.map((i) => normalizedRawTickets[i]);
    const indexMap = idxs;
    chunkTasks.push(async () => {
      const packed = await extractBatchWithLLM(chunk, 0, regionVocab);
      packed.forEach((val, packedIdx) => {
        const key = indexMap[packedIdx];
        if (key === undefined) return;
        extractionMap.set(key, val);
        // 单条实时持久化至目标 Schema 对应的 PostgreSQL 数据库，保证中途关闭或刷新永不丢失进度
        const orig = normalizedRawTickets[key];
        if (orig && orig.id) {
          const area = adminFromLocation(val.location, orig);
          tenantDb.update(ticketsTable)
            .set({
              summarizeTitle: val.summarizeTitle,
              address: val.location,
              district: area.district || orig.district || null,
              subdistrict: area.subdistrict || orig.subdistrict || null,
              sourceCategory: canonicalizeCategory(val.category) || val.category,
              urgency: orig.urgency || "NORMAL",
              confidence: val.confidence,
            })
            .where(eq(ticketsTable.id, orig.id))
            .catch((e) => console.warn(`Failed to persist ticket ${orig.id}:`, e.message));
        }
      });
      processedCount += chunk.length;
      if (taskId) {
        const currentProcessed = Math.min(processedCount, normalizedRawTickets.length);
        const percent = Math.round((currentProcessed / Math.max(1, normalizedRawTickets.length)) * 50);
        updateTaskProgress(taskId, {
          processed: currentProcessed,
          percent,
          stageText: `AI 正在抽取工单实体与微观地点 (${currentProcessed} / ${normalizedRawTickets.length})...`,
          extractedCount: extractionMap.size,
        });
      }
    });
  }

  if (chunkTasks.length > 0) {
    await queue.addAll(chunkTasks);
  }

  // 2. 二级 AI 仲裁：只对「本轮新抽取」的工单做。已落库的抽取结果直接进聚类。
  const arbitrationTasks: Array<() => Promise<void>> = [];
  const lowConfidenceIndices: number[] = [];
  let completedArbitrations = 0;
  const newlyExtracted = new Set(pendingIdx);

  normalizedRawTickets.forEach((ticket, idx) => {
    if (!newlyExtracted.has(idx)) return;
    const item = extractionMap.get(idx) || fallbackDynamicExtraction(ticket);
    if (needsArbitration(item, ticket, regionVocab)) {
      lowConfidenceIndices.push(idx);
      arbitrationTasks.push(async () => {
        const corrected = await arbitrateSingleTicket(ticket, item, regionVocab, aliasMap);
        extractionMap.set(idx, corrected);
        completedArbitrations++;
        if (taskId) {
          const currentPercent = Math.min(68, 58 + Math.round((completedArbitrations / Math.max(1, arbitrationTasks.length)) * 10));
          updateTaskProgress(taskId, {
            percent: currentPercent,
            reviewCount: arbitrationTasks.length,
            stageText: `二级 AI 仲裁复核中 (${completedArbitrations} / ${arbitrationTasks.length})...`,
          });
        }
      });
    }
  });

  if (arbitrationTasks.length > 0) {
    if (taskId) {
      updateTaskProgress(taskId, {
        percent: 58,
        reviewCount: arbitrationTasks.length,
        stageText: `触发二级 AI 仲裁机制，正在对 ${arbitrationTasks.length} 条低置信度/歧义工单进行事实复核纠偏...`,
      });
    }
    await queue.addAll(arbitrationTasks);
  }

  // 3. 构建富化工单并执行最终标准词汇表与别名规范化映射
  const enrichedTickets: EnrichedTicket[] = normalizedRawTickets.map((ticket, index) => {
    const fallback = fallbackDynamicExtraction(ticket);
    const aiExtracted = extractionMap.get(index);
    const summarizeTitle = aiExtracted?.summarizeTitle || ticket.summarizeTitle || fallback.summarizeTitle;
    const rawSubject = aiExtracted?.subject || fallback.subject;
    const rawLocation = aiExtracted?.location || fallback.location;
    const eventType = aiExtracted?.eventType || fallback.eventType;
    const category =
      canonicalizeCategory(aiExtracted?.category || fallback.category) || "城市管理";
    const confidence =
      typeof aiExtracted?.confidence === "number"
        ? aiExtracted.confidence
        : fallback.confidence;

    const canonicalSubject = resolveEntityAlias(rawSubject, aliasMap);
    const canonicalLocation = resolveEntityAlias(rawLocation, aliasMap);
    const area = adminFromLocation(canonicalLocation, ticket);
    const subdistrict =
      canonicalizeTownship(area.subdistrict || ticket.subdistrict, regionVocab) ||
      area.subdistrict ||
      undefined;

    return {
      ...ticket,
      district: area.district || undefined,
      subdistrict,
      sourceCategory: category,
      address: canonicalLocation,
      summarizeTitle,
      confidence,
      canonicalSubject,
      canonicalLocation,
      eventType,
      themes: [category],
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
    updateTaskProgress(taskId, {
      percent: 68,
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
