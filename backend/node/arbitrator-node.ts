/**
 * 二级 AI / 备用模型仲裁与交叉校验引擎 (Secondary AI Arbitrator Node)
 * 当首轮大模型抽取的要素置信度偏低（< 60）、所属辖区非法、或主体模糊存在歧义时，
 * 触发二级仲裁专家模型进行深层消歧与事实纠偏。
 */

import { getChatModel } from "../model";
import {
  ArbitrationSchema,
  buildArbitrationPrompt,
  type ExtractedTicketItem,
  type ArbitrationResult,
} from "../prompt";
import type { RawTicket } from "../state";
import { canonicalizeTownship, isValidShundeTownship } from "@/lib/vocabulary";
import { resolveEntityAlias } from "@/lib/alias-dict";

/**
 * 判断某工单是否需要二级 AI 介入仲裁
 */
export function needsArbitration(
  item: ExtractedTicketItem,
  rawTicket?: RawTicket
): boolean {
  // 1. 置信度低于阈值 (60)
  if (item.confidence < 60) return true;

  // 2. 主体为泛化虚词
  const genericTokens = ["车主", "小车", "车辆", "商户", "商家", "市民", "某单位", "当事人", "特定诉求涉事方", "特定涉事方"];
  if (genericTokens.includes(item.subject.trim())) return true;

  // 3. 地点未明确或仅填写了宽泛区名
  if (
    !item.location ||
    item.location === "未标明微观地点" ||
    item.location === "所属辖区" ||
    item.location === "顺德区"
  ) {
    return true;
  }

  // 4. 抽取出的地点无法在顺德 10 大法定镇街词汇表中锚定
  const township = rawTicket?.subdistrict || item.location;
  if (!isValidShundeTownship(township)) {
    return true;
  }

  return false;
}

/**
 * 执行二级 AI 仲裁
 */
export async function arbitrateSingleTicket(
  ticket: RawTicket,
  firstPass: ExtractedTicketItem
): Promise<ExtractedTicketItem> {
  const prompt = buildArbitrationPrompt(ticket, firstPass);

  try {
    // 采用更低 temperature (0.0) 和严谨模式的二级模型实例进行仲裁
    const arbitratorChat = getChatModel(0);

    let arbitrated: ArbitrationResult | null = null;

    try {
      const structured = arbitratorChat.withStructuredOutput(ArbitrationSchema);
      arbitrated = (await structured.invoke(prompt)) as ArbitrationResult;
    } catch (e) {
      // 备用纯 JSON 解析
      const res = await arbitratorChat.invoke(prompt);
      const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
      const match = text.match(/\{[\s\S]*\}/);
      if (match) {
        arbitrated = JSON.parse(match[0]);
      }
    }

    if (arbitrated && arbitrated.correctedSubject) {
      const validTownship =
        canonicalizeTownship(arbitrated.correctedTownship) ||
        canonicalizeTownship(arbitrated.correctedLocation) ||
        firstPass.location;

      const normalizedSubject = resolveEntityAlias(arbitrated.correctedSubject);
      const normalizedLocation = resolveEntityAlias(arbitrated.correctedLocation);

      return {
        index: firstPass.index,
        summarizeTitle: `关于${validTownship}${normalizedSubject}${arbitrated.correctedEventType}诉求`,
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

  // 若二级模型调用超时或失败，采用别名归一化与词汇表强行保真
  return {
    ...firstPass,
    subject: resolveEntityAlias(firstPass.subject),
    location: resolveEntityAlias(firstPass.location),
    confidence: Math.max(firstPass.confidence, 55),
  };
}
