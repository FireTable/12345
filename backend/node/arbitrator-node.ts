/**
 * 二级 AI / 备用模型仲裁与交叉校验引擎 (Secondary AI Arbitrator Node)
 * 当首轮大模型抽取的要素置信度偏低（< 60）、所属辖区非法、或主体模糊存在歧义时，
 * 触发二级仲裁专家模型进行深层消歧与事实纠偏。
 */

import { getChatModel, markToolCallingUnsupported, modelSupportsToolCalling } from "../model";
import {
  ArbitrationSchema,
  buildArbitrationPrompt,
  type ExtractedTicketItem,
  type ArbitrationResult,
} from "../prompt";
import type { RawTicket } from "../state";
import { canonicalizeTownship, isValidTownship, type RegionVocabulary } from "@/lib/vocabulary";
import { resolveEntityAlias } from "@/lib/alias-dict";

/**
 * 判断某工单是否需要二级 AI 介入仲裁
 */
export function needsArbitration(
  item: ExtractedTicketItem,
  rawTicket?: RawTicket,
  vocab?: RegionVocabulary
): boolean {
  // 1. 置信度低于阈值 (60) 自动触发仲裁
  if (item.confidence < 60) return true;

  // 2. 主体为空或极短非实体 (<= 2 字)
  if (!item.subject || item.subject.trim().length <= 2) {
    return true;
  }

  // 3. 地点未明确或仅填写了该站点的宽泛行政区名
  if (!item.location || (vocab && item.location.trim() === vocab.regionName)) {
    return true;
  }

  // 4. 抽取出的地点无法在当前辖区法定镇街/街道标准库中锚定
  const township = rawTicket?.subdistrict || item.location;
  if (!isValidTownship(township, vocab)) {
    return true;
  }

  return false;
}

/**
 * 执行二级 AI 仲裁
 */
export async function arbitrateSingleTicket(
  ticket: RawTicket,
  firstPass: ExtractedTicketItem,
  vocab?: RegionVocabulary,
  aliasMap?: Map<string, string>
): Promise<ExtractedTicketItem> {
  const prompt = buildArbitrationPrompt(ticket, firstPass, vocab);

  const fallbackResult: ExtractedTicketItem = {
    ...firstPass,
    subject: resolveEntityAlias(firstPass.subject, aliasMap),
    location: resolveEntityAlias(firstPass.location, aliasMap),
    confidence: Math.max(firstPass.confidence, 55),
  };

  const arbitrateTask = async (): Promise<ExtractedTicketItem> => {
    try {
      const arbitratorChat = getChatModel(0);
      let arbitrated: ArbitrationResult | null = null;

      try {
        if (await modelSupportsToolCalling()) {
          const structured = arbitratorChat.withStructuredOutput(ArbitrationSchema);
          arbitrated = (await structured.invoke(prompt)) as ArbitrationResult;
        }
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        markToolCallingUnsupported(message);
      }
      if (!arbitrated) {
        const res = await arbitratorChat.invoke(prompt);
        const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          arbitrated = JSON.parse(match[0]);
        }
      }

      if (arbitrated && arbitrated.correctedSubject) {
        const validTownship =
          canonicalizeTownship(arbitrated.correctedTownship, vocab) ||
          canonicalizeTownship(arbitrated.correctedLocation, vocab) ||
          firstPass.location;

        const normalizedSubject = resolveEntityAlias(arbitrated.correctedSubject, aliasMap);
        const normalizedLocation = resolveEntityAlias(arbitrated.correctedLocation, aliasMap);

        return {
          index: firstPass.index,
          summarizeTitle:
            arbitrated.summarizeTitle ||
            firstPass.summarizeTitle ||
            [validTownship, normalizedSubject, arbitrated.correctedEventType || firstPass.eventType].filter(Boolean).join(" · "),
          subject: normalizedSubject,
          location: normalizedLocation,
          eventType: arbitrated.correctedEventType || firstPass.eventType,
          category: arbitrated.correctedCategory || firstPass.category,
          confidence: Math.max(firstPass.confidence, Math.min(99, arbitrated.confidence || 85)),
        };
      }
    } catch (err: any) {
      console.warn(`[Arbitrator] Secondary model arbitration failed for ticket ${ticket.ticketNo}:`, err.message);
    }
    return fallbackResult;
  };

  const timeoutPromise = new Promise<ExtractedTicketItem>((resolve) =>
    setTimeout(() => resolve(fallbackResult), 8000)
  );

  return Promise.race([arbitrateTask(), timeoutPromise]);
}
