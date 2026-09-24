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

  const prompt = buildBatchExtractionPrompt(tickets, vocab);

  try {
    const chat = getChatModel(0);

    if (await modelSupportsToolCalling()) {
      try {
        const structuredChat = chat.withStructuredOutput(BatchExtractionSchema);
        const structuredRes = await structuredChat.invoke(prompt);
        if (structuredRes && Array.isArray(structuredRes.items)) {
          for (const item of structuredRes.items) {
            if (item && typeof item.index === "number") {
              result.set(startIndex + item.index - 1, {
                index: item.index,
                summarizeTitle: String(item.summarizeTitle || "").trim(),
                subject: String(item.subject || "").trim(),
                location: String(item.location || "").trim(),
                eventType: String(item.eventType || "").trim(),
                category: item.category || "城市管理",
                confidence: Number(item.confidence || 85),
              });
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
          result.set(startIndex + item.index - 1, {
            index: item.index,
            summarizeTitle: String(item.summarizeTitle || "").trim(),
            subject: String(item.subject || "").trim(),
            location: String(item.location || "").trim(),
            eventType: String(item.eventType || "").trim(),
            category: item.category || "城市管理",
            confidence: Number(item.confidence || 85),
          });
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
      result.set(globalIdx, fallbackDynamicExtraction(ticket));
    }
  });

  return result;
}

/**
 * 通用正则兜底提取器（当网络离线时备用，通用中文模式，零特定地名硬编码）
 */
function fallbackDynamicExtraction(ticket: RawTicket): ExtractedTicketItem {
  const content = typeof ticket?.content === "string" ? ticket.content : "";
  const subdistrict = explicitAdmin(ticket?.subdistrict) || "";

  // 1. 车牌专用精确识别（如 粤E SD221 或 粤EY6501）
  const matchPlate = content.match(/(?:车牌[号为：:\s]*|小车|车辆|车牌[：:\s]*)([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/);
  const plateSubject = matchPlate && matchPlate[1] ? `${matchPlate[1].replace(/\s+/g, "").toUpperCase()}车辆` : "";

  // 2. 商家/企业/机构主体识别（严防把"执法部门/政府部门"当作被诉主体）
  let orgSubject = "";
  const matchSubj = content.match(/(?:在|位于|投诉|反映|名称[：:])([^\s，。、（）]{2,25}?(?:民宿|公寓|酒店|酒馆|酒吧|KTV|烧烤店|大排档|快餐店|美食城|商场|便利店|超市|体验馆|俱乐部|桌球室|茶庄|饭店|有限公司|工程部|施工方|物业(?:管理处)?|花园|小区|苑|自建房|大厦))/);
  if (matchSubj && matchSubj[1]) {
    const candidate = matchSubj[1].trim();
    if (!candidate.includes("部门") && !candidate.includes("居委") && !candidate.includes("街道办")) {
      orgSubject = candidate;
    }
  }

  const hasSpecificSubject = Boolean(plateSubject || orgSubject);
  const subject = plateSubject || orgSubject || (subdistrict ? `${subdistrict}特定涉事方` : "特定诉求涉事方");

  // 3. 通用动态微观地点识别（必须包含路/街/巷/号/小区/广场等，且严防"部门"伪装为"门"）
  let location = subdistrict ? `${subdistrict}辖区` : "未标明微观地点";
  let hasSpecificLocation = false;
  const matchLoc = content.match(/([^\s，。、（）]{2,25}?(?:街道|镇)?[^\s，。、（）]{2,20}?(?:路|大道|大街|巷|横街|横巷|新村|广场|公园|中心|城|大厦|小区|花园|公寓|自建房|\d+号(?:门口|附近)?))/);
  if (matchLoc && matchLoc[1]) {
    const locCand = matchLoc[1].replace(/^(?:市民|诉求人|致电|反映|在|位于|我是)/, "").trim();
    const badWords = ["部门", "希望", "反映", "致电", "要求", "执法", "电话", "介入", "处理", "情况", "问题"];
    if (!badWords.some((w) => locCand.includes(w)) && locCand.length >= 4) {
      location = locCand;
      hasSpecificLocation = true;
    }
  }

  let eventType = "城市管理日常诉求跟进";
  let category = "城市管理";

  if (plateSubject || content.includes("违停") || content.includes("乱停") || content.includes("停放") || content.includes("挪车")) {
    eventType = "机动车违规停放阻碍通行";
    category = "交通出行";
  } else if (content.includes("噪音") || content.includes("扰民") || content.includes("音乐") || content.includes("喧哗")) {
    eventType = "夜间营业音响喧哗与商业噪音扰民";
    category = "生态环境";
  } else if (content.includes("烟花") || content.includes("爆竹")) {
    eventType = "违规燃放/售卖烟花爆竹扰民";
    category = "公共安全";
  } else if (content.includes("油烟") || content.includes("排气") || content.includes("异味")) {
    eventType = "餐饮油烟直排与空气污染";
    category = "生态环境";
  } else if (content.includes("水管") || content.includes("下水道") || content.includes("排污")) {
    eventType = "市政排污管道与供水抢修问题";
    category = "城市管理";
  } else if (content.includes("小贩") || content.includes("摆摊") || content.includes("占道")) {
    eventType = "流动摊贩占道经营与路面堵塞";
    category = "城市管理";
  } else if (content.includes("退款") || content.includes("收费") || content.includes("欺诈") || content.includes("虚假宣传")) {
    eventType = "消费纠纷与违规收费维权";
    category = "市场监管";
  } else if (content.includes("物业") || content.includes("电梯")) {
    eventType = "小区物业管理与公共设施隐患";
    category = "城市管理";
  } else if (content.includes("工资") || content.includes("欠薪") || content.includes("社保") || content.includes("劳资") || content.includes("劳动合同")) {
    eventType = "劳资纠纷与劳动社保权益维护";
    category = "劳动社保";
  }

  // 评估规则兜底时的置信度得分
  let fallbackConfidence = 50;
  if (hasSpecificSubject && hasSpecificLocation) {
    fallbackConfidence = 85;
  } else if (hasSpecificSubject || hasSpecificLocation) {
    fallbackConfidence = 70;
  } else {
    fallbackConfidence = 45;
  }

  return {
    index: 0,
    summarizeTitle: `关于${location}${subject}${eventType}的诉求`,
    subject,
    location,
    eventType,
    category: (category as any) || "城市管理",
    confidence: fallbackConfidence,
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

  // 1.1 检查已抽取过的工单（断点续抽/跳过已处理），直接载入并跳过 LLM
  let preExtractedCount = 0;
  normalizedRawTickets.forEach((ticket, idx) => {
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

  let processedCount = preExtractedCount;
  const chunkTasks: Array<() => Promise<void>> = [];

  if (taskId && preExtractedCount > 0) {
    const percent = Math.round((processedCount / Math.max(1, normalizedRawTickets.length)) * 50);
    updateTaskProgress(taskId, {
      processed: processedCount,
      percent,
      stageText: `已恢复断点：跳过已抽取工单 ${preExtractedCount} 条，继续抽取剩余 ${normalizedRawTickets.length - preExtractedCount} 条...`,
      extractedCount: extractionMap.size,
    });
  }

  // 1.2 对尚未抽取的工单加入并发队列
  const pendingIdx: number[] = [];
  for (let i = 0; i < normalizedRawTickets.length; i++) {
    if (!extractionMap.has(i)) pendingIdx.push(i);
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
