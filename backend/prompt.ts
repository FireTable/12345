import { z } from "zod";
import type { RawTicket, MultiFrequencyTheme, EnrichedTicket } from "./state";
import { desensitizeContent, ticketBodyForAI } from "./anonymizer";
import { formatNegativeTermsForPrompt } from "./rules";
import { buildVocabularyPromptConstraint } from "@/lib/vocabulary";

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
    .describe("精准事发微观地点（必须包含：法定镇街 + 路段/巷号 + 具体门牌号/小区/地标，如：顺德区容桂街道扁滘富豪路三街2号门口）"),
  eventType: z
    .string()
    .describe("核心事件类型标准提炼（8-15字，如：机动车违规停放阻碍商铺经营、夜间营业音响喧哗与商业噪音扰民）"),
  category: z
    .enum([
      "城市管理",
      "市场监管",
      "社会治理",
      "交通出行",
      "生态环境",
      "劳动社保",
      "公共安全",
    ])
    .describe("民生业务归属分类"),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe("工单要素抽取综合置信度得分（0-100整数，评估主体、微观地点、诉求事件的清晰度与完整性）"),
});

export type ExtractedTicketItem = z.infer<typeof ExtractedTicketItemSchema>;

export const BatchExtractionSchema = z.object({
  items: z
    .array(ExtractedTicketItemSchema)
    .describe("工单结构化要素抽取结果列表"),
});

export type BatchExtractionResult = z.infer<typeof BatchExtractionSchema>;

/**
 * 二级 AI 仲裁消歧与纠偏 Zod Schema (Arbitration Schema)
 */
export const ArbitrationSchema = z.object({
  correctedSubject: z
    .string()
    .describe("纠正或确认后的具体涉事主体（精确到车牌或机构字号，杜绝泛词）"),
  correctedLocation: z
    .string()
    .describe("纠正后的微观地点（必须包含法定镇街+具体路段门牌/小区，严禁编造不存在的区划）"),
  correctedTownship: z
    .string()
    .describe("归属的顺德区法定镇街（必须为：大良街道、容桂街道、伦教街道、勒流街道、陈村镇、北滘镇、乐从镇、龙江镇、杏坛镇、均安镇之一）"),
  correctedEventType: z
    .string()
    .describe("标准提炼的核心事件问题（8-15字）"),
  correctedCategory: z
    .enum([
      "城市管理",
      "市场监管",
      "社会治理",
      "交通出行",
      "生态环境",
      "劳动社保",
      "公共安全",
    ])
    .describe("核定后的标准民生业务分类"),
  confidence: z
    .number()
    .min(0)
    .max(100)
    .describe("二级仲裁置信度得分（0-100）"),
  arbitrationReason: z
    .string()
    .describe("仲裁纠偏与消歧的核心依据（20-40字）"),
});

export type ArbitrationResult = z.infer<typeof ArbitrationSchema>;

/**
 * 2. 批量要素抽取 Prompt 生成器
 */
export function buildBatchExtractionPrompt(tickets: RawTicket[]): string {
  return `你是政务热线智能工单要素抽取专家。请对以下 ${tickets.length} 条工单精准提取主体、微观地点、事件类型、业务分类与置信度。

${buildVocabularyPromptConstraint()}

【抽取规则】：
1. subject（责任主体）：涉违停提取确切车牌（如"粤ESD221车辆"）；涉商家提取具体字号（如"招财宝民宿"）；涉市政设施提取设施名（如"市政排污管网"）；严禁使用"车主/商家/市民/当事人"等泛词。
2. location（微观地点）：必须包含"法定镇街 + 路段/小区 + 门牌/地标"（如"顺德区容桂街道扁滘富豪路三街2号门口"），镇街必须属于顺德法定镇街，严禁只填宽泛区名。
3. eventType（核心事件）：8-15字政务标准定性（如"机动车违规停放阻碍商铺经营"）。
4. summarizeTitle（诉求标题）：12-25字标准公文标题（如"关于容桂街道扁滘富豪路三街2号粤ESD221违停挪车诉求"）。
5. category：严格归入 7 大法定分类之一。
6. confidence（0-100）：要素明确完整打 85-98 分，主体模糊或诉求歧义打 20-55 分。

工单列表：
${tickets
  .map(
    (t, idx) =>
      `[${idx + 1}] 工单号: ${t.ticketNo} | 登记标题: ${desensitizeContent(t.title || "无")} | 登记辖区: ${t.subdistrict || "未指定"}\n诉求正文: ${ticketBodyForAI(t)}`
  )
  .join("\n\n")}`;
}

/**
 * 二级 AI 仲裁与事实复核 Prompt
 */
export function buildArbitrationPrompt(
  ticket: RawTicket,
  firstPass: ExtractedTicketItem
): string {
  return `你是政务 12345 疑难争议工单复核仲裁专家。首轮 AI 抽取置信度较低（${firstPass.confidence}分）或要素模糊。请结合诉求正文与法定镇街进行事实纠偏。

${buildVocabularyPromptConstraint()}

【原始工单】
- 工单号：${ticket.ticketNo}
- 登记标题：${desensitizeContent(ticket.title || "无")}
- 登记辖区：${ticket.subdistrict || "未指定"}
- 诉求正文：${ticketBodyForAI(ticket)}

【初筛要素（参考）】
- 候选主体：${firstPass.subject}
- 候选微观地点：${firstPass.location}
- 候选事件类型：${firstPass.eventType}
- 候选分类：${firstPass.category}

【复核指令】：
1. 深入正文挖掘隐蔽的具体车牌、商户字号或精准门牌，彻底纠正泛词。
2. 纠正镇街别称（如"容奇/桂洲"纠正为法定"容桂街道"）。
3. 输出纠正后的主体、微观地点、事件类型、分类及依据。`;
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
  patternType: z
    .enum(["GROUP_GATHERING", "INDIVIDUAL_REPEAT"])
    .nullable()
    .describe("多频形态（可选，可为 null）"),
  negativeSentimentHit: z
    .boolean()
    .nullable()
    .describe("是否命中负面情绪/险情词（可选，可为 null）"),
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
      `[${i + 1}] 区域: ${t.subdistrict || "本区"} | 登记时间: ${t.createTime}\n诉求正文（已脱敏）: ${ticketBodyForAI(t)}`
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

【负面险情词库（只用于写理由，最终红黄蓝由本地规则裁定）】：
${formatNegativeTermsForPrompt()}。命中且为群体聚集型时按 HIGH 理解，但不要试图压低本地已定的 HIGH。

【研判输出要求】：
1. riskLevel: "HIGH"（紧急安全隐患/群体诉求/反复未决） | "MEDIUM"（重点关注/矛盾激化可能） | "LOW"（常规咨询与流转）
2. riskReason: 简明扼要的风险诱因与态势研判（25-45字）
3. aiSummary: 深度公文级全貌研判，清晰指出市民核心痛点与演化倾向（60-100字）
4. recommendedAction: **高度贴合具体情境的针对性处置建议**（明确具体承办科室、响应时限与具体办理路径，拒绝千篇一律套用"现场核实"）（50-80字）`;
}

/**
 * 批量多频主题研判 Zod Schema（支持最多 10 个主题 1 个 AI 请求）
 */
export const BatchThemeEnrichmentSchema = z.object({
  results: z.array(
    z.object({
      themeIndex: z.number().describe("主题序号（从 1 开始，对应待研判列表 [1], [2], ...）"),
      riskLevel: z.enum(["HIGH", "MEDIUM", "LOW"]).describe("多频风险等级评定"),
      riskReason: z.string().describe("简明扼要的风险诱因与态势研判（25-45字）"),
      aiSummary: z.string().describe("深度公文级全貌研判综述（60-100字）"),
      recommendedAction: z.string().describe("针对性协同处置建议（明确牵头部门、响应时限及具体路径）（50-80字）"),
    })
  ),
});

export type BatchThemeEnrichmentResult = z.infer<typeof BatchThemeEnrichmentSchema>;

/**
 * 批量多频主题研判 Prompt 生成器（最多 10 个主题打包）
 */
export function buildBatchThemeEnrichmentPrompt(
  themes: MultiFrequencyTheme[]
): string {
  return `你是一位政务热线顶级智能研判与督办专家。请对以下 ${themes.length} 个多频诉求主题进行批量深度公文研判，输出各主题的风险评级、归因分析、全貌综述与精准协同处置建议。

【专业研判与协同处置指引（按具体民生领域精准指定牵头部门、响应时限与办理路径）】：
- 🚗 车辆违停/道路拥堵：由辖区交警中队联动综合行政执法队，1小时内到场劝离或电子抓拍处罚，保障主干道畅通；
- 🍢 流动摊贩/占道经营：由属地综合行政执法办/队加强早晚高峰路面巡查，规范跨门槛经营，引导入市规范经营；
- 🔊 商业噪音/夜间喧哗：由综合行政执法队联合辖区派出所开展夜间测噪联合巡查，责令涉事方加装降噪控音设施；
- 💨 餐饮油烟/工业废气：由属地生态环境所联合综合执法办核查净化设施与清洗台账，限期达标排放并开展油烟浓度抽测；
- 🏢 小区物业/电梯维保：由住建局物业科联合市场监管特种设备股下发督办单，限期排查安全隐患并张贴维保公示；
- 💧 市政排水/管网堵塞：由市政水务/排水抢修工程队立即赶赴现场排查，2小时内核定抢修方案并于当日完成通水排污保障；
- 💳 消费纠纷/虚假宣传：由属地市场监管所（消委会）于2个工作日内核查交易记录与凭证，组织调解并依法处置；
- 💼 劳资纠纷/社保待遇：由人社局劳动保障监察大队/医保中心介入核实，核查合同台账或线上申报校验，依法保障权益；
- 🎆 违规燃放/公共安全：由公安治安大队联动综合行政执法加强敏感时段路面巡查，制止违规行为并依法溯源；
- 📚 校园教育/节假安排：由教育局基教科核实法定节假日安排合规性，协同校方做好政策解释与家长沟通。

【待研判多频主题列表（共 ${themes.length} 个）】：
${themes
  .map((theme, idx) => {
    const sampleTickets = theme.tickets.slice(0, 3);
    return `=== [${idx + 1}] 主题 ID: ${theme.id} ===
- 涉及主体: ${theme.canonicalSubject}
- 发生区域/地点: ${theme.canonicalLocation}
- 核心问题类型: ${theme.eventType} (${theme.category})
- 涉及工单量: ${theme.ticketCount} 件，跨度: ${theme.timeSpanHours} 小时
- 样例诉求正文:
${sampleTickets
  .map(
    (t, i) =>
      `  (${i + 1}) [${t.subdistrict || "本区"}] ${t.summarizeTitle || t.title}: ${ticketBodyForAI(t).slice(0, 90)}...`
  )
  .join("\n")}`;
  })
  .join("\n\n")}

请严格按照 JSON 结构返回包含所有 ${themes.length} 个主题研判结论的 results 数组（themeIndex 必须与 [1]..[${themes.length}] 严格对应）。`;
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

用户提问：「${desensitizeContent(query)}」

请作为资深政务大数据研判专家，给出专业、严谨、有公文逻辑的回答：
1. 观点明确，条理清晰，善用 Markdown 加粗和列表；
2. 如果涉及具体主题或风险，请引用真实数据与建议；
3. 如果用户要求生成交办单或督办公文，请提供标准政务公文格式（包含单号、发文单位、主送单位、案情摘要、处置时限与督办要求）；
4. 语言精炼有力，体现高效政务治理水准。`;
}
