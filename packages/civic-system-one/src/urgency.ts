/**
 * 12345 政务工单紧迫度符号判别器（含否定/已整改语境窗口）
 *
 * 与 ONNXAdapter / FallbackAdapter / 入库预处理共用同一套高危安全与民生中断规则：
 * 1. Level 3（URGENT，2小时）：生命安全受困、火灾燃爆、燃气/危化泄漏、漏电触电、井盖缺失/路面塌陷/高空坠物、消防通道堵塞等。
 * 2. Level 2（MEDIUM，24小时）：大面积停水/停电/停气、爆管/严重积水/信号灯故障、交通瘫痪、明确安全隐患或多次反映未果。
 * 3. 通过前向 16 字否定/已整改语境窗口过滤“无安全隐患”“无人被困”“已修复”等误触，并为 ONNX 输出提供 negatedOnly 降级依据。
 */

export interface CivicUrgencySignal {
  level: 0 | 1 | 2 | 3;
  urgency: "URGENT" | "MEDIUM" | "NORMAL";
  slaHours: 0 | 2 | 24 | 120;
  category?: string;
  keyword?: string;
  negatedOnly: boolean;
}

interface UrgencyRule {
  level: 2 | 3;
  category: string;
  pattern: RegExp;
  innerPredicates?: RegExp;
  checkAccidentContext?: boolean;
}

const LEVEL3_RULES: readonly UrgencyRule[] = [
  {
    level: 3,
    category: "explicit_urgent_tag",
    pattern: /（急）|\(急\)|【急】|特急|加急/g,
  },
  {
    level: 3,
    category: "trapped_or_injury",
    pattern:
      /(?:电梯|人员|住户|乘客|老人|儿童|孩子|群众)[^，。！？；;\n]{0,10}(?:被困|困人|坠梯|急坠|下坠)|(?:被困|困人)(?:电梯|在电梯|求助|求救)|人员伤亡|伤人|急救/g,
    innerPredicates: /(?:被困|困人|坠梯|急坠|下坠|伤亡|伤人)/,
  },
  {
    level: 3,
    category: "fire_gas_electricity",
    pattern:
      /火灾|起火|着火|明火|浓烟|燃爆|燃气(?:严重)?泄漏|煤气(?:严重|大量)?泄漏|天然气泄漏|漏气|管道破裂|爆管喷涌|漏电|触电|高压电线(?:掉落|断落|垂落)/g,
    innerPredicates: /(?:泄漏|漏气|破裂|喷涌|掉落|断落|垂落)/,
  },
  {
    level: 3,
    category: "municipal_life_hazard",
    pattern:
      /井盖缺失|窨井盖缺失|井盖破损|井盖移位|路面塌陷|突发地陷|坍塌|山体滑坡|泥石流|高空坠物|外墙脱落|墙体开裂|危房|桥梁隐患|毒气|食物中毒|群体中毒|重大(?:交通(?:安全)?|生产安全|安全|火灾)?事故/g,
    checkAccidentContext: true,
  },
  {
    level: 3,
    category: "fire_exit_blockage",
    pattern:
      /消防通道(?:被)?(?:堵塞|占用|锁闭|封堵)|安全出口(?:被)?(?:堵塞|锁闭|封堵)|消防应急通道(?:被)?(?:堵塞|占用|锁闭)/g,
    innerPredicates: /(?:堵塞|占用|锁闭|封堵)/,
  },
];

const LEVEL2_RULES: readonly UrgencyRule[] = [
  {
    level: 2,
    category: "utility_or_traffic_disruption",
    pattern:
      /大面积(?:停水|停电|停气)|停水|断水|停电|断电|停气|供暖中断|水管爆裂|爆管|污水横流|化粪池漫溢|积水严重|严重阻碍|交通瘫痪|信号灯故障|红绿灯故障|道路严重破损/g,
    innerPredicates: /(?:停水|停电|停气)/,
  },
  {
    level: 2,
    category: "active_safety_hazard_or_repeat",
    pattern: /安全隐患|重大隐患|多次反映未果|反复投诉|紧急处理/g,
  },
];

const ADVERSATIVE_GAP = "(?:(?!但|却|不过|可是|然而)[^，。！？；;\\n])";

const NEG_PREFIX_RE = new RegExp(
  `(?:(?:并非|不是|没有发生|未发生|没(?:有|发生|出现|见|发现|造成|引发|酿成|导致|涉及)|并未|未见|未出现|未(?!来|果)|不存在|已排除|排除|不涉及|防止|预防|杜绝|辟谣|谣言|虚假|避免|谨防|严防|切勿|不要|禁止|已消除|已修复|已解决|已检修|无需)${ADVERSATIVE_GAP}{0,8}|无(?:任何|明显|实际|发生|人员|迹象)?${ADVERSATIVE_GAP}{0,6}|无人|无|没人|(?<![淹沉埋吞])没)$`
);

const RESOLVED_SUFFIX_RE = /^(?:问题)?(?:已修复|已解决|已排除|已消除|已处置|已清理|已恢复|已开通)/;

const ACCIDENT_PREVENTIVE_PREFIX_RE =
  /(?:(?:容易|极易|很易|较易|易|可能会?|或许会?|也许会?|恐会?|难免会?|防止|预防|避免|谨防|严防|杜绝|以免|以防)(?:引发|造成|发生|导致|出现|酿成|带来|产生|诱发|演变成){0,2})(?:(?:非常|极其|很|比较|较)?(?:严重的?|恶劣的?|更大的?|类似的?|新的?|不必要的?|惨重的?|潜在的?)|一起|各类|各种)?$/;
const ACCIDENT_POST_HAZARD_RE =
  /^(?:的(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头|可能(?:性)?)|(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头))/;

function isNegatedUrgencyMatch(text: string, rule: UrgencyRule, match: RegExpExecArray): boolean {
  const idx = match.index;
  const matched = match[0];
  const pre = text.slice(Math.max(0, idx - 16), idx);
  if (NEG_PREFIX_RE.test(pre)) {
    return true;
  }

  // 若模式中包含前置主体（如“电梯故障无人被困”），补充检查核心动作词前 16 字
  if (rule.innerPredicates) {
    const inner = rule.innerPredicates.exec(matched);
    if (inner && inner.index > 0) {
      const innerStart = idx + inner.index;
      const innerPre = text.slice(Math.max(0, innerStart - 16), innerStart);
      if (NEG_PREFIX_RE.test(innerPre)) {
        return true;
      }
    }
  }

  // “井盖破损已修复”“消防通道已清理”等已闭环表述降级为非高危
  const post = text.slice(idx + matched.length, Math.min(text.length, idx + matched.length + 8));
  if (RESOLVED_SUFFIX_RE.test(post)) {
    return true;
  }

  if (rule.checkAccidentContext && /^重大.*事故$/.test(matched)) {
    const accidentPre = text.slice(Math.max(0, idx - 20), idx);
    if (ACCIDENT_PREVENTIVE_PREFIX_RE.test(accidentPre) || ACCIDENT_POST_HAZARD_RE.test(post)) {
      return true;
    }
  }

  return false;
}

/**
 * 对政务工单标题/正文执行否定敏感的紧迫度规则评估。
 * 优先级：Level 3（URGENT） > Level 2（MEDIUM） > Level 1（NORMAL）。
 */
export function assessCivicUrgency(text: string): CivicUrgencySignal {
  if (!text || typeof text !== "string") {
    return { level: 1, urgency: "NORMAL", slaHours: 120, negatedOnly: false };
  }

  let sawNegatedHazard = false;

  for (const rules of [LEVEL3_RULES, LEVEL2_RULES]) {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = rule.pattern.exec(text)) !== null) {
        if (isNegatedUrgencyMatch(text, rule, match)) {
          sawNegatedHazard = true;
          continue;
        }
        return {
          level: rule.level,
          urgency: rule.level === 3 ? "URGENT" : "MEDIUM",
          slaHours: rule.level === 3 ? 2 : 24,
          category: rule.category,
          keyword: match[0],
          negatedOnly: false,
        };
      }
    }
  }

  return {
    level: 1,
    urgency: "NORMAL",
    slaHours: 120,
    negatedOnly: sawNegatedHazard,
  };
}
