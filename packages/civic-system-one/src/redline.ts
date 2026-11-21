/**
 * 12345 政务高危涉稳与极端安全红线符号检测器（带否定/防误杀上下文窗口）
 *
 * 与 ONNX 涉稳分类头组成双保险硬互锁：
 * 1. 覆盖 10 类极端高危场景（自杀自残、极端暴力、群体/越级上访、群体聚集抗议、堵路堵门、罢工、重大安全险情、群体食安中毒、重大舆情曝光、极端威胁表述）。
 * 2. 通过 16 字前向语境窗口过滤否定/未发生/辟谣/预防表述（如"并非跳楼"、"没有发生食物中毒"、"无食物中毒"、"已排除群体上访"），同时避免误伤"无果/无奈/未果"与"交通拥堵路况"、"市监局"等常规诉求。
 */

export interface CivicRedlineMatch {
  matched: boolean;
  category?: string;
  keyword?: string;
}

interface RedlineRule {
  category: string;
  pattern: RegExp;
  checkWorryWindow?: boolean;
}

const REDLINE_RULES: readonly RedlineRule[] = [
  {
    category: "suicide_self_harm",
    pattern: /跳楼|跳桥|跳河|轻生|自杀|自残|自焚|寻短见|割腕|服毒|不想活|生无可恋|一起死/g,
  },
  {
    category: "extreme_violence",
    pattern: /报复社会|扬言报复|威胁报复|杀人|持刀伤人|持刀砍|砍伤|持械伤人|行凶伤人|砍人|血案|同归于尽|鱼死网破|与人拼命|放火|纵火|泼汽油|带汽油|携带炸药|安放炸弹|群殴|聚众斗殴/g,
    checkWorryWindow: true,
  },
  {
    category: "organized_crime",
    pattern: /涉黑(?:涉恶)?|涉恶|黑恶势力|强迫交易|收取保护费|欺行霸市/g,
  },
  {
    category: "group_petition",
    pattern: /集体上访|越级上访|进京上访|赴省进京|到北京上访|组织上访|串联上访|上访|维稳/g,
  },
  {
    category: "mass_gathering_protest",
    pattern: /群体性?(?:事件|纠纷|维权|抗议|聚集)|集体维权|集体抗议|集体讨薪|聚众(?:闹事|维权|抗议|堵路|堵门|讨薪|示威|冲击|围堵)|串联聚集|拉横幅|静坐抗议|绝食|下跪维权|抬棺/g,
  },
  {
    category: "road_gate_blockade",
    pattern: /(?<!拥)堵路(?!况|段)|(?<!施工)封路(?!施工)(?:维权|抗议|讨薪)?|堵桥|封桥|堵门|围堵|阻断交通/g,
  },
  {
    category: "collective_strike",
    pattern: /罢工|煽动罢工|号召罢工|集体停工/g,
  },
  {
    category: "major_safety_incident",
    pattern: /重大(?:交通(?:安全)?|生产安全|安全|火灾)?事故|突发地陷|路面塌陷|坍塌|毒气(?:泄漏)?|投毒|燃气严重泄漏|煤气大量泄漏|(?:发生|突发|引发|造成)爆炸|爆炸起火|(?:化工厂|厂房|车间|燃气管道|危化品|仓库|现场)[^，。]{0,6}爆炸|伤亡|人身伤害|人员重伤|多人重伤|重伤被困/g,
  },
  {
    category: "food_poisoning",
    pattern: /食物中毒|群体中毒|集体腹泻|集体呕吐/g,
  },
  {
    category: "major_media_escalation",
    pattern: /媒体曝光|全网曝光|黑猫投诉|上热搜/g,
  },
  {
    category: "extreme_threat",
    pattern: /(?:扬言|威胁|声称|逼得)[^，。！？；;\n]{0,12}(?:闹事|拼命|极端|出人命|没法活)/g,
  },
];

const ADVERSATIVE_GAP = "(?:(?!但|却|不过|可是|然而)[^，。！？；;\\n])";

const NEG_PREFIX_RE = new RegExp(
  `(?:(?:并非|不是|没有发生|未发生|没有|并未|未见|未出现|未(?!来|果)|不存在|已排除|排除|不涉及|防止|预防|杜绝|辟谣|谣言|虚假|避免|谨防|严防|切勿|不要|禁止)${ADVERSATIVE_GAP}{0,8}|无(?:任何|明显|实际|发生|人员|迹象)${ADVERSATIVE_GAP}{0,6}|无人|无)$`
);

const FOOD_SAFETY_CHAIN_NEG_RE =
  /(?:没有发生|未发生|没有|并未|未见|未出现|不存在|已排除|排除|不涉及|无)(?:(?:任何|明显|实际)的?)?(?:(?:食物中毒|群体中毒|(?:群体|集体)?(?:腹泻|呕吐))(?:及|和|或|与|、))+(?:群体|集体)?$/;

const WORRY_PREFIX_RE = new RegExp(
  `(?:担心|害怕|生怕|谨防|避免)${ADVERSATIVE_GAP}{0,8}$`
);

const ACCIDENT_PREVENTIVE_PREFIX_RE =
  /(?:(?:容易|极易|很易|较易|易|可能会?|或许会?|也许会?|恐会?|难免会?|防止|预防|避免|谨防|严防|杜绝|以免|以防)(?:引发|造成|发生|导致|出现|酿成|带来|产生|诱发|演变成){0,2})(?:(?:非常|极其|很|比较|较)?(?:严重的?|恶劣的?|更大的?|类似的?|新的?|不必要的?|惨重的?|潜在的?)|一起|各类|各种)?$/;
const ACCIDENT_POST_HAZARD_RE =
  /^(?:的(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头|可能(?:性)?)|(?:安全|潜在|重大|严重){0,2}(?:隐患|风险|苗头))/;

const EXPLOSION_BENIGN_CONTEXT_RE =
  /(?:锅|灯泡|热水器|烧水器|油烟机|抽油烟机|消毒柜|燃气灶|煤气灶|煤气瓶|电瓶(?!车)|筒灯|玻璃|钢化玻璃|如果[^，。]{0,8}发生爆炸)/;
const EXPLOSION_INDUSTRIAL_CONTEXT_RE =
  /(?:化工厂|厂房|车间|燃气管道|危化品|仓库)/;

/**
 * 匹配政务涉稳红线信号并返回命中的类别与关键词；若全部处于否定/预防语境则返回 { matched: false }。
 */
export function matchCivicRedline(text: string): CivicRedlineMatch {
  if (!text || typeof text !== "string") {
    return { matched: false };
  }

  for (const rule of REDLINE_RULES) {
    rule.pattern.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = rule.pattern.exec(text)) !== null) {
      const idx = m.index;
      const matched = m[0];
      const pre = text.slice(Math.max(0, idx - 16), idx);
      if (NEG_PREFIX_RE.test(pre)) {
        continue;
      }
      if (rule.category === "food_poisoning") {
        const beforeFood = text.slice(Math.max(0, idx - 24), idx);
        if (FOOD_SAFETY_CHAIN_NEG_RE.test(beforeFood)) {
          continue;
        }
      }
      if (rule.checkWorryWindow && WORRY_PREFIX_RE.test(pre)) {
        continue;
      }
      if (/^重大.*事故$/.test(matched)) {
        const accidentPre = text.slice(Math.max(0, idx - 20), idx);
        const accidentAfter = text.slice(
          idx + matched.length,
          Math.min(text.length, idx + matched.length + 8)
        );
        if (
          ACCIDENT_PREVENTIVE_PREFIX_RE.test(accidentPre) ||
          ACCIDENT_POST_HAZARD_RE.test(accidentAfter)
        ) {
          continue;
        }
      }
      if (matched.includes("爆炸")) {
        const expOffset = matched.indexOf("爆炸");
        if (expOffset > 0) {
          const expIdx = idx + expOffset;
          const beforeExplosion = text.slice(Math.max(0, expIdx - 16), expIdx);
          if (NEG_PREFIX_RE.test(beforeExplosion)) {
            continue;
          }
        }
        const explosionWindow = text.slice(
          Math.max(0, idx - 60),
          Math.min(text.length, idx + matched.length + 20)
        );
        if (
          EXPLOSION_BENIGN_CONTEXT_RE.test(explosionWindow) &&
          !EXPLOSION_INDUSTRIAL_CONTEXT_RE.test(explosionWindow)
        ) {
          continue;
        }
      }
      return {
        matched: true,
        category: rule.category,
        keyword: matched,
      };
    }
  }

  return { matched: false };
}

/**
 * 判断文本是否触发政务涉稳硬红线。
 */
export function hasCivicRedlineSignal(text: string): boolean {
  return matchCivicRedline(text).matched;
}
