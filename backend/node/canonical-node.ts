import type { TicketRadarState, EnrichedTicket } from "../state";

const SUBJECT_ALIASES: Record<string, string> = {
  "金科博翠天下工地": "金科博翠天下施工项目部",
  "博翠天下工地": "金科博翠天下施工项目部",
  "博翠天下建筑工地": "金科博翠天下施工项目部",
  "金科施工队": "金科博翠天下施工项目部",
  "大良万达商场": "顺德万达广场",
  "大良万达广场": "顺德万达广场",
  "顺德大良万达": "顺德万达广场",
  "万达商圈餐饮街": "顺德万达广场餐饮区",
  "万达餐饮店": "顺德万达广场餐饮区",
  "保利中汇花园物业": "保利中汇物业服务中心",
  "中汇花园物业管理处": "保利中汇物业服务中心",
  "保利中汇物业": "保利中汇物业服务中心",
  "顺峰山公园南门流动摊贩": "顺峰山南门流动摊区",
  "顺峰公园南门摆摊": "顺峰山南门流动摊区",
  "南门无证摆卖": "顺峰山南门流动摊区",
  "华侨城欢乐海岸摩天轮": "顺德华侨城欢乐海岸PLUS",
  "华侨城欢乐海岸": "顺德华侨城欢乐海岸PLUS",
  "顺德欢乐海岸": "顺德华侨城欢乐海岸PLUS",
  "大良逢沙小学后门无证烧烤": "逢沙大道夜市无证烧烤群",
  "逢沙小学旁烧烤摊": "逢沙大道夜市无证烧烤群",
  "逢沙村道烧烤大排档": "逢沙大道夜市无证烧烤群",
  "容桂文海路供水管道": "容桂文海西路市政主供水管网",
  "文海路水管": "容桂文海西路市政主供水管网",
  "容桂文海路爆水管": "容桂文海西路市政主供水管网",
  "北滘碧桂园总部三期地下车库": "碧桂园总部三期物业工程部",
  "碧桂园三期地库漏水": "碧桂园总部三期物业工程部",
  "碧桂园总部3期车库": "碧桂园总部三期物业工程部",
};

const LOCATION_ALIASES: Record<string, string> = {
  "大良逢沙村": "大良街道逢沙社区",
  "逢沙村委会旁": "大良街道逢沙社区",
  "逢沙大道": "大良街道逢沙大道",
  "大良南国东路": "大良街道南国东路",
  "顺德南国路": "大良街道南国东路",
  "容桂文海路": "容桂街道文海西路",
  "北滘新城": "北滘镇新城核心区",
  "顺峰山南门": "大良街道顺峰山公园南门广场",
};

export function resolveCanonicalSubject(surfaceName: string): string {
  const cleaned = surfaceName.trim().replace(/[“”"''`]/g, "");
  if (SUBJECT_ALIASES[cleaned]) return SUBJECT_ALIASES[cleaned];
  for (const [alias, canonical] of Object.entries(SUBJECT_ALIASES)) {
    if (cleaned.includes(alias) || alias.includes(cleaned)) return canonical;
  }
  return cleaned;
}

export function resolveCanonicalLocation(surfaceLoc: string): string {
  const cleaned = surfaceLoc.trim().replace(/[“”"''`]/g, "");
  if (LOCATION_ALIASES[cleaned]) return LOCATION_ALIASES[cleaned];
  for (const [alias, canonical] of Object.entries(LOCATION_ALIASES)) {
    if (cleaned.includes(alias) || alias.includes(cleaned)) return canonical;
  }
  return cleaned;
}

/**
 * Canonical Alignment Node: normalizes subjects and locations across all enriched tickets
 */
export async function canonicalNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const enriched = state.enrichedTickets.map((t) => {
    const canonicalSubject = resolveCanonicalSubject(t.canonicalSubject);
    const canonicalLocation = resolveCanonicalLocation(t.canonicalLocation);
    return {
      ...t,
      canonicalSubject,
      canonicalLocation,
      entities: t.entities.map((e) => {
        if (e.type === "SUBJECT") return { ...e, canonicalName: canonicalSubject };
        if (e.type === "LOCATION") return { ...e, canonicalName: canonicalLocation };
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
  };
}
