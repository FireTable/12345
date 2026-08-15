import { z } from "zod";
import type { RawTicket, MultiFrequencyTheme, EnrichedTicket } from "./state";
import { desensitizeContent } from "./anonymizer";

/**
 * 1. 结构化抽取 Zod Schema (Structured Extraction Schemas)
 */
export const ExtractedTicketItemSchema = z.object({
  index: z
    .number()
    .describe("工单序号（1-indexed，对应输入列表中的序号）"),
  summarizeTitle: z
    .string()
    .describe("提炼的一句话标准公文诉求摘要标题（12-25字，如：关于容桂街道扁滘富豪路三街2号粤ESD221违停挪车诉求）"),
  subject: z
    .string()
    .describe("被诉具体对象/责任主体名称（如具体车牌号'粤E SD221车辆'、商铺全称'招财宝民宿'、物业公司'某某物业管理处'；严禁使用'车主/商家/市民/某单位'等泛化虚词）"),
  location: z
    .string()
    .describe("精准事发微观地点（必须包含：镇街 + 路段/巷号 + 具体门牌号/小区/地标，如：顺德区容桂街道扁滘富豪路三街2号门口）"),
  eventType: z
    .string()
    .describe("核心事件类型标准提炼（8-15字，如：机动车违规停放阻碍商铺经营、夜间营业音响喧哗与商业噪音扰民）"),
  category: z
    .enum([
      "市容秩序",
      "生态环保",
      "住建管理",
      "市场监管",
      "公共安全",
      "交通出行",
      "综合民生",
    ])
    .describe("民生业务归属分类"),
});

export type ExtractedTicketItem = z.infer<typeof ExtractedTicketItemSchema>;

export const BatchExtractionSchema = z.object({
  items: z
    .array(ExtractedTicketItemSchema)
    .describe("工单结构化要素抽取结果列表"),
});

export type BatchExtractionResult = z.infer<typeof BatchExtractionSchema>;

/**
 * 2. 批量要素抽取 Prompt 生成器
 */
export function buildBatchExtractionPrompt(tickets: RawTicket[]): string {
  return `你是一位政务热线顶级智能工单研判专家。请对以下 ${tickets.length} 条市民热线工单进行精准的实体识别、微观地点抽取、事件分类与摘要标题提炼。

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
   - 严格限定分类："市容秩序" | "生态环保" | "住建管理" | "市场监管" | "公共安全" | "交通出行" | "综合民生"

工单列表：
${tickets
  .map(
    (t, idx) =>
      `[${idx + 1}] 工单号: ${t.ticketNo} | 原始标题: ${t.title || "无"} | 所属辖区: ${t.subdistrict || "未指定"}\n诉求正文（已脱敏）: ${desensitizeContent(t.maskedContent || t.content || "")}`
  )
  .join("\n\n")}`;
}

/**
 * 3. 多频主题深度研判 Zod Schema
 */
export const ThemeEnrichmentSchema = z.object({
  riskLevel: z
    .enum(["HIGH", "MEDIUM", "LOW"])
    .describe("多频风险等级评定（HIGH: 紧急/安全隐患/群体诉求/反复未决; MEDIUM: 重点关注/矛盾激化可能; LOW: 常规咨询与流转）"),
  riskReason: z
    .string()
    .describe("简明扼要的风险诱因与态势研判（25-45字）"),
  aiSummary: z
    .string()
    .describe("深度公文级全貌研判综述，清晰指出市民核心痛点与诉求演化倾向（60-100字）"),
  recommendedAction: z
    .string()
    .describe("高度贴合具体诉求的针对性协同处置建议（必须明确指出牵头部门/科室、响应时限及具体办理路径）（50-80字）"),
});

export type ThemeEnrichmentResult = z.infer<typeof ThemeEnrichmentSchema>;

/**
 * 4. 多频主题研判 Prompt 生成器
 */
export function buildThemeEnrichmentPrompt(
  theme: MultiFrequencyTheme,
  sampleTickets: EnrichedTicket[]
): string {
  return `你是一位政务热线智能研判与督办专家。请根据以下多频诉求数据（共 ${theme.ticketCount} 件工单，跨时 ${theme.timeSpanHours} 小时），深入分析并输出高度契合具体情境的专业政务研判结论。

【诉求基本信息】
- 被诉/涉及主体：${theme.canonicalSubject}
- 发生区域/地点：${theme.canonicalLocation}
- 核心问题类型：${theme.eventType}
- 涉及工单列表：
${sampleTickets
  .map(
    (t, i) =>
      `[${i + 1}] 区域: ${t.subdistrict || "本区"} | 登记时间: ${t.createTime}\n诉求正文（已脱敏）: ${desensitizeContent(t.maskedContent || t.content)}`
  )
  .join("\n\n")}

【专业研判与协同处置指引（按具体民生领域精准指定牵头部门、响应时限与办理路径）】：
- 🚗 车辆违停/道路拥堵：由辖区交警中队联动综合行政执法队，1小时内到场劝离或电子抓拍处罚，保障主干道畅通；
- 🍢 流动摊贩/占道经营：由属地综合行政执法办/队加强早晚高峰路面巡查，规范跨门槛经营，引导摊贩入市规范经营；
- 🔊 商业噪音/夜间喧哗：由综合行政执法队联合辖区派出所开展夜间测噪联合巡查，责令涉事方加装降噪控音设施；
- 💨 餐饮油烟/工业废气：由属地生态环境所联合综合执法办核查净化设施与清洗台账，限期达标排放并开展油烟浓度抽测；
- 🏢 小区物业/电梯维保：由住建局物业科联合市场监管特种设备股下发督办单，限期排查安全隐患并张贴维保公示；
- 💧 市政排水/管网堵塞：由市政水务/排水抢修工程队立即赶赴现场排查，2小时内核定抢修方案并于当日完成通水排污保障；
- 💳 消费纠纷/虚假宣传：由属地市场监管所（消委会）于2个工作日内核查交易记录与凭证，组织调解并依法处置；
- 💼 劳资纠纷/社保待遇：由人社局劳动保障监察大队/医保中心介入核实，核查合同台账或线上申报校验，依法保障权益；
- 🎆 违规燃放/公共安全：由公安治安大队联动综合行政执法加强敏感时段路面巡查，制止违规行为并依法溯源；
- 📚 校园教育/节假安排：由教育局基教科核实法定节假日安排合规性，协同校方做好政策解释与家长沟通。

【研判输出要求】：
1. riskLevel: "HIGH"（紧急安全隐患/群体诉求/反复未决） | "MEDIUM"（重点关注/矛盾激化可能） | "LOW"（常规咨询与流转）
2. riskReason: 简明扼要的风险诱因与态势研判（25-45字）
3. aiSummary: 深度公文级全貌研判，清晰指出市民核心痛点与演化倾向（60-100字）
4. recommendedAction: **高度贴合具体情境的针对性处置建议**（明确具体承办科室、响应时限与具体办理路径，拒绝千篇一律套用"现场核实"）（50-80字）`;
}

/**
 * 5. AI Copilot 问答副驾驶 Prompt 生成器
 */
export function buildCopilotPrompt(params: {
  query: string;
  totalCount: number;
  currentThemes: any[];
  highRiskCount: number;
  mediumRiskCount: number;
}): string {
  const { query, totalCount, currentThemes, highRiskCount, mediumRiskCount } = params;
  return `你是由 LangGraph JS 图工作流驱动的 12345 政务热线智能研判副驾驶（LightCopilot）。
当前大盘运行数据底座如下：
- 工单总接入量：${totalCount} 件
- 识别多频主题总数：${currentThemes.length} 个
- 高危紧急事件：${highRiskCount} 项，重点跟进事件：${mediumRiskCount} 项
- 重点多频主题摘要：
${currentThemes
  .map(
    (t, idx) =>
      `${idx + 1}. 【${t.riskLevel}】${t.title}（${t.ticketCount}件工单，位于${t.canonicalLocation}，处置科室建议：${t.recommendedAction}）`
  )
  .join("\n")}

用户提问：「${query}」

请作为资深政务大数据研判专家，给出专业、严谨、有公文逻辑的回答：
1. 观点明确，条理清晰，善用 Markdown 加粗和列表；
2. 如果涉及具体主题或风险，请引用真实数据与建议；
3. 如果用户要求生成交办单或督办公文，请提供标准政务公文格式（包含单号、发文单位、主送单位、案情摘要、处置时限与督办要求）；
4. 语言精炼有力，体现高效政务治理水准。`;
}
