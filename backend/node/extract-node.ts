import type { TicketRadarState, EnrichedTicket, RawTicket } from "../state";
import { getChatModel } from "../model";

interface ExtractedTicketItem {
  index: number;
  summarizeTitle: string;
  subject: string;
  location: string;
  eventType: string;
  category: string;
}

/**
 * 批次调用大模型进行纯 AI 语义四要素抽取与核心诉求标题提炼（完全基于 LLM 理解）
 */
async function extractBatchWithLLM(
  tickets: RawTicket[],
  startIndex: number
): Promise<Map<number, ExtractedTicketItem>> {
  const result = new Map<number, ExtractedTicketItem>();
  if (tickets.length === 0) return result;

  try {
    const chat = getChatModel(0);
    const prompt = `你是一位政务热线智能工单研判 Agent。请对以下 ${tickets.length} 条市民热线工单进行结构化要素抽取与核心诉求标题提炼。完全依靠语义理解提取被诉主体、发生地点、事件核心特征、民生类别并生成一句话标准摘要标题。

工单列表：
${tickets.map((t, idx) => `[${idx + 1}] 工单号: ${t.ticketNo} | 原始标题: ${t.title || "无"} | 所属辖区: ${t.subdistrict || "未指定"}\n诉求正文: ${t.content || ""}`).join("\n\n")}

请严格输出纯 JSON 数组（不要有 markdown 代码块以外的任何文字）：
[
  {
    "index": 1,
    "summarizeTitle": "提炼的一句话标准诉求标题（12-25字，如：关于xx街道xx路夜间餐饮油烟排放扰民诉求）",
    "subject": "被诉主体/责任单位名称（如商家名/物业公司/项目部/经营者/职能部门）",
    "location": "标准发生地点（包含行政区/镇街/道路/小区/地标）",
    "eventType": "事件类型核心提炼（6-15字）",
    "category": "市容秩序|生态环保|住建管理|市场监管|公共安全|交通出行|综合民生"
  }
]`;

    const res = await chat.invoke(prompt);
    const text = typeof res.content === "string" ? res.content : JSON.stringify(res.content);
    const jsonMatch = text.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const items: ExtractedTicketItem[] = JSON.parse(jsonMatch[0]);
      for (const item of items) {
        if (item && typeof item.index === "number") {
          result.set(startIndex + item.index - 1, {
            index: item.index,
            summarizeTitle: String(item.summarizeTitle || "").trim(),
            subject: String(item.subject || "").trim(),
            location: String(item.location || "").trim(),
            eventType: String(item.eventType || "").trim(),
            category: String(item.category || "综合民生").trim(),
          });
        }
      }
    }
  } catch (err: any) {
    console.warn(`LLM Batch Extraction failed for chunk at ${startIndex}:`, err.message);
  }

  return result;
}

/**
 * 通用正则兜底提取器（当网络离线时备用，通用中文模式，零特定地名硬编码）
 */
function fallbackDynamicExtraction(ticket: RawTicket): ExtractedTicketItem {
  const content = typeof ticket?.content === "string" ? ticket.content : "";
  const subdistrict = ticket?.subdistrict || "";

  // 通用动态主体识别
  const matchSubj = content.match(/(?:在|位于|投诉|反映|名称[：:])([^\s，。、（）]{2,25}?(?:民宿|公寓|酒店|酒馆|酒吧|KTV|烧烤店|大排档|快餐店|美食城|商场|便利店|超市|体验馆|俱乐部|桌球室|茶庄|饭店|有限公司|项目部|工程部|施工方|物业|花园|小区|苑|居委会|公司|中心|店))/);
  const subject = matchSubj && matchSubj[1] ? matchSubj[1] : (subdistrict ? `${subdistrict}重点涉事方` : "重点诉求责任主体");

  // 通用动态地点识别（行政区/镇街/路/巷/社区）
  const matchLoc = content.match(/([^\s，。、（）]{2,25}?(?:区|县|镇|街道|社区|村|路|街|巷|大道|广场|公园|中心|城|站|门|大厦|居))/);
  const location = matchLoc && matchLoc[1] ? matchLoc[1] : (subdistrict || "事发辖区所在地");

  let eventType = "综合民生诉求跟进";
  let category = "综合民生";

  if (content.includes("噪音") || content.includes("扰民") || content.includes("音乐") || content.includes("喧哗")) {
    eventType = "夜间营业音响喧哗与商业噪音扰民";
    category = "生态环保";
  } else if (content.includes("烟花") || content.includes("爆竹")) {
    eventType = "违规燃放/售卖烟花爆竹扰民";
    category = "公共安全";
  } else if (content.includes("油烟") || content.includes("排气") || content.includes("异味")) {
    eventType = "餐饮油烟直排与空气污染";
    category = "生态环保";
  } else if (content.includes("水管") || content.includes("下水道") || content.includes("排污")) {
    eventType = "市政排污管道与供水抢修问题";
    category = "住建管理";
  } else if (content.includes("小贩") || content.includes("摆摊") || content.includes("占道")) {
    eventType = "流动摊贩占道经营与路面堵塞";
    category = "市容秩序";
  } else if (content.includes("退款") || content.includes("收费") || content.includes("欺诈")) {
    eventType = "消费纠纷与违规收费维权";
    category = "市场监管";
  } else if (content.includes("物业") || content.includes("电梯")) {
    eventType = "小区物业管理与公共设施隐患";
    category = "住建管理";
  }

  return {
    index: 0,
    summarizeTitle: `关于${location}${subject}${eventType}的诉求`,
    subject,
    location,
    eventType,
    category,
  };
}

/**
 * Extract Node: 全量采用 AI Agent 大模型语义抽取四要素与摘要标题
 */
export async function extractNode(
  state: TicketRadarState
): Promise<Partial<TicketRadarState>> {
  const rawTickets = state.rawTickets || [];
  const CHUNK_SIZE = 15;
  const chunkPromises: Array<Promise<Map<number, ExtractedTicketItem>>> = [];

  // 并发切片提交大模型抽取
  for (let i = 0; i < rawTickets.length; i += CHUNK_SIZE) {
    const chunk = rawTickets.slice(i, i + CHUNK_SIZE);
    chunkPromises.push(extractBatchWithLLM(chunk, i));
  }

  const chunkResults = await Promise.allSettled(chunkPromises);
  const extractionMap = new Map<number, ExtractedTicketItem>();

  chunkResults.forEach((res) => {
    if (res.status === "fulfilled") {
      res.value.forEach((val, key) => extractionMap.set(key, val));
    }
  });

  const enrichedTickets: EnrichedTicket[] = rawTickets.map((ticket, index) => {
    const fallback = fallbackDynamicExtraction(ticket);
    const aiExtracted = extractionMap.get(index);
    const summarizeTitle = aiExtracted?.summarizeTitle || ticket.summarizeTitle || fallback.summarizeTitle;
    const canonicalSubject = aiExtracted?.subject || fallback.subject;
    const canonicalLocation = aiExtracted?.location || fallback.location;
    const eventType = aiExtracted?.eventType || fallback.eventType;
    const category = aiExtracted?.category || fallback.category;

    return {
      ...ticket,
      summarizeTitle,
      canonicalSubject,
      canonicalLocation,
      eventType,
      themes: [category],
      entities: [
        { name: canonicalSubject, canonicalName: canonicalSubject, type: "SUBJECT", confidence: 0.95 },
        { name: canonicalLocation, canonicalName: canonicalLocation, type: "LOCATION", confidence: 0.92 },
        { name: eventType, canonicalName: eventType, type: "EVENT_TYPE", confidence: 0.94 },
      ],
      relations: [
        { source: ticket.id, target: canonicalSubject, relation: "投诉主体" },
        { source: ticket.id, target: canonicalLocation, relation: "发生地" },
        { source: canonicalSubject, target: eventType, relation: "涉及事件" },
      ],
    };
  });

  return {
    enrichedTickets,
    status: "extracting",
  };
}
