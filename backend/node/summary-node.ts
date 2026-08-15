import type {
  TicketRadarState,
  OverallStats,
  GraphData,
  GraphNode,
  GraphLink,
} from "../state";

/**
 * Summary Node: Calculates metrics, compression ratio, and builds ForceGraph topology
 */
export async function summaryNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets;
  const themes = state.themes;
  const enrichedTickets = state.enrichedTickets;

  const totalTickets = rawTickets.length;
  const multiFrequencyTickets = themes.reduce((acc, t) => acc + t.ticketCount, 0);
  const multiFrequencyRate = totalTickets > 0 ? Math.round((multiFrequencyTickets / totalTickets) * 100) : 0;
  const compressionRatio = totalTickets > 0 ? Math.round(((totalTickets - themes.length) / totalTickets) * 100) : 0;
  const highRiskCount = themes.filter((t) => t.riskLevel === "HIGH").length;
  const mediumRiskCount = themes.filter((t) => t.riskLevel === "MEDIUM").length;
  const lowRiskCount = themes.filter((t) => t.riskLevel === "LOW").length;
  const topSubject = themes[0]?.canonicalSubject || "无";

  const stats: OverallStats = {
    totalTickets,
    multiFrequencyTickets,
    multiFrequencyRate,
    themeCount: themes.length,
    highRiskCount,
    mediumRiskCount,
    lowRiskCount,
    compressionRatio,
    topSubject,
    avgResponseTimeSavedHours: 4.8,
  };

  // Build Force Graph
  const nodesMap = new Map<string, GraphNode>();
  const links: GraphLink[] = [];

  themes.forEach((theme) => {
    const themeColor =
      theme.riskLevel === "HIGH" ? "#f43f5e" : theme.riskLevel === "MEDIUM" ? "#f59e0b" : "#10b981";

    nodesMap.set(theme.id, {
      id: theme.id,
      name: theme.title,
      type: "THEME",
      val: Math.max(16, theme.ticketCount * 3),
      color: themeColor,
      riskLevel: theme.riskLevel,
      ticketCount: theme.ticketCount,
    });

    const subjectId = `SUBJ-${theme.canonicalSubject}`;
    if (!nodesMap.has(subjectId)) {
      nodesMap.set(subjectId, {
        id: subjectId,
        name: theme.canonicalSubject,
        type: "SUBJECT",
        val: 20,
        color: "#38bdf8",
      });
    }

    const locId = `LOC-${theme.canonicalLocation}`;
    if (!nodesMap.has(locId)) {
      nodesMap.set(locId, {
        id: locId,
        name: theme.canonicalLocation,
        type: "LOCATION",
        val: 14,
        color: "#a855f7",
      });
    }

    links.push({
      source: theme.id,
      target: subjectId,
      relation: "核心被诉主体",
    });
    links.push({
      source: subjectId,
      target: locId,
      relation: "所属区域",
    });

    theme.tickets.forEach((ticket) => {
      const ticketNodeId = `TK-${ticket.id}`;
      nodesMap.set(ticketNodeId, {
        id: ticketNodeId,
        name: `${ticket.ticketNo} (${ticket.citizenName})`,
        type: "TICKET",
        val: 7,
        color: "#94a3b8",
        meta: ticket,
      });

      links.push({
        source: ticketNodeId,
        target: theme.id,
        relation: "归属多频主题",
      });
    });
  });

  const graphData: GraphData = {
    nodes: Array.from(nodesMap.values()),
    links,
  };

  return {
    stats,
    graphData,
    status: "completed",
  };
}
