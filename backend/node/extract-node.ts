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
 * 批次调用大模型进行严格、精准的 AI 语义实体抽取与核心诉求标题提炼
 */
async function extractBatchWithLLM(
  tickets: RawTicket[],
  startIndex: number
): Promise<Map<number, ExtractedTicketItem>> {
  const result = new Map<number, ExtractedTicketItem>();
  if (tickets.length === 0) return result;

  try {
    const chat = getChatModel(0);
    const prompt = `你是一位政务热线顶级智能工单研判专家。请对以下 ${tickets.length} 条市民热线工单进行精准的实体识别、微观地点抽取、事件分类与摘要标题提炼。

【核心抽取规则 - 严谨区分物理实体，严禁混淆】：
1. subject（被诉具体对象/责任主体）：
   - 若涉及机动车违停/违章，必须提取精确车牌号作为主体（如 "粤E SD221车辆"、"粤EY6501车辆"），绝不可泛化为模糊的"车主"或"小车"！
   - 若涉及商家/企业/民宿/物业，必须提取具体字号全称（如 "招财宝民宿"、"林榢主题公寓"、"万象美食城"、"某某物业管理处"）。
   - 若涉及市政公共设施（无特定企业），提取具体设施对象（如 "市政排污管网"、"市政供水管网"、"路面交通信号设施"）。
   - 严禁提取空泛无意义词汇（如"车主"、"商家"、"市民"、"某单位"、"责任主体"、"当事人"）！

2. location（精准事发微观地点）：
   - 必须提取到最精确的物理空间（包含：镇街 + 路段/巷号 + 具体门牌号/小区/地标），例如："顺德区容桂街道扁滘富豪路三街2号门口"、"顺德区北滘镇碧桂园西苑翠堤岸10号"。
   - 严禁只填宽泛的"顺德区"或"容桂街道"！

3. eventType（核心事件类型）：
   - 8-15字政务标准问题定性（如 "机动车违规停放阻碍商铺经营"、"夜间营业音响喧哗与商业噪音扰民"、"市政排污管道水位过高导致污水反涌"）。

4. summarizeTitle（一句话高清诉求标题）：
   - 12-25字标准公文诉求标题（如 "关于容桂街道扁滘富豪路三街2号粤ESD221违停挪车诉求"）。

5. category：
   - 严格限定以下分类之一："市容秩序" | "生态环保" | "住建管理" | "市场监管" | "公共安全" | "交通出行" | "综合民生"

工单列表：
${tickets.map((t, idx) => `[${idx + 1}] 工单号: ${t.ticketNo} | 原始标题: ${t.title || "无"} | 所属辖区: ${t.subdistrict || "未指定"}\n诉求正文: ${t.content || ""}`).join("\n\n")}

请严格输出纯 JSON 数组（不要输出任何额外文字或解释）：
[
  {
    "index": 1,
    "summarizeTitle": "...",
    "subject": "...",
    "location": "...",
    "eventType": "...",
    "category": "..."
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

  // 1. 车牌专用精确识别（如 粤E SD221 或 粤EY6501）
  const matchPlate = content.match(/(?:车牌[号为：:\s]*|小车|车辆|车牌[：:\s]*)([粤京津沪渝冀豫云辽黑湘皖鲁新苏浙赣鄂桂甘晋蒙陕吉闽贵粤青藏川宁琼][A-Z][\s]?[A-Z0-9]{4,6}[A-Z0-9挂学警港澳]?)/);
  const plateSubject = matchPlate && matchPlate[1] ? `${matchPlate[1].replace(/\s+/g, "").toUpperCase()}车辆` : "";

  // 2. 商家/企业/机构主体识别（严防把"执法部门/政府部门"当作被诉主体）
  let orgSubject = "";
  const matchSubj = content.match(/(?:在|位于|投诉|反映|名称[：:])([^\s，。、（）]{2,25}?(?:民宿|公寓|酒店|酒馆|酒吧|KTV|烧烤店|大排档|快餐店|美食城|商场|便利店|超市|体验馆|俱乐部|桌球室|茶庄|饭店|有限公司|工程部|施工方|物业(?:管理处)?|花园|小区|苑|自建房|大厦))/);
  if (matchSubj && matchSubj[1]) {
    const candidate = matchSubj[1].trim();
    if (!candidate.includes("部门") && !candidate.includes("居委") && !candidate.includes("街道办")) {
      orgSubject = candidate;
    }
  }

  const subject = plateSubject || orgSubject || (subdistrict ? `${subdistrict}特定涉事方` : "特定诉求涉事方");

  // 3. 通用动态微观地点识别（必须包含路/街/巷/号/小区/广场等，且严防"部门"伪装为"门"）
  let location = subdistrict ? `${subdistrict}辖区` : "顺德区事发地";
  const matchLoc = content.match(/([^\s，。、（）]{2,25}?(?:街道|镇)?[^\s，。、（）]{2,20}?(?:路|大道|大街|巷|横街|横巷|新村|广场|公园|中心|城|大厦|小区|花园|公寓|自建房|\d+号(?:门口|附近)?))/);
  if (matchLoc && matchLoc[1]) {
    const locCand = matchLoc[1].replace(/^(?:市民|诉求人|致电|反映|在|位于|我是)/, "").trim();
    const badWords = ["部门", "希望", "反映", "致电", "要求", "执法", "电话", "介入", "处理", "情况", "问题"];
    if (!badWords.some((w) => locCand.includes(w)) && locCand.length >= 4) {
      location = locCand;
    }
  }

  let eventType = "综合民生诉求跟进";
  let category = "综合民生";

  if (plateSubject || content.includes("违停") || content.includes("乱停") || content.includes("停放") || content.includes("挪车")) {
    eventType = "机动车违规停放阻碍通行";
    category = "交通出行";
  } else if (content.includes("噪音") || content.includes("扰民") || content.includes("音乐") || content.includes("喧哗")) {
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
