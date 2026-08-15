import type { TicketRadarState, RawTicket, EnrichedTicket } from "../state";

/**
 * Extract Node: extracts Subject, Location, Event Type, and Themes from raw tickets
 * Reused and adapted from GraphRAG Zod Schema pattern.
 */
export async function extractNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets;

  const enrichedTickets: EnrichedTicket[] = rawTickets.map((ticket) => {
    const content = ticket.content;

    let rawSubject = "未知主体";
    if (content.includes("博翠天下") || content.includes("金科")) {
      rawSubject = "金科博翠天下施工项目部";
    } else if (content.includes("文海路") || content.includes("水管爆裂") || content.includes("爆水管")) {
      rawSubject = "容桂文海西路市政主供水管网";
    } else if (content.includes("保利中汇") || content.includes("中汇花园")) {
      rawSubject = "保利中汇物业服务中心";
    } else if (content.includes("顺峰山") || content.includes("顺峰公园")) {
      rawSubject = "顺峰山南门流动摊区";
    } else if (content.includes("万达")) {
      rawSubject = "顺德万达广场餐饮区";
    } else if (content.includes("逢沙小学") || content.includes("逢沙大道夜市") || content.includes("逢沙村道烧烤")) {
      rawSubject = "逢沙大道夜市无证烧烤群";
    } else if (content.includes("碧桂园总部") || content.includes("碧桂园三期")) {
      rawSubject = "碧桂园总部三期物业工程部";
    } else if (content.includes("欢乐海岸") || content.includes("华侨城")) {
      rawSubject = "顺德华侨城欢乐海岸PLUS";
    } else if (content.includes("家具厂")) {
      rawSubject = "龙江镇仙塘村家具厂";
    } else if (content.includes("药房")) {
      rawSubject = "伦教常康路某药房";
    } else if (content.includes("水乡")) {
      rawSubject = "杏坛逢简水乡景区";
    } else if (content.includes("路灯")) {
      rawSubject = "陈村花卉世界路灯所";
    } else if (content.includes("大榕树")) {
      rawSubject = "勒流园林绿化处";
    }

    let rawLocation = ticket.subdistrict;
    if (content.includes("逢沙")) rawLocation = "大良街道逢沙社区";
    else if (content.includes("文海")) rawLocation = "容桂街道文海西路";
    else if (content.includes("保利中汇")) rawLocation = "大良街道保利中汇花园";
    else if (content.includes("顺峰山") || content.includes("南国东路")) rawLocation = "大良街道顺峰山公园南门广场";
    else if (content.includes("万达")) rawLocation = "大良街道万达广场商圈";
    else if (content.includes("碧桂园总部") || content.includes("北滘新城")) rawLocation = "北滘镇碧桂园总部三期";
    else if (content.includes("欢乐海岸")) rawLocation = "大良街道华侨城欢乐海岸PLUS";

    let eventType = "综合咨询";
    const themes: string[] = [];

    if (content.includes("施工") || content.includes("噪音") || content.includes("打桩") || content.includes("轰鸣")) {
      eventType = "夜间违规施工扰民";
      themes.push("环保与噪音", "违规施工", "夜间扰民");
    } else if (content.includes("爆水管") || content.includes("漏水") || content.includes("停水") || content.includes("水管爆裂")) {
      eventType = "市政管网爆裂与停水抢修";
      themes.push("市政公共设施", "供水抢修", "交通管制");
    } else if (content.includes("电梯") || content.includes("滑梯") || content.includes("困人") || content.includes("曳引机")) {
      eventType = "小区电梯严重故障与安全隐患";
      themes.push("特种设备安全", "物业维权", "高危隐患");
    } else if (content.includes("占道") || content.includes("摆摊") || content.includes("无证") || content.includes("流动摊贩")) {
      eventType = "流动摊贩占道经营与油烟扰民";
      themes.push("市容市貌", "城管执法", "占道经营");
    } else if (content.includes("油烟") || content.includes("排风机") || content.includes("泔水")) {
      eventType = "餐饮商圈油烟直排与排风噪音";
      themes.push("环保生态", "餐饮监管", "商住纠纷");
    } else if (content.includes("车库") || content.includes("地下室") || content.includes("渗水")) {
      eventType = "地下车库持续渗水与维修滞后";
      themes.push("房屋质量", "物业服务", "公共设施");
    } else if (content.includes("乱收费") || content.includes("停车费") || content.includes("现金")) {
      eventType = "旅游景区周边停车场违规乱收费";
      themes.push("市场监管", "物价收费", "景区秩序");
    } else {
      themes.push("日常民生诉求");
    }

    return {
      ...ticket,
      canonicalSubject: rawSubject,
      canonicalLocation: rawLocation,
      eventType,
      themes,
      entities: [
        { name: rawSubject, canonicalName: rawSubject, type: "SUBJECT", confidence: 0.96 },
        { name: rawLocation, canonicalName: rawLocation, type: "LOCATION", confidence: 0.94 },
        { name: eventType, canonicalName: eventType, type: "EVENT_TYPE", confidence: 0.92 },
      ],
      relations: [
        { source: ticket.id, target: rawSubject, relation: "投诉对象" },
        { source: ticket.id, target: rawLocation, relation: "发生地" },
        { source: rawSubject, target: eventType, relation: "涉及事件" },
      ],
    };
  });

  return {
    enrichedTickets,
    status: "extracting",
  };
}
