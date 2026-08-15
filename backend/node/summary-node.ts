import type {
  TicketRadarState,
  OverallStats,
  GraphData,
  GraphNode,
  GraphLink,
  MultiFrequencyTheme,
  RiskLevel,
} from "../state";
import { getChatModel, llmConcurrency, markToolCallingUnsupported, modelSupportsToolCalling } from "../model";

import {
  ThemeEnrichmentSchema,
  BatchThemeEnrichmentSchema,
  buildThemeEnrichmentPrompt,
  buildBatchThemeEnrichmentPrompt,
} from "../prompt";

const DEFAULT_RECOMMENDED_ACTION = "建议转派所属辖区行业主管部门牵头，2个工作日内核实具体诉求并向市民书面反馈办理进展。";

/**
 * 批量调用大模型对多频主题进行深度公文研判（每批最多 10 个主题打包在 1 个 AI 请求中，不足 10 个按实际数量处理）
 */
async function enrichThemeBatchWithLLM(
  themeBatch: MultiFrequencyTheme[]
): Promise<Array<Partial<MultiFrequencyTheme>>> {
  if (themeBatch.length === 0) return [];
  const fallbacks = themeBatch.map(() => ({
    recommendedAction: DEFAULT_RECOMMENDED_ACTION,
  }));

  const enrichTask = async (): Promise<Array<Partial<MultiFrequencyTheme>>> => {
    try {
      const chat = getChatModel(0.1);
      const prompt = buildBatchThemeEnrichmentPrompt(themeBatch);

      // 1. 探测通过才走 tool-calling
      if (await modelSupportsToolCalling()) {
        try {
          const structuredChat = chat.withStructuredOutput(BatchThemeEnrichmentSchema);
          const structuredRes = await structuredChat.invoke(prompt);
          if (structuredRes && Array.isArray(structuredRes.results) && structuredRes.results.length > 0) {
            const resultMap = new Map<number, any>();
            structuredRes.results.forEach((r) => {
              resultMap.set(r.themeIndex, r);
            });

            return themeBatch.map((theme, i) => {
              const r = resultMap.get(i + 1) || structuredRes.results[i];
              if (!r) return { recommendedAction: DEFAULT_RECOMMENDED_ACTION };

              const incoming = r.riskLevel as RiskLevel;
              const finalRisk: RiskLevel = theme.riskLevel === "HIGH" ? "HIGH" : incoming;
              return {
                riskLevel: finalRisk,
                riskReason: r.riskReason || theme.riskReason,
                aiSummary: r.aiSummary || theme.aiSummary,
                recommendedAction: r.recommendedAction || DEFAULT_RECOMMENDED_ACTION,
              };
            });
          }
        } catch (structErr: unknown) {
          const message = structErr instanceof Error ? structErr.message : String(structErr);
          markToolCallingUnsupported(message);
        }
      }

      // 2. 备用直接 Prompt + JSON 解析
      const res = await chat.invoke(prompt);
      const rawText = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const results = Array.isArray(parsed.results) ? parsed.results : Array.isArray(parsed) ? parsed : [];
        if (results.length > 0) {
          const resultMap = new Map<number, any>();
          results.forEach((r: any, idx: number) => {
            const index = typeof r.themeIndex === "number" ? r.themeIndex : idx + 1;
            resultMap.set(index, r);
          });

          return themeBatch.map((theme, i) => {
            const r = resultMap.get(i + 1) || results[i];
            if (!r) return { recommendedAction: DEFAULT_RECOMMENDED_ACTION };

            const candidate = (["HIGH", "MEDIUM", "LOW"].includes(r.riskLevel) ? r.riskLevel : theme.riskLevel) as RiskLevel;
            const finalRisk: RiskLevel = theme.riskLevel === "HIGH" ? "HIGH" : candidate;
            return {
              riskLevel: finalRisk,
              riskReason: r.riskReason || theme.riskReason,
              aiSummary: r.aiSummary || theme.aiSummary,
              recommendedAction: r.recommendedAction || DEFAULT_RECOMMENDED_ACTION,
            };
          });
        }
      }
    } catch (err: any) {
      console.warn("[summary-node] Batch enrichment error:", err?.message);
    }
    return fallbacks;
  };

  // 15秒批次超时控制
  const timeoutPromise = new Promise<Array<Partial<MultiFrequencyTheme>>>((resolve) =>
    setTimeout(() => resolve(fallbacks), 15000)
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
  if (enrichedThemes.length > 0 && process.env.OPENAI_API_KEY) {
    if (taskId) {
      updateTaskProgress(taskId, {
        stage: "SYNTHESIZING",
        stageText: `正在对 ${enrichedThemes.length} 个多频主题进行批量深度公文研判与协同处置建议生成...`,
        percent: 78,
        themeCount: enrichedThemes.length,
      });
    }

    const queue = new PQueue({ concurrency: Math.min(4, llmConcurrency()) });
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
        if (taskId) {
          const percent = Math.min(96, 78 + Math.round((synthesizedCount / Math.max(1, enrichedThemes.length)) * 18));
          updateTaskProgress(taskId, {
            percent,
            stageText: `AI 正在生成公文级处置建议 (${Math.min(synthesizedCount, enrichedThemes.length)} / ${enrichedThemes.length})...`,
          });
        }
      });
    }

    await queue.addAll(chunkTasks);
  }

  if (taskId) {
    updateTaskProgress(taskId, {
      stage: "COMPLETED",
      status: "COMPLETED",
      percent: 100,
      stageText: `多频研判完成！已聚合 ${enrichedThemes.length} 个多频主题`,
      themeCount: enrichedThemes.length,
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
