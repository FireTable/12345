/**
 * 12345 增量时空工单吸附与动态研判引擎 (Incremental Spatial-Temporal Ingestion & Arbiter)
 * 
 * 解决真实业务痛点：
 * 1. 【毫秒级增量吸附】：新工单一经进入，由确定性算法比对当前处置中的活跃主题池，自动归入已有事件簇，杜绝重复建群；
 * 2. 【滑动时间窗口判定】：基于“该事件最近一次反映时间（lastOccurrence）的滑动窗口（默认72h）”及“事件未办结状态”；
 * 3. 【质变按需慢思考】：平时普通追加诉求直接继承已有处置方案（0 秒等待、0 Token消耗）；仅在命中突发严重险情或工单量升级时，触发 System-2 增量重新慢思考。
 */

import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type { EnrichedTicket, MultiFrequencyTheme, RawTicket, RiskLevel } from "./state";
import { isSameSpatialEntity, extractSpatialCore } from "./node/canonical-node";
import { negativeTermsPattern, RULES } from "./rules";
import { getSystemTwoEngine } from "./model";
import { LLM_TOKENS } from "@/lib/tokens";
import { BatchThemeEnrichmentSchema, buildBatchThemeEnrichmentPrompt } from "./prompt";

function safeParseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  return new Date();
}

export interface IncrementalClusterResult {
  action: "ATTACHED" | "STANDALONE";
  matchedThemeId?: string;
  matchedTheme?: MultiFrequencyTheme;
  reason: string;
  needDeepThinkingUpgrade: boolean;
  upgradeReason?: string;
}

/**
 * 核心算法：评估单条已抽取的富化工单，研判其是否应吸附进现有活跃多频主题
 * @param newTicket 已完成要素抽取的工单
 * @param activeThemes 当前正在处置中/未结案的活跃主题列表
 * @param options 可配置参数（如滑动时间窗口小时数，默认 72 小时）
 */
export function evaluateIncrementalTicket(
  newTicket: EnrichedTicket,
  activeThemes: MultiFrequencyTheme[],
  options?: { slidingWindowHours?: number }
): IncrementalClusterResult {
  const slidingWindow = options?.slidingWindowHours ?? 72;
  const ticketTime = safeParseDate(newTicket.createTime);
  const ticketSpatialCore = extractSpatialCore(newTicket.canonicalLocation || newTicket.address || "");

  // 1. 遍历活跃主题（排除已彻底办结归档的主题）
  for (const theme of activeThemes) {
    if (theme.handlingStatus === "已办结" || theme.status === "DISMISSED") {
      continue;
    }

    // 2. 空间基底校验：核心微观空间是否一致
    const isSpatialMatch = isSameSpatialEntity(theme.canonicalLocation, ticketSpatialCore);
    
    // 3. 主体一致性校验：是否属于同一明确被诉对象
    const cleanThemeSubj = (theme.canonicalSubject || "").trim();
    const cleanTicketSubj = (newTicket.canonicalSubject || "").trim();
    const isSubjectMatch =
      cleanThemeSubj.length >= 4 &&
      cleanTicketSubj.length >= 4 &&
      (cleanThemeSubj.includes(cleanTicketSubj) || cleanTicketSubj.includes(cleanThemeSubj));

    // 空间必须一致，或者主体高度一致
    if (!isSpatialMatch && !isSubjectMatch) {
      continue;
    }

    // 4. 业务类型相关性校验（城市管理、生态环境等同类诉求）
    const isCategoryCompatible =
      !newTicket.sourceCategory ||
      !theme.category ||
      theme.category === newTicket.sourceCategory ||
      theme.category === "城市管理" ||
      newTicket.sourceCategory === "城市管理";

    if (!isCategoryCompatible) {
      continue;
    }

    // 5. 滑动时间窗口核验（基于最后一个事件发生时间 lastOccurrence，而非第一次）
    const lastThemeEventTime = safeParseDate(theme.lastOccurrence || theme.firstOccurrence);
    const hoursSinceLast = Math.abs(differenceInHours(ticketTime, lastThemeEventTime));

    if (hoursSinceLast > slidingWindow) {
      // 虽同地但距上次反映已超过 72 小时，视为新独立事件
      continue;
    }

    // ----------------------------------------------------
    // 命中成功！执行增量吸附
    // ----------------------------------------------------
    newTicket.clusterId = theme.id;
    theme.tickets.push(newTicket);
    theme.ticketCount = theme.tickets.length;
    // 刷新最后一次反映时间为该新工单时间（滑动窗口向前推移）
    if (ticketTime > lastThemeEventTime) {
      theme.lastOccurrence = newTicket.createTime;
    }

    // 6. 质变升级研判：研判是否需要触发 System-2 慢思考增量重推
    const hasExtremeHazard = negativeTermsPattern().test(newTicket.content || "");
    const crossedRiskThreshold = theme.ticketCount >= RULES.risk.highCount && theme.riskLevel !== "HIGH";
    
    let needDeepThinkingUpgrade = false;
    let upgradeReason: string | undefined;

    if (hasExtremeHazard && theme.riskLevel !== "HIGH") {
      needDeepThinkingUpgrade = true;
      upgradeReason = `新工单反映突发严重险情关键字（如塌陷/事故/伤亡/断水断电），诉求性质升级！`;
    } else if (crossedRiskThreshold) {
      needDeepThinkingUpgrade = true;
      upgradeReason = `工单数量达到 ${theme.ticketCount} 件，突破高风险群体事件阈值！`;
    }

    return {
      action: "ATTACHED",
      matchedThemeId: theme.id,
      matchedTheme: theme,
      reason: `匹配活跃主题 [${theme.id}: ${theme.title}]：空间核心 [${theme.canonicalLocation}] 一致，距上次发生仅 ${hoursSinceLast} 小时 (<= ${slidingWindow}h 滑动窗口)，状态正在处置中。`,
      needDeepThinkingUpgrade,
      upgradeReason,
    };
  }

  // 7. 未匹配任何存量活跃主题，判定为独立待办单
  return {
    action: "STANDALONE",
    reason: "未匹配到处于 72 小时滑动窗口内的同空间/同主体活跃主题，作为独立诉求流转。",
    needDeepThinkingUpgrade: false,
  };
}

/**
 * 触发 System-2 对质变升级的主题进行增量慢思考（仅在升级时调用）
 */
export async function upgradeThemeWithSystemTwo(
  theme: MultiFrequencyTheme
): Promise<MultiFrequencyTheme> {
  const systemTwo = await getSystemTwoEngine();
  const prompt = buildBatchThemeEnrichmentPrompt([theme]);

  const { data, reasoning } = await systemTwo.createJSON(
    BatchThemeEnrichmentSchema,
    {
      messages: [{ role: "user", content: prompt }],
      enableThinking: true,
      maxTokens: LLM_TOKENS.THINKING_SUMMARY,
      temperature: 0.2,
    }
  );

  if (data?.results?.[0]) {
    const res = data.results[0];
    theme.riskLevel = (res.riskLevel as RiskLevel) || "HIGH";
    theme.riskReason = res.riskReason || theme.riskReason;
    theme.aiSummary = res.aiSummary || theme.aiSummary;
    theme.recommendedAction = res.recommendedAction || theme.recommendedAction;
    theme.reasoningContent = reasoning;
  }

  return theme;
}
