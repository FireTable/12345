import type {
  TicketRadarState,
  OverallStats,
  GraphData,
  GraphNode,
  GraphLink,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";
import { getChatModel } from "../model";

async function enrichThemeWithLLM(theme: MultiFrequencyTheme): Promise<Partial<MultiFrequencyTheme>> {
  try {
    const chat = getChatModel(0.1);
    const sampleTickets = theme.tickets.slice(0, 5);
    const prompt = `你是一位政务热线高级研判专家。请根据以下多频诉求数据（共${theme.ticketCount}件工单，历时${theme.timeSpanHours}小时），生成专业政务研判结果。

涉事主体：${theme.canonicalSubject}
发生地址：${theme.canonicalLocation}
事件类别：${theme.eventType}
工单样本：
${sampleTickets.map((t, i) => `${i + 1}. [${t.subdistrict} ${t.createTime}] ${t.content}`).join("\n")}

请严格仅输出以下 JSON 格式（不要包含任何 markdown 代码块外部的文字）：
{
  "riskLevel": "HIGH" | "MEDIUM" | "LOW",
  "riskReason": "简明扼要的风险归因说明，40字以内",
  "aiSummary": "深度公文全貌研判，分析矛盾痛点与诉求演化，100-140字",
  "recommendedAction": "精准政务处置建议，指出具体牵头职能部门/科室及处置时限要求，70-90字"
}`;

    const res = await chat.invoke(prompt);
    const rawText = String(res.content).trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      return {
        riskLevel: (["HIGH", "MEDIUM", "LOW"].includes(parsed.riskLevel) ? parsed.riskLevel : theme.riskLevel) as RiskLevel,
        riskReason: parsed.riskReason || theme.riskReason,
        aiSummary: parsed.aiSummary || theme.aiSummary,
        recommendedAction: parsed.recommendedAction || theme.recommendedAction,
      };
    }
  } catch (err: any) {
    console.warn(`LLM enrichment for theme ${theme.id} fallback:`, err.message);
  }
  return {};
}

/**
 * Summary Node: Performs LLM deep synthesis, calculates metrics, and builds ForceGraph topology
 */
export async function summaryNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets;
  const initialThemes = state.themes;

  // 1. LLM deep synthesis for top multi-frequency themes (concurrent with Promise.allSettled)
  const topThemesCount = Math.min(initialThemes.length, 6);
  const enrichedThemes = [...initialThemes];

  if (topThemesCount > 0 && process.env.OPENAI_API_KEY) {
    const promises = enrichedThemes.slice(0, topThemesCount).map((theme) => enrichThemeWithLLM(theme));
    const results = await Promise.allSettled(promises);

    results.forEach((res, idx) => {
      if (res.status === "fulfilled" && res.value) {
        enrichedThemes[idx] = {
          ...enrichedThemes[idx],
          ...res.value,
        };
      }
    });
  }

  // Re-sort by risk level & ticket count
  const riskOrder: Record<RiskLevel, number> = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  enrichedThemes.sort((a, b) => {
    if (riskOrder[a.riskLevel] !== riskOrder[b.riskLevel]) {
      return riskOrder[a.riskLevel] - riskOrder[b.riskLevel];
    }
    return b.ticketCount - a.ticketCount;
  });

  const totalTickets = rawTickets.length;
  const multiFrequencyTickets = enrichedThemes.reduce((acc, t) => acc + t.ticketCount, 0);
  const multiFrequencyRate = totalTickets > 0 ? Math.round((multiFrequencyTickets / totalTickets) * 100) : 0;
  const compressionRatio = totalTickets > 0 ? Math.round(((totalTickets - enrichedThemes.length) / totalTickets) * 100) : 0;
  const highRiskCount = enrichedThemes.filter((t) => t.riskLevel === "HIGH").length;
  const mediumRiskCount = enrichedThemes.filter((t) => t.riskLevel === "MEDIUM").length;
  const lowRiskCount = enrichedThemes.filter((t) => t.riskLevel === "LOW").length;
  const topSubject = enrichedThemes[0]?.canonicalSubject || "无";

  const stats: OverallStats = {
    totalTickets,
    multiFrequencyTickets,
    multiFrequencyRate,
    themeCount: enrichedThemes.length,
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

  enrichedThemes.forEach((theme) => {
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
    themes: enrichedThemes,
    stats,
    graphData,
    status: "completed",
  };
}
