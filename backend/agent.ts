import { graph } from "./agent/ticket-agent";
import type { RawTicket, TicketRadarState, MultiFrequencyTheme, EnrichedTicket } from "./state";
import { evaluateIncrementalTicket, upgradeThemeWithSystemTwo, type IncrementalClusterResult } from "./incremental-cluster";
import { embedTextsWithRetry, extractionProductText } from "./embed-products";
import { isEmbedEligible, productHashForTicket } from "./embed-policy";
import { upsertTicketEmbeddings } from "@/lib/ticket-embeddings";
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
  regionId: string = "shunde",
  options?: {
    themeVectors?: Map<string, number[]>;
    embedClient?: { embed: (texts: string[]) => Promise<number[][]> };
  }
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
  let ticketVector: number[] | undefined;
  if (isEmbedEligible(enrichedTicket)) {
    const text = extractionProductText(enrichedTicket);
    const vectors = await embedTextsWithRetry([text], options?.embedClient);
    ticketVector = vectors[0];
    if (regionId && ticketVector?.length === 1024) {
      await upsertTicketEmbeddings(regionId, [
        {
          ticketId: enrichedTicket.id,
          productHash: productHashForTicket(enrichedTicket),
          model: "BAAI/bge-m3",
          vector: ticketVector,
        },
      ]);
    }
  }
  const clusterResult = evaluateIncrementalTicket(enrichedTicket, activeThemes, {
    townships: vocab.townships,
    vocab,
    ticketVector,
    themeVectors: options?.themeVectors,
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

