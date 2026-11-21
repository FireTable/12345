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

const ECOM_ADVERSATIVE_GAP =
  "(?:(?!但|却|不过|可是|然而|而是|只是|就是|还|又|竟|居然|反而|卖|售)[^，,。！？；;\\n])";

const ECOM_STRONG_NEG_PREFIX_RE = new RegExp(
  `(?:并非|并不是|不是|不存在|已排除|排除|不涉及|无需|不需要|不用|不必|不想|不打算)${ECOM_ADVERSATIVE_GAP}{0,6}$`
);

const ECOM_ABSENCE_NEG_PREFIX_RE = new RegExp(
  `(?:(?:并没有|还没有|没有出现|没有发生|没有|并未出现|并未发生|并未|未见|未出现|未发生|未(?!来|果)|不会|没去|没打|没找|没向|暂未|尚未)${ECOM_ADVERSATIVE_GAP}{0,6}|无(?:任何|明显|实际|发生|迹象)${ECOM_ADVERSATIVE_GAP}{0,4}|无人|无)$`
);

const ECOM_DUTY_OMISSION_TARGET_RE =
  /^(?:退款|退钱|赔付|赔偿|补偿|到账|揽收|发货|处理|解决|收到|退(?:$|[^货]))/;

const ECOM_CHAIN_DOMAIN_TERM =
  "(?:食物过敏|吃坏肚子|馊了|虫卵|过期食品|食品过期|无生产日期|三无食品|翻新机|二手充新|盗版|食物中毒|食源性中毒|腹泻|拉肚子|窜稀|上吐下泻|闹肚子|呕吐|发霉|长毛|长霉|腐烂|腐败|变质|发臭|酸臭|发酸|异物|虫子|生虫|长虫|过期|食安|假货|假冒|山寨|高仿|仿冒|仿品|[Aa]货|冒牌|水货|欺诈|以次充好|破损|碎裂|瑕疵|异响|漏液|开裂|丢件|丢包|延误|超时|问题|投诉|差评|索赔|退款|假闭环|推诿|敷衍)";

const ECOM_CHAIN_NEG_RE = new RegExp(
  `(?:并非|并不是|不是|并没有|没有出现|没有发生|没有|并未出现|并未发生|并未|未见|未出现|未发生|不存在|已排除|排除|不涉及|无)(?:(?:任何|明显|实际)的?)?(?:${ECOM_CHAIN_DOMAIN_TERM}(?:以及|及|和|或|与|、))+(?:任何|明显|实际)?$`
);

// 责任落空类目标（退款/到账/揽收…）默认不因"没有/未"而被否定（"没有退款"是诉求），
// 但"没有申请退款""无任何退款诉求"属于明确的无此诉求，仍需视为否定。
const ECOM_DUTY_INTENT_NEG_PREFIX_RE =
  /(?:没有|没|未|并未|暂未|不|无需|不需要)(?:申请|要求|打算|想要?|需要)$/;
const ECOM_DUTY_NONE_PREFIX_RE = /无(?:任何)?$/;
const ECOM_DUTY_NONE_SUFFIX_RE = /^(?:诉求|要求|打算|需求|意向|想法)/;

export function hasPositiveMatch(text: string, pattern: RegExp): boolean {
  if (!text) return false;
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalRe = new RegExp(pattern.source, flags);
  let match: RegExpExecArray | null;
  while ((match = globalRe.exec(text)) !== null) {
    if (match[0].length === 0) {
      globalRe.lastIndex += 1;
      continue;
    }
    const idx = match.index;
    const matched = match[0];
    const pre = text.slice(Math.max(0, idx - 16), idx);
    if (ECOM_STRONG_NEG_PREFIX_RE.test(pre)) {
      continue;
    }
    const isDutyTarget = ECOM_DUTY_OMISSION_TARGET_RE.test(matched);
    if (isDutyTarget) {
      if (ECOM_DUTY_INTENT_NEG_PREFIX_RE.test(pre)) continue;
      if (
        ECOM_DUTY_NONE_PREFIX_RE.test(pre) &&
        ECOM_DUTY_NONE_SUFFIX_RE.test(text.slice(idx + matched.length))
      ) {
        continue;
      }
    }
    if (!isDutyTarget && ECOM_ABSENCE_NEG_PREFIX_RE.test(pre)) {
      continue;
    }
    const chainPre = text.slice(Math.max(0, idx - 32), idx);
    if (!isDutyTarget && ECOM_CHAIN_NEG_RE.test(chainPre)) {
      continue;
    }
    return true;
  }
  return false;
}

const REDLINE_RULES: Array<{ pattern: RegExp; label: string }> = [
  {
    pattern: /12315|12345|315投诉|315举报|市场监管|市监局|市监部门|工商局|消协|消费者协会|工商投诉|举报投诉|食药监|邮政申诉|行政举报/,
    label: "12315/市监监管举报风险",
  },
  {
    pattern: /微博(?:维权)?|小红书(?:避雷)?|抖音曝光|快手曝光|热搜|舆论|集体维权|联合维权|抱团维权|拉群维权|媒体曝光|媒体爆料|黑猫投诉|黑猫维权|全网曝光|315曝光/,
    label: "社媒舆情发酵风险",
  },
  {
    pattern: /食物中毒|食源性中毒|腹泻|拉肚子|窜稀|上吐下泻|闹肚子|吃坏肚子|食物过敏|呕吐|发霉|长毛|长霉|腐烂|腐败|变质|发臭|酸臭|发酸|馊了|异物|虫子|生虫|长虫|虫卵|吃出(?:头发|塑料|玻璃|铁丝|蟑螂|虫)|过期食品|食品过期|无生产日期|三无食品|食安/,
    label: "食品安全红线",
  },
  {
    pattern: /假货|假冒|山寨|高仿|仿冒|仿品|a货|冒牌|水货|翻新机|二手充新|防伪(?:码|验证)?(?:失败|查不到|无效|异常)|扫码验真失败|以次充好|欺诈|(?<!是)不是正品|非正品|盗版|贴牌假货/i,
    label: "假冒伪劣合规红线",
  },
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
    if (hasPositiveMatch(combined, rule.pattern)) {
      riskSignals.push(rule.label);
    }
  }

  const stabilityRisk = riskSignals.length > 0;

  let intent: CivicIntent = "COMPLAINT";
  if (
    hasPositiveMatch(
      combined,
      /催办|催促|催一下|假闭环|已安抚|敷衍|推诿|踢皮球|再次投诉|二次投诉|反复投诉|48小时|未处理完|还没解决|压根没处理|一直拖|没人管|反弹|回潮|没有解决|没解决|未解决|并未解决|暂未解决|没有处理|没处理|未处理|并未处理|暂未处理/
    )
  ) {
    intent = "REMINDER";
  } else if (
    hasPositiveMatch(combined, /表扬|点赞|五星好评|好评|感谢客服|感谢售后|辛苦了/) &&
    !hasPositiveMatch(combined, /投诉|问题|破损|退款|差评|不满意|没解决|没有解决|未解决/)
  ) {
    intent = "COMMENDATION";
  } else if (
    hasPositiveMatch(combined, /建议|希望优化|希望改进|提个意见/) &&
    !hasPositiveMatch(combined, /投诉|索赔|退款|赔付|赔偿|没发货|没有发货|未发货|12315|假货|到账|退钱|不给退|拒退|不退|没收到|没有收到|没有得到解决/)
  ) {
    intent = "SUGGESTION";
  } else if (
    !stabilityRisk &&
    hasPositiveMatch(
      combined,
      /怎么退|如何申请|什么时候发货|何时发货|几天到|多久能到|查询物流|查一下物流|物流到哪了|怎么开发票|怎么操作|咨询|请问/
    ) &&
    !hasPositiveMatch(
      combined,
      /投诉|破损|变质|假货|超时|退款失败|发霉|丢件|少发|错发|没发货|没有发货|未发货|并未发货|暂未发货|没有收到退款|还没收到退款|没收到退款|未收到退款|没退|未退|没有到账|没到账|没有揽收|还没有揽收/
    )
  ) {
    intent = "INQUIRY";
  }

  let category = "商品质量与破损";
  if (
    hasPositiveMatch(
      combined,
      /食物中毒|食源性中毒|腹泻|拉肚子|窜稀|上吐下泻|闹肚子|吃坏肚子|食物过敏|呕吐|发霉|长毛|长霉|腐烂|腐败|变质|发臭|酸臭|发酸|馊了|异物|虫子|生虫|长虫|虫卵|吃出(?:头发|塑料|玻璃|铁丝|蟑螂|虫)|过期|无生产日期|三无食品|食安|生鲜坏|化冻发臭/
    )
  ) {
    category = "食安与合规红线";
  } else if (
    hasPositiveMatch(
      combined,
      /假货|假冒|山寨|高仿|仿冒|仿品|a货|冒牌|水货|翻新机|二手充新|防伪(?:码|验证)?(?:失败|无效|异常|查不到|不对|假|有问题|无法)|扫码验真失败|三无|欺诈|以次充好|(?<!是)不是正品|非正品|盗版|贴牌/i
    )
  ) {
    category = "假冒伪劣与欺诈";
  } else if (
    hasPositiveMatch(
      combined,
      /机械回复|机器人回复|已安抚|推诿|踢皮球|客服不理|客服不回复|联系不上客服|转不到人工|已读不回|装死|售后超时|假闭环|强行结案|强行关闭|直接关单|一直拖|没人管|敷衍|48h|48小时|(?:客服|售后)[^，,。！？；;\n]{0,6}(?:没|没有|未|并未|暂未)(?:解决|处理)/
    )
  ) {
    category = "客服推诿与售后超时";
  } else if (
    hasPositiveMatch(
      combined,
      /退款|退货|退钱|价保|保价|差价|拒退|不给退|未到账|没到账|没有到账|并未到账|暂未到账|迟迟不到账|定金|尾款|赔付|赔偿|补偿/
    )
  ) {
    category = "退款与价保纠纷";
  } else if (
    hasPositiveMatch(
      combined,
      /货不对板|货不对版|宣传不符|直播间夸大|夸大宣传|错发|发错|漏发|少发|少件|漏件|赠品没发|尺码不符|图文不符|实物不符|缺斤少两/
    )
  ) {
    category = "货不对板与宣传不符";
  } else if (
    hasPositiveMatch(
      combined,
      /延误|丢件|丢包|寄丢|停滞|未揽收|没有揽收|(?:什么时候|何时|啥时候)发货|没发货|没有发货|未发货|并未发货|暂未发货|虚假发货|一直不更新|卡在半路|擅自签收|虚假签收|物流|快递|冷链超时|面单|承运商|派送/
    )
  ) {
    category = "物流延误与丢件";
  } else if (
    hasPositiveMatch(
      combined,
      /破损|碎裂|碎了|摔坏|压扁|压坏|瑕疵|异响|漏液|漏水|开裂|质量|坏了|用不了|不能用|化冻|解冻|融化|化了|掉漆|划痕|开不了机|失灵|次品|残次品/
    )
  ) {
    category = "商品质量与破损";
  } else if (
    hasPositiveMatch(
      combined,
      /没解决|没有解决|未解决|并未解决|暂未解决|没有处理|没处理|未处理|并未处理|暂未处理/
    )
  ) {
    category = "客服推诿与售后超时";
  }

  let urgency: "NORMAL" | "MEDIUM" | "URGENT" = "NORMAL";
  let slaHours: 0 | 2 | 24 | 120 | 360 = 120;
  if (stabilityRisk) {
    urgency = "URGENT";
    slaHours = 2;
  } else if (
    intent === "REMINDER" ||
    hasPositiveMatch(
      combined,
      /冷链|生鲜|破损|碎了|丢件|丢包|加急|急用|赶时间|马上要|尽快|超时|批次|化冻|解冻|融化|漏液|坏了|没发货|没有发货|未发货|并未发货|暂未发货|没有揽收|发错|少发/
    )
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
