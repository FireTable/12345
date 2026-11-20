import type { CivicIntent } from "@civic/system-one";

export interface EcommerceTriageInput {
  title?: string | null;
  content: string;
  subdistrict?: string | null;
}

export interface EcommerceTriageResult {
  intent: CivicIntent;
  urgency: "NORMAL" | "MEDIUM" | "URGENT";
  slaHours: 0 | 2 | 24 | 120 | 360;
  stabilityRisk: boolean;
  category: string;
  riskSignals: string[];
  adapter: "ecommerce-rule";
}

const REDLINE_RULES: Array<{ pattern: RegExp; label: string }> = [
  { pattern: /12315|市场监管|市监局|消协|消费者协会|工商投诉|举报投诉/, label: "12315/市监监管举报风险" },
  { pattern: /微博|小红书|抖音曝光|热搜|舆论|集体维权|媒体曝光|黑猫投诉|全网曝光/, label: "社媒舆情发酵风险" },
  { pattern: /食物中毒|腹泻|呕吐|发霉|腐烂|变质|异物|虫子|过期食品|食安/, label: "食品安全红线" },
  { pattern: /假货|假冒|山寨|高仿|仿冒|防伪码失败|以次充好|欺诈/, label: "假冒伪劣合规红线" },
];

/**
 * 电商售后客诉轻量快思考分流器。
 * 识别 12315 投诉、社媒舆情发酵、食安/假冒合规红线及 7 大电商客诉分类。
 */
export function evaluateEcommerceTicket(
  input: EcommerceTriageInput
): EcommerceTriageResult {
  const combined = [input.title, input.content, input.subdistrict]
    .filter(Boolean)
    .join(" ")
    .trim();

  const riskSignals: string[] = [];
  for (const rule of REDLINE_RULES) {
    if (rule.pattern.test(combined)) {
      riskSignals.push(rule.label);
    }
  }

  const stabilityRisk = riskSignals.length > 0;

  let intent: CivicIntent = "COMPLAINT";
  if (/催办|催促|假闭环|已安抚|敷衍|推诿|再次投诉|48小时|未处理完|反弹|回潮/.test(combined)) {
    intent = "REMINDER";
  } else if (/表扬|点赞|感谢客服/.test(combined) && !/投诉|问题|破损|退款|差评/.test(combined)) {
    intent = "COMMENDATION";
  } else if (/建议|希望优化/.test(combined) && !/投诉|索赔|退款|12315|假货/.test(combined)) {
    intent = "SUGGESTION";
  } else if (/怎么退|如何申请|什么时候发货|查询物流|咨询/.test(combined) && !/投诉|破损|变质|假货|超时|退款失败/.test(combined)) {
    intent = "INQUIRY";
  }

  let category = "商品质量与破损";
  if (/食物中毒|腹泻|呕吐|发霉|腐烂|变质|异物|虫子|过期|食安|生鲜坏|化冻发臭/.test(combined)) {
    category = "食安与合规红线";
  } else if (/假货|假冒|山寨|高仿|仿冒|防伪|三无|欺诈|以次充好/.test(combined)) {
    category = "假冒伪劣与欺诈";
  } else if (/机械回复|已安抚|推诿|踢皮球|客服不理|售后超时|假闭环|敷衍|48h|48小时未解决/.test(combined)) {
    category = "客服推诿与售后超时";
  } else if (/退款|退货|价保|差价|拒退|未到账|定金|尾款/.test(combined)) {
    category = "退款与价保纠纷";
  } else if (/货不对板|宣传不符|直播间夸大|错发|漏发|少发|尺码不符|图文不符/.test(combined)) {
    category = "货不对板与宣传不符";
  } else if (/延误|丢件|停滞|未揽收|物流|快递|冷链超时|面单|承运商|派送/.test(combined)) {
    category = "物流延误与丢件";
  } else if (/破损|碎裂|瑕疵|异响|漏液|开裂|质量|坏了|化冻|解冻/.test(combined)) {
    category = "商品质量与破损";
  }

  let urgency: "NORMAL" | "MEDIUM" | "URGENT" = "NORMAL";
  let slaHours: 0 | 2 | 24 | 120 | 360 = 120;
  if (stabilityRisk) {
    urgency = "URGENT";
    slaHours = 2;
  } else if (
    intent === "REMINDER" ||
    /冷链|生鲜|破损|丢件|加急|超时|批次/.test(combined)
  ) {
    urgency = "MEDIUM";
    slaHours = 24;
  } else if (intent === "INQUIRY") {
    urgency = "NORMAL";
    slaHours = 0;
  }

  return {
    intent,
    urgency,
    slaHours,
    stabilityRisk,
    category,
    riskSignals,
    adapter: "ecommerce-rule",
  };
}
