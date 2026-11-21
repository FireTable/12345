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

function parseDateOrNull(dateStr: string | Date | undefined | null): Date | null {
  if (!dateStr) return null;
  if (dateStr instanceof Date) {
    return isValid(dateStr) ? dateStr : null;
  }
  const trimmed = String(dateStr).trim();
  if (!trimmed) return null;
  const d1 = parse(trimmed, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(trimmed);
  if (isValid(d2)) return d2;
  const d3 = new Date(trimmed);
  return isValid(d3) ? d3 : null;
}

export interface IncrementalClusterResult {
  action: "ATTACHED" | "STANDALONE";
  matchedThemeId?: string;
  matchedTheme?: MultiFrequencyTheme;
  reason: string;
  needDeepThinkingUpgrade: boolean;
  upgradeReason?: string;
  cadence?: ThemeCadence;
  recurredAfterClose?: boolean;
  fakeClosureDetected?: boolean;
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
  const ticketTime = parseDateOrNull(newTicket.createTime) ?? new Date();
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
        content: [theme.canonicalSubject, theme.canonicalLocation, theme.aiSummary, theme.recommendedAction]
          .filter(Boolean)
          .join("\n"),
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

    const lastThemeEventTime =
      parseDateOrNull(theme.lastOccurrence) ?? parseDateOrNull(theme.firstOccurrence);
    const firstThemeEventTime =
      parseDateOrNull(theme.firstOccurrence) ?? parseDateOrNull(theme.lastOccurrence);
    const hoursSinceLast = lastThemeEventTime
      ? Math.abs(differenceInHours(ticketTime, lastThemeEventTime))
      : 0;
    const recurredAfterClose = normalizeStatusCode(theme.handlingStatus) === HANDLING_STATUS.RESOLVED;
    const closeRefRaw = theme.closedAt || theme.handlingEta || theme.lastOccurrence || theme.firstOccurrence;
    const closeRefTime = parseDateOrNull(closeRefRaw);
    const daysSinceClose = closeRefTime
      ? (ticketTime.getTime() - closeRefTime.getTime()) / (24 * 60 * 60 * 1000)
      : null;
    const withinFakeClosureWindow =
      recurredAfterClose &&
      daysSinceClose !== null &&
      daysSinceClose >= -1 &&
      daysSinceClose <= RULES.fakeClosure.windowDays;

    const initialRiskReason = theme.riskReason || "";
    newTicket.clusterId = theme.id;
    const loadedMembers = theme.tickets.length;
    const previousCount = theme.ticketCount || 0;
    theme.tickets.push(newTicket);
    theme.ticketCount = attachedMemberCount(previousCount, loadedMembers);
    const ticketTimeStr = (newTicket.createTime || "").trim() || ticketTime.toISOString();
    if (!lastThemeEventTime || ticketTime > lastThemeEventTime) {
      theme.lastOccurrence = ticketTimeStr;
    }
    if (!firstThemeEventTime || ticketTime < firstThemeEventTime) {
      theme.firstOccurrence = ticketTimeStr;
    }
    const finalFirst = parseDateOrNull(theme.firstOccurrence);
    const finalLast = parseDateOrNull(theme.lastOccurrence);
    theme.timeSpanHours =
      finalFirst && finalLast
        ? Math.max(1, differenceInHours(finalLast, finalFirst))
        : Math.max(1, theme.timeSpanHours || 1);
    if (recurredAfterClose) {
      theme.reopenCount = (theme.reopenCount || 0) + 1;
      theme.reopenTicketIds = [...(theme.reopenTicketIds || []), newTicket.id];
    }
    if (withinFakeClosureWindow) {
      newTicket.isFakeClosure = true;
      newTicket.closureStatus = "REOPENED";
      theme.handlingStatus = HANDLING_STATUS.IN_PROGRESS;
      theme.handlingProgress = 40;
      theme.riskLevel = "HIGH";
      const fakeNote = `已办结主题在 ${RULES.fakeClosure.windowDays} 天复发窗口期内再次收到同类诉求，判定疑似假闭环并自动重开升级为高风险`;
      if (!theme.riskReason?.includes("疑似假闭环")) {
        theme.riskReason = theme.riskReason ? `${theme.riskReason}；${fakeNote}` : fakeNote;
      }
    }
    const cadence = describeCadence([
      theme.firstOccurrence,
      theme.lastOccurrence,
      ...theme.tickets.map((ticket) => ticket.createTime),
    ]);

    // 6. 质变升级研判：研判是否需要触发 System-2 慢思考增量重推
    const hasExtremeHazard = negativeTermsPattern().test(
      `${newTicket.title || ""}\n${newTicket.content || ""}`
    );
    const crossedRiskThreshold = theme.ticketCount >= RULES.risk.highCount && theme.riskLevel !== "HIGH";
    const highCount = Math.max(1, RULES.risk.highCount);
    const surgeMilestones = [highCount * 2, highCount * 4, highCount * 8, highCount * 16];
    const hitSurgeMilestone = surgeMilestones.some(
      (m) => previousCount < m && theme.ticketCount >= m
    );
    const missingAdvice = !theme.aiSummary?.trim() || !theme.recommendedAction?.trim();

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
    } else if (theme.riskLevel === "HIGH") {
      if (hasExtremeHazard && !initialRiskReason.includes("突发严重险情")) {
        needDeepThinkingUpgrade = true;
        upgradeReason = `高风险主题新增突发严重险情关键字（如塌陷/事故/伤亡/断水断电），需立即刷新应急处置预案！`;
        theme.riskReason = theme.riskReason
          ? `${theme.riskReason}；${upgradeReason}`
          : upgradeReason;
      } else if (withinFakeClosureWindow && !initialRiskReason.includes("疑似假闭环")) {
        needDeepThinkingUpgrade = true;
        upgradeReason = `已办结高风险主题触发假闭环复发重开，需重新生成督办处置建议！`;
      } else if (hitSurgeMilestone) {
        needDeepThinkingUpgrade = true;
        upgradeReason = `高风险主题诉求量突破 ${theme.ticketCount} 件，触发阶段性升级复盘与处置建议刷新！`;
      } else if (missingAdvice) {
        needDeepThinkingUpgrade = true;
        upgradeReason = `高风险主题缺失摘要或处置建议，触发智能补全！`;
      }
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
      recurredAfterClose,
      fakeClosureDetected: withinFakeClosureWindow,
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
  const promptTheme =
    theme.tickets.length > 2
      ? { ...theme, tickets: theme.tickets.slice(-2) }
      : theme;
  const prompt = buildBatchThemeEnrichmentPrompt([promptTheme]);

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
      if (res?.recommendedAction?.trim()) break;
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
