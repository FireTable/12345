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
import { civicModeFromPattern, deriveThemeMetrics, inferPatternType } from "../theme-metrics";
import { validateAndFilterThemes } from "./cluster-validator";
import { getRegionVocabulary } from "@/lib/vocabulary";

function safeParseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  return new Date();
}

/**
 * 校验是否为有效的具体业务实体（排除空泛虚词）
 */
function isValidSpecificSubject(subject: string): boolean {
  if (!subject) return false;
  const s = subject.trim();
  if (s.length < 2) return false;
  if ((RULES.genericSubjects as readonly string[]).includes(s)) return false;
  if (RULES.genericSubjectSuffix.test(s)) return false;
  return true;
}

/**
 * 校验是否为有效的微观具体地点（必须包含小区/门牌/路段/地标，而非泛区划）
 */
function isSpecificMicroLocation(location: string): boolean {
  if (!location) return false;
  const loc = location.trim();
  if (loc.length < 5) return false;
  if (RULES.locationNoise.test(loc)) return false;
  if (RULES.adminOnlyLocation.test(loc)) return false;
  return RULES.microLocationHint.test(loc);
}

/**
 * Cluster Node: 严谨精准的多频主题智能聚类引擎
 * 严格支持两大真实政务业务场景：
 * 1. 【主体型多频】：同一明确涉事方（如同一个车牌/同一家民宿/同一个物业）的多次/群发投诉；
 * 2. 【微观地点型多频】：同一具体微观物理空间（同一小区/门牌/具体路段）的群发共性民生治理事件。
 * 绝不允许跨主体、跨地点的乱绑定与乱拉郎配！
 */
import { updateTaskProgress } from "@/lib/task-progress";

export async function clusterNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];
  const taskId = state.taskId;

  if (taskId) {
    updateTaskProgress(taskId, {
      stage: "CLUSTERING",
      stageText: `正在构建多频知识图谱连通子图 (输入 ${enrichedTickets.length} 条已富化工单)...`,
      percent: 72,
    });
  }

  if (enrichedTickets.length === 0) {
    return { themes: [], status: "clustering" };
  }

  const themes: MultiFrequencyTheme[] = [];
  const assignedTicketIds = new Set<string>();

  // ==========================================
  // 模式 1：【同一明确涉事主体】多频共性聚类
  // ==========================================
  const subjectGroupMap = new Map<string, EnrichedTicket[]>();
  for (const ticket of enrichedTickets) {
    const subj = (ticket.canonicalSubject || "").trim();
    if (!isValidSpecificSubject(subj)) continue;

    if (!subjectGroupMap.has(subj)) {
      subjectGroupMap.set(subj, []);
    }
    subjectGroupMap.get(subj)!.push(ticket);
  }

  for (const [subj, tickets] of subjectGroupMap.entries()) {
    if (tickets.length >= RULES.minClusterSize) {
      tickets.forEach((t) => assignedTicketIds.add(t.id));
      tickets.sort(
        (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
      );

      const firstTime = tickets[0].createTime;
      const lastTime = tickets[tickets.length - 1].createTime;
      const timeSpanHours = Math.max(
        1,
        differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
      );

      const eventType = tickets[0].eventType || "多频诉求跟进";
      const distinctLocations = Array.from(new Set(tickets.map((t) => t.canonicalLocation).filter(Boolean)));
      const canonicalLocation = distinctLocations.length === 1 ? distinctLocations[0] : `${distinctLocations[0]} 等多处`;

      const themeId = `THEME-${themes.length + 1}`;
      const title = `${subj} — ${eventType}`;

      tickets.forEach((t) => {
        t.clusterId = themeId;
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
      const metrics = deriveThemeMetrics({
        eventType,
        canonicalLocation,
        tickets,
        patternType,
      });

      themes.push({
        id: themeId,
        title,
        canonicalSubject: subj,
        canonicalLocation,
        eventType,
        category: (tickets[0].themes && tickets[0].themes[0]) || RULES.defaultCategory,
        riskLevel,
        patternType,
        civicMode: civicModeFromPattern(patternType),
        riskReason:
          reopenCount > 0
            ? `疑似假闭环：办结 ${RULES.fakeClosure.windowDays} 天内同主体再次投诉 ${reopenCount} 次`
            : `重点主体多频诉求：同一涉事主体在 ${timeSpanHours} 小时内集中被市民反映 ${tickets.length} 次`,
        ticketCount: tickets.length,
        timeSpanHours,
        firstOccurrence: firstTime,
        lastOccurrence: lastTime,
        aiSummary: `多频研判发现：涉事主体【${subj}】在 ${timeSpanHours} 小时内累计被市民诉求反映 ${tickets.length} 次，集中在【${canonicalLocation}】，主要矛盾焦点为“${eventType}”。`,
        recommendedAction: `建议转派所属辖区行业主管部门对【${subj}】开展专项核查，2个工作日内责令整改并向市民书面反馈办理进展。`,
        tickets,
        relatedSubjects: [subj],
        relatedLocations: distinctLocations,
        status: "UNCHECKED",
        reopenCount,
        reopenTicketIds,
        aiConfidence: metrics.aiConfidence,
        features: metrics.features,
        radar: metrics.radar,
        trendPct: metrics.trendPct,
        handlingStatus: "未处理",
        handlingProgress: 0,
      });
    }
  }

  // ==========================================
  // 模式 2：【同一微观物理地点】群发共性问题聚类
  // ==========================================
  const unassignedTickets = enrichedTickets.filter((t) => !assignedTicketIds.has(t.id));
  const locationEventMap = new Map<string, EnrichedTicket[]>();

  for (const ticket of unassignedTickets) {
    const loc = (ticket.canonicalLocation || "").trim();
    if (!isSpecificMicroLocation(loc)) continue;

    if (!locationEventMap.has(loc)) {
      locationEventMap.set(loc, []);
    }
    locationEventMap.get(loc)!.push(ticket);
  }

  for (const [microLocation, tickets] of locationEventMap.entries()) {
    if (tickets.length >= RULES.minClusterSize) {
      tickets.forEach((t) => assignedTicketIds.add(t.id));
      tickets.sort(
        (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
      );

      const firstTime = tickets[0].createTime;
      const lastTime = tickets[tickets.length - 1].createTime;
      const timeSpanHours = Math.max(
        1,
        differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
      );

      const eventType = tickets[0].eventType || "区域集中诉求";
      const distinctSubjects = Array.from(new Set(tickets.map((t) => t.canonicalSubject).filter(isValidSpecificSubject)));
      const canonicalSubject = distinctSubjects.length > 0 ? distinctSubjects.join("、") : `${microLocation}周边涉事对象`;

      const themeId = `THEME-${themes.length + 1}`;
      const title = `${microLocation} — ${eventType}群发共性问题`;

      tickets.forEach((t) => {
        t.clusterId = themeId;
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
      const metrics = deriveThemeMetrics({
        eventType,
        canonicalLocation: microLocation,
        tickets,
        patternType,
      });
      const category = (tickets[0].themes && tickets[0].themes[0]) || RULES.defaultCategory;

      themes.push({
        id: themeId,
        title,
        canonicalSubject,
        canonicalLocation: microLocation,
        eventType,
        category,
        riskLevel,
        patternType,
        civicMode: civicModeFromPattern(patternType),
        riskReason:
          reopenCount > 0
            ? `疑似假闭环：办结 ${RULES.fakeClosure.windowDays} 天内同地点再次投诉 ${reopenCount} 次`
            : `区域微观点位群发：位于【${microLocation}】在 ${timeSpanHours} 小时内集中出现 ${tickets.length} 件同类诉求`,
        ticketCount: tickets.length,
        timeSpanHours,
        firstOccurrence: firstTime,
        lastOccurrence: lastTime,
        aiSummary: `区域态势研判发现：微观地点【${microLocation}】在 ${timeSpanHours} 小时内出现 ${tickets.length} 起“${eventType}”群发反映，涉及【${canonicalSubject}】，呈现明显的空间点位聚集性。`,
        recommendedAction: `建议属地综合行政执法队联合网格力量对【${microLocation}】点位开展集中现场整治与定点排查。`,
        tickets,
        relatedSubjects: distinctSubjects.length > 0 ? distinctSubjects : [canonicalSubject],
        relatedLocations: [microLocation],
        status: "UNCHECKED",
        reopenCount,
        reopenTicketIds,
        aiConfidence: metrics.aiConfidence,
        features: metrics.features,
        radar: metrics.radar,
        trendPct: metrics.trendPct,
        handlingStatus: "未处理",
        handlingProgress: 0,
      });
    }
  }

  // ==========================================
  // 3. 严格真实性与质量交叉质检（Cluster Validator）
  // ==========================================
  const regionVocab = await getRegionVocabulary(state.regionId);
  const validatedThemes = validateAndFilterThemes(themes, enrichedTickets, regionVocab);

  // ==========================================
  // 4. 排序与结构输出（高风险与高频次优先）
  // ==========================================
  const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  validatedThemes.sort((a, b) => {
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.ticketCount - a.ticketCount;
  });

  return {
    themes: validatedThemes,
    status: "clustering",
  };
}
