import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type {
  TicketRadarState,
  EnrichedTicket,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";
import { markFakeClosures } from "./fake-closure";
import { deriveRiskLevel, scanNegativeSentiment } from "./risk-rules";
import { RULES } from "../rules";
import { cadenceLabel, civicModeFromPattern, deriveThemeMetrics, describeCadence, inferPatternType } from "../theme-metrics";
import { validateAndFilterThemes } from "./cluster-validator";
import { getRegionVocabulary } from "@/lib/vocabulary";
import { updateTaskProgress } from "@/lib/task-progress";
import { HANDLING_STATUS } from "@/lib/civic-dto";
import { clusterIncidents, familyLabel, profileTicket } from "../ticket-profile";

function safeParseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  return new Date();
}

/**
 * 全量聚类：只合并同一类事，并且主体或地点对得上的工单。
 * 同一标题下的无关诉求各自成单，不进入多频主题。
 */
export async function clusterNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];
  const taskId = state.taskId;

  if (taskId) {
    updateTaskProgress(taskId, {
      stage: "CLUSTERING",
      stageText: `正在按同一事件归并工单 (输入 ${enrichedTickets.length} 条)...`,
      percent: 72,
    });
  }

  if (enrichedTickets.length === 0) {
    return { themes: state.themes || [], status: "clustering" };
  }

  const regionVocab = await getRegionVocabulary(state.regionId);
  for (const ticket of enrichedTickets) {
    ticket.clusterId = undefined;
    const profile = profileTicket(ticket, regionVocab.townships);
    ticket.sourceCategory = profile.category || undefined;
    ticket.themes = profile.category ? [profile.category] : [];
    if (profile.township) ticket.subdistrict = profile.township;
    if (profile.subject) ticket.canonicalSubject = profile.subject;
    if (profile.place) ticket.canonicalLocation = profile.place;
    if (profile.family) ticket.eventType = familyLabel(profile.family);
  }

  const themes: MultiFrequencyTheme[] = [];
  const groups = clusterIncidents(enrichedTickets, (ticket) =>
    profileTicket(ticket, regionVocab.townships)
  );

  for (const group of groups) {
    const tickets = [...group.members].sort(
      (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
    );
    const firstTime = tickets[0].createTime;
    const lastTime = tickets[tickets.length - 1].createTime;
    const timeSpanHours = Math.max(
      1,
      differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
    );
    const themeId = `THEME-${themes.length + 1}`;
    const eventType = familyLabel(group.family) || "同类诉求";
    const anchor = !group.anchor || group.anchor === group.family ? eventType : group.anchor;
    const location = group.place
      ? [group.township, group.place].filter(Boolean).join("")
      : [group.township, anchor === eventType ? "" : anchor].filter(Boolean).join("") || anchor;
    const title =
      anchor === eventType
        ? [group.township, eventType].filter(Boolean).join(" ")
        : [group.township, anchor, eventType].filter(Boolean).join(" · ");

    tickets.forEach((ticket) => {
      ticket.clusterId = themeId;
    });

    const { reopenCount, reopenTicketIds } = markFakeClosures(tickets);
    const patternType = inferPatternType(tickets);
    const hitNegative = scanNegativeSentiment(tickets);
    const riskLevel = deriveRiskLevel({
      ticketCount: tickets.length,
      patternType,
      hitNegative,
      reopenCount,
    });
    const cadence = describeCadence(tickets.map((ticket) => ticket.createTime));
    const metrics = deriveThemeMetrics({
      eventType,
      canonicalLocation: location,
      tickets,
      patternType,
    });
    const distinctSubjects = Array.from(
      new Set(tickets.map((ticket) => (ticket.canonicalSubject || "").trim()).filter(Boolean))
    );
    const distinctLocations = Array.from(
      new Set(tickets.map((ticket) => (ticket.canonicalLocation || "").trim()).filter(Boolean))
    );

    themes.push({
      id: themeId,
      title,
      canonicalSubject: anchor,
      canonicalLocation: location,
      eventType,
      category: group.category || "",
      riskLevel,
      patternType,
      civicMode: civicModeFromPattern(patternType),
      riskReason:
        reopenCount > 0
          ? `办结${RULES.fakeClosure.windowDays}天内再次诉求（${reopenCount}次，${cadenceLabel(cadence)}）`
          : `同一事件重复反映（${tickets.length}件，${cadenceLabel(cadence)}）`,
      ticketCount: tickets.length,
      timeSpanHours,
      firstOccurrence: firstTime,
      lastOccurrence: lastTime,
      aiSummary: "",
      recommendedAction: "",
      tickets,
      relatedSubjects: distinctSubjects.length > 0 ? distinctSubjects : [anchor],
      relatedLocations: distinctLocations.length > 0 ? distinctLocations : [location],
      status: "UNCHECKED",
      reopenCount,
      reopenTicketIds,
      aiConfidence: metrics.aiConfidence,
      features: metrics.features,
      radar: metrics.radar,
      trendPct: metrics.trendPct,
      handlingStatus: HANDLING_STATUS.PENDING,
      handlingProgress: 0,
    });
  }

  const validatedThemes = validateAndFilterThemes(themes, enrichedTickets, regionVocab);
  const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  validatedThemes.sort((a, b) => {
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.ticketCount - a.ticketCount;
  });

  return {
    themes: validatedThemes,
    enrichedTickets,
    status: "clustering",
  };
}
