import type { TicketRadarState, EnrichedTicket } from "../state";

/**
 * 动态实体归一化：消除多余标点与空格，自动匹配长全称
 */
function normalizeEntityName(name: string): string {
  return name
    .trim()
    .replace(/[“”"''`]/g, "")
    .replace(/\s+/g, "")
    .replace(/（[^）]*）|\([^)]*\)/g, "");
}

/**
 * Canonical Alignment Node: 基于动态语义与公共词根自动对齐同义实体（杜绝硬编码字典）
 */
export async function canonicalNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets;

  // 1. 统计当前批次中所有出现的主体词频与代表性名称
  const subjectFrequency = new Map<string, { count: number; bestName: string }>();
  for (const t of enrichedTickets) {
    const raw = normalizeEntityName(t.canonicalSubject);
    if (!raw) continue;

    let matchedKey = raw;
    // 动态查找是否存在包含关系的已有主体（优先保留更详细具体的名称）
    for (const key of subjectFrequency.keys()) {
      if (key.includes(raw) || raw.includes(key)) {
        matchedKey = key.length > raw.length ? key : raw;
        break;
      }
    }

    const current = subjectFrequency.get(matchedKey) || { count: 0, bestName: t.canonicalSubject };
    subjectFrequency.set(matchedKey, {
      count: current.count + 1,
      bestName: t.canonicalSubject.length >= current.bestName.length ? t.canonicalSubject : current.bestName,
    });
  }

  // 2. 映射对齐到最标准的主体名称
  const enriched = enrichedTickets.map((t) => {
    const raw = normalizeEntityName(t.canonicalSubject);
    let canonicalSubject = t.canonicalSubject;

    for (const [key, val] of subjectFrequency.entries()) {
      if (key.includes(raw) || raw.includes(key)) {
        canonicalSubject = val.bestName;
        break;
      }
    }

    const canonicalLocation = t.canonicalLocation.trim();

    return {
      ...t,
      canonicalSubject,
      canonicalLocation,
      entities: t.entities.map((e) => {
        if (e.type === "SUBJECT") return { ...e, name: t.canonicalSubject, canonicalName: canonicalSubject };
        if (e.type === "LOCATION") return { ...e, name: t.canonicalLocation, canonicalName: canonicalLocation };
        return e;
      }),
      relations: [
        { source: t.id, target: canonicalSubject, relation: "投诉对象" },
        { source: t.id, target: canonicalLocation, relation: "发生地" },
        { source: canonicalSubject, target: t.eventType, relation: "涉及事件" },
      ],
    };
  });

  return {
    enrichedTickets: enriched,
    status: "extracting",
  };
}
