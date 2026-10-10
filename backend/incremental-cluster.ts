/**
 * 新来的单张工单并入已有主题。
 * 同一件事就并入，不按相隔多久拆开。时间只记这团事情是突发、反复还是季节性。
 * 已办结表示上一轮办理结束，后来又反映仍是同一主题下的复发。
 */

import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type { EnrichedTicket, MultiFrequencyTheme } from "./state";
import { negativeTermsPattern, RULES } from "./rules";
import { getSystemTwoEngine } from "./model";
import { LLM_TOKENS } from "@/lib/tokens";
import { BatchThemeEnrichmentSchema, buildBatchThemeEnrichmentPrompt, type BatchThemeEnrichmentResult } from "./prompt";
import { familyLabel, profileTicket } from "./ticket-profile";
import { shouldLinkIncidents } from "./same-incident-cluster";
import { attachedMemberCount } from "./embed-policy";
import { CADENCE, cadenceLabel, describeCadence, type ThemeCadence } from "./theme-metrics";
import { legalTownshipName, loadPresetVocabulary, type RegionVocabulary, type TownshipInfo } from "@/lib/vocabulary";
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
  options?: {
    townships?: TownshipInfo[];
    vocab?: RegionVocabulary;
    ticketVector?: number[];
    themeVectors?: Map<string, number[]>;
  }
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
  const explicitSubdistrict = (newTicket.subdistrict || "").trim();
  const ticketTownship = explicitSubdistrict
    ? legalTownshipName(explicitSubdistrict, options?.vocab) || explicitSubdistrict
    : "";
  if (ticketTownship) incoming.township = ticketTownship;

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
    const themeTownship =
      legalTownshipName(theme.canonicalLocation, options?.vocab) || active.township || "";
    const linked = shouldLinkIncidents(
      {
        profile: incoming,
        category: newTicket.sourceCategory || "",
        township: ticketTownship,
        placeEvidence: [newTicket.canonicalLocation, newTicket.summarizeTitle, newTicket.content]
          .filter(Boolean)
          .join("\n"),
        subject: newTicket.canonicalSubject || "",
        vector: options?.ticketVector || [],
      },
      {
        profile: active,
        category: theme.category || "",
        township: themeTownship,
        placeEvidence: [theme.canonicalLocation, theme.aiSummary, theme.title].filter(Boolean).join("\n"),
        subject: theme.canonicalSubject || "",
        vector: options?.themeVectors?.get(theme.id) || [],
      }
    );
    if (!linked) continue;

    const lastThemeEventTime = safeParseDate(theme.lastOccurrence || theme.firstOccurrence);
    const hoursSinceLast = Math.abs(differenceInHours(ticketTime, lastThemeEventTime));
    const recurredAfterClose = normalizeStatusCode(theme.handlingStatus) === HANDLING_STATUS.RESOLVED;

    newTicket.clusterId = theme.id;
    const loadedMembers = theme.tickets.length;
    const previousCount = theme.ticketCount || 0;
    theme.tickets.push(newTicket);
    theme.ticketCount = attachedMemberCount(previousCount, loadedMembers);
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
    const cadence = describeCadence([
      theme.firstOccurrence,
      theme.lastOccurrence,
      ...theme.tickets.map((ticket) => ticket.createTime),
    ]);

    // 6. 质变升级研判：研判是否需要触发 System-2 慢思考增量重推
    const hasExtremeHazard = negativeTermsPattern().test(newTicket.content || "");
    const crossedRiskThreshold = theme.ticketCount >= RULES.risk.highCount && theme.riskLevel !== "HIGH";
    
    let needDeepThinkingUpgrade = false;
    let upgradeReason: string | undefined;

    if (hasExtremeHazard && theme.riskLevel !== "HIGH") {
      needDeepThinkingUpgrade = true;
      upgradeReason = `新工单反映突发严重险情关键字（如塌陷/事故/伤亡/断水断电），诉求性质升级！`;
      theme.riskLevel = "HIGH";
      theme.riskReason = upgradeReason;
    } else if (crossedRiskThreshold) {
      needDeepThinkingUpgrade = true;
      upgradeReason = `工单数量达到 ${theme.ticketCount} 件，突破高风险群体事件阈值！`;
      theme.riskLevel = "HIGH";
      theme.riskReason = upgradeReason;
    }

    const rhythm =
      cadence === CADENCE.SAME_DAY
        ? `同一天，编号没有钟点，节奏记为${cadenceLabel(cadence)}`
        : cadence === CADENCE.SEASONAL
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
 * 险情升级后重写这一条主题的摘要和处置建议。思考关掉。风险等级保持本地规则刚写上的值。
 */
export async function upgradeThemeWithSystemTwo(
  theme: MultiFrequencyTheme
): Promise<MultiFrequencyTheme> {
  const riskLevel = theme.riskLevel;
  const riskReason = theme.riskReason;
  let advice = theme.recommendedAction || "";
  let summary = theme.aiSummary || "";
  const systemTwo = await getSystemTwoEngine();
  const prompt = buildBatchThemeEnrichmentPrompt([theme]);

  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { data } = await systemTwo.createJSON(BatchThemeEnrichmentSchema, {
        messages: [{ role: "user", content: prompt }],
        enableThinking: false,
        maxTokens: LLM_TOKENS.THEME_ADVICE,
        temperature: 0.2,
      });
      const res = (data as BatchThemeEnrichmentResult | null)?.results?.[0];
      if (res?.recommendedAction?.trim()) advice = res.recommendedAction;
      if (res?.aiSummary?.trim()) summary = res.aiSummary;
      if (advice.trim()) break;
    } catch (err: any) {
      console.warn(`[incremental] theme upgrade attempt ${attempt + 1}:`, err?.message);
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
  }

  theme.aiSummary = summary;
  theme.recommendedAction = advice;
  theme.riskLevel = riskLevel;
  theme.riskReason = riskReason;
  return theme;
}
