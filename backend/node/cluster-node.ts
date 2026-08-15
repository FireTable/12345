import { differenceInHours, parse, parseISO, isValid } from "date-fns";
import type {
  TicketRadarState,
  EnrichedTicket,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";
import { getEmbeddingModel } from "../model";

function safeParseDate(dateStr: string): Date {
  if (!dateStr) return new Date();
  const d1 = parse(dateStr, "yyyy-MM-dd HH:mm:ss", new Date());
  if (isValid(d1)) return d1;
  const d2 = parseISO(dateStr);
  if (isValid(d2)) return d2;
  return new Date();
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Cluster Node: Fully AI Embedding & Semantic Driven Theme Clustering
 */
export async function clusterNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];
  if (enrichedTickets.length === 0) {
    return { themes: [], status: "clustering" };
  }

  const themes: MultiFrequencyTheme[] = [];
  const assignedTicketIds = new Set<string>();

  // 1. First Pass: Grouping by exact extracted Subject & Event
  const subjectEventMap = new Map<string, EnrichedTicket[]>();
  for (const ticket of enrichedTickets) {
    const subj = ticket.canonicalSubject || "顺德区重点诉求责任主体";
    const evt = ticket.eventType || "综合民生诉求跟进";
    const key = `${subj}::${evt}`;
    if (!subjectEventMap.has(key)) {
      subjectEventMap.set(key, []);
    }
    subjectEventMap.get(key)!.push(ticket);
  }

  for (const [_, tickets] of subjectEventMap.entries()) {
    if (tickets.length >= 2) {
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

      const canonicalSubject = tickets[0].canonicalSubject;
      const canonicalLocation = tickets[0].canonicalLocation;
      const eventType = tickets[0].eventType;
      const themeId = `THEME-${themes.length + 1}`;
      const title = `${canonicalSubject} — ${eventType}`;

      tickets.forEach((t) => {
        t.clusterId = themeId;
      });

      themes.push({
        id: themeId,
        title,
        canonicalSubject,
        canonicalLocation,
        eventType,
        category: (tickets[0].themes && tickets[0].themes[0]) || "综合民生",
        riskLevel: tickets.length >= 5 ? "HIGH" : tickets.length >= 3 ? "MEDIUM" : "LOW",
        riskReason: `多频诉求聚集：近${timeSpanHours}小时内集中出现${tickets.length}件同类市民反映`,
        ticketCount: tickets.length,
        timeSpanHours,
        firstOccurrence: firstTime,
        lastOccurrence: lastTime,
        aiSummary: `系统聚类发现：位于【${canonicalLocation}】的【${canonicalSubject}】在 ${timeSpanHours} 小时内累计被诉求 ${tickets.length} 次，主要涉及“${eventType}”。`,
        recommendedAction: `转派所属辖区行业主管部门牵头，2个工作日内核实具体诉求并向市民反馈办理进展。`,
        tickets,
        relatedSubjects: Array.from(new Set(tickets.map((t) => t.canonicalSubject))),
        relatedLocations: Array.from(new Set(tickets.map((t) => t.canonicalLocation))),
        status: "UNCHECKED",
      });
    }
  }

  // 2. Second Pass: Dense Vector Semantic Similarity (Baishanyun BGE-M3) for unassigned tickets
  const unassigned = enrichedTickets.filter((t) => !assignedTicketIds.has(t.id));
  if (unassigned.length >= 2 && unassigned.length <= 300) {
    try {
      const embedModel = getEmbeddingModel();
      const texts = unassigned.map((t) => {
        const sub = t.subdistrict || "";
        const subj = t.canonicalSubject || "";
        const evt = t.eventType || "";
        const content = typeof t.content === "string" ? t.content.slice(0, 80) : "";
        return `${sub} ${subj} ${evt} ${content}`;
      });

      const vectors = await embedModel.embedDocuments(texts);

      const visited = new Set<number>();
      for (let i = 0; i < unassigned.length; i++) {
        if (visited.has(i)) continue;
        const cluster = [unassigned[i]];
        visited.add(i);

        for (let j = i + 1; j < unassigned.length; j++) {
          if (visited.has(j)) continue;
          const sim = cosineSimilarity(vectors[i], vectors[j]);
          if (sim >= 0.78) {
            visited.add(j);
            cluster.push(unassigned[j]);
          }
        }

        if (cluster.length >= 2) {
          cluster.sort(
            (a, b) => safeParseDate(a.createTime).getTime() - safeParseDate(b.createTime).getTime()
          );

          const firstTime = cluster[0].createTime;
          const lastTime = cluster[cluster.length - 1].createTime;
          const timeSpanHours = Math.max(
            1,
            differenceInHours(safeParseDate(lastTime), safeParseDate(firstTime))
          );

          const themeId = `THEME-${themes.length + 1}`;
          const canonicalSubject = cluster[0].canonicalSubject;
          const canonicalLocation = cluster[0].canonicalLocation;
          const eventType = cluster[0].eventType;
          const title = `${canonicalSubject} — ${eventType}`;

          cluster.forEach((t) => {
            t.clusterId = themeId;
            assignedTicketIds.add(t.id);
          });

          themes.push({
            id: themeId,
            title,
            canonicalSubject,
            canonicalLocation,
            eventType,
            category: (cluster[0].themes && cluster[0].themes[0]) || "综合民生",
            riskLevel: cluster.length >= 5 ? "HIGH" : cluster.length >= 3 ? "MEDIUM" : "LOW",
            riskReason: `语义向量聚类发现：${cluster.length} 件高相似诉求集中发生（语义相似度 > 78%）`,
            ticketCount: cluster.length,
            timeSpanHours,
            firstOccurrence: firstTime,
            lastOccurrence: lastTime,
            aiSummary: `通过 Baishan BGE-M3 语义向量聚类发现：位于【${canonicalLocation}】周边在 ${timeSpanHours} 小时内出现 ${cluster.length} 件同质化诉求。`,
            recommendedAction: "转派所属镇街职能部门开展现场集中联合执法处置。",
            tickets: cluster,
            relatedSubjects: Array.from(new Set(cluster.map((t) => t.canonicalSubject))),
            relatedLocations: Array.from(new Set(cluster.map((t) => t.canonicalLocation))),
            status: "UNCHECKED",
          });
        }
      }
    } catch (embedErr: any) {
      console.warn("Vector clustering fallback:", embedErr.message);
    }
  }

  // Sort themes by risk level and count
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
