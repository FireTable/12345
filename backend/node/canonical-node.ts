import type { TicketRadarState, EnrichedTicket } from "../state";
import { registerAlias, resolveEntityAlias } from "@/lib/alias-dict";
import { yieldToEventLoop } from "@/lib/yield-loop";

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
 * 提炼微观地点空间核心基底（道路/街巷/小区/地标基底）
 * 例：
 * "大良街道金榜上街28号" -> "大良街道金榜上街"
 * "大良街道金榜上街金山路段" -> "大良街道金榜上街"
 * "大良街道金榜上街沿街商铺" -> "大良街道金榜上街"
 * "容桂街道文武路某烧烤大排档" -> "容桂街道文武路"
 * "容桂街道文武路商业街" -> "容桂街道文武路"
 */
export function extractSpatialCore(location: string): string {
  if (!location) return "";
  let loc = location.trim()
    .replace(/^(?:.+?[省市区县]|广东省|广州市|佛山市|顺德区)/, "")
    .replace(/[“”"''`]/g, "");

  // 匹配道路、街巷、商业街、工业区、小区、花园、大厦等空间核心实体
  const coreRegex = /^(.*?(?:大道|商业街|工业区|步行街|综合体|批发市场|路段|路|街|巷|小区|花园|苑|城|大厦|新村|广场|公园|中心))(?=[0-9一二三四五六七八九十]+号|[0-9]+栋|[0-9]+弄|附近|周边|段|交汇处|十字路口|门前|沿街|商铺|内|旁|某|\s|$)/;
  
  const m = loc.match(coreRegex);
  if (m && m[1] && m[1].length >= 4) {
    return m[1].trim();
  }

  return loc.replace(/[0-9一二三四五六七八九十]+号.*$/, "").trim() || loc;
}

import { RULES } from "../rules";

/**
 * 校验两个微观空间是否属于同一物理点位/片区
 */
export function isSameSpatialEntity(a: string, b: string): boolean {
  if (!a || !b) return false;
  const coreA = extractSpatialCore(a);
  const coreB = extractSpatialCore(b);
  if (!coreA || !coreB) return false;
  if (coreA === coreB && coreA.length >= 4) return true;

  // 严禁将纯行政区划（如"大良街道"、"容桂街道"）与具体微观道路/小区强行合并
  if (RULES.adminOnlyLocation.test(coreA) || RULES.adminOnlyLocation.test(coreB)) {
    return false;
  }

  const baseA = coreA.replace(/(?:商业街|步行街|沿街商铺)$/, "");
  const baseB = coreB.replace(/(?:商业街|步行街|沿街商铺)$/, "");
  if (baseA === baseB && baseA.length >= 4) return true;

  if (baseA.length >= 4 && baseB.length >= 4) {
    if (baseA.startsWith(baseB) || baseB.startsWith(baseA)) return true;
  }
  return false;
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
 * 抽取已经全部落库时跳过。否则每比较一批就让出事件循环。
 */
export async function canonicalNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enrichedTickets = state.enrichedTickets || [];
  if (state.extractionFresh === false) {
    console.log(`[canonical] ${enrichedTickets.length} 条抽取已落库，跳过全表实体对齐`);
    return { enrichedTickets, status: "extracting" };
  }

  let steps = 0;
  const due = () => {
    steps += 1;
    return steps % 512 === 0;
  };

  // 1. 统计当前批次中独立实体与其最具代表性的规范全称
  const canonicalEntityGroups: Array<{ representative: string; members: Set<string> }> = [];

  for (const t of enrichedTickets) {
    if (due()) await yieldToEventLoop();
    const rawSubject = resolveEntityAlias((t.canonicalSubject || "").trim());
    if (!rawSubject) continue;

    let foundGroup = false;
    for (const group of canonicalEntityGroups) {
      if (due()) await yieldToEventLoop();
      if (isSamePhysicalEntity(group.representative, rawSubject)) {
        group.members.add(rawSubject);
        if (rawSubject.length > group.representative.length) {
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
      if (due()) await yieldToEventLoop();
      if (member !== group.representative && member.length >= 2) {
        registerAlias(member, group.representative);
      }
    }
  }

  // 2. 统计当前批次中的微观地理基底核心（Spatial Cores），实现同片区地点规范化
  const canonicalLocationGroups: Array<{ representative: string; members: Set<string> }> = [];
  for (const t of enrichedTickets) {
    if (due()) await yieldToEventLoop();
    const rawLoc = (t.canonicalLocation || "").trim();
    if (!rawLoc) continue;

    let foundLocGroup = false;
    for (const group of canonicalLocationGroups) {
      if (due()) await yieldToEventLoop();
      if (isSameSpatialEntity(group.representative, rawLoc)) {
        group.members.add(rawLoc);
        foundLocGroup = true;
        break;
      }
    }

    if (!foundLocGroup) {
      const spatialCore = extractSpatialCore(rawLoc);
      canonicalLocationGroups.push({
        representative: spatialCore || rawLoc,
        members: new Set([rawLoc]),
      });
    }
  }

  // 3. 映射对齐实体与空间核心，并保持地点与事件独立精准
  const enriched: EnrichedTicket[] = new Array(enrichedTickets.length);
  for (let index = 0; index < enrichedTickets.length; index++) {
    if (due()) await yieldToEventLoop();
    const t = enrichedTickets[index];
    const rawSubject = (t.canonicalSubject || "").trim();
    let canonicalSubject = rawSubject;

    for (const group of canonicalEntityGroups) {
      if (due()) await yieldToEventLoop();
      if (isSamePhysicalEntity(group.representative, rawSubject)) {
        canonicalSubject = group.representative;
        break;
      }
    }

    const rawLocation = (t.canonicalLocation || "").trim() || (t.subdistrict || t.district || "");
    let canonicalLocation = rawLocation;
    for (const group of canonicalLocationGroups) {
      if (due()) await yieldToEventLoop();
      if (isSameSpatialEntity(group.representative, rawLocation)) {
        canonicalLocation = group.representative;
        break;
      }
    }

    const eventType = (t.eventType || "").trim();

    enriched[index] = {
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
  }

  return {
    enrichedTickets: enriched,
    status: "extracting",
  };
}

