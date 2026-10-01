/**
 * 新来的单张工单并入已有主题。
 * 同一件事就并入，不按相隔多久拆开。时间只记这团事情是突发、反复还是季节性。
 * 已办结表示上一轮办理结束，后来又反映仍是同一主题下的复发。
 */

import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type { EnrichedTicket, MultiFrequencyTheme, RiskLevel } from "./state";
import { negativeTermsPattern, RULES } from "./rules";
import { getSystemTwoEngine } from "./model";
import { LLM_TOKENS } from "@/lib/tokens";
import { BatchThemeEnrichmentSchema, buildBatchThemeEnrichmentPrompt } from "./prompt";
import { familyLabel, incidentsMatch, profileTicket } from "./ticket-profile";
import { CADENCE, cadenceLabel, describeCadence, type ThemeCadence } from "./theme-metrics";
import { loadPresetVocabulary, type TownshipInfo } from "@/lib/vocabulary";
import { HANDLING_STATUS, normalizeStatusCode } from "@/lib/civic-dto";

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
  cadence?: ThemeCadence;
}

/**
 * 同一件事并入已有主题。驳回的主题不再接收。
 */
export function evaluateIncrementalTicket(
  newTicket: EnrichedTicket,
  activeThemes: MultiFrequencyTheme[],
  options?: { townships?: TownshipInfo[] }
): IncrementalClusterResult {
  const townships = options?.townships ?? loadPresetVocabulary().townships;
  const ticketTime = safeParseDate(newTicket.createTime);
  const incoming = profileTicket(
    {
      title: newTicket.title,
      content: [newTicket.content, newTicket.canonicalLocation, newTicket.address].filter(Boolean).join("\n"),
      subdistrict: newTicket.subdistrict,
    },
    townships
  );

  for (const theme of activeThemes) {
    if (theme.status === "DISMISSED") continue;

    const active = profileTicket(
      {
        title: [theme.eventType, theme.title].filter(Boolean).join(" "),
        content: [theme.canonicalSubject, theme.canonicalLocation].filter(Boolean).join("\n"),
        subdistrict: theme.canonicalLocation,
      },
      townships
    );
    if (!incidentsMatch(incoming, active)) continue;

    const lastThemeEventTime = safeParseDate(theme.lastOccurrence || theme.firstOccurrence);
    const hoursSinceLast = Math.abs(differenceInHours(ticketTime, lastThemeEventTime));
    const recurredAfterClose = normalizeStatusCode(theme.handlingStatus) === HANDLING_STATUS.RESOLVED;

    newTicket.clusterId = theme.id;
    theme.tickets.push(newTicket);
    theme.ticketCount = theme.tickets.length;
    if (ticketTime > lastThemeEventTime) {
      theme.lastOccurrence = newTicket.createTime;
    }
    const firstThemeEventTime = safeParseDate(theme.firstOccurrence);
    if (ticketTime < firstThemeEventTime) {
      theme.firstOccurrence = newTicket.createTime;
    }
    theme.timeSpanHours = Math.max(
      1,
      differenceInHours(
        safeParseDate(theme.lastOccurrence),
        safeParseDate(theme.firstOccurrence)
      )
    );
    if (recurredAfterClose) {
      theme.reopenCount = (theme.reopenCount || 0) + 1;
      theme.reopenTicketIds = [...(theme.reopenTicketIds || []), newTicket.id];
    }
    const cadence = describeCadence(theme.tickets.map((ticket) => ticket.createTime));

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

    const rhythm =
      cadence === CADENCE.SEASONAL
        ? `距上次 ${hoursSinceLast} 小时，中间空了很久，节奏记为${cadenceLabel(cadence)}`
        : `距上次 ${hoursSinceLast} 小时，节奏记为${cadenceLabel(cadence)}`;
    const familyName = familyLabel(incoming.family) || familyLabel(active.family) || "同类诉求";

    return {
      action: "ATTACHED",
      matchedThemeId: theme.id,
      matchedTheme: theme,
      cadence,
      reason: `同一事件并入 [${theme.id}: ${theme.title}]（${familyName}）。${rhythm}${
        recurredAfterClose ? "。上一轮已办结，本次按复发并入" : ""
      }。`,
      needDeepThinkingUpgrade,
      upgradeReason,
    };
  }

  return {
    action: "STANDALONE",
    reason: "没有对得上的同一事件主题，作为独立诉求留下。",
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
