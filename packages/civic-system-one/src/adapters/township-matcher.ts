import type { CivicTownshipOption, CivicTicketInput } from "../types";

/**
 * 快思考引擎法定镇街动态决策器 (Dynamic Civic Township Matcher)
 * 严格基于当前辖区标准政务词库白名单进行归一化判定，与 System-2 严格保证同源 Enum
 */
export function matchTownshipFromOptions(
  ticket: CivicTicketInput,
  townships?: CivicTownshipOption[]
): { township: string; probability: number } {
  if (!townships || townships.length === 0) {
    return { township: "UNKNOWN", probability: 0 };
  }

  const rawSubdistrict = (ticket.subdistrict || "").trim();
  const text = ((ticket.title || "") + " " + (ticket.content || "")).trim();

  // 1. 若工单已显式携带有效镇街名，优先匹配标准全称、简称或别名
  if (rawSubdistrict && rawSubdistrict !== "未知" && rawSubdistrict !== "UNKNOWN") {
    for (const t of townships) {
      if (
        t.fullName === rawSubdistrict ||
        t.name === rawSubdistrict ||
        (t.aliases && t.aliases.includes(rawSubdistrict))
      ) {
        return { township: t.fullName, probability: 0.99 };
      }
    }
  }

  // 2. 最长前缀 / 实体子词匹配算法（严格从全称、简称、别名、社区、地标倒查归属法定镇街）
  let bestMatch: { fullName: string; matchLen: number; index: number } | null = null;
  for (const t of townships) {
    const fullName = (t.fullName || t.name || "").trim();
    if (!fullName) continue;
    const labels = [
      t.fullName,
      t.name,
      ...(t.aliases || []),
      ...(t.communities || []),
      ...(t.landmarks || []),
    ];
    for (const raw of labels) {
      const label = (raw || "").trim();
      if (label.length < 2) continue;
      const index = text.indexOf(label);
      if (index < 0) continue;
      if (
        !bestMatch ||
        label.length > bestMatch.matchLen ||
        (label.length === bestMatch.matchLen && index < bestMatch.index)
      ) {
        bestMatch = { fullName: t.fullName, matchLen: label.length, index };
      }
    }
  }

  if (bestMatch) {
    return { township: bestMatch.fullName, probability: 0.92 };
  }

  return { township: "UNKNOWN", probability: 0 };
}
