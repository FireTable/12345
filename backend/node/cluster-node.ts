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
import { getRegionVocabulary, legalTownshipName } from "@/lib/vocabulary";
import { updateTaskProgress } from "@/lib/task-progress";
import { stagePercent } from "@/lib/pipeline-progress";
import { HANDLING_STATUS } from "@/lib/civic-dto";
import { profileTicket } from "../ticket-profile";
import { chooseThemeAnchor, clusterLinked } from "../same-incident-cluster";
import { embedTextsWithRetry, extractionProductText } from "../embed-products";

function majority(values: Array<string | null | undefined>): string | null {
  const counts = new Map<string, number>();
  for (const value of values) {
    const text = (value || "").trim();
    if (!text) continue;
    counts.set(text, (counts.get(text) || 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [value, count] of counts) {
    if (count > n) {
      best = value;
      n = count;
    }
  }
  return best;
}

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
  const regionId = state.regionId;

  if (taskId) {
    updateTaskProgress(taskId, regionId, {
      stage: "CLUSTERING",
      stageText: `正在按同一事件归并工单 (输入 ${enrichedTickets.length} 条)...`,
      percent: stagePercent("CLUSTER", 0, Math.max(1, enrichedTickets.length), "min"),
    });
  }

  if (enrichedTickets.length === 0) {
    return { themes: state.themes || [], status: "clustering" };
  }

  const regionVocab = await getRegionVocabulary(state.regionId);
  for (const ticket of enrichedTickets) {
    ticket.clusterId = undefined;
  }

  const productTexts = enrichedTickets.map((ticket) => extractionProductText(ticket));
  const vectors = await embedTextsWithRetry(productTexts);
  if (vectors.length !== enrichedTickets.length) {
    throw new Error(`Embedding rows ${vectors.length} != tickets ${enrichedTickets.length}`);
  }

  const themes: MultiFrequencyTheme[] = [];
  const groups = clusterLinked(enrichedTickets, (ticket, index) => ({
    profile: profileTicket(
      { title: ticket.title, content: ticket.content, subdistrict: ticket.subdistrict },
      regionVocab.townships
    ),
    category: ticket.sourceCategory || "",
    township:
      ticket.subdistrict ||
      legalTownshipName(`${ticket.canonicalLocation || ""}\n${ticket.content || ""}`, regionVocab) ||
      "",
    placeEvidence: [ticket.canonicalLocation, ticket.summarizeTitle, ticket.content].filter(Boolean).join("\n"),
    subject: ticket.canonicalSubject || "",
    vector: vectors[index] || [],
  }));

  for (const members of groups) {
    const tickets = [...members].sort(
      (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
    );
    const firstTime = tickets[0].createTime;
    const lastTime = tickets[tickets.length - 1].createTime;
    const timeSpanHours = Math.max(
      1,
      differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
    );
    const themeId = `THEME-${themes.length + 1}`;
    const eventType = majority(tickets.map((ticket) => ticket.eventType)) || "同类诉求";
    const township = majority(tickets.map((ticket) => ticket.subdistrict));
    const category = majority(tickets.map((ticket) => ticket.sourceCategory)) || "";
    const place = majority(tickets.map((ticket) => ticket.canonicalLocation));
    const anchor = chooseThemeAnchor({
      subjects: tickets.map((ticket) => ticket.canonicalSubject || ""),
      placeEvidence: tickets.map((ticket) =>
        [ticket.canonicalLocation, ticket.summarizeTitle, ticket.content].filter(Boolean).join("\n")
      ),
      eventType,
    });
    const location = place
      ? [township && place.includes(township) ? "" : township, place].filter(Boolean).join("")
      : [township, anchor === eventType ? "" : anchor].filter(Boolean).join("") || anchor;
    const title =
      anchor === eventType
        ? [township, eventType].filter(Boolean).join(" ")
        : [township, anchor, eventType].filter(Boolean).join(" · ");

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
      category,
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

  if (taskId) {
    const joined = validatedThemes.reduce((sum, theme) => sum + theme.ticketCount, 0);
    updateTaskProgress(taskId, regionId, {
      absorbedCount: joined,
      themeCount: validatedThemes.length,
      stageText: `同一事件归并完成，${validatedThemes.length} 个主题`,
    });
  }

  return {
    themes: validatedThemes,
    enrichedTickets,
    status: "clustering",
  };
}
