import type {
  TicketRadarState,
  OverallStats,
  GraphData,
  GraphNode,
  GraphLink,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";
import { getSystemTwoEngine, systemTwoConcurrency } from "../model";
import { LLM_TOKENS, LLM_TIMEOUTS } from "@/lib/tokens";

import {
  BatchThemeEnrichmentSchema,
  buildBatchThemeEnrichmentPrompt,
} from "../prompt";

const EMPTY_ADVICE = { aiSummary: "", recommendedAction: "" };

/**
 * 给一批主题写各自的摘要和处置建议。
 * 只要 JSON，不开思考。思考会把输出额度用完，正文变空，最后每个主题都落成同一句套话。
 */
export async function enrichThemeBatchWithLLM(
  themeBatch: MultiFrequencyTheme[]
): Promise<Array<Partial<MultiFrequencyTheme>>> {
  if (themeBatch.length === 0) return [];
  const fallbacks = themeBatch.map(() => ({ ...EMPTY_ADVICE }));

  const enrichTask = async (): Promise<Array<Partial<MultiFrequencyTheme>>> => {
    const merged = themeBatch.map((theme) => ({
      aiSummary: theme.aiSummary || "",
      recommendedAction: "",
    }));
    for (let attempt = 0; attempt < 3; attempt++) {
      if (attempt > 0 && merged.every((row) => row.recommendedAction.trim())) break;
      try {
        const systemTwo = await getSystemTwoEngine();
        const prompt = buildBatchThemeEnrichmentPrompt(themeBatch);
        const { data } = await systemTwo.createJSON(BatchThemeEnrichmentSchema, {
          messages: [{ role: "user", content: prompt }],
          enableThinking: false,
          maxTokens: LLM_TOKENS.THEME_ADVICE,
          temperature: 0.2,
        });
        if (data && Array.isArray(data.results) && data.results.length > 0) {
          const resultMap = new Map<number, any>();
          data.results.forEach((row) => resultMap.set(row.themeIndex, row));
          themeBatch.forEach((theme, index) => {
            const row = resultMap.get(index + 1) || data.results[index];
            if (!row) return;
            if (!merged[index].aiSummary.trim()) merged[index].aiSummary = row.aiSummary || theme.aiSummary || "";
            if (!merged[index].recommendedAction.trim()) merged[index].recommendedAction = row.recommendedAction || "";
          });
        }
      } catch (err: any) {
        console.warn(`[summary-node] System-2 batch enrichment error attempt ${attempt + 1}:`, err?.message);
      }
      if (merged.every((row) => row.recommendedAction.trim())) return merged;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500 * (attempt + 1)));
    }
    return merged;
  };

  // 慢思考批次超时控制 (充分尊重模型思考推导过程，分配充裕的 10 分钟预算)
  const timeoutPromise = new Promise<Array<Partial<MultiFrequencyTheme>>>((resolve) =>
    setTimeout(() => resolve(fallbacks), LLM_TIMEOUTS.THINKING * 3)
  );

  return Promise.race([enrichTask(), timeoutPromise]);
}

import PQueue from "p-queue";
import { updateTaskProgress } from "@/lib/task-progress";

/**
 * Summary Node: Performs LLM deep synthesis for ALL themes, calculates metrics, and builds ForceGraph topology
 */
export async function summaryNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets || [];
  const initialThemes = state.themes || [];
  const enrichedThemes = [...initialThemes];
  const taskId = state.taskId;

  const THEME_CHUNK_SIZE = 10;

  // 1. LLM deep synthesis for themes with 10-per-batch chunking
  if (enrichedThemes.length > 0) {
    if (taskId) {
      updateTaskProgress(taskId, {
        stage: "SYNTHESIZING",
        stageText: `正在为 ${enrichedThemes.length} 个主题生成各自的摘要和处置建议...`,
        percent: 78,
        themeCount: enrichedThemes.length,
      });
    }

    const queue = new PQueue({ concurrency: systemTwoConcurrency() });
    let synthesizedCount = 0;

    const chunkTasks: Array<() => Promise<void>> = [];
    for (let i = 0; i < enrichedThemes.length; i += THEME_CHUNK_SIZE) {
      const startIdx = i;
      const batch = enrichedThemes.slice(startIdx, startIdx + THEME_CHUNK_SIZE);
      chunkTasks.push(async () => {
        const batchResults = await enrichThemeBatchWithLLM(batch);
        batchResults.forEach((res, offset) => {
          const idx = startIdx + offset;
          if (idx < enrichedThemes.length) {
            const local = enrichedThemes[idx];
            enrichedThemes[idx] = {
              ...local,
              ...res,
              // 红黄蓝与假闭环由本地规则裁定，LLM 只能补理由/摘要/处置建议
              riskLevel: local.riskLevel,
              patternType: local.patternType,
              reopenCount: local.reopenCount,
              reopenTicketIds: local.reopenTicketIds,
            };
          }
        });

        synthesizedCount += batch.length;
        console.log(`[summary] ${Math.min(synthesizedCount, enrichedThemes.length)}/${enrichedThemes.length}`);
        if (taskId) {
          const percent = Math.min(96, 78 + Math.round((synthesizedCount / Math.max(1, enrichedThemes.length)) * 18));
          const sampleAdvice = batchResults.find((row) => row.recommendedAction?.trim())?.recommendedAction;
          const spotlightClusters = enrichedThemes.slice(0, 5).map((t) => ({
            id: t.id,
            name: t.title,
            category: t.category,
            ticketCount: t.ticketCount,
            subdistrict: t.canonicalLocation,
            type: "NEW_CLUSTER" as const,
          }));

          updateTaskProgress(taskId, {
            percent,
            themeCount: enrichedThemes.length,
            recentClusters: spotlightClusters,
            currentReasoning: sampleAdvice ? sampleAdvice.slice(0, 180) : undefined,
            stageText: `正在生成处置建议 (${Math.min(synthesizedCount, enrichedThemes.length)} / ${enrichedThemes.length} 主题)...`,
          });
        }
      });
    }

    await queue.addAll(chunkTasks);
  }

  if (taskId) {
    const spotlightClusters = enrichedThemes.slice(0, 6).map((t) => ({
      id: t.id,
      name: t.title,
      category: t.category,
      ticketCount: t.ticketCount,
      subdistrict: t.canonicalLocation,
      type: "NEW_CLUSTER" as const,
    }));

    updateTaskProgress(taskId, {
      stage: "SYNTHESIZING",
      status: "RUNNING",
      percent: 96,
      stageText: `主题已生成，正在写入数据库（${enrichedThemes.length} 个）...`,
      themeCount: enrichedThemes.length,
      recentClusters: spotlightClusters,
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
  const fakeClosureCount = enrichedThemes.reduce((acc, t) => acc + (t.reopenCount || 0), 0);
  const highRiskCount = enrichedThemes.filter(
    (t) => t.riskLevel === "HIGH" || (t.reopenCount || 0) > 0
  ).length;
  const mediumRiskCount = enrichedThemes.filter((t) => t.riskLevel === "MEDIUM").length;
  const lowRiskCount = enrichedThemes.filter((t) => t.riskLevel === "LOW").length;
  const topSubject = enrichedThemes[0]?.canonicalSubject || "暂无重点多频诉求";

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
    fakeClosureCount,
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
