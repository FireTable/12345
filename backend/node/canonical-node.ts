import type { TicketRadarState, EnrichedTicket } from "../state";
import { registerAlias, resolveEntityAlias } from "@/lib/alias-dict";

/**
 * 车牌号提取与唯一标识符判断
 */
function extractPlateIdentifier(name: string): string | null {
  const match = name.match(/([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/i);
  return match ? match[1].replace(/\s+/g, "").toUpperCase() : null;
}

/**
 * 动态实体归一化：消除多余标点与空白
 */
function cleanEntityName(name: string): string {
  return (name || "")
    .trim()
    .replace(/[“”"''`]/g, "")
    .replace(/\s+/g, "")
    .replace(/（[^）]*）|\([^)]*\)/g, "");
}

/**
 * 检查两个主体名称是否真正属于同一物理实体（严防通用虚词包含误判）
 */
function isSamePhysicalEntity(a: string, b: string): boolean {
  if (!a || !b) return false;
  const cleanA = cleanEntityName(a);
  const cleanB = cleanEntityName(b);
  if (cleanA === cleanB) return true;

  // 1. 如果包含车牌号，必须车牌完全一致才可对齐，绝不允许跨车牌合并
  const plateA = extractPlateIdentifier(a);
  const plateB = extractPlateIdentifier(b);
  if (plateA || plateB) {
    return plateA !== null && plateB !== null && plateA === plateB;
  }

  // 2. 实体名称长度过短 (<= 2 字) 严禁做包含归并，避免误合并
  if (cleanA.length <= 2 || cleanB.length <= 2) {
    return false;
  }

  // 3. 专有商业字号前缀对齐（字号长度至少 >= 4，且核心词根完全吻合）
  if (cleanA.length >= 4 && cleanB.length >= 4) {
    if (cleanA.startsWith(cleanB) || cleanB.startsWith(cleanA)) {
      return true;
    }
  }

  return false;
}

/**
 * Canonical Alignment Node: 实体对齐与规范化（严格实体隔离，杜绝跨主体串扰并沉淀别名字典）
 */
export async function canonicalNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];

  // 1. 统计当前批次中独立实体与其最具代表性的规范全称
  const canonicalEntityGroups: Array<{ representative: string; members: Set<string> }> = [];

  for (const t of enrichedTickets) {
    const rawSubject = resolveEntityAlias((t.canonicalSubject || "").trim());
    if (!rawSubject) continue;

    let foundGroup = false;
    for (const group of canonicalEntityGroups) {
      if (isSamePhysicalEntity(group.representative, rawSubject)) {
        group.members.add(rawSubject);
        // 如果当前名称更长、更具体，升级代表名称
        if (rawSubject.length > group.representative.length && !rawSubject.includes("所属辖区")) {
          group.representative = rawSubject;
        }
        foundGroup = true;
        break;
      }
    }

    if (!foundGroup) {
      canonicalEntityGroups.push({
        representative: rawSubject,
        members: new Set([rawSubject]),
      });
    }
  }

  // 沉淀新发现的实体别名映射，实现一次学习、全局沉淀
  for (const group of canonicalEntityGroups) {
    for (const member of group.members) {
      if (member !== group.representative && member.length >= 2) {
        registerAlias(member, group.representative);
      }
    }
  }

  // 2. 映射对齐实体，并保持地点与事件独立精准
  const enriched: EnrichedTicket[] = enrichedTickets.map((t) => {
    const rawSubject = (t.canonicalSubject || "").trim();
    let canonicalSubject = rawSubject;

    for (const group of canonicalEntityGroups) {
      if (isSamePhysicalEntity(group.representative, rawSubject)) {
        canonicalSubject = group.representative;
        break;
      }
    }

    const canonicalLocation = (t.canonicalLocation || "").trim() || (t.subdistrict || t.district || "");
    const eventType = (t.eventType || "").trim();

    return {
      ...t,
      canonicalSubject,
      canonicalLocation,
      eventType,
      entities: [
        { name: canonicalSubject, canonicalName: canonicalSubject, type: "SUBJECT", confidence: 0.98 },
        { name: canonicalLocation, canonicalName: canonicalLocation, type: "LOCATION", confidence: 0.95 },
        { name: eventType, canonicalName: eventType, type: "EVENT_TYPE", confidence: 0.96 },
      ],
      relations: [
        { source: t.id, target: canonicalSubject, relation: "涉事主体" },
        { source: t.id, target: canonicalLocation, relation: "发生地" },
        { source: canonicalSubject, target: eventType, relation: "涉及事件" },
      ],
    };
  });

  return {
    enrichedTickets: enriched,
    status: "extracting",
  };
}
