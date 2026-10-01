import { graph } from "./agent/ticket-agent";
import type { RawTicket, TicketRadarState, MultiFrequencyTheme, EnrichedTicket } from "./state";
import { evaluateIncrementalTicket, upgradeThemeWithSystemTwo, type IncrementalClusterResult } from "./incremental-cluster";
import { embedTextsWithRetry, extractionProductText, themeProductText } from "./embed-products";
import { extractNode } from "./node/extract-node";
import { canonicalNode } from "./node/canonical-node";
import { getRegionVocabulary } from "@/lib/vocabulary";

export { graph };

/**
 * Execute the Ticket Radar Agent Pipeline on a set of tickets
 */
export async function runTicketRadarPipeline(
  rawTickets: RawTicket[],
  threadId: string = "default-radar-thread",
  taskId?: string,
  regionId?: string,
  existingThemes?: MultiFrequencyTheme[]
): Promise<TicketRadarState> {
  const initialState = {
    rawTickets,
    taskId,
    regionId,
    themes: existingThemes || [],
    status: "idle" as const,
  };

  const result = await graph.invoke(initialState, {
    configurable: { thread_id: threadId },
  });

  return result as TicketRadarState;
}

/**
 * 单条工单增量接入与时空吸附流水线 (Stream Ingestion Pipeline)
 * 供单条工单即时上报、实时吸附与质变研判调用
 */
export async function ingestSingleTicketPipeline(
  rawTicket: RawTicket,
  activeThemes: MultiFrequencyTheme[],
  regionId: string = "shunde"
): Promise<{
  enrichedTicket: EnrichedTicket;
  result: IncrementalClusterResult;
  updatedTheme?: MultiFrequencyTheme;
}> {
  // 1. 抽取四要素（System-1 快思考分流 + System-2 结构化抽取）
  const extractState = await extractNode({
    rawTickets: [rawTicket],
    regionId,
    status: "idle",
  } as TicketRadarState);

  // 2. 实体与微观空间核心基底规范化
  const canonicalState = await canonicalNode({
    ...extractState,
    regionId,
  } as TicketRadarState);

  const enrichedTicket = canonicalState.enrichedTickets?.[0] || (extractState.enrichedTickets?.[0] as EnrichedTicket);

  // 3. 同一件事，或向量很近的同一个具体地点，并入已有主题。
  const vocab = await getRegionVocabulary(regionId);
  const openThemes = activeThemes.filter((theme) => theme.status !== "DISMISSED");
  let ticketVector: number[] | undefined;
  const themeVectors = new Map<string, number[]>();
  if (openThemes.length > 0) {
    const texts = [extractionProductText(enrichedTicket), ...openThemes.map((theme) => themeProductText(theme))];
    const vectors = await embedTextsWithRetry(texts);
    ticketVector = vectors[0];
    openThemes.forEach((theme, index) => {
      const vector = vectors[index + 1];
      if (vector) themeVectors.set(theme.id, vector);
    });
  }
  const clusterResult = evaluateIncrementalTicket(enrichedTicket, activeThemes, {
    townships: vocab.townships,
    vocab,
    ticketVector,
    themeVectors,
  });

  // 4. 险情升级只重写建议，思考关掉，风险等级用本地规则
  let updatedTheme: MultiFrequencyTheme | undefined = clusterResult.matchedTheme;
  if (clusterResult.needDeepThinkingUpgrade && clusterResult.matchedTheme) {
    updatedTheme = await upgradeThemeWithSystemTwo(clusterResult.matchedTheme);
  }

  return {
    enrichedTicket,
    result: clusterResult,
    updatedTheme,
  };
}

