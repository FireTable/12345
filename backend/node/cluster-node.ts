import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type {
  TicketRadarState,
  EnrichedTicket,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";

function safeParseDate(dateStr: string): Date {
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  return new Date();
}

/**
 * Cluster Node: Groups tickets by (canonicalSubject + eventType) & Graph Connectivities
 */
export async function clusterNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets;
  const groups = new Map<string, EnrichedTicket[]>();

  for (const ticket of enrichedTickets) {
    const key = `${ticket.canonicalSubject}::${ticket.eventType}`;
    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key)!.push(ticket);
  }

  const themes: MultiFrequencyTheme[] = [];
  const MULTI_FREQ_THRESHOLD = 3;

  for (const [key, tickets] of groups.entries()) {
    if (tickets.length >= MULTI_FREQ_THRESHOLD) {
      tickets.sort(
        (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
      );

      const firstTime = tickets[0].createTime;
      const lastTime = tickets[tickets.length - 1].createTime;
      const timeSpanHours = Math.max(
        1,
        differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
      );

      const canonicalSubject = tickets[0].canonicalSubject;
      const canonicalLocation = tickets[0].canonicalLocation;
      const eventType = tickets[0].eventType;

      let riskLevel: RiskLevel = "LOW";
      let riskReason = "常规多频民生工单，诉求相对稳定";
      let recommendedAction = "转派所属辖区居委会及责任部门限期核实跟进。";

      if (
        eventType.includes("水管") ||
        eventType.includes("电梯") ||
        tickets.length >= 9 ||
        (tickets.length >= 5 && timeSpanHours <= 12)
      ) {
        riskLevel = "HIGH";
        if (eventType.includes("水管")) {
          riskReason = `突发紧急事件：${timeSpanHours}小时内集中爆发${tickets.length}单，引发大面积停水与交通瘫痪！`;
          recommendedAction = "建议启动政务热线突发事件加急响应机制，联动水务集团抢修队、交警支队开展应急调度与现场交通疏导。";
        } else if (eventType.includes("电梯")) {
          riskReason = `特种设备安全高危隐患：涉及人员滑梯受惊与电梯困人，多名居民连续强烈投诉！`;
          recommendedAction = "建议转派区市场监督管理局特种设备安全科，下达安全监察指令书，责令暂停运行并由第三方全面复检。";
        } else {
          riskReason = `超高频扰民警报：近${timeSpanHours}小时内累计投诉高达${tickets.length}次，舆情升级风险高！`;
          recommendedAction = "建议区住建局与生态环境局成立联合督办组，约谈项目总包负责人并依法暂停夜间施工许可资质。";
        }
      } else if (tickets.length >= 5 || eventType.includes("占道") || eventType.includes("油烟")) {
        riskLevel = "MEDIUM";
        riskReason = `多频集中反复诉求：涉及${tickets.length}位不同市民反映，存在执法巡查后回潮现象。`;
        recommendedAction = "建议街道综合执法队设立常态化巡查岗，联动居委会与商管部门划定疏导区域或加装抓拍监控。";
      }

      const themeId = `THEME-${themes.length + 1}`;
      const uniqueDistricts = Array.from(new Set(tickets.map((t) => t.subdistrict))).join("、");
      const title = `${canonicalSubject} — ${eventType}`;

      const aiSummary = `系统从 ${tickets.length} 张市民工单中聚类发现：位于【${canonicalLocation}】的【${canonicalSubject}】在 ${timeSpanHours} 小时内被不同市民多频投诉（涵盖${uniqueDistricts}）。主要诉求集中于“${eventType}”，多位市民反映存在反复发生或处置不及时的问题。`;

      tickets.forEach((t) => {
        t.clusterId = themeId;
      });

      themes.push({
        id: themeId,
        title,
        canonicalSubject,
        canonicalLocation,
        eventType,
        category: tickets[0].themes[0] || "综合民生",
        riskLevel,
        riskReason,
        ticketCount: tickets.length,
        timeSpanHours,
        firstOccurrence: firstTime,
        lastOccurrence: lastTime,
        aiSummary,
        recommendedAction,
        tickets,
        relatedSubjects: Array.from(new Set(tickets.map((t) => t.entities[0]?.name || t.canonicalSubject))),
        relatedLocations: Array.from(new Set(tickets.map((t) => t.canonicalLocation))),
        status: "UNCHECKED",
      });
    }
  }

  const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  themes.sort((a, b) => {
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.ticketCount - a.ticketCount;
  });

  return {
    themes,
    status: "clustering",
  };
}
